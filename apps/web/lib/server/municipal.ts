// Acompanhamento da totalização por município (mapa municipal).
//
// A totalização de uma seção inclui todos os cargos da urna ao mesmo tempo. Por isso basta ler
// o arquivo municipal de um cargo leve (Governador, eleição estadual) para saber quanto de cada
// município já foi apurado — o mesmo andamento vale para Senador e Deputados Federal/Estadual.

import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  electionCodeFor,
  municipalResultUrl,
  municipalityConfigUrl,
  normalizePlaceName,
  parseMunicipalityConfig,
  parseSimplifiedResult,
  type RaceStatus,
  type TseMunicipality,
} from "@apuracao/core";
import type { Ingestor } from "./ingestor";

const OFFICE = "governador" as const;

export interface MunicipalityStatus {
  ibge: string;
  name: string;
  sectionsTotalizedPct: number;
  status: RaceStatus;
  officialTimestamp: string | null;
}

export interface MunicipalSnapshot {
  uf: string;
  source: "tse" | "mock";
  /** Municípios do mapa que têm correspondência na lista oficial do TSE. */
  matched: number;
  total: number;
  updatedAt: string | null;
  municipalities: MunicipalityStatus[];
}

interface Entry extends MunicipalityStatus {
  tseCode: string | null;
  etag?: string;
  lastModified?: string;
}

interface MapFile {
  municipalities: { ibge: string; name: string }[];
}

export class MunicipalTracker {
  private readonly entries = new Map<string, Entry>();
  private ready: Promise<void>;
  private matchedTse = false;
  private updatedAt: string | null = null;
  private running = false;
  private readonly startedAt = Date.now();
  readonly intervalMs: number;

  constructor(
    private readonly ingestor: Ingestor,
    readonly uf: string,
  ) {
    const mock = ingestor.config.source === "mock";
    this.intervalMs = Number(process.env.MUNICIPAL_POLL_MS) || (mock ? 10_000 : 60_000);
    this.ready = this.loadMap();
  }

  private async loadMap() {
    const file = path.join(/* turbopackIgnore: true */ process.cwd(), "public", "maps", `${this.uf}-municipios.json`);
    const map = JSON.parse(await readFile(file, "utf8")) as MapFile;
    for (const m of map.municipalities) {
      this.entries.set(m.ibge, {
        ibge: m.ibge,
        name: m.name,
        tseCode: null,
        sectionsTotalizedPct: 0,
        status: "AGUARDANDO",
        officialTimestamp: null,
      });
    }
  }

  start() {
    const tick = async () => {
      await this.runCycle().catch((err) => this.ingestor.log("error", `Mapa municipal ${this.uf.toUpperCase()}: ${String(err)}`));
      setTimeout(tick, this.intervalMs);
    };
    setTimeout(tick, 2_000);
  }

  private get electionCode() {
    return electionCodeFor(this.ingestor.config.electionCodes, OFFICE);
  }

  /** Associa a lista oficial de municípios do TSE ao desenho do mapa (pelo código IBGE ou pelo nome). */
  private async matchTseMunicipalities(): Promise<boolean> {
    const url = municipalityConfigUrl(this.ingestor.config.endpoint, this.electionCode);
    const res = await this.ingestor.httpGet(url);
    if (res.kind !== "new") return false;
    const list: TseMunicipality[] = parseMunicipalityConfig(JSON.parse(res.body), this.uf);
    const byName = new Map([...this.entries.values()].map((e) => [normalizePlaceName(e.name), e]));
    let matched = 0;
    const unmatched: string[] = [];
    for (const m of list) {
      const entry = (m.ibge && this.entries.get(m.ibge)) || byName.get(normalizePlaceName(m.name));
      if (entry) {
        entry.tseCode = m.tseCode;
        matched++;
      } else unmatched.push(m.name);
    }
    this.ingestor.log(
      unmatched.length ? "warn" : "info",
      `Mapa municipal ${this.uf.toUpperCase()}: ${matched} de ${this.entries.size} municípios associados à lista do TSE` +
        (unmatched.length ? ` (sem correspondência: ${unmatched.slice(0, 5).join(", ")})` : ""),
    );
    return matched > 0;
  }

  async runCycle() {
    if (this.running) return;
    this.running = true;
    try {
      await this.ready;
      const mock = this.ingestor.config.source === "mock";
      if (!mock && !this.matchedTse) {
        this.matchedTse = await this.matchTseMunicipalities();
        if (!this.matchedTse) return;
      }

      let changed = false;
      const queue = [...this.entries.values()].filter((e) => mock || e.tseCode);
      const worker = async () => {
        for (let e = queue.shift(); e; e = queue.shift()) {
          try {
            if (mock ? this.updateMock(e) : await this.updateFromTse(e)) changed = true;
          } catch {
            // Falhas pontuais de um município não interrompem o ciclo; o próximo ciclo tenta de novo.
          }
        }
      };
      await Promise.all(Array.from({ length: 6 }, worker));

      if (changed) {
        this.updatedAt = new Date().toISOString();
        this.ingestor.emit("live", { type: "municipal_update", state: this.uf.toUpperCase(), timestamp: this.updatedAt });
      }
    } finally {
      this.running = false;
    }
  }

  private async updateFromTse(e: Entry): Promise<boolean> {
    const url = municipalResultUrl(this.ingestor.config.endpoint, this.electionCode, OFFICE, this.uf, e.tseCode!);
    const res = await this.ingestor.httpGet(url, e);
    if (res.kind !== "new") return false;
    e.etag = res.etag;
    e.lastModified = res.lastModified;
    const r = parseSimplifiedResult(JSON.parse(res.body), { office: OFFICE, scope: this.uf, round: this.ingestor.config.round });
    if (r.sectionsTotalizedPct === e.sectionsTotalizedPct && r.status === e.status) return false;
    e.sectionsTotalizedPct = r.sectionsTotalizedPct;
    e.status = r.status;
    e.officialTimestamp = r.officialTimestamp;
    return true;
  }

  /** Simulação: cada município começa num momento diferente e cidades pequenas terminam antes. */
  private updateMock(e: Entry): boolean {
    const seed = Number(e.ibge.slice(-4));
    const duration = this.ingestor.config.mockDurationMs;
    const start = ((seed % 37) / 100) * duration;
    const length = (0.25 + ((seed * 7) % 50) / 100) * duration;
    const pct = Math.max(0, Math.min(100, ((Date.now() - this.startedAt - start) / length) * 100));
    const rounded = Math.round(pct * 100) / 100;
    if (rounded === e.sectionsTotalizedPct) return false;
    e.sectionsTotalizedPct = rounded;
    e.status = rounded >= 100 ? "TOTALIZACAO_FINALIZADA" : rounded > 0 ? "APURACAO_EM_ANDAMENTO" : "AGUARDANDO";
    e.officialTimestamp = new Date().toISOString();
    return true;
  }

  /** Municípios do mapa com o código do TSE (null enquanto a lista oficial não foi associada). */
  municipalities(): { ibge: string; name: string; tseCode: string | null }[] {
    return [...this.entries.values()].map(({ ibge, name, tseCode }) => ({ ibge, name, tseCode }));
  }

  async whenReady() {
    await this.ready;
  }

  getSnapshot(): MunicipalSnapshot {
    const list = [...this.entries.values()];
    return {
      uf: this.uf.toUpperCase(),
      source: this.ingestor.config.source,
      matched: this.ingestor.config.source === "mock" ? list.length : list.filter((e) => e.tseCode).length,
      total: list.length,
      updatedAt: this.updatedAt,
      municipalities: list.map(({ ibge, name, sectionsTotalizedPct, status, officialTimestamp }) => ({
        ibge,
        name,
        sectionsTotalizedPct,
        status,
        officialTimestamp,
      })),
    };
  }
}

/** UFs com mapa municipal (precisam do desenho em public/maps/<uf>-municipios.json). */
export const MUNICIPAL_UFS = (process.env.MUNICIPAL_UFS ?? "sp")
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);
