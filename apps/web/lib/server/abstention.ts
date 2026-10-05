// Abstenção por município: eleitorado, comparecimento e abstenção de cada cidade da UF.
//
// Lê o arquivo municipal de Governador (o menor da eleição estadual): o comparecimento é o mesmo
// para todos os cargos da urna. Consulta a cada 3 min com ETag e guarda o resultado em disco.

import { promises as fs } from "node:fs";
import path from "node:path";
import { electionCodeFor, municipalResultUrl, parseSimplifiedResult } from "@apuracao/core";
import type { Ingestor } from "./ingestor";
import type { MunicipalityRegistry } from "./municipal";

const OFFICE = "governador" as const;
const CACHE_VERSION = 1;

export interface CityAbstention {
  ibge: string;
  name: string;
  electorate: number;
  turnout: number;
  abstention: number;
  abstentionPct: number;
  sectionsTotalizedPct: number;
}

interface CityState extends Omit<CityAbstention, "name"> {
  etag?: string;
  lastModified?: string;
}

export interface AbstentionSnapshot {
  uf: string;
  updatedAt: string | null;
  totals: { electorate: number; turnout: number; abstention: number; abstentionPct: number };
  progress: { running: boolean; done: number; total: number; failures: number; lastError: string | null };
  /** Campos encontrados no arquivo da primeira cidade lida (ajuda a diagnosticar mudanças de formato). */
  fileKeys: Record<string, string[]> | null;
  cities: CityAbstention[];
}

export class AbstentionTracker {
  private readonly cities = new Map<string, CityState>();
  private progress = { running: false, done: 0, total: 0, failures: 0, lastError: null as string | null };
  private updatedAt: string | null = null;
  private fileKeys: Record<string, string[]> | null = null;
  private running = false;
  private readonly startedAt = Date.now();
  private readonly cacheFile: string;
  private readonly loaded: Promise<void>;
  readonly intervalMs: number;

  constructor(
    private readonly ingestor: Ingestor,
    private readonly registry: MunicipalityRegistry,
    readonly uf: string,
  ) {
    const mock = ingestor.config.source === "mock";
    this.intervalMs = Number(process.env.ABSTENTION_POLL_MS) || (mock ? 10_000 : 180_000);
    this.cacheFile = path.join(ingestor.config.dataDir, "cities", `abstencao-${uf}${mock ? "-mock" : ""}.json`);
    this.loaded = this.loadCache();
  }

  private async loadCache() {
    try {
      const saved = JSON.parse(await fs.readFile(this.cacheFile, "utf8")) as {
        version: number;
        updatedAt: string | null;
        cities: [string, CityState][];
      };
      if (saved.version !== CACHE_VERSION) return;
      this.updatedAt = saved.updatedAt;
      for (const [ibge, c] of saved.cities) this.cities.set(ibge, c);
    } catch {
      // Sem cache ainda.
    }
  }

  private async saveCache() {
    await fs.mkdir(path.dirname(this.cacheFile), { recursive: true });
    const data = { version: CACHE_VERSION, updatedAt: this.updatedAt, cities: [...this.cities] };
    await fs.writeFile(`${this.cacheFile}.tmp`, JSON.stringify(data), "utf8");
    await fs.rename(`${this.cacheFile}.tmp`, this.cacheFile);
  }

  start() {
    const tick = async () => {
      await this.runCycle().catch((err) => this.ingestor.log("error", `Abstenção ${this.uf.toUpperCase()}: ${String(err)}`));
      setTimeout(tick, this.cities.size === 0 ? 30_000 : this.intervalMs);
    };
    setTimeout(tick, 8_000);
  }

  async runCycle() {
    if (this.running) return;
    this.running = true;
    try {
      await this.loaded;
      if (!(await this.registry.ensureTseCodes())) {
        this.progress.lastError = `${this.registry.lastError ?? "Lista de municípios do TSE ainda não disponível"} — nova tentativa em 30 s.`;
        return;
      }
      const mock = this.ingestor.config.source === "mock";
      const list = this.registry.municipalities().filter((m) => mock || m.tseCode);
      this.progress = { running: true, done: 0, total: list.length, failures: 0, lastError: null };
      let changed = false;
      const queue = [...list];
      const worker = async () => {
        for (let m = queue.shift(); m; m = queue.shift()) {
          try {
            if (mock ? this.updateMock(m.ibge) : await this.updateFromTse(m.ibge, m.tseCode!)) changed = true;
          } catch (err) {
            this.progress.failures++;
            this.progress.lastError = `${m.name}: ${err instanceof Error ? err.message : String(err)}`;
          }
          this.progress.done++;
          await new Promise((resolve) => setImmediate(resolve));
        }
      };
      await Promise.all(Array.from({ length: 4 }, worker));
      if (this.progress.failures > 0) {
        this.ingestor.log("warn", `Abstenção ${this.uf.toUpperCase()}: ${this.progress.failures} cidades com falha. Ex.: ${this.progress.lastError}`);
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

  private async updateFromTse(ibge: string, tseCode: string): Promise<boolean> {
    const prev = this.cities.get(ibge);
    const url = municipalResultUrl(
      this.ingestor.config.endpoint,
      electionCodeFor(this.ingestor.config.electionCodes, OFFICE),
      OFFICE,
      this.uf,
      tseCode,
    );
    const res = await this.ingestor.httpGet(url, prev, 30_000);
    if (res.kind === "not_published") throw new Error(`arquivo não encontrado no TSE (HTTP ${res.status}): ${url}`);
    if (res.kind !== "new") return false;
    const raw = JSON.parse(res.body) as Record<string, unknown>;
    if (!this.fileKeys) {
      const keysOf = (v: unknown) => (v && typeof v === "object" && !Array.isArray(v) ? Object.keys(v) : []);
      this.fileKeys = { arquivo: Object.keys(raw), e: keysOf(raw.e), c: keysOf(raw.c), a: keysOf(raw.a), v: keysOf(raw.v) };
    }
    const r = parseSimplifiedResult(raw, { office: OFFICE, scope: this.uf, round: this.ingestor.config.round, skipProjection: true });
    const t = r.totals;
    this.cities.set(ibge, {
      ibge,
      etag: res.etag,
      lastModified: res.lastModified,
      electorate: t.electorate,
      turnout: t.turnout,
      abstention: t.abstention,
      abstentionPct: t.abstentionPct,
      sectionsTotalizedPct: r.sectionsTotalizedPct,
    });
    return true;
  }

  /** Simulação: eleitorado e abstenção fictícios, estáveis por município. */
  private updateMock(ibge: string): boolean {
    const seed = Number(ibge.slice(-4));
    const progress = Math.min(1, (Date.now() - this.startedAt) / this.ingestor.config.mockDurationMs);
    const electorate = 3_000 + ((seed * 7919) % 200_000);
    const rate = 0.12 + ((seed * 31) % 140) / 1000;
    const abstention = Math.round(electorate * rate * progress);
    const turnout = Math.round(electorate * (1 - rate) * progress);
    this.cities.set(ibge, {
      ibge,
      electorate,
      turnout,
      abstention,
      abstentionPct: progress > 0 ? Math.round(rate * 10_000) / 100 : 0,
      sectionsTotalizedPct: Math.round(progress * 10_000) / 100,
    });
    return true;
  }

  getSnapshot(): AbstentionSnapshot {
    const names = new Map(this.registry.municipalities().map((m) => [m.ibge, m.name]));
    const cities: CityAbstention[] = [...this.cities.values()].map(({ etag: _e, lastModified: _l, ...c }) => ({
      ...c,
      name: names.get(c.ibge) ?? c.ibge,
    }));
    const electorate = cities.reduce((s, c) => s + c.electorate, 0);
    const turnout = cities.reduce((s, c) => s + c.turnout, 0);
    const abstention = cities.reduce((s, c) => s + c.abstention, 0);
    const counted = turnout + abstention;
    return {
      uf: this.uf.toUpperCase(),
      updatedAt: this.updatedAt,
      totals: { electorate, turnout, abstention, abstentionPct: counted > 0 ? Math.round((abstention / counted) * 10_000) / 100 : 0 },
      progress: { ...this.progress },
      fileKeys: this.fileKeys,
      cities,
    };
  }
}
