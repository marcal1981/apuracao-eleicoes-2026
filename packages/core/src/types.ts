import type { OfficeKey } from "./domain";

export type RaceStatus =
  | "AGUARDANDO"
  | "APURACAO_EM_ANDAMENTO"
  | "TOTALIZACAO_FINALIZADA";

export interface CandidateResult {
  position: number;
  /** Posição na atualização anterior (null na primeira leitura). */
  previousPosition: number | null;
  /** Positivo = subiu posições; negativo = caiu. */
  positionChange: number | null;
  /** Sequencial do candidato no TSE. */
  id: string;
  number: string;
  name: string;
  /** Vice ou suplentes, conforme o arquivo oficial. */
  running: string | null;
  /** Partido (sigla) ou, no formato de 2022, a composição informada pelo TSE. */
  party: string;
  /** Federação/coligação a que o partido pertence, quando houver. */
  coalition: string | null;
  votes: number;
  /** Percentual sobre os votos válidos, como informado pelo TSE. */
  percentage: number;
  /** Diferença de votos para o candidato imediatamente acima. */
  gapToPrevious: number | null;
  /** Situação oficial do candidato (ex.: "Eleito", "2º turno", "Suplente"). */
  officialStatus: string;
  /** Somente verdadeiro quando o TSE informa o candidato como eleito. */
  elected: boolean;
  /** Indica quando o TSE marca o candidato como classificado para o 2º turno. */
  secondRound: boolean;
  /** Destinação do voto (ex.: "Válido", "Anulado sub judice"). */
  voteDestination: string;
}

export interface RaceTotals {
  electorate: number;
  turnout: number;
  turnoutPct: number;
  abstention: number;
  abstentionPct: number;
  valid: number;
  validPct: number;
  blank: number;
  blankPct: number;
  null: number;
  nullPct: number;
}

export interface RaceResult {
  electionCode: string;
  round: number;
  office: OfficeKey;
  /** "br" ou a sigla da UF em minúsculas. */
  scope: string;
  status: RaceStatus;
  /** Percentual de seções totalizadas. */
  sectionsTotalizedPct: number;
  sectionsTotalized: number;
  sections: number;
  /** Horário da totalização informado pelo TSE (ISO 8601, -03:00). */
  officialTimestamp: string | null;
  totals: RaceTotals;
  candidates: CandidateResult[];
}

/** Ponto da série histórica, guardado a cada atualização para gráficos e variação de posição. */
export interface Snapshot {
  officialTimestamp: string | null;
  receivedAt: string;
  sectionsTotalizedPct: number;
  totalVotes: number;
  sourceHash: string;
  candidates: { id: string; votes: number; percentage: number; position: number }[];
}
