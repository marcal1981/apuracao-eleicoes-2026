// Abstenção por seção eleitoral de uma cidade, lida dos boletins de urna publicados pelo TSE.
//
// Para cada seção: arquivo auxiliar (situação + arquivos da urna) e a imagem em texto do boletim (.imgbu),
// de onde saem eleitores aptos, comparecimento e faltosos. Boletim lido não muda mais, então só as
// seções ainda sem boletim são consultadas de novo (a cada 3 min). O resultado fica em disco.

import { promises as fs } from "node:fs";
import path from "node:path";
import {
  describeDer,
  parseBuCandidateVotes,
  parseBuCargoVotes,
  parseBuDer,
  parseBuImage,
  parseSectionAux,
  parseUrnaConfig,
  sectionAuxUrl,
  sectionFileUrl,
  urnaConfigUrl,
  type SectionRef,
} from "@apuracao/core";
import type { Ingestor } from "./ingestor";
import type { MunicipalityRegistry } from "./municipal";
import { PollingPlaces } from "./locais";
import { fetchBytes, resolvePleito, tseCodeOf } from "./urna-files";

// 3: aptos e comparecimento lidos da eleição e conferidos com a soma dos votos (versões 1 e 2 guardaram números errados).
const CACHE_VERSION = 3;
const CONCURRENCY = 6;

export interface SectionAbstention {
  zone: string;
  section: string;
  place: string | null;
  status: string;
  electorate: number;
  turnout: number;
  abstention: number;
  abstentionPct: number;
  /** true quando o boletim de urna já foi lido. */
  done: boolean;
  /** Votos dos candidatos em destaque nesta seção (número → votos). */
  votes?: Record<string, number>;
  /** Números de candidatos procurados quando o boletim foi lido (para reler se a lista mudar). */
  votesKey?: string;
  /** Votos para Presidente na seção: número do candidato → votos, mais "branco" e "nulo". */
  presVotes?: Record<string, number>;
}

export interface FeaturedCandidate {
  number: string;
  name: string;
  office: string;
}

/** Local de votação com as seções dele (coordenadas do cadastro do TSE). */
export interface PlaceInfo {
  zone: string;
  code: string;
  name: string;
  address: string;
  bairro: string;
  lat: number | null;
  lon: number | null;
}

export interface SectionsSnapshot {
  city: string;
  slug: string;
  uf: string;
  updatedAt: string | null;
  pleito: string | null;
  totals: { sections: number; read: number; electorate: number; turnout: number; abstention: number; abstentionPct: number };
  progress: { running: boolean; done: number; total: number; failures: number; lastError: string | null };
  /** Exemplo do que veio do TSE (ajuda a diagnosticar mudanças de formato). */
  sample: {
    aux: string[] | null;
    bu: string | null;
    /** Última consulta de arquivo auxiliar que não trouxe boletim: endereço, resposta e trecho do conteúdo. */
    lastAuxUrl?: string | null;
    lastAuxResult?: string | null;
    lastAuxBody?: string | null;
  };
  sections: SectionAbstention[];
  /** Candidatos em destaque cujos votos são lidos dos boletins. */
  candidates: FeaturedCandidate[];
  places: PlaceInfo[];
  placesStatus: PollingPlaces["snapshot"];
}

const keyOf = (s: SectionRef) => `${s.zone}-${s.section}`;

export class SectionAbstentionTracker {
  private readonly sections = new Map<string, SectionAbstention>();
  private refs: SectionRef[] = [];
  private pleito: string | null = process.env.TSE_PLEITO || null;
  private progress = { running: false, done: 0, total: 0, failures: 0, lastError: null as string | null };
  private sample: SectionsSnapshot["sample"] = { aux: null, bu: null };
  private updatedAt: string | null = null;
  private running = false;
  private started = false;
  private readonly startedAt = Date.now();
  private readonly cacheFile: string;
  private readonly loaded: Promise<void>;
  private readonly mock: boolean;
  private readonly places: PollingPlaces;

  constructor(
    private readonly ingestor: Ingestor,
    private readonly registry: MunicipalityRegistry,
    readonly uf: string,
    readonly city: string,
    readonly slug: string,
    private readonly featured: () => FeaturedCandidate[] = () => [],
  ) {
    this.mock = ingestor.config.source === "mock";
    this.cacheFile = path.join(ingestor.config.dataDir, "cities", `secoes-${slug}${this.mock ? "-mock" : ""}.json`);
    this.loaded = this.loadCache();
    this.places = new PollingPlaces(ingestor, uf, slug);
  }

  private async loadCache() {
    try {
      const saved = JSON.parse(await fs.readFile(this.cacheFile, "utf8")) as {
        version: number;
        updatedAt: string | null;
        pleito: string | null;
        refs: SectionRef[];
        sections: SectionAbstention[];
      };
      if (saved.version !== CACHE_VERSION) return;
      this.updatedAt = saved.updatedAt;
      this.pleito ??= saved.pleito;
      this.refs = saved.refs;
      for (const s of saved.sections) this.sections.set(keyOf(s), s);
    } catch {
      // Sem cache ainda.
    }
  }

  private async saveCache() {
    await fs.mkdir(path.dirname(this.cacheFile), { recursive: true });
    const data = { version: CACHE_VERSION, updatedAt: this.updatedAt, pleito: this.pleito, refs: this.refs, sections: [...this.sections.values()] };
    await fs.writeFile(`${this.cacheFile}.tmp`, JSON.stringify(data), "utf8");
    await fs.rename(`${this.cacheFile}.tmp`, this.cacheFile);
  }

  /** Começa a leitura na primeira vez que a página é aberta (evita consultas que ninguém vai ver). */
  ensureStarted() {
    if (this.started || process.env.INGESTION_DISABLED === "true") return;
    this.started = true;
    const intervalMs = Number(process.env.SECTIONS_POLL_MS) || (this.mock ? 10_000 : 180_000);
    const tick = async () => {
      await this.runCycle().catch((err) => {
        this.progress.lastError = err instanceof Error ? err.message : String(err);
        this.ingestor.log("error", `Seções ${this.city}: ${this.progress.lastError}`);
      });
      // Continua consultando: seções ainda sem boletim e candidatos em destaque que apareçam depois.
      setTimeout(tick, this.refs.length === 0 ? 30_000 : intervalMs);
    };
    void tick();
  }



  private async loadRefs(tseCode: string, pleito: string) {
    const url = urnaConfigUrl(this.ingestor.config.endpoint, pleito, this.uf);
    const res = await this.ingestor.httpGet(url, undefined, 60_000);
    if (res.kind !== "new") throw new Error(`lista de seções não disponível no TSE (${url})`);
    const refs = parseUrnaConfig(JSON.parse(res.body), tseCode);
    if (refs.length === 0) throw new Error(`nenhuma seção de ${this.city} (código ${tseCode}) encontrada em ${url}`);
    this.refs = refs;
  }

  async runCycle() {
    if (this.running) return;
    this.running = true;
    try {
      await this.loaded;
      let tseCode = "mock";
      let pleito = "mock";
      if (this.mock) {
        if (this.refs.length === 0) this.refs = mockRefs();
      } else {
        if (!(await this.registry.ensureTseCodes())) throw new Error(this.registry.lastError ?? "lista de municípios do TSE ainda não disponível");
        const code = tseCodeOf(this.registry, this.city);
        if (!code) throw new Error(`${this.city} não encontrada na lista de municípios do TSE`);
        tseCode = code;
        this.places.ensure(code);
        pleito = this.pleito ?? (this.pleito = await resolvePleito(this.ingestor));
        if (this.refs.length === 0) await this.loadRefs(tseCode, pleito);
      }

      // Seções sem boletim lido, ou lidas antes de saber os candidatos em destaque atuais.
      const key = this.votesKey();
      const queue = this.refs.filter((r) => {
        const s = this.sections.get(keyOf(r));
        // (Boletins lidos antes de guardar os votos de Presidente também são relidos uma vez.)
        return !s?.done || (key !== "" && s.votesKey !== key) || !s.presVotes;
      });
      this.progress = { running: true, done: 0, total: queue.length, failures: 0, lastError: null };
      let changed = false;
      let sinceSave = 0;
      const worker = async () => {
        for (let r = queue.shift(); r; r = queue.shift()) {
          try {
            if (this.mock ? this.updateMock(r) : await this.updateFromTse(r, tseCode, pleito)) {
              changed = true;
              if (++sinceSave >= 100) {
                sinceSave = 0;
                this.updatedAt = new Date().toISOString();
                await this.saveCache().catch(() => {});
              }
            }
          } catch (err) {
            this.progress.failures++;
            this.progress.lastError = `Zona ${r.zone} seção ${r.section}: ${err instanceof Error ? err.message : String(err)}`;
          }
          this.progress.done++;
          await new Promise((resolve) => setImmediate(resolve));
        }
      };
      await Promise.all(Array.from({ length: CONCURRENCY }, worker));
      if (this.progress.failures > 0) {
        this.ingestor.log("warn", `Seções ${this.city}: ${this.progress.failures} com falha. Ex.: ${this.progress.lastError}`);
      }
      if (changed) {
        this.updatedAt = new Date().toISOString();
        await this.saveCache().catch(() => {});
      }
    } finally {
      this.progress.running = false;
      this.running = false;
    }
  }

  private async updateFromTse(r: SectionRef, tseCode: string, pleito: string): Promise<boolean> {
    const endpoint = this.ingestor.config.endpoint;
    const auxUrl = sectionAuxUrl(endpoint, pleito, this.uf, tseCode, r);
    const auxRes = await this.ingestor.httpGet(auxUrl, undefined, 20_000);
    if (auxRes.kind !== "new") {
      if (auxRes.kind === "not_published") {
        this.noteAux(auxUrl, `HTTP ${auxRes.status} (arquivo não encontrado no TSE)`, null);
        this.setPending(r, `Sem arquivo da urna (HTTP ${auxRes.status})`);
      }
      return auxRes.kind === "not_published";
    }
    const auxRaw = JSON.parse(auxRes.body) as Record<string, unknown>;
    this.sample.aux ??= Object.keys(auxRaw);
    const aux = parseSectionAux(auxRaw);
    if (!aux.hash || !aux.buFile) {
      this.noteAux(auxUrl, `arquivo lido, mas sem boletim de urna — situação "${aux.status}"`, auxRes.body);
      this.setPending(r, aux.status || "Sem boletim de urna");
      return true;
    }
    const buUrl = sectionFileUrl(endpoint, pleito, this.uf, tseCode, r, aux.hash, aux.buFile);
    const bytes = await fetchBytes(buUrl);
    if (!bytes) {
      this.noteAux(buUrl, "boletim ainda não disponível no TSE", auxRes.body);
      this.setPending(r, aux.status || "Boletim ainda não publicado");
      return true;
    }
    const bu = aux.buKind === "der" ? parseBuDer(bytes) : parseBuImage(new TextDecoder("latin1").decode(bytes));
    if (!this.sample.bu || !bu) {
      this.sample.bu = aux.buKind === "der" ? `${buUrl}\n${describeDer(bytes)}` : new TextDecoder("latin1").decode(bytes).slice(0, 1500);
    }
    if (!bu) throw new Error(`números não encontrados no boletim de urna (${aux.buFile})`);
    const numbers = this.featured().map((c) => c.number);
    const votes = numbers.length && aux.buKind === "der" ? parseBuCandidateVotes(bytes, numbers) : null;
    // Presidente é o cargo 1 do boletim; {} quando o boletim não traz o cargo (não relê de novo).
    const presVotes = (aux.buKind === "der" ? parseBuCargoVotes(bytes, 1) : null) ?? {};
    this.sections.set(keyOf(r), {
      ...r,
      place: bu.place,
      status: aux.status || "Totalizada",
      electorate: bu.electorate,
      turnout: bu.turnout,
      abstention: bu.abstention,
      abstentionPct: pct(bu.abstention, bu.turnout + bu.abstention),
      done: true,
      ...(votes ? { votes: Object.fromEntries(votes), votesKey: this.votesKey() } : {}),
      presVotes,
    });
    return true;
  }

  private votesKey() {
    return this.featured()
      .map((c) => c.number)
      .sort()
      .join(",");
  }


  private noteAux(url: string, result: string, body: string | null) {
    this.sample.lastAuxUrl = url;
    this.sample.lastAuxResult = result;
    this.sample.lastAuxBody = body ? body.slice(0, 800) : null;
  }

  private setPending(r: SectionRef, status: string) {
    const prev = this.sections.get(keyOf(r));
    this.sections.set(keyOf(r), { ...r, place: prev?.place ?? null, status, electorate: 0, turnout: 0, abstention: 0, abstentionPct: 0, done: false });
  }

  /** Simulação: seções fictícias que vão sendo apuradas ao longo do tempo. */
  private updateMock(r: SectionRef): boolean {
    const seed = Number(r.zone) * 1000 + Number(r.section);
    const progress = Math.min(1, (Date.now() - this.startedAt) / this.ingestor.config.mockDurationMs);
    if ((seed * 7919) % 1000 > progress * 1000) {
      this.setPending(r, "Não totalizada");
      return true;
    }
    const electorate = 180 + ((seed * 31) % 220);
    const abstention = Math.round(electorate * (0.1 + ((seed * 17) % 180) / 1000));
    this.sections.set(keyOf(r), {
      ...r,
      place: String(1000 + Math.floor(Number(r.section) / 8) * 10 + (Number(r.zone) % 7)),
      status: "Totalizada",
      electorate,
      turnout: electorate - abstention,
      abstention,
      abstentionPct: pct(abstention, electorate),
      done: true,
      votes: Object.fromEntries(this.featured().map((c, i) => [c.number, (seed * (i + 7) * 31) % (i === 0 ? 40 : 12)])),
      presVotes: { "13": 60 + (seed % 70), "22": 50 + ((seed * 7) % 80), "15": (seed * 3) % 25, branco: seed % 9, nulo: (seed * 5) % 11 },
      votesKey: this.votesKey(),
    });
    return true;
  }

  getSnapshot(): SectionsSnapshot {
    // Local de cada seção: o do boletim de urna; na falta, o do cadastro de locais do TSE.
    const placeRows = this.mock ? mockPlaces(this.refs) : this.places.rows;
    const placeOfSection = new Map(placeRows.map((p) => [`${p.zone}-${p.section}`, p.code]));
    const placeInfo = new Map<string, PlaceInfo>();
    for (const { section: _s, ...p } of placeRows) if (!placeInfo.has(`${p.zone}-${p.code}`)) placeInfo.set(`${p.zone}-${p.code}`, p);
    const sections = this.refs.map((r) => {
      const s =
        this.sections.get(keyOf(r)) ?? { ...r, place: null, status: "Aguardando leitura", electorate: 0, turnout: 0, abstention: 0, abstentionPct: 0, done: false };
      const place = s.place ?? placeOfSection.get(`${Number(r.zone)}-${Number(r.section)}`) ?? null;
      return place === s.place ? s : { ...s, place };
    });
    const read = sections.filter((s) => s.done);
    const electorate = read.reduce((n, s) => n + s.electorate, 0);
    const turnout = read.reduce((n, s) => n + s.turnout, 0);
    const abstention = read.reduce((n, s) => n + s.abstention, 0);
    return {
      city: this.city,
      slug: this.slug,
      uf: this.uf.toUpperCase(),
      updatedAt: this.updatedAt,
      pleito: this.pleito,
      totals: { sections: sections.length, read: read.length, electorate, turnout, abstention, abstentionPct: pct(abstention, turnout + abstention) },
      progress: { ...this.progress },
      sample: this.sample,
      sections,
      candidates: this.featured(),
      places: [...placeInfo.values()],
      placesStatus: this.mock ? { status: "ready", source: "simulação", message: null, downloadedMb: 0, count: placeRows.length } : this.places.snapshot,
    };
  }
}

function pct(part: number, total: number) {
  return total > 0 ? Math.round((part / total) * 10_000) / 100 : 0;
}

/** Simulação: locais espalhados pela área urbana de São José dos Campos. */
function mockPlaces(refs: SectionRef[]) {
  const bairros = ["Centro", "Santana", "Vila Industrial", "Jardim Satélite", "Urbanova", "Eugênio de Melo", "Jardim da Granja", "Campo dos Alemães"];
  return refs.map((r) => {
    const code = String(1000 + Math.floor(Number(r.section) / 8) * 10 + (Number(r.zone) % 7));
    const seed = Number(r.zone) * 7 + Number(code);
    return {
      zone: String(Number(r.zone)),
      section: String(Number(r.section)),
      code,
      name: `ESCOLA ESTADUAL ${code}`,
      address: `RUA ${(seed * 13) % 500}, ${(seed * 7) % 900}`,
      bairro: bairros[seed % bairros.length]!.toUpperCase(),
      lat: -23.255 + ((seed * 7919) % 1000) / 1000 * 0.12,
      lon: -45.95 + ((seed * 104729) % 1000) / 1000 * 0.16,
    };
  });
}

function mockRefs(): SectionRef[] {
  const zones = [
    { zone: "0127", count: 420 },
    { zone: "0273", count: 380 },
    { zone: "0282", count: 360 },
    { zone: "0411", count: 300 },
  ];
  return zones.flatMap(({ zone, count }) => Array.from({ length: count }, (_, i) => ({ zone, section: String(i + 1).padStart(4, "0") })));
}

/** Cidades com abstenção por seção (SECTION_CITIES="sp:São José dos Campos;…"). */
export const SECTION_CITIES = (process.env.SECTION_CITIES ?? "sp:São José dos Campos")
  .split(";")
  .map((s) => s.trim())
  .filter(Boolean)
  .map((s) => {
    const [uf, ...rest] = s.split(":");
    const city = rest.join(":").trim();
    return { uf: uf!.trim().toLowerCase(), city, slug: slugify(city) };
  })
  .filter((c) => c.city && /^[a-z]{2}$/.test(c.uf));

function slugify(name: string) {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}
