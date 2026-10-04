// Leitura dos arquivos de divulgação de resultados do TSE.
//
// Layout de URL de 2026:
//   {base}/{ciclo}/{eleicao}/dados/{abr}/{abr}-c{cargo}-e{eleicao6}-u.json
// (em 2022 era dados-simplificados/…-r.json; ambos os formatos de arquivo são aceitos).
// Em 2026 há duas eleições: federal (Presidente) e estadual (Governador, Senador, Deputados).
// A configuração de eleições fica em {base}/comum/config/ele-c.json.

import { OFFICES, type OfficeKey } from "./domain";
import { projectSeats, seatsFor } from "./seats";
import type { CandidateResult, RaceResult, RaceStatus } from "./types";

export interface TseEndpointConfig {
  baseUrl: string;
  cycle: string;
  /** Pasta dos arquivos de resultado ("dados" em 2026; "dados-simplificados" em 2022). */
  dataPath: string;
  /** Sufixo do arquivo ("u" em 2026; "r" em 2022). */
  fileSuffix: string;
}

export const DEFAULT_TSE_ENDPOINT: TseEndpointConfig = {
  baseUrl: "https://resultados.tse.jus.br/oficial",
  cycle: "ele2026",
  dataPath: "dados",
  fileSuffix: "u",
};

export interface ElectionCodes {
  /** Eleição federal: Presidente. */
  federal: string;
  /** Eleição estadual: Governador, Senador, Deputados. */
  state: string;
}

/** Códigos das Eleições Gerais 2026 no TSE (1º turno 6257/6259; 2º turno 6258/6260). */
export function defaultElectionCodes(round: number): ElectionCodes {
  return round === 2 ? { federal: "6258", state: "6260" } : { federal: "6257", state: "6259" };
}

export function electionCodeFor(codes: ElectionCodes, office: OfficeKey): string {
  return office === "presidente" ? codes.federal : codes.state;
}

export function resultFileUrl(
  endpoint: TseEndpointConfig,
  electionCode: string,
  office: OfficeKey,
  scope: string,
): string {
  const abr = scope.toLowerCase();
  const cargo = OFFICES[office].tseCode;
  const ele = electionCode.padStart(6, "0");
  return `${endpoint.baseUrl}/${endpoint.cycle}/${electionCode}/${endpoint.dataPath}/${abr}/${abr}-c${cargo}-e${ele}-${endpoint.fileSuffix}.json`;
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
const obj = (v: unknown): Record<string, unknown> | undefined =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;
const arr = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? (v as Record<string, unknown>[]) : []);
/** Primeiro valor escalar presente (os formatos de 2022 e 2026 guardam os totais em lugares diferentes). */
const pick = (...values: unknown[]): unknown =>
  values.find((v) => v !== undefined && v !== null && v !== "" && typeof v !== "object");

export class TseParseError extends Error {}

export interface ParseContext {
  office: OfficeKey;
  scope: string;
  round: number;
  /** Ranking anterior (id → posição) para cálculo de variação. */
  previousPositions?: Map<string, number>;
  /** Não calcula a projeção de cadeiras (ex.: arquivos municipais, onde ela não se aplica). */
  skipProjection?: boolean;
}

function readCandidate(c: Record<string, unknown>, party: string, coalition: string | null): Unranked {
  const officialStatus = str(c.st);
  const statusLower = officialStatus.toLowerCase();
  const vices = arr(c.vs)
    .map((v) => str(v.nmu) || str(v.nm))
    .filter(Boolean);
  return {
    id: str(c.sqcand) || str(c.n),
    seq: parseTseNumber(c.seq),
    number: str(c.n),
    name: str(c.nmu) || str(c.nm),
    running: vices.length > 0 ? vices.join(" · ") : str(c.nv) || null,
    party,
    coalition,
    votes: parseTseNumber(c.vap),
    percentage: parseTseNumber(c.pvap),
    officialStatus,
    elected: str(c.e).toLowerCase() === "s" || (statusLower.startsWith("eleito") && !statusLower.includes("não")),
    secondRound: statusLower.includes("2º turno") || statusLower.includes("2° turno"),
    voteDestination: str(c.dvt),
  };
}

/** Lista de candidatos: formato 2026 (carg → agr → par → cand) ou 2022 (cand). */
/** Votos de legenda por partido/federação, quando o arquivo os informa. */
function readLegendVotes(r: Record<string, unknown>): Map<string, number> {
  const out = new Map<string, number>();
  for (const cargo of arr(r.carg)) {
    for (const agr of arr(cargo.agr)) {
      for (const par of arr(agr.par)) {
        const legend = parseTseNumber(pick(par.vl, par.tvl, par.vlg, par.vleg));
        if (!legend) continue;
        const sg = str(par.sg) || str(par.nm);
        const group = str(agr.nm) && str(agr.nm) !== sg ? str(agr.nm) : sg;
        out.set(group, (out.get(group) ?? 0) + legend);
      }
    }
  }
  return out;
}

function readCandidates(r: Record<string, unknown>): Unranked[] {
  if (Array.isArray(r.carg)) {
    const out: Unranked[] = [];
    for (const cargo of arr(r.carg)) {
      for (const agr of arr(cargo.agr)) {
        const agrName = str(agr.nm);
        const parties = arr(agr.par);
        for (const par of parties) {
          const sg = str(par.sg) || str(par.nm);
          const coalition = agrName && agrName !== sg ? agrName : null;
          for (const c of arr(par.cand)) out.push(readCandidate(c, sg, coalition));
        }
      }
    }
    return out;
  }
  if (Array.isArray(r.cand)) return arr(r.cand).map((c) => readCandidate(c, str(c.cc), null));
  throw new TseParseError("Arquivo sem lista de candidatos (carg/cand)");
}

const pctOf = (part: number, total: number) => (total > 0 ? Math.round((part / total) * 10_000) / 100 : 0);

/**
 * Normaliza um arquivo de resultados do TSE (formatos 2026 e 2022).
 * Não decide quem foi eleito: usa apenas a situação oficial informada no arquivo.
 */
export function parseSimplifiedResult(raw: unknown, ctx: ParseContext): RaceResult {
  const r = obj(raw);
  if (!r) throw new TseParseError("Arquivo vazio ou inválido");
  const s = obj(r.s);
  const e = obj(r.e);
  const v = obj(r.v);
  const c = obj(r.c);
  const a = obj(r.a);

  const sectionsTotalizedPct = parseTseNumber(pick(s?.pst, r.pst));
  if (sectionsTotalizedPct < 0 || sectionsTotalizedPct > 100) {
    throw new TseParseError(`Percentual de seções totalizadas fora do intervalo: ${str(pick(s?.pst, r.pst))}`);
  }

  const finished = str(r.tf).toLowerCase() === "s";
  const status: RaceStatus = finished
    ? "TOTALIZACAO_FINALIZADA"
    : sectionsTotalizedPct > 0
      ? "APURACAO_EM_ANDAMENTO"
      : "AGUARDANDO";

  const candidates = rankCandidates(readCandidates(r), ctx.previousPositions);
  for (const cand of candidates) {
    if (cand.votes < 0) throw new TseParseError(`Votação negativa para ${cand.name}`);
  }

  // Projeção de cadeiras (proporcionais), enquanto o TSE não divulga a situação oficial.
  let projection: RaceResult["projection"] = null;
  // Usa o número de vagas do arquivo quando ele é plausível; senão, a tabela constitucional.
  const tableSeats = seatsFor(ctx.office, ctx.scope);
  const fileSeats = parseTseNumber(arr(r.carg)[0]?.nv);
  const seats =
    fileSeats > 0 && (!tableSeats || Math.abs(fileSeats - tableSeats) <= tableSeats * 0.3) ? fileSeats : tableSeats;
  const validForSeats = parseTseNumber(pick(obj(r.v)?.vv, r.vv));
  if (!ctx.skipProjection && OFFICES[ctx.office].system === "proporcional" && seats && validForSeats > 0) {
    const result = projectSeats(
      candidates
        .filter((c) => !c.voteDestination || /^v[áa]lido/i.test(c.voteDestination))
        .map((c, i) => ({ id: c.id, votes: c.votes, group: c.coalition ?? c.party, seq: i })),
      validForSeats,
      seats,
      readLegendVotes(r),
    );
    if (result) {
      for (const c of candidates) c.projected = result.elected.get(c.id) ?? null;
      const { elected: _e, ...rest } = result;
      projection = rest;
    }
  }

  const valid = parseTseNumber(pick(v?.vv, r.vv));
  const blank = parseTseNumber(pick(v?.vb, r.vb));
  const nulls = parseTseNumber(pick(v?.tvn, v?.vn, r.tvn));
  const electorate = parseTseNumber(pick(e?.te, r.e));
  // Quando o arquivo não traz comparecimento/abstenção, deriva-se dos votos totalizados.
  const turnout = parseTseNumber(pick(c?.c, c?.tc, e?.c, r.c)) || parseTseNumber(pick(v?.tv, r.tv)) || valid + blank + nulls;
  const abstention = parseTseNumber(pick(a?.a, c?.a, e?.a, r.a)) || Math.max(0, parseTseNumber(pick(e?.est, electorate)) - turnout);

  return {
    electionCode: str(r.ele),
    round: ctx.round,
    office: ctx.office,
    scope: ctx.scope.toLowerCase(),
    status,
    sectionsTotalizedPct,
    sectionsTotalized: parseTseNumber(pick(s?.st, r.st)),
    sections: parseTseNumber(pick(s?.ts, r.s)),
    // dt/ht = horário da totalização; dg/hg = geração do arquivo (usado quando não há totalização).
    officialTimestamp: parseTseDateTime(r.dt, r.ht) ?? parseTseDateTime(r.dg, r.hg),
    totals: {
      electorate,
      turnout,
      turnoutPct: parseTseNumber(pick(c?.pc, e?.pc, r.pc)) || pctOf(turnout, turnout + abstention),
      abstention,
      abstentionPct: parseTseNumber(pick(a?.pa, c?.pa, e?.pa, r.pa)) || pctOf(abstention, turnout + abstention),
      valid,
      validPct: parseTseNumber(pick(v?.pvv, r.pvv)) || pctOf(valid, turnout),
      blank,
      blankPct: parseTseNumber(pick(v?.pvb, r.pvb)) || pctOf(blank, turnout),
      null: nulls,
      nullPct: parseTseNumber(pick(v?.ptvn, v?.pvn, r.ptvn)) || pctOf(nulls, turnout),
    },
    candidates,
    projection,
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

// ---------------------------------------------------------------------------
// Abrangência municipal

/** Lista de municípios da eleição: {base}/{ciclo}/{eleicao}/config/mun-e{eleicao6}-cm.json */
export function municipalityConfigUrl(endpoint: TseEndpointConfig, electionCode: string): string {
  return `${endpoint.baseUrl}/${endpoint.cycle}/${electionCode}/config/mun-e${electionCode.padStart(6, "0")}-cm.json`;
}

/** Resultado de um município: …/dados/{uf}/{uf}{codigoTSE}-c{cargo}-e{eleicao6}-u.json */
export function municipalResultUrl(
  endpoint: TseEndpointConfig,
  electionCode: string,
  office: OfficeKey,
  uf: string,
  tseCode: string,
): string {
  const abr = uf.toLowerCase();
  const ele = electionCode.padStart(6, "0");
  return `${endpoint.baseUrl}/${endpoint.cycle}/${electionCode}/${endpoint.dataPath}/${abr}/${abr}${tseCode}-c${OFFICES[office].tseCode}-e${ele}-${endpoint.fileSuffix}.json`;
}

export interface TseMunicipality {
  /** Código do município no TSE (5 dígitos). */
  tseCode: string;
  /** Código IBGE (7 dígitos), quando informado pelo TSE. */
  ibge: string | null;
  name: string;
  uf: string;
}

/** Lê a lista de municípios (formato: abr[] → mu[] com cd, cdi, nm). */
export function parseMunicipalityConfig(raw: unknown, uf?: string): TseMunicipality[] {
  const r = obj(raw);
  const out: TseMunicipality[] = [];
  for (const abr of arr(r?.abr)) {
    const sigla = str(abr.cd).toUpperCase();
    if (uf && sigla !== uf.toUpperCase()) continue;
    for (const mu of arr(abr.mu)) {
      const tseCode = str(mu.cd);
      if (!tseCode) continue;
      out.push({ tseCode, ibge: str(mu.cdi) || null, name: str(mu.nm), uf: sigla });
    }
  }
  return out;
}

/** Normaliza nomes de municípios para comparação (sem acentos, apóstrofos ou espaços). */
export function normalizePlaceName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

/** Candidato em destaque: "#1234" busca pelo número; outro texto busca no nome (sem acentos); "|" separa alternativas. */
export function matchesCandidate(c: { name: string; number: string }, query: string): boolean {
  // Alternativas separadas por "|": "EDUARDO SIVINSK|DUDU SIVINSK".
  if (query.includes("|")) return query.split("|").some((alt) => matchesCandidate(c, alt));
  const q = query.trim();
  if (!q) return false;
  if (q.startsWith("#")) return c.number === q.slice(1).trim();
  // Compara palavras inteiras: "CANDIDATO K" não deve casar com "CANDIDATO K1".
  const words = (s: string) =>
    ` ${s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim()} `;
  const name = words(c.name);
  const wanted = words(q);
  if (name.includes(wanted)) return true;
  // Tolera grafia incompleta no fim do nome (ex.: "SIVINSK" encontra "SIVINSKI"), só para palavras com 4+ letras.
  const last = wanted.trim().split(" ").pop() ?? "";
  return last.length >= 4 && name.includes(wanted.trimEnd());
}

export interface FeaturedCandidate {
  office: OfficeKey;
  scope: string;
  query: string;
}

/** Lê "cargo:uf:nome-ou-#numero;cargo:uf:..." (ex.: "deputado-federal:sp:ROBERTINHO DA PADARIA"). */
export function parseFeaturedCandidates(spec: string): FeaturedCandidate[] {
  return spec
    .split(";")
    .map((item) => item.split(":").map((p) => p.trim()))
    .filter((p): p is [string, string, string] => p.length === 3 && p[0]! in OFFICES && !!p[1] && !!p[2])
    .map(([office, scope, query]) => ({ office: office as OfficeKey, scope: scope.toLowerCase(), query }));
}
