import type { RaceResult, Snapshot } from "@apuracao/core";

/** Resultado publicado pela API: dado oficial normalizado + metadados de origem e atualização. */
export interface PublishedRace extends RaceResult {
  key: string;
  officeName: string;
  /** Quando o arquivo foi baixado do TSE. */
  receivedAt: string;
  /** Quando foi processado e publicado pela plataforma. */
  processedAt: string;
  sourceUrl: string;
  sourceHash: string;
  /** Verdadeiro quando a ingestão não consegue atualizar este resultado há mais tempo que o esperado. */
  stale: boolean;
  simulated: boolean;
}

export interface RaceHistory {
  key: string;
  snapshots: Snapshot[];
}

export interface LiveEvent {
  type: "result_update" | "status";
  key?: string;
  office?: string;
  state?: string;
  round?: number;
  timestamp: string;
  totalized?: number;
}

export interface AuditEvent {
  at: string;
  level: "info" | "warn" | "error";
  message: string;
  key?: string;
  hash?: string;
}

export interface IngestionStatus {
  status: "operational" | "degraded" | "waiting";
  source: "tse" | "mock";
  tse: "online" | "offline" | "unknown";
  electionCode: string | null;
  round: number;
  pollIntervalMs: number;
  startedAt: string;
  cycles: number;
  lastCycleStartedAt: string | null;
  lastCycleFinishedAt: string | null;
  /** Última vez em que um arquivo novo foi recebido do TSE. */
  lastReceivedAt: string | null;
  lastProcessedAt: string | null;
  lastPublishedAt: string | null;
  racesTracked: number;
  racesWithData: number;
  racesFinished: number;
  errorsLastCycle: number;
}

export interface RaceSummary {
  key: string;
  office: string;
  officeName: string;
  scope: string;
  status: string;
  sectionsTotalizedPct: number;
  officialTimestamp: string | null;
  leader: { name: string; party: string; percentage: number } | null;
  stale: boolean;
}
