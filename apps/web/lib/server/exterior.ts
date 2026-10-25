// Votação para Presidente nas cidades do exterior, no 1º e no 2º turno, para comparar os dois.
//
// O TSE publica um arquivo por cidade do exterior (UF "ZZ"), no mesmo formato dos municípios.
// A lista de cidades vem do cadastro de municípios de cada eleição (lido uma vez por turno).
// Os arquivos são pequenos e lidos com ETag: os do 1º turno, já finalizados, quase sempre voltam "sem mudança".

import {
  electionCodeFor,
  municipalResultUrl,
  municipalityConfigUrl,
  parseMunicipalityConfig,
  parseSimplifiedResult,
} from "@apuracao/core";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { Ingestor } from "./ingestor";

export interface ExteriorCityRound {
  pct: number;
  electorate: number;
  turnout: number;
  valid: number;
  blank: number;
  null: number;
  /** número do candidato → votos */
  votes: Record<string, number>;
  timestamp: string | null;
}

interface CityState extends Partial<ExteriorCityRound> {
  etag?: string;
  lastModified?: string;
}

interface RoundState {
  /** código TSE da cidade → nome */
  cities: Map<string, string>;
  data: Map<string, CityState>;
  listError: string | null;
}

export interface ExteriorSnapshot {
  updatedAt: string | null;
  progress: { running: boolean; done: number; total: number; failures: number; lastError: string | null };
  rounds: Record<1 | 2, { citiesListed: number; listError: string | null }>;
  cities: { code: string; name: string; r1: ExteriorCityRound | null; r2: ExteriorCityRound | null }[];
}

const CACHE_VERSION = 1;

export class ExteriorTracker {
  private readonly rounds: Record<1 | 2, RoundState> = {
    1: { cities: new Map(), data: new Map(), listError: null },
    2: { cities: new Map(), data: new Map(), listError: null },
  };
  private updatedAt: string | null = null;
  private running = false;
  private progress = { running: false, done: 0, total: 0, failures: 0, lastError: null as string | null };
  private readonly cacheFile: string;
  private readonly loaded: Promise<void>;
  readonly intervalMs = Number(process.env.EXTERIOR_POLL_MS) || 120_000;

  constructor(
    private readonly r1: Ingestor,
    private readonly r2: () => Ingestor | null,
  ) {
    this.cacheFile = path.join(r1.config.dataDir, "cities", "exterior-presidente.json");
    this.loaded = this.loadCache();
  }

  private ingestorOf(round: 1 | 2) {
    return round === 1 ? this.r1 : this.r2();
  }

  private async loadCache() {
    try {
      const saved = JSON.parse(await fs.readFile(this.cacheFile, "utf8")) as {
        version: number;
        updatedAt: string | null;
        rounds: Record<"1" | "2", { cities: [string, string][]; data: [string, CityState][] }>;
      };
      if (saved.version !== CACHE_VERSION) return;
      this.updatedAt = saved.updatedAt;
      for (const r of [1, 2] as const) {
        this.rounds[r].cities = new Map(saved.rounds[r].cities);
        this.rounds[r].data = new Map(saved.rounds[r].data);
      }
    } catch {
      // Sem cache ainda.
    }
  }

  private async saveCache() {
    const rounds = Object.fromEntries(
      ([1, 2] as const).map((r) => [r, { cities: [...this.rounds[r].cities], data: [...this.rounds[r].data] }]),
    );
    await fs.mkdir(path.dirname(this.cacheFile), { recursive: true });
    await fs.writeFile(`${this.cacheFile}.tmp`, JSON.stringify({ version: CACHE_VERSION, updatedAt: this.updatedAt, rounds }), "utf8");
    await fs.rename(`${this.cacheFile}.tmp`, this.cacheFile);
  }

  start() {
    const tick = async () => {
      await this.runCycle().catch((err) => this.r1.log("error", `Exterior por cidade: ${String(err)}`));
      setTimeout(tick, this.rounds[2].cities.size === 0 ? 60_000 : this.intervalMs);
    };
    setTimeout(tick, 8_000);
  }

  /** Lista de cidades do exterior do turno (uma leitura bem-sucedida basta). */
  private async ensureCities(round: 1 | 2): Promise<boolean> {
    const st = this.rounds[round];
    const ing = this.ingestorOf(round);
    if (!ing) return false;
    if (st.cities.size > 0) return true;
    const url = municipalityConfigUrl(ing.config.endpoint, electionCodeFor(ing.config.electionCodes, "presidente"));
    try {
      const res = await ing.httpGet(url, undefined, 60_000);
      if (res.kind !== "new") {
        st.listError = `Lista de cidades do ${round}º turno ainda não publicada pelo TSE (${url})`;
        return false;
      }
      for (const m of parseMunicipalityConfig(JSON.parse(res.body), "ZZ")) st.cities.set(m.tseCode, m.name);
      st.listError = st.cities.size > 0 ? null : `O cadastro do TSE não trouxe cidades do exterior (${url})`;
      return st.cities.size > 0;
    } catch (err) {
      st.listError = `Lista de cidades do ${round}º turno (${url}): ${err instanceof Error ? err.message : String(err)}`;
      return false;
    }
  }

  async runCycle() {
    if (this.running || this.r1.config.source === "mock") return;
    this.running = true;
    try {
      await this.loaded;
      const jobs: { round: 1 | 2; code: string }[] = [];
      for (const round of [1, 2] as const) {
        if (!(await this.ensureCities(round))) continue;
        for (const code of this.rounds[round].cities.keys()) {
          // 1º turno já finalizado na cidade: não precisa ler de novo.
          if (round === 1 && (this.rounds[1].data.get(code)?.pct ?? 0) >= 100) continue;
          jobs.push({ round, code });
        }
      }
      this.progress = { running: true, done: 0, total: jobs.length, failures: 0, lastError: null };
      let changed = false;
      const worker = async () => {
        for (let job = jobs.shift(); job; job = jobs.shift()) {
          try {
            if (await this.update(job.round, job.code)) changed = true;
          } catch (err) {
            this.progress.failures++;
            this.progress.lastError = `${this.rounds[job.round].cities.get(job.code)} (${job.round}º turno): ${err instanceof Error ? err.message : String(err)}`;
          }
          this.progress.done++;
          await new Promise((resolve) => setImmediate(resolve));
        }
      };
      await Promise.all(Array.from({ length: 4 }, worker));
      if (changed) {
        this.updatedAt = new Date().toISOString();
        await this.saveCache().catch(() => {});
      }
    } finally {
      this.progress.running = false;
      this.running = false;
    }
  }

  private async update(round: 1 | 2, code: string): Promise<boolean> {
    const ing = this.ingestorOf(round)!;
    const city = this.rounds[round].data.get(code) ?? {};
    const url = municipalResultUrl(ing.config.endpoint, electionCodeFor(ing.config.electionCodes, "presidente"), "presidente", "zz", code);
    const res = await ing.httpGet(url, city);
    // Cidade ainda sem arquivo (apuração não começou): tenta de novo no próximo ciclo, sem contar como falha.
    if (res.kind === "not_published") return false;
    if (res.kind !== "new") return false;
    const r = parseSimplifiedResult(JSON.parse(res.body), { office: "presidente", scope: "zz", round, skipProjection: true });
    this.rounds[round].data.set(code, {
      etag: res.etag,
      lastModified: res.lastModified,
      pct: r.sectionsTotalizedPct,
      electorate: r.totals.electorate,
      turnout: r.totals.turnout,
      valid: r.totals.valid,
      blank: r.totals.blank,
      null: r.totals.null,
      votes: Object.fromEntries(r.candidates.map((c) => [c.number, c.votes])),
      timestamp: r.officialTimestamp,
    });
    return true;
  }

  getSnapshot(): ExteriorSnapshot {
    const codes = new Set([...this.rounds[1].cities.keys(), ...this.rounds[2].cities.keys()]);
    const pick = (round: 1 | 2, code: string): ExteriorCityRound | null => {
      const d = this.rounds[round].data.get(code);
      if (!d || d.pct === undefined) return null;
      const { etag: _e, lastModified: _l, ...rest } = d;
      return rest as ExteriorCityRound;
    };
    return {
      updatedAt: this.updatedAt,
      progress: { ...this.progress },
      rounds: {
        1: { citiesListed: this.rounds[1].cities.size, listError: this.rounds[1].listError },
        2: { citiesListed: this.rounds[2].cities.size, listError: this.r2() ? this.rounds[2].listError : "Acompanhamento do 2º turno desligado (SECOND_ROUND=false)" },
      },
      cities: [...codes].map((code) => ({
        code,
        name: this.rounds[2].cities.get(code) ?? this.rounds[1].cities.get(code) ?? code,
        r1: pick(1, code),
        r2: pick(2, code),
      })),
    };
  }
}
