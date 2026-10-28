// Estimativa (não oficial) da abstenção do 2º turno por faixa de idade, enquanto o TSE não publica o perfil do 2º turno.
//
// Dados: para cada município, os eleitores e a abstenção de cada faixa de idade no 1º turno (perfil do TSE) e a
// abstenção total do município no 2º turno (resultado oficial). Modelo: em cada faixa, a abstenção mudou do 1º
// para o 2º turno o mesmo tanto em todos os municípios do estado (Δ da faixa). A mudança de cada município é então
// a soma das mudanças das faixas, pesadas pela participação de cada faixa no eleitorado dele; os Δ saem de uma
// regressão (mínimos quadrados ponderados pelo eleitorado) com todos os municípios do estado.

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

/** Resolve A·x = b (sistema pequeno) por eliminação de Gauss com pivô; null se singular. */
function solve(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]!]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r]![c]!) > Math.abs(M[p]![c]!)) p = r;
    if (Math.abs(M[p]![c]!) < 1e-12) return null;
    [M[c], M[p]] = [M[p]!, M[c]!];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r]![c]! / M[c]![c]!;
      for (let k = c; k <= n; k++) M[r]![k]! -= f * M[c]![k]!;
    }
  }
  return M.map((row, i) => row[n]! / row[i]!);
}

function inverse(A: number[][]): number[][] | null {
  const n = A.length;
  const cols: number[][] = [];
  for (let j = 0; j < n; j++) {
    const x = solve(A, A.map((_, i) => (i === j ? 1 : 0)));
    if (!x) return null;
    cols.push(x);
  }
  return A.map((_, i) => cols.map((c) => c[i]!));
}

export function estimateSecondRoundByAge(uf: string) {
  const profile = getAbstentionProfile(getIngestor());
  profile.ensure();
  const t1 = profile.profile(uf)?.["1"];
  if (!t1 || !t1.cityBands) return { status: "waiting" as const, message: "O perfil do 1º turno ainda está sendo preparado." };
  const codes = Object.keys(t1.cityBands);
  const job = loadCities(uf, codes);
  if (job.status !== "ready") return { status: job.status, done: job.done, total: job.total, message: job.message };

  // Uma linha por município: participação de cada faixa no eleitorado e a mudança da abstenção (pontos de %).
  const k = AGE_BANDS.length;
  const XtWX = Array.from({ length: k }, () => new Array<number>(k).fill(0));
  const XtWy = new Array<number>(k).fill(0);
  const rows: { s: number[]; y: number; w: number }[] = [];
  const r1Band = AGE_BANDS.map(() => [0, 0]);
  let r2Electorate = 0;
  let r2Abst = 0;
  for (const code of codes) {
    const bands = t1.cityBands[code]!;
    const aptos = bands.reduce((s, b) => s + b[0]!, 0);
    const abst1 = bands.reduce((s, b) => s + b[1]!, 0);
    bands.forEach((b, i) => {
      r1Band[i]![0]! += b[0]!;
      r1Band[i]![1]! += b[1]!;
    });
    const r2 = job.cities[code];
    if (!r2 || aptos < 50 || r2[0] <= 0) continue;
    r2Electorate += r2[0];
    r2Abst += r2[1];
    const s = bands.map((b) => b[0]! / aptos);
    const y = (r2[1] / r2[0] - abst1 / aptos) * 100;
    const w = aptos;
    rows.push({ s, y, w });
    for (let i = 0; i < k; i++) {
      XtWy[i]! += w * s[i]! * y;
      for (let j = 0; j < k; j++) XtWX[i]![j]! += w * s[i]! * s[j]!;
    }
  }
  if (rows.length < k * 3) return { status: "error" as const, message: `Poucos municípios com o 2º turno finalizado (${rows.length}) para estimar.` };
  const delta = solve(XtWX, XtWy);
  const inv = inverse(XtWX);
  if (!delta || !inv) return { status: "error" as const, message: "Não foi possível estimar (faixas muito parecidas entre os municípios)." };
  // Erro-padrão: variância dos resíduos (ponderada) × (X'WX)⁻¹.
  let sse = 0;
  for (const r of rows) {
    const fit = r.s.reduce((sum, v, i) => sum + v * delta[i]!, 0);
    sse += r.w * (r.y - fit) ** 2;
  }
  const sigma2 = sse / (rows.length - k);
  const totalAptos = r1Band.reduce((s, b) => s + b[0]!, 0);
  const bands = AGE_BANDS.map((b, i) => {
    const r1Rate = (r1Band[i]![1]! / r1Band[i]![0]!) * 100;
    const r2Rate = Math.min(100, Math.max(0, r1Rate + delta[i]!));
    return {
      label: b.label,
      aptos: r1Band[i]![0]!,
      share: (r1Band[i]![0]! / totalAptos) * 100,
      r1Rate,
      r2Rate,
      delta: delta[i]!,
      // margem de 95%
      margin: 1.96 * Math.sqrt(Math.max(0, sigma2 * inv[i]![i]!)),
    };
  });
  return {
    status: "ready" as const,
    citiesUsed: rows.length,
    citiesTotal: codes.length,
    r2ActualRate: r2Electorate > 0 ? (r2Abst / r2Electorate) * 100 : null,
    r2ModelRate: bands.reduce((s, b) => s + (b.share / 100) * b.r2Rate, 0),
    bands,
    message: job.message,
  };
}
