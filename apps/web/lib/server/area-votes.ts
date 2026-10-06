// Votos de um candidato numa área de uma cidade (distrito de São Paulo, ou bairro pelo nome),
// somando os boletins de urna das seções cujos locais de votação ficam na área.
//
// 1. Locais de votação da cidade (cadastro do TSE, com coordenadas) → locais dentro do distrito
//    (contorno oficial da Prefeitura de São Paulo) ou cujo bairro/nome contém o texto pedido.
// 2. Boletim de urna de cada seção desses locais → votos do candidato, aptos e comparecimento.

import { promises as fs } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { normalizePlaceName, parseBuCandidateVotes, parseBuDer, type PollingPlaceRow } from "@apuracao/core";
import type { Ingestor } from "./ingestor";
import type { MunicipalityRegistry } from "./municipal";
import { PollingPlaces } from "./locais";
import { fetchSectionBu, resolvePleito, tseCodeOf } from "./urna-files";

const CACHE_VERSION = 1;
const CONCURRENCY = 6;

export type AreaSpec = { kind: "district"; name: string; polygons: number[][][][] } | { kind: "text"; text: string };

interface SectionResult {
  zone: string;
  section: string;
  place: string;
  done: boolean;
  status: string;
  votes: number;
  electorate: number;
  turnout: number;
}

export interface AreaVotesSnapshot {
  uf: string;
  city: string;
  area: string;
  areaKind: AreaSpec["kind"];
  candidate: { number: string; name: string };
  status: "preparing" | "running" | "done" | "error";
  message: string | null;
  updatedAt: string | null;
  progress: { done: number; total: number; failures: number };
  placesStatus: PollingPlaces["snapshot"];
  totals: { sections: number; read: number; votes: number; electorate: number; turnout: number };
  places: {
    zone: string;
    code: string;
    name: string;
    address: string;
    bairro: string;
    sections: number;
    read: number;
    votes: number;
    electorate: number;
    turnout: number;
  }[];
  /** Locais da cidade sem coordenadas no cadastro (não dá para saber se ficam no distrito). */
  placesWithoutCoords: number;
}

/** Ponto dentro de um (multi)polígono [lon, lat] (regra par-ímpar, considerando buracos). */
export function insidePolygons(lon: number, lat: number, polygons: number[][][][]): boolean {
  let inside = false;
  for (const polygon of polygons) {
    for (const ring of polygon) {
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xi, yi] = ring[i] as [number, number];
        const [xj, yj] = ring[j] as [number, number];
        if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
      }
    }
  }
  return inside;
}

const pad = (v: string) => v.padStart(4, "0");

export class AreaVotesQuery {
  private status: AreaVotesSnapshot["status"] = "preparing";
  private message: string | null = null;
  private updatedAt: string | null = null;
  private progress = { done: 0, total: 0, failures: 0 };
  private selected: PollingPlaceRow[] = [];
  private withoutCoords = 0;
  private readonly results = new Map<string, SectionResult>();
  private running = false;
  private lastRun = 0;
  private readonly cacheFile: string;
  private readonly loaded: Promise<void>;

  constructor(
    private readonly ingestor: Ingestor,
    private readonly registry: MunicipalityRegistry,
    private readonly places: PollingPlaces,
    readonly uf: string,
    readonly city: string,
    readonly area: AreaSpec,
    readonly candidate: { number: string; name: string },
  ) {
    const key = createHash("sha1").update(JSON.stringify([uf, normalizePlaceName(city), this.areaLabel(), candidate.number])).digest("hex").slice(0, 12);
    this.cacheFile = path.join(ingestor.config.dataDir, "cities", `area-votos-${key}.json`);
    this.loaded = this.loadCache();
  }

  private areaLabel() {
    return this.area.kind === "district" ? this.area.name : this.area.text;
  }

  private async loadCache() {
    try {
      const saved = JSON.parse(await fs.readFile(this.cacheFile, "utf8")) as { version: number; updatedAt: string; results: SectionResult[] };
      if (saved.version !== CACHE_VERSION) return;
      this.updatedAt = saved.updatedAt;
      for (const r of saved.results) this.results.set(`${r.zone}-${r.section}`, r);
    } catch {
      // Sem cache ainda.
    }
  }

  private async saveCache() {
    await fs.mkdir(path.dirname(this.cacheFile), { recursive: true });
    const data = { version: CACHE_VERSION, updatedAt: this.updatedAt, results: [...this.results.values()] };
    await fs.writeFile(`${this.cacheFile}.tmp`, JSON.stringify(data), "utf8");
    await fs.rename(`${this.cacheFile}.tmp`, this.cacheFile);
  }

  /** Começa (ou retoma, depois de 3 min) a leitura das seções que faltam. */
  ensureRunning() {
    if (this.running || (this.status === "done" && Date.now() - this.lastRun < 180_000)) return;
    this.running = true;
    void this.run()
      .catch((err) => {
        this.status = "error";
        this.message = err instanceof Error ? err.message : String(err);
        this.ingestor.log("warn", `Votos por área (${this.city} / ${this.areaLabel()}): ${this.message}`);
      })
      .finally(() => {
        this.running = false;
        this.lastRun = Date.now();
      });
  }

  private async run() {
    await this.loaded;
    this.status = "preparing";
    this.message = null;
    if (!(await this.registry.ensureTseCodes())) throw new Error(this.registry.lastError ?? "lista de municípios do TSE ainda não disponível");
    const tseCode = tseCodeOf(this.registry, this.city);
    if (!tseCode) throw new Error(`${this.city} não encontrada na lista de municípios do TSE`);

    this.places.ensure(tseCode);
    await this.places.whenSettled();
    if (this.places.snapshot.status !== "ready") {
      throw new Error(`cadastro de locais de votação indisponível: ${this.places.snapshot.message ?? this.places.snapshot.status}`);
    }
    const rows = this.places.rows;
    this.withoutCoords = new Set(rows.filter((r) => r.lat === null).map((r) => `${r.zone}-${r.code}`)).size;
    if (this.area.kind === "district") {
      const polygons = this.area.polygons;
      this.selected = rows.filter((r) => r.lat !== null && r.lon !== null && insidePolygons(r.lon, r.lat, polygons));
    } else {
      const wanted = normalizePlaceName(this.area.text);
      this.selected = rows.filter((r) => normalizePlaceName(r.bairro).includes(wanted) || normalizePlaceName(r.name).includes(wanted));
    }
    if (this.selected.length === 0) {
      this.status = "done";
      this.message = "Nenhum local de votação encontrado nesta área.";
      return;
    }

    const pleito = await resolvePleito(this.ingestor);
    const queue = this.selected.filter((r) => !this.results.get(`${r.zone}-${r.section}`)?.done);
    this.progress = { done: 0, total: queue.length, failures: 0 };
    this.status = "running";
    let sinceSave = 0;
    const worker = async () => {
      for (let r = queue.shift(); r; r = queue.shift()) {
        const ref = { zone: pad(r.zone), section: pad(r.section) };
        try {
          const bu = await fetchSectionBu(this.ingestor, pleito, this.uf, tseCode, ref);
          const base = { zone: r.zone, section: r.section, place: r.code };
          if (bu.kind === "missing") {
            this.results.set(`${r.zone}-${r.section}`, { ...base, done: false, status: bu.status, votes: 0, electorate: 0, turnout: 0 });
          } else {
            const votes = parseBuCandidateVotes(bu.bytes, [this.candidate.number]);
            if (!votes) throw new Error("boletim de urna ilegível");
            const summary = parseBuDer(bu.bytes);
            this.results.set(`${r.zone}-${r.section}`, {
              ...base,
              done: true,
              status: bu.aux.status || "Totalizada",
              votes: votes.get(this.candidate.number) ?? 0,
              electorate: summary?.electorate ?? 0,
              turnout: summary?.turnout ?? 0,
            });
            if (++sinceSave >= 50) {
              sinceSave = 0;
              this.updatedAt = new Date().toISOString();
              await this.saveCache().catch(() => {});
            }
          }
        } catch (err) {
          this.progress.failures++;
          this.message = `Zona ${r.zone} seção ${r.section}: ${err instanceof Error ? err.message : String(err)}`;
        }
        this.progress.done++;
      }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    this.updatedAt = new Date().toISOString();
    await this.saveCache().catch(() => {});
    this.status = "done";
  }

  getSnapshot(): AreaVotesSnapshot {
    const byPlace = new Map<string, AreaVotesSnapshot["places"][number]>();
    const totals = { sections: this.selected.length, read: 0, votes: 0, electorate: 0, turnout: 0 };
    for (const r of this.selected) {
      const key = `${r.zone}-${r.code}`;
      let p = byPlace.get(key);
      if (!p) {
        p = { zone: r.zone, code: r.code, name: r.name, address: r.address, bairro: r.bairro, sections: 0, read: 0, votes: 0, electorate: 0, turnout: 0 };
        byPlace.set(key, p);
      }
      p.sections++;
      const res = this.results.get(`${r.zone}-${r.section}`);
      if (res?.done) {
        p.read++;
        p.votes += res.votes;
        p.electorate += res.electorate;
        p.turnout += res.turnout;
        totals.read++;
        totals.votes += res.votes;
        totals.electorate += res.electorate;
        totals.turnout += res.turnout;
      }
    }
    return {
      uf: this.uf.toUpperCase(),
      city: this.city,
      area: this.areaLabel(),
      areaKind: this.area.kind,
      candidate: this.candidate,
      status: this.status,
      message: this.message,
      updatedAt: this.updatedAt,
      progress: { ...this.progress },
      placesStatus: this.places.snapshot,
      totals,
      places: [...byPlace.values()].sort((a, b) => b.votes - a.votes || a.name.localeCompare(b.name, "pt-BR")),
      placesWithoutCoords: this.withoutCoords,
    };
  }
}
