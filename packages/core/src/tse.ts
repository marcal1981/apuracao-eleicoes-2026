// Leitura dos arquivos de divulgação de resultados do TSE ("dados simplificados").
//
// Layout de URL utilizado pelo TSE desde 2022:
//   {base}/{ciclo}/{eleicao}/dados-simplificados/{abr}/{abr}-c{cargo}-e{eleicao6}-r.json
// e a configuração de eleições em {base}/comum/config/ele-c.json.
// Todos os componentes são configuráveis para acompanhar ajustes publicados na
// documentação técnica oficial de 2026.

import { OFFICES, type OfficeKey } from "./domain";
import type { CandidateResult, RaceResult, RaceStatus } from "./types";

export interface TseEndpointConfig {
  baseUrl: string;
  cycle: string;
}

export const DEFAULT_TSE_ENDPOINT: TseEndpointConfig = {
  baseUrl: "https://resultados.tse.jus.br/oficial",
  cycle: "ele2026",
};

export function simplifiedResultUrl(
  endpoint: TseEndpointConfig,
  electionCode: string,
  office: OfficeKey,
  scope: string,
): string {
  const abr = scope.toLowerCase();
  const cargo = OFFICES[office].tseCode;
  const ele = electionCode.padStart(6, "0");
  return `${endpoint.baseUrl}/${endpoint.cycle}/${electionCode}/dados-simplificados/${abr}/${abr}-c${cargo}-e${ele}-r.json`;
}

export function electionConfigUrl(endpoint: TseEndpointConfig): string {
  return `${endpoint.baseUrl}/comum/config/ele-c.json`;
}

/**
 * Converte números no formato do TSE: inteiros sem separador ("57259504"),
 * inteiros com milhar ("57.259.504") e decimais com vírgula ("48,43").
 */
export function parseTseNumber(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value !== "string") return 0;
  let s = value.trim();
  if (s === "" || s === "-") return 0;
  if (s.includes(",")) {
    s = s.replace(/\./g, "").replace(",", ".");
  } else if (/^-?\d{1,3}(\.\d{3})+$/.test(s)) {
    s = s.replace(/\./g, "");
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

/** Converte "dd/mm/aaaa" + "hh:mm:ss" (horário de Brasília) para ISO 8601. */
export function parseTseDateTime(date: unknown, time: unknown): string | null {
  if (typeof date !== "string" || typeof time !== "string") return null;
  const d = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(date.trim());
  const t = /^(\d{2}):(\d{2}):(\d{2})$/.exec(time.trim());
  if (!d || !t) return null;
  return `${d[3]}-${d[2]}-${d[1]}T${t[1]}:${t[2]}:${t[3]}-03:00`;
}

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : v == null ? "" : String(v));

export class TseParseError extends Error {}

interface RawCandidate {
  seq?: unknown;
  sqcand?: unknown;
  n?: unknown;
  nm?: unknown;
  cc?: unknown;
  nv?: unknown;
  e?: unknown;
  st?: unknown;
  dvt?: unknown;
  vap?: unknown;
  pvap?: unknown;
}

export interface ParseContext {
  office: OfficeKey;
  scope: string;
  round: number;
  /** Ranking anterior (id → posição) para cálculo de variação. */
  previousPositions?: Map<string, number>;
}

/**
 * Normaliza um arquivo de "dados simplificados" do TSE.
 * Não decide quem foi eleito: usa apenas a situação oficial informada no arquivo.
 */
export function parseSimplifiedResult(raw: unknown, ctx: ParseContext): RaceResult {
  if (!raw || typeof raw !== "object") throw new TseParseError("Arquivo vazio ou inválido");
  const r = raw as Record<string, unknown>;
  if (!Array.isArray(r.cand)) throw new TseParseError("Arquivo sem lista de candidatos (cand)");

  const sectionsTotalizedPct = parseTseNumber(r.pst);
  if (sectionsTotalizedPct < 0 || sectionsTotalizedPct > 100) {
    throw new TseParseError(`Percentual de seções totalizadas fora do intervalo: ${str(r.pst)}`);
  }

  const finished = str(r.tf).toLowerCase() === "s";
  const status: RaceStatus = finished
    ? "TOTALIZACAO_FINALIZADA"
    : sectionsTotalizedPct > 0
      ? "APURACAO_EM_ANDAMENTO"
      : "AGUARDANDO";

  const candidates = rankCandidates(
    (r.cand as RawCandidate[]).map((c) => {
      const officialStatus = str(c.st);
      const statusLower = officialStatus.toLowerCase();
      return {
        id: str(c.sqcand) || str(c.n),
        seq: parseTseNumber(c.seq),
        number: str(c.n),
        name: str(c.nm),
        running: str(c.nv) || null,
        party: str(c.cc),
        votes: parseTseNumber(c.vap),
        percentage: parseTseNumber(c.pvap),
        officialStatus,
        elected: str(c.e).toLowerCase() === "s" || (statusLower.startsWith("eleito") && !statusLower.includes("não")),
        secondRound: statusLower.includes("2º turno") || statusLower.includes("2° turno"),
        voteDestination: str(c.dvt),
      };
    }),
    ctx.previousPositions,
  );

  for (const c of candidates) {
    if (c.votes < 0) throw new TseParseError(`Votação negativa para ${c.name}`);
  }

  return {
    electionCode: str(r.ele),
    round: ctx.round,
    office: ctx.office,
    scope: ctx.scope.toLowerCase(),
    status,
    sectionsTotalizedPct,
    sectionsTotalized: parseTseNumber(r.st),
    sections: parseTseNumber(r.s),
    officialTimestamp: parseTseDateTime(r.dg, r.hg),
    totals: {
      electorate: parseTseNumber(r.e),
      turnout: parseTseNumber(r.c),
      turnoutPct: parseTseNumber(r.pc),
      abstention: parseTseNumber(r.a),
      abstentionPct: parseTseNumber(r.pa),
      valid: parseTseNumber(r.vv),
      validPct: parseTseNumber(r.pvv),
      blank: parseTseNumber(r.vb),
      blankPct: parseTseNumber(r.pvb),
      null: parseTseNumber(r.tvn),
      nullPct: parseTseNumber(r.ptvn),
    },
    candidates,
  };
}

type Unranked = Omit<CandidateResult, "position" | "previousPosition" | "positionChange" | "gapToPrevious"> & {
  seq: number;
};

/** Ordena por votos (desempate pela ordem oficial) e calcula posição, variação e diferença. */
export function rankCandidates(
  list: Unranked[],
  previousPositions?: Map<string, number>,
): CandidateResult[] {
  const sorted = [...list].sort((a, b) => b.votes - a.votes || a.seq - b.seq);
  return sorted.map(({ seq: _seq, ...c }, i) => {
    const position = i + 1;
    const previousPosition = previousPositions?.get(c.id) ?? null;
    const above = sorted[i - 1];
    return {
      ...c,
      position,
      previousPosition,
      positionChange: previousPosition === null ? null : previousPosition - position,
      gapToPrevious: above ? above.votes - c.votes : null,
    };
  });
}

export interface ElectionConfigEntry {
  code: string;
  round: number;
  name: string;
  date: string;
}

/**
 * Lê o arquivo de configuração de eleições (ele-c.json) e lista as eleições encontradas.
 * O formato é lido de forma tolerante, pois pode variar entre ciclos.
 */
export function parseElectionConfig(raw: unknown): ElectionConfigEntry[] {
  const out: ElectionConfigEntry[] = [];
  const pleitos = (raw as { pl?: unknown })?.pl;
  if (!Array.isArray(pleitos)) return out;
  for (const pl of pleitos as Record<string, unknown>[]) {
    const plDate = str(pl.dt);
    const elections = Array.isArray(pl.e) ? (pl.e as Record<string, unknown>[]) : [];
    for (const e of elections) {
      const code = str(e.cd);
      if (!code) continue;
      out.push({
        code,
        round: parseTseNumber(e.t) || 1,
        name: str(e.nm),
        date: str(e.dt) || plDate,
      });
    }
  }
  return out;
}

/** Escolhe a eleição geral ordinária de um ano/turno a partir da configuração oficial. */
export function pickGeneralElection(
  entries: ElectionConfigEntry[],
  year: number,
  round: number,
): ElectionConfigEntry | undefined {
  const candidates = entries.filter(
    (e) => e.round === round && e.date.includes(String(year)) && !/suplementar/i.test(e.name),
  );
  const preferred = candidates.find((e) => /(geral|federal|ordin)/i.test(e.name));
  return preferred ?? candidates[0];
}
