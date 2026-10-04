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
  "deputado-federal:sp:ROBERTINHO DA PADARIA;deputado-federal:sp:EDUARDO CURY;deputado-federal:sp:EDUARDO SIVINSK|DUDU SIVINSK;deputado-federal:sp:DR ELTON;deputado-estadual:sp:LETICIA AGUIAR;deputado-estadual:sp:THOMAZ HENRIQUE";

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
  const offices = (process.env.TRACK_OFFICES ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(isOfficeKey);

  return {
    source,
    endpoint: {
      baseUrl: (process.env.TSE_BASE_URL || DEFAULT_TSE_ENDPOINT.baseUrl).replace(/\/$/, ""),
      cycle: process.env.TSE_CYCLE || DEFAULT_TSE_ENDPOINT.cycle,
      dataPath: process.env.TSE_DATA_PATH || DEFAULT_TSE_ENDPOINT.dataPath,
      fileSuffix: process.env.TSE_FILE_SUFFIX || DEFAULT_TSE_ENDPOINT.fileSuffix,
    },
    year: int("ELECTION_YEAR", 2026),
    round,
    electionCodes: {
      federal: (round === 2 ? process.env.TSE_ELECTION_FEDERAL_R2 : process.env.TSE_ELECTION_FEDERAL) || defaultElectionCodes(round).federal,
      state: (round === 2 ? process.env.TSE_ELECTION_STATE_R2 : process.env.TSE_ELECTION_STATE) || defaultElectionCodes(round).state,
    },
    pollIntervalMs: int("POLL_INTERVAL_MS", source === "mock" ? 10_000 : 30_000),
    concurrency: int("POLL_CONCURRENCY", 4),
    requestTimeoutMs: int("TSE_TIMEOUT_MS", 10_000),
    offices: offices.length > 0 ? offices : OFFICE_KEYS,
    dataDir: path.resolve(/* turbopackIgnore: true */ process.cwd(), process.env.DATA_DIR ?? "data"),
    archiveRaw: process.env.ARCHIVE_RAW !== "false",
    mockDurationMs: int("MOCK_DURATION_MIN", 30) * 60_000,
    featured: parseFeaturedCandidates(process.env.FEATURED_CANDIDATES ?? DEFAULT_FEATURED),
  };
}
