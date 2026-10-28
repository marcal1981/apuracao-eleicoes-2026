import path from "node:path";
import {
  DEFAULT_TSE_ENDPOINT,
  OFFICE_KEYS,
  defaultElectionCodes,
  parseFeaturedCandidates,
  type FeaturedCandidate,
  isOfficeKey,
  type ElectionCodes,
  type OfficeKey,
  type TseEndpointConfig,
} from "@apuracao/core";

export type SourceMode = "tse" | "mock";

/** Destaque padrão deste projeto. Para desativar, defina FEATURED_CANDIDATES= (vazio) no .env. */
const DEFAULT_FEATURED =
  "deputado-federal:sp:ROBERTINHO DA PADARIA;deputado-federal:sp:EDUARDO CURY;deputado-federal:sp:EDUARDO SIVINSK|DUDU SIVINSK;deputado-federal:sp:DR ELTON;deputado-federal:sp:LUCAS PAVANATO;deputado-estadual:sp:LETICIA AGUIAR;deputado-estadual:sp:THOMAZ HENRIQUE";

export interface AppConfig {
  source: SourceMode;
  endpoint: TseEndpointConfig;
  year: number;
  /** Turno acompanhado pela ingestão (1 ou 2). */
  round: number;
  /** Códigos das eleições federal (Presidente) e estadual (demais cargos) no TSE. */
  electionCodes: ElectionCodes;
  pollIntervalMs: number;
  concurrency: number;
  requestTimeoutMs: number;
  offices: OfficeKey[];
  dataDir: string;
  archiveRaw: boolean;
  /** Duração total da apuração simulada (modo mock). */
  mockDurationMs: number;
  /** Candidatos fixados no topo das páginas (FEATURED_CANDIDATES; vazio desativa). */
  featured: FeaturedCandidate[];
}

function int(name: string, fallback: number): number {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

export function loadConfig(): AppConfig {
  const source: SourceMode = process.env.TSE_SOURCE === "mock" ? "mock" : "tse";
  const round = int("TSE_ROUND", 1) === 2 ? 2 : 1;
  const offices = (envText("TRACK_OFFICES") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(isOfficeKey);

  return {
    source,
    endpoint: {
      baseUrl: ((/^https?:\/\//.test(envText("TSE_BASE_URL") ?? "") ? envText("TSE_BASE_URL")! : DEFAULT_TSE_ENDPOINT.baseUrl)).replace(/\/$/, ""),
      cycle: envText("TSE_CYCLE") || DEFAULT_TSE_ENDPOINT.cycle,
      dataPath: envText("TSE_DATA_PATH") || DEFAULT_TSE_ENDPOINT.dataPath,
      fileSuffix: envText("TSE_FILE_SUFFIX") || DEFAULT_TSE_ENDPOINT.fileSuffix,
    },
    year: int("ELECTION_YEAR", 2026),
    round,
    electionCodes: {
      federal: envCode(round === 2 ? "TSE_ELECTION_FEDERAL_R2" : "TSE_ELECTION_FEDERAL") ?? defaultElectionCodes(round).federal,
      state: envCode(round === 2 ? "TSE_ELECTION_STATE_R2" : "TSE_ELECTION_STATE") ?? defaultElectionCodes(round).state,
    },
    pollIntervalMs: int("POLL_INTERVAL_MS", source === "mock" ? 10_000 : 30_000),
    concurrency: int("POLL_CONCURRENCY", 4),
    requestTimeoutMs: int("TSE_TIMEOUT_MS", 10_000),
    offices: offices.length > 0 ? offices : OFFICE_KEYS,
    dataDir: path.resolve(/* turbopackIgnore: true */ process.cwd(), envText("DATA_DIR") || "data"),
    archiveRaw: process.env.ARCHIVE_RAW !== "false",
    mockDurationMs: int("MOCK_DURATION_MIN", 30) * 60_000,
    featured: parseFeaturedCandidates(envText("FEATURED_CANDIDATES") ?? DEFAULT_FEATURED),
  };
}

/**
 * Código numérico vindo do .env (eleição, pleito); valor vazio ou que não seja número (ex.: "." que alguns painéis de
 * hospedagem exigem no lugar de vazio) é ignorado e vale o padrão.
 */
export function envCode(name: string): string | undefined {
  const v = (process.env[name] ?? "").trim();
  return /^\d+$/.test(v) ? v : undefined;
}

/**
 * Texto vindo do .env. Um valor só de pontuação (ex.: ".", "-", que alguns painéis de hospedagem exigem no lugar de
 * vazio) conta como não definido; vazio de verdade continua vazio (ex.: FEATURED_CANDIDATES= para não fixar ninguém).
 */
export function envText(name: string): string | undefined {
  const v = process.env[name];
  if (v === undefined) return undefined;
  const t = v.trim();
  return t && !/[\p{L}\p{N}]/u.test(t) ? undefined : t;
}

