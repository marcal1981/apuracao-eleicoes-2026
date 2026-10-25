// Presidente numa cidade, 1º × 2º turno (aba "2º turno na cidade").
// Lê o arquivo municipal do TSE de cada turno; o do 2º turno é relido a cada minuto enquanto a página
// (ou a última consulta) estiver ativa, e cada mudança vira um ponto da evolução, guardado em disco.

import { electionCodeFor, municipalResultUrl, parseSimplifiedResult } from "@apuracao/core";
import { promises as fs } from "node:fs";
import path from "node:path";
import { getIngestor, getMunicipalityRegistry, getSecondRoundIngestor, type Ingestor } from "./ingestor";

export interface CityRound {
  status: string;
  pct: number;
  sectionsTotalized: number;
  sections: number;
  electorate: number;
  turnout: number;
  abstention: number;
  valid: number;
  blank: number;
  null: number;
  /** número → { nome, votos } */
  candidates: { number: string; name: string; votes: number }[];
  timestamp: string | null;
}

export interface CityPoint {
  pct: number;
  time: string;
  votes: Record<string, number>;
}

interface CityState {
  ibge: string;
  name: string;
  tseCode: string;
  r1?: CityRound & { etag?: string; lastModified?: string };
  r2?: CityRound & { etag?: string; lastModified?: string };
  series: CityPoint[];
  lastFetch: number;
  lastAccess: number;
  error: string | null;
  timer?: NodeJS.Timeout;
  loaded?: Promise<void>;
}

const REFRESH_MS = 60_000;
/** Para de consultar a cidade depois de 30 min sem ninguém olhar. */
const IDLE_MS = 30 * 60_000;
const KEY = Symbol.for("apuracao.city-rounds");

function states(): Map<string, CityState> {
  const g = globalThis as unknown as Record<symbol, Map<string, CityState> | undefined>;
  return (g[KEY] ??= new Map());
}

const seriesFile = (ing: Ingestor, ibge: string) => path.join(ing.config.dataDir, "cities", `segundo-turno-${ibge}.json`);

async function fetchRound(ing: Ingestor, round: 1 | 2, st: CityState) {
  const prev = round === 1 ? st.r1 : st.r2;
  const url = municipalResultUrl(ing.config.endpoint, electionCodeFor(ing.config.electionCodes, "presidente"), "presidente", "sp", st.tseCode);
  const res = await ing.httpGet(url, prev);
  if (res.kind !== "new") return false;
  const r = parseSimplifiedResult(JSON.parse(res.body), { office: "presidente", scope: "sp", round, skipProjection: true });
  const data: CityRound & { etag?: string; lastModified?: string } = {
    etag: res.etag,
    lastModified: res.lastModified,
    status: r.status,
    pct: r.sectionsTotalizedPct,
    sectionsTotalized: r.sectionsTotalized,
    sections: r.sections,
    electorate: r.totals.electorate,
    turnout: r.totals.turnout,
    abstention: r.totals.abstention,
    valid: r.totals.valid,
    blank: r.totals.blank,
    null: r.totals.null,
    candidates: r.candidates.map((c) => ({ number: c.number, name: c.name, votes: c.votes })),
    timestamp: r.officialTimestamp,
  };
  if (round === 1) st.r1 = data;
  else st.r2 = data;
  return true;
}

async function refresh(st: CityState) {
  const r1ing = getIngestor();
  const r2ing = getSecondRoundIngestor();
  try {
    // O 1º turno está finalizado: basta uma leitura.
    if (!st.r1 || st.r1.status !== "TOTALIZACAO_FINALIZADA") await fetchRound(r1ing, 1, st);
    if (r2ing && (await fetchRound(r2ing, 2, st)) && st.r2 && st.r2.pct > 0) {
      const last = st.series[st.series.length - 1];
      if (!last || last.pct !== st.r2.pct) {
        st.series.push({
          pct: st.r2.pct,
          time: st.r2.timestamp ?? new Date().toISOString(),
          votes: Object.fromEntries(st.r2.candidates.map((c) => [c.number, c.votes])),
        });
        const file = seriesFile(r1ing, st.ibge);
        await fs.mkdir(path.dirname(file), { recursive: true });
        await fs.writeFile(file, JSON.stringify(st.series), "utf8").catch(() => {});
      }
    }
    st.error = null;
  } catch (err) {
    st.error = err instanceof Error ? err.message : String(err);
  }
  st.lastFetch = Date.now();
}

/** Cidades de SP pela lista do TSE (nome e código IBGE), para o seletor da página. */
export async function cityOptions() {
  const reg = getMunicipalityRegistry("sp");
  if (!reg) return [];
  await reg.ensureTseCodes();
  return reg
    .municipalities()
    .filter((m) => m.tseCode)
    .map((m) => ({ ibge: m.ibge, name: m.name }))
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
}

export async function getCityRounds(ibge: string) {
  const map = states();
  let st = map.get(ibge);
  if (!st) {
    const reg = getMunicipalityRegistry("sp");
    if (!reg || !(await reg.ensureTseCodes())) return { error: reg?.lastError ?? "Lista de municípios do TSE ainda não disponível" };
    const m = reg.municipalities().find((x) => x.ibge === ibge);
    if (!m?.tseCode) return { error: "Cidade não encontrada na lista do TSE" };
    st = { ibge, name: m.name, tseCode: m.tseCode, series: [], lastFetch: 0, lastAccess: Date.now(), error: null };
    const created = st;
    created.loaded = fs
      .readFile(seriesFile(getIngestor(), ibge), "utf8")
      .then((s) => void (created.series = JSON.parse(s) as CityPoint[]))
      .catch(() => {});
    map.set(ibge, st);
  }
  st.lastAccess = Date.now();
  await st.loaded;
  if (Date.now() - st.lastFetch > REFRESH_MS) await refresh(st);
  // Mantém a evolução sendo registrada mesmo entre uma consulta e outra da página.
  if (!st.timer) {
    const s = st;
    s.timer = setInterval(() => {
      if (Date.now() - s.lastAccess > IDLE_MS || s.r2?.status === "TOTALIZACAO_FINALIZADA") {
        clearInterval(s.timer);
        s.timer = undefined;
        return;
      }
      if (Date.now() - s.lastFetch >= REFRESH_MS) void refresh(s);
    }, 15_000);
  }
  const strip = (r?: CityState["r1"]) => {
    if (!r) return null;
    const { etag: _e, lastModified: _l, ...rest } = r;
    return rest;
  };
  return { ibge, name: st.name, error: st.error, r1: strip(st.r1), r2: strip(st.r2), series: st.series };
}
