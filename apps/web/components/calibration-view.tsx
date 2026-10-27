"use client";

import { useEffect, useMemo, useState } from "react";
import { formatPct, formatTimeBrasilia } from "@apuracao/core";
import { DEFAULT_PARAMS, projectFinal, type ProjectionParams, type UfState } from "@/lib/projection";

interface Moment {
  time: string;
  pct: number;
  count: { a: number; b: number };
  ufs: UfState[];
}
interface Data {
  finalists: { number: string; name: string }[];
  final: { a: number; b: number; pct: number; status: string };
  ufsWithR1History: number;
  updates: number;
  moments: Moment[];
}

const FIXED: [RegExp, string][] = [
  [/\bLULA\b/i, "#dc2626"],
  [/\bBOLSONARO\b/i, "#2563eb"],
];
const FALLBACK = ["#7c3aed", "#0891b2"];
const colorFor = (name: string, i: number) => FIXED.find(([re]) => re.test(name))?.[1] ?? FALLBACK[i]!;
const title = (s: string) =>
  s
    .toLowerCase()
    .replace(/(^|\s)\S/g, (c) => c.toUpperCase())
    .replace(/ (Da|De|Do|Das|Dos|E)(?= )/g, (w) => w.toLowerCase());
const shareA = (a: number, b: number) => (a + b > 0 ? (a / (a + b)) * 100 : 50);
const f1 = (v: number) => v.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const f2 = (v: number) => v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const chance = (v: number) => (v > 0.995 ? "> 99%" : v < 0.005 ? "< 1%" : `${Math.round(v * 100)}%`);

/** Fases da apuração para o resumo (por % das urnas apuradas no Brasil). */
const PHASES: [number, number][] = [
  [0, 10],
  [10, 25],
  [25, 50],
  [50, 75],
  [75, 100.01],
];

interface Row {
  time: string;
  pct: number;
  count: number;
  proj: number;
  sd: number;
  chanceA: number;
  errProj: number;
  errCount: number;
  inside: boolean;
}

/** Avalia um conjunto de parâmetros em todos os momentos da noite. */
function evaluate(moments: Moment[], params: ProjectionParams, finalA: number): Row[] {
  const out: Row[] = [];
  for (const m of moments) {
    const p = projectFinal(m.ufs, params);
    if (!p) continue;
    const count = shareA(m.count.a, m.count.b);
    out.push({
      time: m.time,
      pct: m.pct,
      count,
      proj: p.shareA,
      sd: p.sd,
      chanceA: p.chanceA,
      errProj: p.shareA - finalA,
      errCount: count - finalA,
      inside: Math.abs(p.shareA - finalA) <= 1.96 * Math.max(p.sd, 0.05),
    });
  }
  return out;
}

/** Pontuação logarítmica (quanto menor, melhor): premia acertar e ter a margem do tamanho certo. */
function logScore(rows: Row[]) {
  if (rows.length === 0) return Infinity;
  let s = 0;
  for (const r of rows) {
    const sd = Math.max(r.sd, 0.05);
    s += Math.log(sd) + (r.errProj * r.errProj) / (2 * sd * sd);
  }
  return s / rows.length;
}

/** Calibração da projeção: refaz a projeção em cada momento da noite e compara com o resultado final. */
export function CalibrationView() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [params, setParams] = useState<ProjectionParams>(DEFAULT_PARAMS);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    fetch("/api/v1/segundo-turno/calibracao", { cache: "no-store" })
      .then(async (r) => {
        const body = (await r.json()) as Data & { error?: string };
        if (!r.ok) throw new Error(body.error ?? `HTTP ${r.status}`);
        setData(body);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  const [A, B] = data?.finalists ?? [];
  const nameA = A ? title(A.name) : "Candidato A";
  const nameB = B ? title(B.name) : "Candidato B";
  const colorA = A ? colorFor(A.name, 0) : FALLBACK[0]!;
  const colorB = B ? colorFor(B.name, 1) : FALLBACK[1]!;
  const finalA = data ? shareA(data.final.a, data.final.b) : 50;
  const winnerA = finalA >= 50;

  const rows = useMemo(() => (data ? evaluate(data.moments, params, finalA) : []), [data, params, finalA]);
  const current = useMemo(() => (data ? evaluate(data.moments, DEFAULT_PARAMS, finalA) : []), [data, finalA]);

  // Busca os parâmetros com a melhor pontuação (a direção da projeção não muda; só a margem de erro).
  const suggested = useMemo(() => {
    if (!data) return null;
    let best: { params: ProjectionParams; score: number } | null = null;
    for (let sdUf = 0.5; sdUf <= 10.01; sdUf += 0.5)
      for (let sdCommon = 0; sdCommon <= 8.01; sdCommon += 0.5) {
        const p = { sdUf, sdCommon };
        const score = logScore(evaluate(data.moments, p, finalA));
        if (!best || score < best.score) best = { params: p, score };
      }
    return best;
  }, [data, finalA]);

  const phases = PHASES.map(([lo, hi]) => {
    const rs = rows.filter((r) => r.pct >= lo && r.pct < hi);
    const avg = (f: (r: Row) => number) => (rs.length ? rs.reduce((s, r) => s + f(r), 0) / rs.length : null);
    return {
      label: `${lo}% a ${Math.min(100, Math.round(hi))}%`,
      n: rs.length,
      errCount: avg((r) => Math.abs(r.errCount)),
      errProj: avg((r) => Math.abs(r.errProj)),
      margin: avg((r) => 1.96 * r.sd),
      inside: avg((r) => (r.inside ? 100 : 0)),
      right: avg((r) => ((r.proj >= 50) === winnerA ? 100 : 0)),
      chanceWinner: avg((r) => (winnerA ? r.chanceA : 1 - r.chanceA)),
    };
  });

  // Desde quando a projeção apontou o vencedor certo sem mudar mais.
  let steadyFrom: Row | null = null;
  for (let i = rows.length - 1; i >= 0; i--) {
    if ((rows[i]!.proj >= 50) !== winnerA) break;
    steadyFrom = rows[i]!;
  }
  let countSteadyFrom: Row | null = null;
  for (let i = rows.length - 1; i >= 0; i--) {
    if ((rows[i]!.count >= 50) !== winnerA) break;
    countSteadyFrom = rows[i]!;
  }

  const winnerName = winnerA ? nameA : nameB;
  const winnerColor = winnerA ? colorA : colorB;

  return (
    <section className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Calibração da projeção — 2º turno</h1>
        <p className="text-sm text-muted">
          A apuração da noite gravada pelo sistema, &quot;rebobinada&quot;: em cada momento a projeção é refeita com os dados que existiam naquela
          hora e comparada com o resultado final. Mostra o erro típico em cada fase e qual margem de erro deixaria a projeção mais bem
          calibrada.
        </p>
      </div>

      {error && (
        <p role="alert" className="rounded-lg border border-amber-500/50 bg-amber-500/10 px-4 py-2 text-sm">
          {error}
        </p>
      )}
      {!data ? (
        !error && <p className="text-sm text-muted">Rebobinando a apuração…</p>
      ) : data.moments.length < 3 ? (
        <p className="rounded-lg border border-border bg-surface px-4 py-3 text-sm text-muted">
          O sistema guardou poucas atualizações do 2º turno ({data.updates}) — é preciso ter ficado aberto durante a apuração.
        </p>
      ) : (
        <>
          <div className="rounded-xl border border-border bg-surface p-4 text-sm">
            <p>
              Resultado final ({formatPct(data.final.pct)} apurado):{" "}
              <strong style={{ color: colorA }}>
                {nameA} {formatPct(finalA)}
              </strong>{" "}
              ×{" "}
              <strong style={{ color: colorB }}>
                {nameB} {formatPct(100 - finalA)}
              </strong>
              . {data.updates} atualizações guardadas; {data.moments.length} momentos analisados; {data.ufsWithR1History} de 28 UFs com a
              evolução do 1º turno guardada{data.ufsWithR1History < 20 ? " (nas demais, a projeção usa só o resultado final do 1º turno)" : ""}.
            </p>
            <p className="mt-2">
              A projeção apontou <strong style={{ color: winnerColor }}>{winnerName}</strong> sem mudar mais a partir de{" "}
              <strong>{steadyFrom ? `${formatPct(steadyFrom.pct)} apurado (às ${formatTimeBrasilia(steadyFrom.time)})` : "—"}</strong>; o placar
              (só a contagem) passou a mostrar {winnerName} à frente de vez a partir de{" "}
              <strong>{countSteadyFrom ? `${formatPct(countSteadyFrom.pct)} apurado (às ${formatTimeBrasilia(countSteadyFrom.time)})` : "—"}</strong>.
            </p>
          </div>

          <Chart rows={rows} finalA={finalA} nameA={nameA} colorA={colorA} colorB={colorB} />

          <div className="rounded-xl border border-border bg-surface p-4">
            <h2 className="text-base font-semibold">Margem de erro da projeção</h2>
            <p className="text-xs text-muted">
              A direção da projeção vem dos dados de cada estado; estes dois números definem só o tamanho da margem (e, com ele, a chance de
              cada um terminar à frente). Mexa e veja o efeito nas tabelas.
            </p>
            <div className="mt-3 grid gap-4 sm:grid-cols-2">
              {(
                [
                  ["sdUf", "Incerteza de cada estado", 0.5, 10],
                  ["sdCommon", "Incerteza comum a todos os estados", 0, 8],
                ] as const
              ).map(([k, label, min, max]) => (
                <label key={k} className="text-sm">
                  {label}: <strong>{f1(params[k])} pontos</strong>
                  <input
                    type="range"
                    min={min}
                    max={max}
                    step={0.5}
                    value={params[k]}
                    onChange={(e) => setParams({ ...params, [k]: Number(e.target.value) })}
                    className="mt-1 w-full"
                  />
                </label>
              ))}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
              <button type="button" onClick={() => setParams(DEFAULT_PARAMS)} className="rounded-full border border-border px-3 py-1 hover:border-accent hover:text-accent">
                Valores da aba ao vivo ({f1(DEFAULT_PARAMS.sdUf)} e {f1(DEFAULT_PARAMS.sdCommon)})
              </button>
              {suggested && (
                <button
                  type="button"
                  onClick={() => setParams(suggested.params)}
                  className="rounded-full border border-accent px-3 py-1 text-accent hover:bg-accent hover:text-white"
                >
                  Melhor ajuste desta noite ({f1(suggested.params.sdUf)} e {f1(suggested.params.sdCommon)})
                </button>
              )}
              <span className="text-xs text-muted">
                Pontuação (menor = melhor): atual {f2(logScore(current))} · escolhida {f2(logScore(rows))}
              </span>
            </div>
          </div>

          <div className="overflow-x-auto rounded-xl border border-border bg-surface">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted">
                <tr className="border-b border-border">
                  <th className="px-3 py-2">Fase (urnas apuradas)</th>
                  <th className="px-3 py-2 text-right">Momentos</th>
                  <th className="px-3 py-2 text-right">
                    Erro do placar
                    <span className="block font-normal">só a contagem</span>
                  </th>
                  <th className="px-3 py-2 text-right">
                    Erro da projeção
                    <span className="block font-normal">média, em pontos de %</span>
                  </th>
                  <th className="px-3 py-2 text-right">
                    Margem usada
                    <span className="block font-normal">± (95%)</span>
                  </th>
                  <th className="px-3 py-2 text-right">
                    Resultado dentro da margem
                    <span className="block font-normal">ideal: perto de 95%</span>
                  </th>
                  <th className="px-3 py-2 text-right">Apontou o vencedor</th>
                  <th className="px-3 py-2 text-right">Chance média dada a {winnerName}</th>
                </tr>
              </thead>
              <tbody>
                {phases.map((p) => (
                  <tr key={p.label} className="border-b border-border last:border-0">
                    <td className="px-3 py-2 font-medium">{p.label}</td>
                    <td className="px-3 py-2 text-right">{p.n}</td>
                    <td className="px-3 py-2 text-right">{p.errCount === null ? "—" : f2(p.errCount)}</td>
                    <td className="px-3 py-2 text-right font-semibold">{p.errProj === null ? "—" : f2(p.errProj)}</td>
                    <td className="px-3 py-2 text-right">{p.margin === null ? "—" : `± ${f2(p.margin)}`}</td>
                    <td className="px-3 py-2 text-right">{p.inside === null ? "—" : `${Math.round(p.inside)}%`}</td>
                    <td className="px-3 py-2 text-right">{p.right === null ? "—" : `${Math.round(p.right)}%`}</td>
                    <td className="px-3 py-2 text-right" style={{ color: winnerColor }}>
                      {p.chanceWinner === null ? "—" : chance(p.chanceWinner)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <details className="rounded-xl border border-border bg-surface p-4 text-sm" open={showAll} onToggle={(e) => setShowAll((e.target as HTMLDetailsElement).open)}>
            <summary className="cursor-pointer font-semibold">Momento a momento ({rows.length})</summary>
            {showAll && (
              <div className="mt-2 max-h-[480px] overflow-auto">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-surface text-left text-muted">
                    <tr className="border-b border-border">
                      <th className="px-2 py-1">Hora</th>
                      <th className="px-2 py-1 text-right">Apurado</th>
                      <th className="px-2 py-1 text-right">Placar {nameA}</th>
                      <th className="px-2 py-1 text-right">Projeção {nameA}</th>
                      <th className="px-2 py-1 text-right">Margem</th>
                      <th className="px-2 py-1 text-right">Erro</th>
                      <th className="px-2 py-1 text-right">Chance {nameA}</th>
                      <th className="px-2 py-1 text-right">Chance {nameB}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.time} className="border-b border-border last:border-0">
                        <td className="px-2 py-1">{formatTimeBrasilia(r.time)}</td>
                        <td className="px-2 py-1 text-right">{formatPct(r.pct)}</td>
                        <td className="px-2 py-1 text-right">{formatPct(r.count)}</td>
                        <td className="px-2 py-1 text-right font-semibold">{formatPct(r.proj)}</td>
                        <td className="px-2 py-1 text-right">± {f2(1.96 * r.sd)}</td>
                        <td className={`px-2 py-1 text-right ${r.inside ? "" : "font-semibold text-amber-600"}`}>
                          {r.errProj >= 0 ? "+" : "−"}
                          {f2(Math.abs(r.errProj))}
                        </td>
                        <td className="px-2 py-1 text-right" style={{ color: colorA }}>
                          {chance(r.chanceA)}
                        </td>
                        <td className="px-2 py-1 text-right" style={{ color: colorB }}>
                          {chance(1 - r.chanceA)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </details>

          <p className="text-xs text-muted">
            Erro: projeção menos o resultado final, em pontos de % de {nameA} (só entre os dois); &quot;placar&quot; é o % na contagem daquele
            momento, sem projeção. Uma noite só é uma amostra pequena — os momentos são encadeados (o erro de um puxa o do seguinte), então o
            &quot;melhor ajuste&quot; é um indicativo, não uma regra.
          </p>
        </>
      )}
    </section>
  );
}

/** % de A ao longo da apuração: placar, projeção com a margem (95%) e o resultado final. */
function Chart({ rows, finalA, nameA, colorA, colorB }: { rows: Row[]; finalA: number; nameA: string; colorA: string; colorB: string }) {
  const W = 760;
  const H = 320;
  const pad = { l: 44, r: 16, t: 16, b: 30 };
  const ys = rows.flatMap((r) => [r.count, r.proj - 1.96 * r.sd, r.proj + 1.96 * r.sd]).concat(finalA, 50);
  const lo = Math.floor(Math.max(0, Math.min(...ys) - 1));
  const hi = Math.ceil(Math.min(100, Math.max(...ys) + 1));
  const sx = (x: number) => pad.l + (x / 100) * (W - pad.l - pad.r);
  const sy = (y: number) => pad.t + ((hi - y) / Math.max(1, hi - lo)) * (H - pad.t - pad.b);
  const line = (f: (r: Row) => number) => rows.map((r, i) => `${i ? "L" : "M"}${sx(r.pct).toFixed(1)},${sy(f(r)).toFixed(1)}`).join(" ");
  const band =
    rows.map((r, i) => `${i ? "L" : "M"}${sx(r.pct).toFixed(1)},${sy(r.proj + 1.96 * r.sd).toFixed(1)}`).join(" ") +
    " " +
    [...rows]
      .reverse()
      .map((r) => `L${sx(r.pct).toFixed(1)},${sy(r.proj - 1.96 * r.sd).toFixed(1)}`)
      .join(" ") +
    " Z";
  const step = hi - lo > 20 ? 5 : hi - lo > 8 ? 2 : 1;
  const yTicks = Array.from({ length: Math.floor((hi - lo) / step) + 1 }, (_, i) => lo + i * step);
  return (
    <figure className="rounded-xl border border-border bg-surface p-3">
      <figcaption className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
        <span className="font-semibold text-[var(--text)]">% de {nameA} (entre os dois) ao longo da apuração</span>
        <span className="inline-flex items-center gap-1">
          <svg width="22" height="6" aria-hidden>
            <line x1="0" y1="3" x2="22" y2="3" stroke="var(--text)" strokeWidth="2" />
          </svg>
          projeção
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-2.5 w-5 rounded-sm bg-[var(--text)] opacity-15" />
          margem (95%)
        </span>
        <span className="inline-flex items-center gap-1">
          <svg width="22" height="6" aria-hidden>
            <line x1="0" y1="3" x2="22" y2="3" stroke="var(--muted)" strokeWidth="2" strokeDasharray="4 3" />
          </svg>
          placar (só a contagem)
        </span>
        <span className="inline-flex items-center gap-1">
          <svg width="22" height="6" aria-hidden>
            <line x1="0" y1="3" x2="22" y2="3" stroke="#16a34a" strokeWidth="2" />
          </svg>
          resultado final
        </span>
      </figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="Projeção e placar ao longo da apuração">
        <rect x={pad.l} y={pad.t} width={W - pad.l - pad.r} height={Math.max(0, sy(50) - pad.t)} fill={colorA} opacity="0.05" />
        <rect x={pad.l} y={sy(50)} width={W - pad.l - pad.r} height={Math.max(0, H - pad.b - sy(50))} fill={colorB} opacity="0.05" />
        {yTicks.map((v) => (
          <g key={v}>
            <line x1={pad.l} x2={W - pad.r} y1={sy(v)} y2={sy(v)} stroke="var(--border)" strokeWidth={v === 50 ? 1.5 : 1} />
            <text x={pad.l - 6} y={sy(v) + 4} fontSize="10" textAnchor="end" fill="var(--muted)">
              {v}%
            </text>
          </g>
        ))}
        {[0, 25, 50, 75, 100].map((x) => (
          <text key={x} x={sx(x)} y={H - 10} fontSize="10" textAnchor="middle" fill="var(--muted)">
            {x}% apurado
          </text>
        ))}
        <path d={band} fill="var(--text)" opacity="0.12" />
        <line x1={pad.l} x2={W - pad.r} y1={sy(finalA)} y2={sy(finalA)} stroke="#16a34a" strokeWidth="2" />
        <path d={line((r) => r.count)} fill="none" stroke="var(--muted)" strokeWidth="2" strokeDasharray="5 4" />
        <path d={line((r) => r.proj)} fill="none" stroke="var(--text)" strokeWidth="2" />
      </svg>
    </figure>
  );
}
