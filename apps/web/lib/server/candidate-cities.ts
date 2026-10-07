// Votação por município dos candidatos em destaque (cargos proporcionais).
//
// Os arquivos municipais de Deputado trazem todos os candidatos e são grandes, por isso só são
// baixados para disputas que tenham candidatos em destaque, em intervalo maior e com ETag
// (arquivos sem mudança não são baixados de novo). Do conteúdo, guarda-se só o necessário.

import {
  electionCodeFor,
  matchesCandidate,
  municipalResultUrl,
  extractCandidateVotes,
  raceKey,
  type OfficeKey,
} from "@apuracao/core";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { Ingestor } from "./ingestor";
import type { MunicipalityRegistry } from "./municipal";

export interface CandidateCityVotes {
  ibge: string;
  name: string;
  votes: number;
  /** Percentual dos votos válidos do município. */
  share: number;
  sectionsTotalizedPct: number;
}

export interface CandidateCitiesSnapshot {
  office: OfficeKey;
  uf: string;
  updatedAt: string | null;
  citiesRead: number;
  citiesTotal: number;
  /** Andamento da leitura em curso (para a barra de progresso). */
  progress: { running: boolean; done: number; total: number; failures: number; lastError: string | null };
  candidates: {
    id: string;
    name: string;
    number: string;
    total: number;
    cities: CandidateCityVotes[];
  }[];
}

interface CityState {
  etag?: string;
  lastModified?: string;
  sectionsTotalizedPct: number;
  valid: number;
  /** id do candidato em destaque → votos. */
  votes: Map<string, number>;
}

const CACHE_VERSION = 2;

export class CandidateCitiesTracker {
  private readonly cities = new Map<string, CityState>();
  private readonly candidates = new Map<string, { name: string; number: string }>();
  private updatedAt: string | null = null;
  private running = false;
  private readonly startedAt = Date.now();
  private progress = { running: false, done: 0, total: 0, failures: 0, lastError: null as string | null };
  private readonly cacheFile: string;
  private loaded: Promise<void>;
  readonly intervalMs: number;
  readonly concurrency: number;

  constructor(
    private readonly ingestor: Ingestor,
    private readonly municipal: MunicipalityRegistry,
    readonly office: OfficeKey,
    readonly uf: string,
  ) {
    const mock = ingestor.config.source === "mock";
    this.intervalMs = Number(process.env.CANDIDATE_CITIES_POLL_MS) || (mock ? 10_000 : 180_000);
    this.concurrency = Number(process.env.CANDIDATE_CITIES_CONCURRENCY) || 4;
    this.cacheFile = path.join(ingestor.config.dataDir, "cities", `${office}-${uf}${mock ? "-mock" : ""}.json`);
    this.loaded = this.loadCache();
  }

  /** Recupera do disco os votos por cidade já lidos, para não baixar tudo de novo ao reiniciar. */
  private async loadCache() {
    try {
      const saved = JSON.parse(await fs.readFile(this.cacheFile, "utf8")) as {
        version?: number;
        queries?: string[];
        updatedAt: string | null;
        candidates: [string, { name: string; number: string }][];
        cities: [string, Omit<CityState, "votes"> & { votes: [string, number][] }][];
      };
      if (saved.version !== CACHE_VERSION) return; // formato antigo: lê tudo de novo
      this.updatedAt = saved.updatedAt;
      for (const [id, info] of saved.candidates) this.candidates.set(id, info);
      // Se a lista de destaques mudou, os arquivos precisam ser lidos de novo (sem ETag) para achar os novos nomes.
      const sameQueries = JSON.stringify(saved.queries ?? []) === JSON.stringify(this.queries);
      for (const [ibge, c] of saved.cities) {
        const city: CityState = { ...c, votes: new Map(c.votes) };
        if (!sameQueries) {
          delete city.etag;
          delete city.lastModified;
        }
        this.cities.set(ibge, city);
      }
    } catch {
      // Sem cache ainda.
    }
  }

  private async saveCache() {
    const data = {
      version: CACHE_VERSION,
      queries: this.queries,
      updatedAt: this.updatedAt,
      candidates: [...this.candidates],
      cities: [...this.cities].map(([ibge, c]) => [ibge, { ...c, votes: [...c.votes] }]),
    };
    await fs.mkdir(path.dirname(this.cacheFile), { recursive: true });
    await fs.writeFile(`${this.cacheFile}.tmp`, JSON.stringify(data), "utf8");
    await fs.rename(`${this.cacheFile}.tmp`, this.cacheFile);
  }

  private notify() {
    this.updatedAt = new Date().toISOString();
    this.ingestor.emit("live", {
      type: "municipal_update",
      state: this.uf.toUpperCase(),
      office: this.office,
      timestamp: this.updatedAt,
    });
  }

  private get queries() {
    return this.ingestor.featuredQueries(this.office, this.uf);
  }

  start() {
    const tick = async () => {
      await this.runCycle().catch((err) =>
        this.ingestor.log("error", `Votos por cidade (${this.office} ${this.uf.toUpperCase()}): ${String(err)}`),
      );
      // Enquanto a lista de municípios não estiver pronta, tenta de novo logo.
      setTimeout(tick, this.cities.size === 0 && this.progress.total === 0 ? 30_000 : this.intervalMs);
    };
    setTimeout(tick, 5_000);
  }

  async runCycle() {
    if (this.running || this.queries.length === 0) return;
    this.running = true;
    try {
      await this.loaded;
      if (!(await this.municipal.ensureTseCodes())) {
        this.progress.lastError = `${this.municipal.lastError ?? "Lista de municípios do TSE ainda não disponível"} — nova tentativa em 30 s.`;
        return;
      }
      const mock = this.ingestor.config.source === "mock";
      // Primeiro as cidades ainda não lidas; depois as de mais votos (onde a apuração mais muda).
      const list = this.municipal
        .municipalities()
        .filter((m) => mock || m.tseCode)
        .sort((a, b) => {
          const ca = this.cities.get(a.ibge);
          const cb = this.cities.get(b.ibge);
          if (!ca !== !cb) return ca ? 1 : -1;
          return (cb?.valid ?? 0) - (ca?.valid ?? 0);
        });
      if (list.length === 0) {
        this.progress.lastError = "Nenhum município associado à lista do TSE.";
        return;
      }
      this.progress = { running: true, done: 0, total: list.length, failures: 0, lastError: null };
      let changed = false;
      let sinceNotify = 0;
      const queue = [...list];
      const worker = async () => {
        for (let m = queue.shift(); m; m = queue.shift()) {
          try {
            if (mock ? this.updateMock(m.ibge) : await this.updateFromTse(m.ibge, m.tseCode!)) {
              changed = true;
              sinceNotify++;
            }
          } catch (err) {
            // Um município com falha não interrompe o ciclo; tenta de novo no próximo.
            this.progress.failures++;
            this.progress.lastError = `${m.name}: ${err instanceof Error ? err.message : String(err)}`;
          }
          this.progress.done++;
          // Devolve a vez ao servidor entre um arquivo e outro, para as páginas continuarem respondendo.
          await new Promise((resolve) => setImmediate(resolve));
          // Atualiza a tela aos poucos, sem esperar as 645 cidades.
          if (sinceNotify >= 25) {
            sinceNotify = 0;
            this.notify();
          }
        }
      };
      await Promise.all(Array.from({ length: this.concurrency }, worker));
      if (this.progress.failures > 0) {
        this.ingestor.log(
          "warn",
          `Votos por cidade (${this.office} ${this.uf.toUpperCase()}): ${this.progress.failures} cidades com falha. Ex.: ${this.progress.lastError}`,
        );
      }
      if (changed) {
        this.notify();
        await this.saveCache().catch(() => {});
      }
    } finally {
      this.progress.running = false;
      this.running = false;
    }
  }

  private async updateFromTse(ibge: string, tseCode: string): Promise<boolean> {
    const city: CityState = this.cities.get(ibge) ?? { sectionsTotalizedPct: 0, valid: 0, votes: new Map() };
    const url = municipalResultUrl(
      this.ingestor.config.endpoint,
      electionCodeFor(this.ingestor.config.electionCodes, this.office),
      this.office,
      this.uf,
      tseCode,
    );
    // Arquivos municipais de deputado são grandes (todos os candidatos): mais tempo para baixar.
    const res = await this.ingestor.httpGet(url, city, Number(process.env.CANDIDATE_CITIES_TIMEOUT_MS) || 60_000);
    if (res.kind === "not_published") throw new Error(`arquivo não encontrado no TSE (HTTP ${res.status}): ${url}`);
    if (res.kind !== "new") return false;
    // Leitura leve: só os candidatos em destaque, sem processar a lista inteira.
    const r = extractCandidateVotes(JSON.parse(res.body), (c) => this.queries.some((q) => matchesCandidate(c, q)));
    city.etag = res.etag;
    city.lastModified = res.lastModified;
    city.sectionsTotalizedPct = r.sectionsTotalizedPct;
    city.valid = r.valid;
    city.votes = new Map();
    // A chave é o número do candidato, que é o mesmo nos arquivos estadual e municipais.
    for (const c of r.candidates) {
      city.votes.set(c.number, c.votes);
      this.candidates.set(c.number, { name: c.name, number: c.number });
    }
    this.cities.set(ibge, city);
    return true;
  }

  /** Simulação: distribui os votos estaduais do candidato entre as cidades com pesos fixos. */
  private updateMock(ibge: string): boolean {
    const race = this.ingestor.getRace(raceKey(this.ingestor.config.round, this.office, this.uf));
    if (!race) return false;
    const seed = Number(ibge.slice(-4));
    const progress = Math.min(1, (Date.now() - this.startedAt) / this.ingestor.config.mockDurationMs);
    const city: CityState = { sectionsTotalizedPct: Math.round(progress * 10_000) / 100, valid: 0, votes: new Map() };
    const weight = ((seed * 7919) % 1000) / 1000;
    city.valid = Math.round(2_000 + weight * 40_000 * progress);
    for (const c of race.candidates) {
      if (!this.queries.some((q) => matchesCandidate(c, q))) continue;
      const local = ((seed * (Number(c.number) || 1)) % 97) / 97;
      city.votes.set(c.number, Math.round((c.votes / 645) * 2 * weight * local));
      this.candidates.set(c.number, { name: c.name, number: c.number });
    }
    this.cities.set(ibge, city);
    return true;
  }

  /** Para o diagnóstico: cadastro de municípios e nomes procurados. */
  get registry() {
    return this.municipal;
  }

  get featuredQueries() {
    return this.queries;
  }

  /** Candidatos em destaque já identificados nesta disputa (nome e número). */
  candidateList(): { name: string; number: string }[] {
    return [...this.candidates.values()];
  }

  getSnapshot(): CandidateCitiesSnapshot {
    const names = new Map(this.municipal.municipalities().map((m) => [m.ibge, m.name]));
    return {
      office: this.office,
      uf: this.uf.toUpperCase(),
      updatedAt: this.updatedAt,
      citiesRead: this.cities.size,
      citiesTotal: names.size,
      progress: { ...this.progress },
      candidates: [...this.candidates].map(([id, info]) => {
        const cities: CandidateCityVotes[] = [];
        for (const [ibge, city] of this.cities) {
          const votes = city.votes.get(id) ?? 0;
          cities.push({
            ibge,
            name: names.get(ibge) ?? ibge,
            votes,
            share: city.valid > 0 ? Math.round((votes / city.valid) * 10_000) / 100 : 0,
            sectionsTotalizedPct: city.sectionsTotalizedPct,
          });
        }
        cities.sort((a, b) => b.votes - a.votes || a.name.localeCompare(b.name, "pt-BR"));
        return { id, ...info, total: cities.reduce((sum, c) => sum + c.votes, 0), cities };
      }),
    };
  }
}
