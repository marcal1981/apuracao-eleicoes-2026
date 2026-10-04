// Ingestor: único componente que consulta o TSE. Os navegadores consomem apenas a API própria.
//
// Fluxo por ciclo: download (com ETag/If-Modified-Since) → hash → arquivo bruto preservado →
// parser/validação → normalização com ranking anterior → snapshot → publicação (SSE).

import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import {
  OFFICES,
  STATES,
  electionCodeFor,
  matchesCandidate,
  officesForScope,
  parseSimplifiedResult,
  raceKey,
  resultFileUrl,
  simulateSimplifiedResult,
  type OfficeKey,
  type Snapshot,
} from "@apuracao/core";
import type { AuditEvent, IngestionStatus, LiveEvent, PublishedRace, RaceSummary } from "../api-types";
import { Archive } from "./archive";
import { loadConfig, type AppConfig } from "./config";
import { MUNICIPAL_UFS, MunicipalTracker } from "./municipal";
import { CandidateCitiesTracker } from "./candidate-cities";

const HISTORY_LIMIT = 2_000;
const AUDIT_LIMIT = 500;
// O TSE recusa clientes sem User-Agent de navegador.
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 apuracao-eleicoes-2026";

interface RaceState {
  key: string;
  office: OfficeKey;
  scope: string;
  etag?: string;
  lastModified?: string;
  lastHash?: string;
  current?: PublishedRace;
  history: Snapshot[];
  lastSuccessAt?: number;
  lastError?: string;
}

export type FetchOutcome =
  | { kind: "new"; body: string; etag?: string; lastModified?: string; url: string }
  | { kind: "unchanged" }
  | { kind: "not_published"; status: number };

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class Ingestor extends EventEmitter {
  readonly config: AppConfig;
  private readonly archive: Archive;
  private readonly races = new Map<string, RaceState>();
  private readonly audit: AuditEvent[] = [];
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private readonly startedAt = Date.now();
  private stats = {
    cycles: 0,
    lastCycleStartedAt: null as string | null,
    lastCycleFinishedAt: null as string | null,
    lastReceivedAt: null as string | null,
    lastProcessedAt: null as string | null,
    lastPublishedAt: null as string | null,
    errorsLastCycle: 0,
    tse: "unknown" as IngestionStatus["tse"],
  };
  private ready: Promise<void>;
  private cycleNotPublished: string[] = [];
  private lastNotPublishedCount = -1;

  constructor(config = loadConfig()) {
    super();
    this.setMaxListeners(0);
    this.config = config;
    this.archive = new Archive(config.dataDir);

    // Presidente é divulgado tanto no total nacional quanto por UF.
    const scopes = ["br", ...STATES.map((s) => s.uf.toLowerCase())];
    for (const scope of scopes) {
      for (const office of officesForScope(scope, config.round)) {
        if (!config.offices.includes(office)) continue;
        const key = raceKey(config.round, office, scope);
        this.races.set(key, { key, office, scope, history: [] });
      }
    }
    this.ready = this.restore();
  }

  /** Recarrega o último resultado e a série histórica do disco, para sobreviver a reinícios. */
  private async restore() {
    await Promise.all(
      [...this.races.values()].map(async (race) => {
        const latest = await this.archive.loadLatest<PublishedRace & { etag?: string; lastModified?: string }>(race.key);
        if (latest && latest.simulated === (this.config.source === "mock")) {
          const { etag, lastModified, ...published } = latest;
          race.current = { ...published, stale: true };
          race.lastHash = published.sourceHash;
          race.etag = etag;
          race.lastModified = lastModified;
          race.history = await this.archive.loadSnapshots(race.key, HISTORY_LIMIT);
        }
      }),
    );
  }

  start() {
    if (this.timer || this.running) return;
    this.log("info", `Ingestão iniciada (fonte: ${this.config.source}, turno ${this.config.round}, ${this.races.size} disputas)`);
    const tick = async () => {
      await this.runCycle().catch((err) => this.log("error", `Falha no ciclo: ${String(err)}`));
      this.timer = setTimeout(tick, this.config.pollIntervalMs);
    };
    this.timer = setTimeout(tick, 0);
  }

  stop() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  async runCycle() {
    if (this.running) return;
    this.running = true;
    await this.ready;
    const started = new Date();
    this.stats.lastCycleStartedAt = started.toISOString();
    let errors = 0;
    let networkFailures = 0;
    let attempts = 0;
    try {
      this.cycleNotPublished = [];
      const queue = [...this.races.values()];
      const worker = async () => {
        for (let race = queue.shift(); race; race = queue.shift()) {
          attempts++;
          try {
            await this.ingestRace(race);
          } catch (err) {
            errors++;
            if (!(err instanceof HttpError) || err.status >= 500) networkFailures++;
            const message = err instanceof Error ? err.message : String(err);
            if (race.lastError !== message) this.log("error", `${race.key}: ${message}`, race.key);
            race.lastError = message;
          }
        }
      };
      await Promise.all(Array.from({ length: this.config.concurrency }, worker));
      const missing = this.cycleNotPublished.length;
      if (missing !== this.lastNotPublishedCount) {
        this.lastNotPublishedCount = missing;
        if (missing > 0)
          this.log("warn", `${missing} de ${attempts} arquivos ainda não publicados pelo TSE. Exemplo: ${this.cycleNotPublished[0]}`);
        else this.log("info", `Todos os ${attempts} arquivos acompanhados estão disponíveis no TSE`);
      }
      // Todos os arquivos recusados (HTTP 403) indicam bloqueio de acesso, não "ainda não publicado".
      const allForbidden = attempts > 0 && this.cycleNotPublished.filter((u) => u.endsWith("(HTTP 403)")).length === attempts;
      this.stats.tse = attempts > 0 && (networkFailures >= attempts / 2 || allForbidden) ? "offline" : "online";
    } finally {
      this.stats.cycles++;
      this.stats.errorsLastCycle = errors;
      this.stats.lastCycleFinishedAt = new Date().toISOString();
      this.running = false;
      this.emitLive({ type: "status", timestamp: this.stats.lastCycleFinishedAt });
    }
  }

  private async ingestRace(race: RaceState) {
    const electionCode = electionCodeFor(this.config.electionCodes, race.office);
    const url = resultFileUrl(this.config.endpoint, electionCode, race.office, race.scope);
    const outcome =
      this.config.source === "mock" ? this.mockFetch(race, electionCode, url) : await this.httpGet(url, race);
    if (outcome.kind === "not_published") {
      this.cycleNotPublished.push(`${url} (HTTP ${outcome.status})`);
      return;
    }
    if (outcome.kind === "unchanged") {
      race.lastSuccessAt = Date.now();
      return;
    }

    const receivedAt = new Date().toISOString();
    const hash = createHash("sha256").update(outcome.body).digest("hex");
    race.etag = outcome.etag;
    race.lastModified = outcome.lastModified;
    race.lastSuccessAt = Date.now();
    race.lastError = undefined;
    if (hash === race.lastHash) return;
    this.stats.lastReceivedAt = receivedAt;

    const fileName = url.slice(url.lastIndexOf("/") + 1);
    if (this.config.archiveRaw) await this.archive.saveRaw(electionCode, fileName, receivedAt, hash, outcome.body);

    const previousPositions = new Map(race.current?.candidates.map((c) => [c.id, c.position]));
    const result = parseSimplifiedResult(JSON.parse(outcome.body), {
      office: race.office,
      scope: race.scope,
      round: this.config.round,
      previousPositions: race.current ? previousPositions : undefined,
    });

    // Nunca aceitar um arquivo mais antigo do que o já publicado.
    if (
      race.current?.officialTimestamp &&
      result.officialTimestamp &&
      Date.parse(result.officialTimestamp) < Date.parse(race.current.officialTimestamp)
    ) {
      this.log("warn", `${race.key}: arquivo com horário anterior ao publicado foi ignorado`, race.key, hash);
      return;
    }

    const processedAt = new Date().toISOString();
    const published: PublishedRace = {
      ...result,
      key: race.key,
      officeName: OFFICES[race.office].name,
      receivedAt,
      processedAt,
      sourceUrl: url,
      sourceHash: hash,
      stale: false,
      simulated: this.config.source === "mock",
    };
    const proportional = OFFICES[race.office].system === "proporcional";
    const snapshot: Snapshot = {
      officialTimestamp: result.officialTimestamp,
      receivedAt,
      sectionsTotalizedPct: result.sectionsTotalizedPct,
      totalVotes: result.totals.valid,
      sourceHash: hash,
      // Proporcionais: guarda os 50 primeiros e sempre os candidatos em destaque.
      candidates: result.candidates
        .filter((c, i) => !proportional || i < 50 || this.featuredQueries(race.office, race.scope).some((q) => matchesCandidate(c, q)))
        .map((c) => ({ id: c.id, votes: c.votes, percentage: c.percentage, position: c.position })),
    };

    race.current = published;
    race.lastHash = hash;
    race.history.push(snapshot);
    if (race.history.length > HISTORY_LIMIT) race.history.splice(0, race.history.length - HISTORY_LIMIT);
    await Promise.all([
      this.archive.appendSnapshot(race.key, snapshot),
      this.archive.saveLatest(race.key, { ...published, etag: race.etag, lastModified: race.lastModified }),
    ]);

    this.stats.lastProcessedAt = processedAt;
    this.stats.lastPublishedAt = new Date().toISOString();
    this.log("info", `${race.key}: ${result.sectionsTotalizedPct.toFixed(2)}% seções totalizadas`, race.key, hash);
    this.emitLive({
      type: "result_update",
      key: race.key,
      office: race.office,
      state: race.scope.toUpperCase(),
      round: this.config.round,
      timestamp: result.officialTimestamp ?? processedAt,
      totalized: result.sectionsTotalizedPct,
    });
  }

  async httpGet(url: string, cache?: { etag?: string; lastModified?: string }): Promise<FetchOutcome> {
    const delays = [1_000, 2_000, 4_000];
    for (let attempt = 0; ; attempt++) {
      try {
        const headers: Record<string, string> = { "user-agent": USER_AGENT, accept: "application/json" };
        if (cache?.etag) headers["if-none-match"] = cache.etag;
        if (cache?.lastModified) headers["if-modified-since"] = cache.lastModified;
        const res = await fetch(url, { headers, signal: AbortSignal.timeout(this.config.requestTimeoutMs), cache: "no-store" });
        if (res.status === 304) return { kind: "unchanged" };
        if (res.status === 404 || res.status === 403) return { kind: "not_published", status: res.status };
        if (!res.ok) throw new HttpError(res.status, `HTTP ${res.status} em ${url}`);
        return {
          kind: "new",
          body: await res.text(),
          etag: res.headers.get("etag") ?? undefined,
          lastModified: res.headers.get("last-modified") ?? undefined,
          url,
        };
      } catch (err) {
        const retryable = !(err instanceof HttpError) || err.status >= 500 || err.status === 429;
        const delay = delays[attempt];
        if (!retryable || delay === undefined) throw err;
        this.log("warn", `Tentativa ${attempt + 1} falhou (${err instanceof Error ? err.message : String(err)}); nova tentativa em ${delay / 1000}s`);
        await sleep(delay);
      }
    }
  }

  /** Simulação: cada UF começa a apurar com um pequeno atraso e avança até 100%. */
  private mockFetch(race: RaceState, electionCode: string, url: string): FetchOutcome {
    const elapsed = Date.now() - this.startedAt;
    const offset = (race.scope.charCodeAt(0) * 31 + (race.scope.charCodeAt(1) || 0)) % 15;
    const progress = Math.max(0, Math.min(1, (elapsed - (offset / 100) * this.config.mockDurationMs) / this.config.mockDurationMs));
    const raw = simulateSimplifiedResult({
      office: race.office,
      scope: race.scope,
      round: this.config.round,
      electionCode,
      progress: Math.round(progress * 10_000) / 10_000,
      now: new Date(),
    });
    if (progress === 0) return { kind: "not_published", status: 404 };
    return { kind: "new", body: JSON.stringify(raw), url };
  }

  private isStale(race: RaceState): boolean {
    if (!race.current || race.current.status === "TOTALIZACAO_FINALIZADA") return false;
    if (!race.lastSuccessAt) return true;
    return Date.now() - race.lastSuccessAt > this.config.pollIntervalMs * 3 + 30_000;
  }

  /** Nomes/números de candidatos fixados em destaque para uma disputa. */
  featuredQueries(office: OfficeKey, scope: string): string[] {
    return this.config.featured.filter((f) => f.office === office && f.scope === scope.toLowerCase()).map((f) => f.query);
  }

  getRace(key: string): PublishedRace | null {
    const race = this.races.get(key);
    if (!race?.current) return null;
    return { ...race.current, stale: this.isStale(race) };
  }

  hasRace(key: string): boolean {
    return this.races.has(key);
  }

  getHistory(key: string): Snapshot[] {
    return this.races.get(key)?.history ?? [];
  }

  listRaces(filter?: { office?: string; scope?: string }): RaceSummary[] {
    const out: RaceSummary[] = [];
    for (const race of this.races.values()) {
      if (filter?.office && race.office !== filter.office) continue;
      if (filter?.scope && race.scope !== filter.scope.toLowerCase()) continue;
      const c = race.current;
      const leader = c?.candidates[0];
      out.push({
        key: race.key,
        office: race.office,
        officeName: OFFICES[race.office].name,
        scope: race.scope,
        status: c?.status ?? "AGUARDANDO",
        sectionsTotalizedPct: c?.sectionsTotalizedPct ?? 0,
        officialTimestamp: c?.officialTimestamp ?? null,
        leader: leader && leader.votes > 0 ? { name: leader.name, party: leader.party, percentage: leader.percentage } : null,
        stale: this.isStale(race),
      });
    }
    return out;
  }

  getStatus(): IngestionStatus {
    const all = [...this.races.values()];
    const withData = all.filter((r) => r.current).length;
    const finished = all.filter((r) => r.current?.status === "TOTALIZACAO_FINALIZADA").length;
    const cycleLate =
      this.stats.lastCycleFinishedAt !== null &&
      Date.now() - Date.parse(this.stats.lastCycleFinishedAt) > this.config.pollIntervalMs * 3 + 60_000;
    return {
      status: this.stats.tse === "offline" || cycleLate ? "degraded" : "operational",
      source: this.config.source,
      tse: this.stats.tse,
      electionCode: `${this.config.electionCodes.federal} (federal) / ${this.config.electionCodes.state} (estadual)`,
      round: this.config.round,
      pollIntervalMs: this.config.pollIntervalMs,
      startedAt: new Date(this.startedAt).toISOString(),
      cycles: this.stats.cycles,
      lastCycleStartedAt: this.stats.lastCycleStartedAt,
      lastCycleFinishedAt: this.stats.lastCycleFinishedAt,
      lastReceivedAt: this.stats.lastReceivedAt,
      lastProcessedAt: this.stats.lastProcessedAt,
      lastPublishedAt: this.stats.lastPublishedAt,
      racesTracked: all.length,
      racesWithData: withData,
      racesFinished: finished,
      errorsLastCycle: this.stats.errorsLastCycle,
      notPublishedLastCycle: Math.max(0, this.lastNotPublishedCount),
    };
  }

  /** Acesso somente leitura aos arquivos guardados (página "Arquivos"). */
  get files() {
    return this.archive;
  }

  getAudit(limit = 100): AuditEvent[] {
    return this.audit.slice(-limit).reverse();
  }

  private emitLive(event: LiveEvent) {
    this.emit("live", event);
  }

  log(level: AuditEvent["level"], message: string, key?: string, hash?: string) {
    const event: AuditEvent = { at: new Date().toISOString(), level, message, key, hash };
    this.audit.push(event);
    if (this.audit.length > AUDIT_LIMIT) this.audit.shift();
    const line = `[ingestor] ${level.toUpperCase()} ${message}`;
    if (level === "error") console.error(line);
    else if (level === "warn") console.warn(line);
    else console.log(line);
    this.archive.appendAudit(event).catch(() => {});
  }
}

const GLOBAL_KEY = Symbol.for("apuracao.ingestor");
const MUNICIPAL_KEY = Symbol.for("apuracao.municipal");
const CITIES_KEY = Symbol.for("apuracao.candidate-cities");

/** Instância única por processo; inicia a ingestão na primeira chamada (exceto durante o build). */
export function getIngestor(): Ingestor {
  const g = globalThis as unknown as Record<symbol, unknown>;
  let instance = g[GLOBAL_KEY] as Ingestor | undefined;
  if (!instance) {
    instance = new Ingestor();
    g[GLOBAL_KEY] = instance;
    const trackers = new Map(MUNICIPAL_UFS.map((uf) => [uf, new MunicipalTracker(instance!, uf)]));
    g[MUNICIPAL_KEY] = trackers;
    // Votos por cidade: só para disputas proporcionais com candidatos em destaque e mapa municipal.
    const cityTrackers = new Map<string, CandidateCitiesTracker>();
    for (const f of instance.config.featured) {
      const municipal = trackers.get(f.scope);
      const key = `${f.office}:${f.scope}`;
      if (!municipal || cityTrackers.has(key) || OFFICES[f.office].system !== "proporcional") continue;
      cityTrackers.set(key, new CandidateCitiesTracker(instance, municipal, f.office, f.scope));
    }
    g[CITIES_KEY] = cityTrackers;
    if (process.env.NEXT_PHASE !== "phase-production-build" && process.env.INGESTION_DISABLED !== "true") {
      instance.start();
      for (const t of trackers.values()) t.start();
      for (const t of cityTrackers.values()) t.start();
    }
  }
  return instance;
}

export function getMunicipalTracker(uf: string): MunicipalTracker | undefined {
  getIngestor();
  const trackers = (globalThis as unknown as Record<symbol, Map<string, MunicipalTracker> | undefined>)[MUNICIPAL_KEY];
  return trackers?.get(uf.toLowerCase());
}

export function getCandidateCitiesTracker(office: string, uf: string): CandidateCitiesTracker | undefined {
  getIngestor();
  const trackers = (globalThis as unknown as Record<symbol, Map<string, CandidateCitiesTracker> | undefined>)[CITIES_KEY];
  return trackers?.get(`${office}:${uf.toLowerCase()}`);
}
