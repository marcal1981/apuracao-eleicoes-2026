// Abstenção do 2º turno por município, cruzada com o perfil do eleitorado de cada município (1º turno), enquanto o
// TSE não publica o perfil oficial do 2º turno.
//
// Obs.: estimar a abstenção de cada idade a partir dos municípios (regressão ecológica) foi testado e dá resultados
// instáveis e implausíveis — a composição por idade varia pouco entre municípios e se mistura a outras diferenças
// (tamanho, urbanização). Por isso aqui só se mostra o dado observado: grupos de municípios e a abstenção de cada um.

import { electionCodeFor, municipalResultUrl, parseSimplifiedResult } from "@apuracao/core";
import { promises as fs } from "node:fs";
import path from "node:path";
import { AGE_BANDS, getAbstentionProfile } from "./abstention-profile";
import { getIngestor, getSecondRoundIngestor } from "./ingestor";

/** código do município → [eleitores, abstenção] no 2º turno */
type CityR2 = Record<string, [number, number]>;

interface Job {
  status: "loading" | "ready" | "error";
  done: number;
  total: number;
  message: string | null;
  cities: CityR2;
}

const KEY = Symbol.for("apuracao.age-estimate");
const jobs = (): Map<string, Job> => {
  const g = globalThis as unknown as Record<symbol, Map<string, Job> | undefined>;
  return (g[KEY] ??= new Map());
};

/** Lê (uma vez) a abstenção de cada município da UF no 2º turno; resultado final fica em disco. */
function loadCities(uf: string, codes: string[]): Job {
  const map = jobs();
  const existing = map.get(uf);
  if (existing && existing.status !== "error") return existing;
  const job: Job = { status: "loading", done: 0, total: codes.length, message: null, cities: {} };
  map.set(uf, job);
  void (async () => {
    const main = getIngestor();
    const r2 = getSecondRoundIngestor();
    if (!r2) throw new Error("acompanhamento do 2º turno desligado");
    const file = path.join(main.config.dataDir, "cities", `abstencao-2turno-${uf.toLowerCase()}.json`);
    try {
      Object.assign(job.cities, JSON.parse(await fs.readFile(file, "utf8")) as CityR2);
    } catch {
      // ainda não lido
    }
    const queue = codes.filter((c) => !job.cities[c]);
    job.done = codes.length - queue.length;
    const code = electionCodeFor(r2.config.electionCodes, "presidente");
    let failures = 0;
    const worker = async () => {
      for (let c = queue.shift(); c; c = queue.shift()) {
        try {
          const res = await r2.httpGet(municipalResultUrl(r2.config.endpoint, code, "presidente", uf, c), undefined, 30_000);
          if (res.kind === "new") {
            const r = parseSimplifiedResult(JSON.parse(res.body), { office: "presidente", scope: uf, round: 2, skipProjection: true });
            // Só o resultado final (100% apurado) serve para a estimativa.
            if (r.sectionsTotalizedPct >= 100) job.cities[c] = [r.totals.turnout + r.totals.abstention, r.totals.abstention];
          }
        } catch {
          failures++;
        }
        job.done++;
      }
    };
    await Promise.all(Array.from({ length: 4 }, worker));
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, JSON.stringify(job.cities), "utf8");
    job.status = "ready";
    if (failures) job.message = `${failures} municípios não puderam ser lidos agora (ficam de fora da estimativa).`;
  })().catch((err: unknown) => {
    job.status = "error";
    job.message = err instanceof Error ? err.message : String(err);
  });
  return job;
}

export interface CityGroup {
  label: string;
  cities: number;
  electorate: number;
  /** valor médio do critério no grupo (ex.: % de eleitores de 16 a 24 anos) */
  value: number;
  r1Rate: number;
  r2Rate: number;
}

/**
 * Os municípios do estado em cinco grupos (do menor para o maior valor de cada critério: % de jovens, % de idosos e
 * tamanho do eleitorado) e a abstenção de cada grupo nos dois turnos. Dado observado, sem modelo: mostra onde a
 * abstenção caiu mais, não a abstenção de cada idade (isso só o perfil oficial do 2º turno vai dizer).
 */
export function compareCitiesByProfile(uf: string) {
  const profile = getAbstentionProfile(getIngestor());
  profile.ensure();
  const t1 = profile.profile(uf)?.["1"];
  if (!t1 || !t1.cityBands) return { status: "waiting" as const, message: "O perfil do 1º turno ainda está sendo preparado." };
  const codes = Object.keys(t1.cityBands);
  const job = loadCities(uf, codes);
  if (job.status !== "ready") return { status: job.status, done: job.done, total: job.total, message: job.message };

  const rows = codes
    .map((code) => {
      const bands = t1.cityBands[code]!;
      const aptos = bands.reduce((s, b) => s + b[0]!, 0);
      const abst = bands.reduce((s, b) => s + b[1]!, 0);
      const r2 = job.cities[code];
      return r2 && aptos >= 50 && r2[0] > 0
        ? { aptos, young: bands[0]![0]! / aptos, old: bands[AGE_BANDS.length - 1]![0]! / aptos, r1: abst / aptos, r2: r2[1] / r2[0] }
        : null;
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);

  const groupsBy = (key: "young" | "old" | "aptos", label: (lo: number, hi: number) => string): CityGroup[] => {
    const sorted = [...rows].sort((a, b) => a[key] - b[key]);
    const q = 5;
    return Array.from({ length: q }, (_, i) => {
      const g = sorted.slice(Math.floor((i * sorted.length) / q), Math.floor(((i + 1) * sorted.length) / q));
      const w = g.reduce((s, r) => s + r.aptos, 0);
      const avg = (f: (r: (typeof g)[0]) => number) => g.reduce((s, r) => s + f(r) * r.aptos, 0) / Math.max(1, w);
      return {
        label: label(g[0]?.[key] ?? 0, g[g.length - 1]?.[key] ?? 0),
        cities: g.length,
        electorate: w,
        value: key === "aptos" ? w / Math.max(1, g.length) : avg((r) => r[key]) * 100,
        r1Rate: avg((r) => r.r1) * 100,
        r2Rate: avg((r) => r.r2) * 100,
      };
    });
  };
  const pctRange = (lo: number, hi: number) =>
    `${(lo * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}% a ${(hi * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
  const intRange = (lo: number, hi: number) => `${Math.round(lo).toLocaleString("pt-BR")} a ${Math.round(hi).toLocaleString("pt-BR")} eleitores`;
  return {
    status: "ready" as const,
    citiesUsed: rows.length,
    citiesTotal: codes.length,
    groups: [
      { key: "jovens", title: "Cidades pela proporção de eleitores de 16 a 24 anos", unit: "% de 16 a 24 anos", items: groupsBy("young", pctRange) },
      { key: "idosos", title: "Cidades pela proporção de eleitores de 70 anos ou mais", unit: "% de 70 anos ou mais", items: groupsBy("old", pctRange) },
      { key: "tamanho", title: "Cidades pelo tamanho do eleitorado", unit: "eleitores por cidade (média)", items: groupsBy("aptos", intRange) },
    ],
    /** abstenção de cada município no 2º turno: código → [eleitores, abstenção] */
    cities: job.cities,
    message: job.message,
  };
}
