// Gerador de arquivos no formato do TSE para desenvolvimento, testes e ensaios de carga.
// Os candidatos são fictícios ("Candidato A", "Candidato B"...) e a interface sinaliza
// claramente quando a plataforma está em modo de simulação.

import { OFFICES, type OfficeKey } from "./domain";

const fmtInt = (n: number) => String(Math.round(n));
const fmtPct = (n: number) => n.toFixed(2).replace(".", ",");

function hashSeed(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function rng(seed: number) {
  let s = seed || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 1_000_000) / 1_000_000;
  };
}

export interface SimulationOptions {
  office: OfficeKey;
  scope: string;
  round: number;
  electionCode: string;
  /** Progresso da apuração, de 0 a 1. */
  progress: number;
  /** Data/hora usada como horário oficial da totalização. */
  now: Date;
}

/** Data/hora no fuso de Brasília, como o TSE publica. */
function brasiliaParts(d: Date): Record<"day" | "month" | "year" | "hour" | "minute" | "second", string> {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  return { day: get("day"), month: get("month"), year: get("year"), hour: get("hour"), minute: get("minute"), second: get("second") };
}

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

function candidateCount(office: OfficeKey, round: number): number {
  if (round === 2) return 2;
  if (OFFICES[office].system === "proporcional") return 60;
  if (office === "senador") return 7;
  return office === "presidente" ? 9 : 6;
}

/** Gera um arquivo "dados simplificados" sintético e determinístico para o progresso informado. */
export function simulateSimplifiedResult(opts: SimulationOptions): Record<string, unknown> {
  const { office, scope, round, progress } = opts;
  const p = Math.min(1, Math.max(0, progress));
  const rand = rng(hashSeed(`${office}:${scope}:${round}`));
  const electorate = Math.round((scope === "br" ? 156_000_000 : 2_000_000 + rand() * 30_000_000));
  const sections = Math.round(electorate / 330);
  const totalizedSections = Math.round(sections * p);
  const turnoutRate = 0.78 + rand() * 0.04;
  const turnout = electorate * turnoutRate * p;
  const blank = turnout * 0.02;
  const nulls = turnout * 0.035;
  const valid = turnout - blank - nulls;

  const n = candidateCount(office, round);
  // Pesos base + uma deriva dependente do progresso, para que o ranking mude ao longo da apuração.
  const weights = Array.from({ length: n }, (_, i) => {
    const base = Math.pow(0.72, i) * (0.8 + rand() * 0.4);
    const drift = (rand() - 0.5) * 0.35 * Math.sin(p * Math.PI);
    return Math.max(0.0005, base * (1 + drift));
  });
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  const votes = weights.map((w) => Math.floor((valid * w) / totalWeight));

  const finished = p >= 1;
  const proportional = OFFICES[office].system === "proporcional";
  const seats = OFFICES[office].seats ?? 1;
  const order = votes.map((v, i) => [v, i] as const).sort((a, b) => b[0] - a[0]).map(([, i]) => i);
  const proportionalSeats = proportional ? Math.max(8, Math.round(n / 4)) : 0;

  const cand = votes.map((v, i) => {
    const rank = order.indexOf(i);
    let st = "";
    let e = "n";
    if (finished) {
      if (proportional) {
        if (rank < proportionalSeats) {
          st = rank % 3 === 2 ? "Eleito por média" : "Eleito por QP";
          e = "s";
        } else st = "Suplente";
      } else if (office === "senador") {
        if (rank < seats) {
          st = "Eleito";
          e = "s";
        } else st = "Não eleito";
      } else {
        const leaderPct = (votes[order[0]!]! / Math.max(1, valid)) * 100;
        if (round === 1 && leaderPct <= 50 && OFFICES[office].hasSecondRound) {
          st = rank < 2 ? "2º turno" : "Não eleito";
        } else if (rank === 0) {
          st = "Eleito";
          e = "s";
        } else st = "Não eleito";
      }
    }
    return {
      seq: String(i + 1),
      sqcand: String(900000000000 + hashSeed(`${office}:${scope}:${i}`) % 99999999),
      n: proportional ? String(1000 + i * 37) : String(10 + i * 3),
      nm: `CANDIDATO ${LETTERS[i % 26]}${i >= 26 ? Math.floor(i / 26) : ""}`,
      cc: `PARTIDO ${LETTERS[(i * 7) % 26]}`,
      nv: office === "presidente" || office === "governador" ? `VICE ${LETTERS[i % 26]}` : "",
      e,
      st,
      dvt: "Válido",
      vap: fmtInt(v),
      pvap: fmtPct(valid > 0 ? (v / valid) * 100 : 0),
    };
  });
  const bt = brasiliaParts(opts.now);
  return {
    ele: opts.electionCode,
    tpabr: scope === "br" ? "PAIS" : "UF",
    cdabr: scope.toUpperCase(),
    t: String(round),
    dg: `${bt.day}/${bt.month}/${bt.year}`,
    hg: `${bt.hour}:${bt.minute}:${bt.second}`,
    tf: finished ? "s" : "n",
    s: fmtInt(sections),
    st: fmtInt(totalizedSections),
    pst: fmtPct(p * 100),
    e: fmtInt(electorate),
    c: fmtInt(turnout),
    pc: fmtPct(p > 0 ? turnoutRate * 100 : 0),
    a: fmtInt(electorate * (1 - turnoutRate) * p),
    pa: fmtPct(p > 0 ? (1 - turnoutRate) * 100 : 0),
    vv: fmtInt(valid),
    pvv: fmtPct(turnout > 0 ? (valid / turnout) * 100 : 0),
    vb: fmtInt(blank),
    pvb: fmtPct(turnout > 0 ? (blank / turnout) * 100 : 0),
    tvn: fmtInt(nulls),
    ptvn: fmtPct(turnout > 0 ? (nulls / turnout) * 100 : 0),
    cand,
  };
}
