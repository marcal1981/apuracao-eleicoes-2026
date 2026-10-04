// Votação por município dos candidatos em destaque (cargos proporcionais).
//
// Os arquivos municipais de Deputado trazem todos os candidatos e são grandes, por isso só são
// baixados para disputas que tenham candidatos em destaque, em intervalo maior e com ETag
// (arquivos sem mudança não são baixados de novo). Do conteúdo, guarda-se só o necessário.

import {
  electionCodeFor,
  matchesCandidate,
  municipalResultUrl,
  parseSimplifiedResult,
  raceKey,
  type OfficeKey,
} from "@apuracao/core";
import type { Ingestor } from "./ingestor";
import type { MunicipalTracker } from "./municipal";

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

export class CandidateCitiesTracker {
  private readonly cities = new Map<string, CityState>();
  private readonly candidates = new Map<string, { name: string; number: string }>();
  private updatedAt: string | null = null;
  private running = false;
  private readonly startedAt = Date.now();
  readonly intervalMs: number;

  constructor(
    private readonly ingestor: Ingestor,
    private readonly municipal: MunicipalTracker,
    readonly office: OfficeKey,
    readonly uf: string,
  ) {
    const mock = ingestor.config.source === "mock";
    this.intervalMs = Number(process.env.CANDIDATE_CITIES_POLL_MS) || (mock ? 10_000 : 180_000);
  }

  private get queries() {
    return this.ingestor.featuredQueries(this.office, this.uf);
  }

  start() {
    const tick = async () => {
      await this.runCycle().catch((err) =>
        this.ingestor.log("error", `Votos por cidade (${this.office} ${this.uf.toUpperCase()}): ${String(err)}`),
      );
      setTimeout(tick, this.intervalMs);
    };
    setTimeout(tick, 5_000);
  }

  async runCycle() {
    if (this.running || this.queries.length === 0) return;
    this.running = true;
    try {
      await this.municipal.whenReady();
      const mock = this.ingestor.config.source === "mock";
      const list = this.municipal.municipalities().filter((m) => mock || m.tseCode);
      let changed = false;
      const queue = [...list];
      const worker = async () => {
        for (let m = queue.shift(); m; m = queue.shift()) {
          try {
            if (mock ? this.updateMock(m.ibge) : await this.updateFromTse(m.ibge, m.tseCode!)) changed = true;
          } catch {
            // Um município com falha não interrompe o ciclo; tenta de novo no próximo.
          }
        }
      };
      await Promise.all(Array.from({ length: 6 }, worker));
      if (changed) {
        this.updatedAt = new Date().toISOString();
        this.ingestor.emit("live", {
          type: "municipal_update",
          state: this.uf.toUpperCase(),
          office: this.office,
          timestamp: this.updatedAt,
        });
      }
    } finally {
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
    const res = await this.ingestor.httpGet(url, city);
    if (res.kind !== "new") return false;
    const r = parseSimplifiedResult(JSON.parse(res.body), {
      office: this.office,
      scope: this.uf,
      round: this.ingestor.config.round,
      skipProjection: true,
    });
    city.etag = res.etag;
    city.lastModified = res.lastModified;
    city.sectionsTotalizedPct = r.sectionsTotalizedPct;
    city.valid = r.totals.valid;
    city.votes = new Map();
    for (const c of r.candidates) {
      if (!this.queries.some((q) => matchesCandidate(c, q))) continue;
      city.votes.set(c.id, c.votes);
      this.candidates.set(c.id, { name: c.name, number: c.number });
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
      city.votes.set(c.id, Math.round((c.votes / 645) * 2 * weight * local));
      this.candidates.set(c.id, { name: c.name, number: c.number });
    }
    this.cities.set(ibge, city);
    return true;
  }

  getSnapshot(): CandidateCitiesSnapshot {
    const names = new Map(this.municipal.municipalities().map((m) => [m.ibge, m.name]));
    return {
      office: this.office,
      uf: this.uf.toUpperCase(),
      updatedAt: this.updatedAt,
      citiesRead: this.cities.size,
      citiesTotal: names.size,
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
