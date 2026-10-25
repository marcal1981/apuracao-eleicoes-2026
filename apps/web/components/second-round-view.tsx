"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { STATES, formatInt, formatPct, formatTimeBrasilia } from "@apuracao/core";
import { TseLinkBox, type TseLink } from "./tse-link-box";
import type { UfShade } from "./uf-map";

const UfMap = dynamic(() => import("./uf-map").then((m) => m.UfMap), {
  ssr: false,
  loading: () => <div className="h-[380px] w-full animate-pulse rounded-xl border border-border bg-surface sm:h-[480px]" />,
});

interface Point {
  pct: number;
  time: string;
  a: number;
  b: number;
}
interface Totals {
  a: number;
  b: number;
  pct: number;
  status: string;
  timestamp: string | null;
}
interface Data {
  office: "presidente" | "governador";
  scope: string;
  secondRoundEnabled: boolean;
  finalists: { number: string; name: string; party: string }[];
  r1: Totals | null;
  r2: Totals | null;
  r1Series: Point[];
  r2Series: Point[];
  byUf: {
    uf: string;
    name: string;
    r1: { a: number; b: number; pct: number; valid: number };
    /** 1º turno da UF no mesmo % apurado do 2º turno; null quando a evolução não foi guardada. */
    r1SamePoint: { a: number; b: number } | null;
    r2: { a: number; b: number; pct: number };
  }[];
  link: TseLink | null;
}

type Axis = "pct" | "time";
type MapMode = "lider" | "apurado" | "terreno";
const esc = (t: string) => t.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

// Cores fixas por candidato (as mesmas da aba Presidente por bairro).
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

/** Vantagem de A sobre B, em pontos percentuais dos votos dos dois (positivo = A à frente). */
const lead = (a: number, b: number) => (a + b > 0 ? ((a - b) / (a + b)) * 100 : 0);
const shareA = (a: number, b: number) => (a + b > 0 ? (a / (a + b)) * 100 : 50);
const pp = (v: number) => `${v.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} pontos`;

/** Minutos desde 00:00 no horário de Brasília (UTC−3), para alinhar os dois turnos pelo relógio. */
function minuteOfDay(iso: string) {
  const d = new Date(iso);
  return (((d.getUTCHours() - 3 + 24) % 24) * 60 + d.getUTCMinutes()) % 1440;
}
const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(Math.round(m % 60)).padStart(2, "0")}`;

/** Valor da série no ponto x (interpolação linear); null fora do trecho apurado. */
function at(series: { x: number; y: number }[], x: number): number | null {
  if (series.length === 0 || x < series[0]!.x || x > series[series.length - 1]!.x) return null;
  for (let i = 1; i < series.length; i++) {
    const p = series[i - 1]!;
    const q = series[i]!;
    if (x <= q.x) return q.x === p.x ? q.y : p.y + ((q.y - p.y) * (x - p.x)) / (q.x - p.x);
  }
  return series[series.length - 1]!.y;
}

/** Comparação ao vivo do 2º turno com o 1º, no mesmo ponto da apuração (ou no mesmo horário). */
export function SecondRoundView() {
  const [office, setOffice] = useState<"presidente" | "governador">("presidente");
  const [state, setState] = useState("BR");
  const [axis, setAxis] = useState<Axis>("pct");
  const [mapMode, setMapMode] = useState<MapMode>("lider");
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/v1/segundo-turno?office=${office}&state=${state}`, { cache: "no-store", signal: AbortSignal.timeout(20_000) });
      const body = (await r.json()) as Data & { error?: string };
      if (!r.ok) return setError(body.error ?? `O servidor respondeu com erro (HTTP ${r.status}).`);
      setError(null);
      setData(body);
    } catch {
      setError("Não foi possível falar com o servidor. Confira se o npm run dev continua aberto.");
    }
  }, [office, state]);

  const final = data?.r2?.status === "TOTALIZACAO_FINALIZADA";
  useEffect(() => {
    setData(null);
    load();
    const id = setInterval(load, final ? 120_000 : 15_000);
    return () => clearInterval(id);
  }, [load, final]);

  const [A, B] = data?.finalists ?? [];
  const colorA = A ? colorFor(A.name, 0) : FALLBACK[0]!;
  const colorB = B ? colorFor(B.name, 1) : FALLBACK[1]!;
  const nameA = A ? title(A.name) : "Candidato A";
  const nameB = B ? title(B.name) : "Candidato B";

  // Séries da vantagem de A (pontos) em função do % apurado ou do horário.
  const toXY = useCallback(
    (s: Point[]) =>
      s
        .map((p) => ({ x: axis === "pct" ? p.pct : minuteOfDay(p.time), y: lead(p.a, p.b) }))
        .sort((p, q) => p.x - q.x),
    [axis],
  );
  const s1 = useMemo(() => toXY(data?.r1Series ?? []), [data, toXY]);
  const s2 = useMemo(() => toXY(data?.r2Series ?? []), [data, toXY]);

  const r2 = data?.r2;
  const r1 = data?.r1;
  const nowX = r2 ? (axis === "pct" ? r2.pct : r2.timestamp ? minuteOfDay(r2.timestamp) : null) : null;
  const leadNow = r2 ? lead(r2.a, r2.b) : null;
  const leadSamePoint = nowX !== null ? at(s1, nowX) : null;
  const leadR1Final = r1 ? lead(r1.a, r1.b) : null;
  const ahead = (v: number) => (v >= 0 ? nameA : nameB);

  // Presidente no Brasil: cada UF comparada com o 1º turno dela no MESMO % apurado (ou, sem a evolução
  // guardada, com o resultado final); o total pondera pelos votos do 2º turno de cada UF.
  const ufCompare = useMemo(() => {
    const rows = (data?.byUf ?? [])
      .filter((u) => u.r2.a + u.r2.b > 0 && (u.r1SamePoint || u.r1.a + u.r1.b > 0))
      .map((u) => {
        const ref = u.r1SamePoint ?? u.r1;
        return { ...u, samePoint: u.r1SamePoint !== null, s1: shareA(ref.a, ref.b), s2: shareA(u.r2.a, u.r2.b) };
      });
    const votes = rows.reduce((s, u) => s + u.r2.a + u.r2.b, 0);
    const expected = votes > 0 ? rows.reduce((s, u) => s + u.s1 * (u.r2.a + u.r2.b), 0) / votes : null;
    const actual = votes > 0 ? (rows.reduce((s, u) => s + u.r2.a, 0) / votes) * 100 : null;
    return { expected, actual, allSamePoint: rows.every((u) => u.samePoint), rows: rows.sort((x, y) => y.s2 - y.s1 - (x.s2 - x.s1)) };
  }, [data]);

  const projection = useMemo(() => projectFinal(data?.byUf ?? []), [data]);

  // Mapa das UFs: quem está à frente, quanto já foi apurado e quem ganhou terreno desde o 1º turno.
  const ufMap = useMemo(() => {
    const ufs = (data?.byUf ?? []).filter((u) => u.uf !== "ZZ");
    const started = ufs.filter((u) => u.r2.pct > 0 || u.r2.a + u.r2.b > 0);
    const shades: UfShade[] = ufs.map((u) => {
      const has = u.r2.a + u.r2.b > 0;
      const s2 = shareA(u.r2.a, u.r2.b);
      const ref = u.r1SamePoint ?? (u.r1.a + u.r1.b > 0 ? u.r1 : null);
      const d = ref && has ? (s2 - shareA(ref.a, ref.b)) * 2 : null;
      const lines = [
        `<strong>${esc(u.name)}</strong> · ${formatPct(u.r2.pct)} das urnas apuradas`,
        has ? `${esc(nameA)} ${formatPct(s2)} · ${esc(nameB)} ${formatPct(100 - s2)}` : "Sem urnas apuradas no 2º turno",
        has ? `${formatInt(u.r2.a)} × ${formatInt(u.r2.b)} votos` : "",
        ref && has
          ? `1º turno${u.r1SamePoint ? " no mesmo ponto" : " (final)"}: ${esc(nameA)} ${formatPct(shareA(ref.a, ref.b))} · ${esc(nameB)} ${formatPct(100 - shareA(ref.a, ref.b))}`
          : "",
        d !== null ? `<strong>${esc(d >= 0 ? nameA : nameB)} ganhou ${pp(Math.abs(d))}</strong>` : "",
      ].filter(Boolean);
      let fill: string | null = null;
      let opacity = 0;
      if (mapMode === "apurado") {
        fill = u.r2.pct > 0 ? "#0f766e" : null;
        opacity = 0.12 + 0.78 * (u.r2.pct / 100);
      } else if (mapMode === "lider" && has) {
        fill = s2 >= 50 ? colorA : colorB;
        opacity = 0.3 + Math.min(0.6, (Math.abs(s2 - 50) * 2) / 40);
      } else if (mapMode === "terreno" && d !== null) {
        fill = d >= 0 ? colorA : colorB;
        opacity = 0.2 + Math.min(0.7, Math.abs(d) / 10);
      }
      return { uf: u.uf, fill, opacity, html: lines.join("<br>") };
    });
    return {
      shades,
      started: started.length,
      done: ufs.filter((u) => u.r2.pct >= 100).length,
      leadA: ufs.filter((u) => u.r2.a + u.r2.b > 0 && u.r2.a >= u.r2.b).length,
      leadB: ufs.filter((u) => u.r2.a + u.r2.b > 0 && u.r2.b > u.r2.a).length,
      exterior: (data?.byUf ?? []).find((u) => u.uf === "ZZ") ?? null,
    };
  }, [data, mapMode, nameA, nameB, colorA, colorB]);

  const scopeName = state === "BR" ? "Brasil" : state === "ZZ" ? "Exterior" : (STATES.find((s) => s.uf === state)?.name ?? state);

  return (
    <section className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">2º turno ao vivo — comparação com o 1º turno</h1>
        <p className="text-sm text-muted">
          A vantagem de um finalista sobre o outro (em pontos, considerando só os votos dos dois) a cada atualização do TSE, ao
          lado da mesma conta no 1º turno, no mesmo ponto da apuração.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {(["presidente", "governador"] as const).map((o) => (
          <button
            key={o}
            type="button"
            onClick={() => {
              setOffice(o);
              if (o === "governador" && (state === "BR" || state === "ZZ")) setState("SP");
            }}
            aria-pressed={office === o}
            className={`rounded-full border px-3 py-1 text-sm ${office === o ? "border-accent bg-accent text-white" : "border-border hover:border-accent hover:text-accent"}`}
          >
            {o === "presidente" ? "Presidente" : "Governador"}
          </button>
        ))}
        <select value={state} onChange={(e) => setState(e.target.value)} className="rounded-lg border border-border bg-surface px-2 py-1.5 text-sm" aria-label="Abrangência">
          {office === "presidente" && <option value="BR">Brasil (inclui o exterior)</option>}
          {STATES.map((s) => (
            <option key={s.uf} value={s.uf}>
              {s.name}
            </option>
          ))}
          {office === "presidente" && <option value="ZZ">Exterior</option>}
        </select>
        <span className="ml-auto flex overflow-hidden rounded-full border border-border text-sm">
          {(["pct", "time"] as const).map((ax) => (
            <button
              key={ax}
              type="button"
              onClick={() => setAxis(ax)}
              aria-pressed={axis === ax}
              className={`px-3 py-1 ${axis === ax ? "bg-accent text-white" : "hover:text-accent"}`}
            >
              {ax === "pct" ? "Por % apurado" : "Por horário"}
            </button>
          ))}
        </span>
      </div>

      {error && (
        <p role="alert" className="rounded-lg border border-amber-500/50 bg-amber-500/10 px-4 py-2 text-sm">
          {error}
        </p>
      )}
      {data?.link && <TseLinkBox link={data.link} />}
      {data && !data.secondRoundEnabled && (
        <p className="rounded-lg border border-amber-500/50 bg-amber-500/10 px-4 py-2 text-sm">
          O acompanhamento do 2º turno está desligado (SECOND_ROUND=false no .env).
        </p>
      )}

      {!data ? (
        !error && <p className="text-sm text-muted">Carregando…</p>
      ) : data.finalists.length < 2 ? (
        <p className="rounded-lg border border-border bg-surface px-4 py-3 text-sm text-muted">
          Sem resultado para {office === "presidente" ? "Presidente" : "Governador"} em {scopeName}
          {office === "governador" ? " — esta UF pode não ter 2º turno para Governador" : ""}.
        </p>
      ) : (
        <>
          {/* Frase-resumo: o que o usuário quer saber de relance. */}
          <div className="rounded-xl border border-border bg-surface p-4">
            {!r2 ? (
              <p className="text-sm">
                Aguardando os primeiros números do 2º turno no TSE (com a votação prorrogada, a apuração começa depois das 19h de Brasília). A página se atualiza
                sozinha a cada 15 segundos.
              </p>
            ) : (
              <p className="text-base">
                Com <strong>{formatPct(r2.pct)}</strong> das urnas apuradas
                {r2.timestamp ? ` (às ${formatTimeBrasilia(r2.timestamp)})` : ""}, <strong>{ahead(leadNow!)}</strong> está{" "}
                <strong>{pp(Math.abs(leadNow!))}</strong> à frente.{" "}
                {leadSamePoint !== null ? (
                  <>
                    No 1º turno, {axis === "pct" ? `com os mesmos ${formatPct(r2.pct)} apurados` : `no mesmo horário (às ${hhmm(nowX!)})`},{" "}
                    <strong>{ahead(leadSamePoint)}</strong> estava{" "}
                    {pp(Math.abs(leadSamePoint))} à frente —{" "}
                    <strong style={{ color: leadNow! - leadSamePoint >= 0 ? colorA : colorB }}>
                      {ahead(leadNow! - leadSamePoint)} ganhou {pp(Math.abs(leadNow! - leadSamePoint))}
                    </strong>{" "}
                    em relação ao 1º turno.
                  </>
                ) : leadR1Final !== null ? (
                  <>
                    O sistema não tem a evolução do 1º turno neste ponto; no resultado final do 1º turno (entre os dois),{" "}
                    {ahead(leadR1Final)} teve {pp(Math.abs(leadR1Final))} de vantagem ({nameA} {formatPct(50 + leadR1Final / 2)} ·{" "}
                    {nameB} {formatPct(50 - leadR1Final / 2)}).
                  </>
                ) : null}
              </p>
            )}
            {r2 && (leadSamePoint ?? leadR1Final) !== null && (
              <SummaryTable
                rows={[
                  {
                    label: "2º turno — agora",
                    detail: `${formatPct(r2.pct)} apurado${r2.timestamp ? `, às ${formatTimeBrasilia(r2.timestamp)}` : ""}`,
                    lead: leadNow!,
                  },
                  leadSamePoint !== null
                    ? {
                        label: "1º turno — mesmo ponto",
                        detail: axis === "pct" ? `${formatPct(r2.pct)} apurado` : `às ${hhmm(nowX!)}`,
                        lead: leadSamePoint,
                      }
                    : { label: "1º turno — resultado final", detail: "sem a evolução guardada", lead: leadR1Final! },
                ]}
                nameA={nameA}
                nameB={nameB}
                colorA={colorA}
                colorB={colorB}
              />
            )}
          </div>

          {projection && r2 && r2.pct < 100 && (
            <ProjectionCard p={projection} nameA={nameA} nameB={nameB} colorA={colorA} colorB={colorB} leadNow={leadNow!} />
          )}

          <dl className="grid grid-cols-2 gap-3 rounded-xl border border-border bg-surface p-4 sm:grid-cols-4">
            {[
              { f: A!, color: colorA, v2: r2?.a ?? 0, v1: r1?.a ?? 0 },
              { f: B!, color: colorB, v2: r2?.b ?? 0, v1: r1?.b ?? 0 },
            ].map(({ f, color, v2, v1 }, i) => (
              <div key={f.number}>
                <dt className="flex items-center gap-2 text-xs text-muted">
                  <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: color }} />
                  {title(f.name)} ({f.number})
                </dt>
                <dd className="text-2xl font-bold">{r2 ? formatPct(i === 0 ? shareA(r2.a, r2.b) : 100 - shareA(r2.a, r2.b)) : "—"}</dd>
                <dd className="text-xs text-muted">
                  {formatInt(v2)} votos no 2º turno · 1º turno: {formatInt(v1)}
                </dd>
              </div>
            ))}
            <div>
              <dt className="text-xs text-muted">Urnas apuradas (2º turno)</dt>
              <dd className="text-2xl font-bold">{r2 ? formatPct(r2.pct) : "—"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted">Vantagem no fim do 1º turno</dt>
              <dd className="text-lg font-bold">{leadR1Final !== null ? `${ahead(leadR1Final)} +${pp(Math.abs(leadR1Final))}` : "—"}</dd>
              {leadR1Final !== null && (
                <dd className="text-xs text-muted">
                  {nameA} {formatPct(50 + leadR1Final / 2)} · {nameB} {formatPct(50 - leadR1Final / 2)} (só entre os dois)
                </dd>
              )}
            </div>
          </dl>

          <LeadChart
            s1={s1}
            s2={s2}
            axis={axis}
            nameA={nameA}
            nameB={nameB}
            colorA={colorA}
            colorB={colorB}
          />
          {s1.length === 0 && (
            <p className="text-xs text-muted">
              Sem a evolução do 1º turno guardada para esta disputa (o sistema só guarda a apuração enquanto está aberto). A
              comparação usa o resultado final do 1º turno.
            </p>
          )}

          {office === "presidente" && state === "BR" && ufMap.shades.length > 0 && (
            <div className="space-y-2 rounded-xl border border-border bg-surface p-4">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-base font-semibold">Mapa da apuração por estado</h2>
                <span className="text-sm text-muted">
                  {ufMap.started} de 27 estados com urnas apuradas · {ufMap.done} com 100% · à frente: {nameA} em {ufMap.leadA}, {nameB}{" "}
                  em {ufMap.leadB}
                </span>
                <span className="ml-auto flex overflow-hidden rounded-full border border-border text-sm">
                  {(
                    [
                      ["lider", "Quem está à frente"],
                      ["apurado", "% apurado"],
                      ["terreno", "Ganho sobre o 1º turno"],
                    ] as const
                  ).map(([m, label]) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setMapMode(m)}
                      aria-pressed={mapMode === m}
                      className={`px-3 py-1 ${mapMode === m ? "bg-accent text-white" : "hover:text-accent"}`}
                    >
                      {label}
                    </button>
                  ))}
                </span>
              </div>
              <UfMap shades={ufMap.shades} onPick={(uf) => setState(uf)} />
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
                {mapMode === "apurado" ? (
                  <span className="inline-flex items-center gap-1">
                    <span className="inline-block h-2.5 w-16 rounded" style={{ background: "linear-gradient(90deg, rgba(15,118,110,.12), rgba(15,118,110,.9))" }} />
                    0% → 100% das urnas apuradas
                  </span>
                ) : (
                  [
                    { name: nameA, color: colorA },
                    { name: nameB, color: colorB },
                  ].map((c) => (
                    <span key={c.name} className="inline-flex items-center gap-1">
                      <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: c.color }} />
                      {mapMode === "lider" ? `${c.name} à frente` : `${c.name} ganhou terreno`}
                    </span>
                  ))
                )}
                <span className="inline-flex items-center gap-1">
                  <span className="inline-block h-2.5 w-2.5 rounded-sm bg-slate-300" />
                  sem urnas apuradas
                </span>
                {mapMode !== "apurado" && <span>cor mais forte = {mapMode === "lider" ? "vantagem maior" : "mudança maior"}</span>}
                <span className="ml-auto">Clique num estado para ver o gráfico dele.</span>
              </div>
              {ufMap.exterior && (
                <p className="text-xs text-muted">
                  <strong>Exterior</strong> (fora do mapa): {formatPct(ufMap.exterior.r2.pct)} apurado
                  {ufMap.exterior.r2.a + ufMap.exterior.r2.b > 0
                    ? ` · ${nameA} ${formatPct(shareA(ufMap.exterior.r2.a, ufMap.exterior.r2.b))} · ${nameB} ${formatPct(100 - shareA(ufMap.exterior.r2.a, ufMap.exterior.r2.b))}`
                    : " · o TSE divulga depois do fim da votação no Brasil (19h de Brasília)"}
                  .{" "}
                  <button type="button" className="underline hover:text-accent" onClick={() => setState("ZZ")}>
                    ver gráfico
                  </button>
                </p>
              )}
            </div>
          )}

          {ufCompare.rows.length > 0 && (
            <>
              <div className="rounded-xl border border-border bg-surface p-4 text-sm">
                <strong>Somando as UFs, cada uma comparada com o seu próprio 1º turno:</strong>{" "}
                {ufCompare.allSamePoint ? "no mesmo ponto da apuração" : "no mesmo ponto da apuração quando há histórico, ou no resultado final"},{" "}
                {nameA} teria {formatPct(ufCompare.expected!)} e tem {formatPct(ufCompare.actual!)}; {nameB} teria{" "}
                {formatPct(100 - ufCompare.expected!)} e tem {formatPct(100 - ufCompare.actual!)} —{" "}
                <strong style={{ color: ufCompare.actual! - ufCompare.expected! >= 0 ? colorA : colorB }}>
                  {ufCompare.actual! - ufCompare.expected! >= 0 ? nameA : nameB} ganhou {pp(Math.abs(ufCompare.actual! - ufCompare.expected!) * 2)}
                </strong>{" "}
                de vantagem. Como cada estado é comparado com ele mesmo, essa conta não é afetada por alguns estados apurarem mais
                rápido que outros.
              </div>
              <div className="overflow-x-auto rounded-xl border border-border bg-surface">
                <table className="w-full text-sm">
                  <thead className="text-left text-xs text-muted">
                    <tr className="border-b border-border">
                      <th className="px-3 py-2">UF</th>
                      <th className="px-3 py-2 text-right">Apurado (2º turno)</th>
                      {[
                        { name: nameA, color: colorA },
                        { name: nameB, color: colorB },
                      ].map((c) => (
                        <th key={c.name} className="px-3 py-2 text-right" colSpan={2}>
                          <span className="mr-1 inline-block h-2 w-2 rounded-full" style={{ background: c.color }} />
                          {c.name}
                          <span className="block font-normal">1º turno* · 2º turno</span>
                        </th>
                      ))}
                      {[
                        { name: nameA, color: colorA },
                        { name: nameB, color: colorB },
                      ].map((c) => (
                        <th key={`t-${c.name}`} className="px-3 py-2 text-right">
                          <span className="mr-1 inline-block h-2 w-2 rounded-full" style={{ background: c.color }} />
                          Terreno {c.name}
                          <span className="block font-normal">pontos × 1º turno</span>
                        </th>
                      ))}
                      <th className="px-3 py-2 text-right">
                        Projeção ao fim
                        <span className="block font-normal">
                          {nameA} × {nameB}
                        </span>
                      </th>
                      <th className="px-3 py-2">À frente agora</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ufCompare.rows.map((u) => {
                      const d = u.s2 - u.s1;
                      return (
                        <tr key={u.uf} className="border-b border-border last:border-0">
                          <td className="px-3 py-2 font-medium">{u.name}</td>
                          <td className="px-3 py-2 text-right">{formatPct(u.r2.pct)}</td>
                          {[
                            { s1: u.s1, s2: u.s2 },
                            { s1: 100 - u.s1, s2: 100 - u.s2 },
                          ].map((c, i) => (
                            <Fragment key={i}>
                              <td className="px-3 py-2 text-right">
                                {formatPct(c.s1)}
                                {!u.samePoint && (
                                  <span className="ml-1 text-xs text-muted" title="Sem a evolução do 1º turno desta UF: comparado com o resultado final">
                                    (final)
                                  </span>
                                )}
                              </td>
                              <td className="px-3 py-2 text-right font-semibold">{formatPct(c.s2)}</td>
                            </Fragment>
                          ))}
                          {[
                            { v: d * 2, color: colorA },
                            { v: -d * 2, color: colorB },
                          ].map((t, i) => (
                            <td
                              key={`t${i}`}
                              className="whitespace-nowrap px-3 py-2 text-right font-semibold"
                              style={{ color: t.v > 0 ? t.color : "var(--muted)" }}
                            >
                              {t.v > 0 ? "+" : t.v < 0 ? "−" : ""}
                              {Math.abs(t.v).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}
                            </td>
                          ))}
                          <td className="whitespace-nowrap px-3 py-2 text-right text-xs">
                            {(() => {
                              const pu = projection?.byUf.get(u.uf);
                              return pu ? `${formatPct(pu.shareA)} × ${formatPct(100 - pu.shareA)}` : "—";
                            })()}
                          </td>
                          <td className="px-3 py-2">
                            <span className="inline-flex items-center gap-1 text-xs font-semibold">
                              <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: u.s2 >= 50 ? colorA : colorB }} />
                              {u.s2 >= 50 ? nameA : nameB}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-muted">
                * Percentual de {nameA} e de {nameB} considerando só os votos dos dois finalistas, no 1º turno da UF com o mesmo % apurado
                que ela tem agora no 2º turno (&quot;final&quot; quando o sistema não guardou a evolução do 1º turno). &quot;Terreno&quot;:
                quanto a vantagem de cada um mudou em relação ao 1º turno, em pontos (positivo = ganhou, negativo = perdeu) — a mesma conta
                da frase e do gráfico. &quot;Projeção ao fim&quot;: estimativa de como a UF termina, explicada no quadro de projeção.
              </p>
            </>
          )}
        </>
      )}
    </section>
  );
}

type ByUf = Data["byUf"][number];

interface Projection {
  /** % de A (entre os dois) projetado ao fim da apuração. */
  shareA: number;
  /** desvio estimado da projeção, em pontos de % de A. */
  sd: number;
  /** chance de A terminar à frente (0–1). */
  chanceA: number;
  /** fração dos votos que ainda falta apurar (estimada). */
  remaining: number;
  byUf: Map<string, { shareA: number }>;
}

/** Função de distribuição da normal padrão (aproximação de Abramowitz-Stegun). */
function normCdf(z: number) {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989423 * Math.exp((-z * z) / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return z > 0 ? 1 - p : p;
}

/**
 * Projeção do resultado final do Presidente a partir das UFs (inclui o exterior):
 * - votos que faltam em cada UF: estimados pelo ritmo atual (ou pelo 1º turno, no começo da apuração);
 * - como esses votos devem se dividir: o que faltava apurar na própria UF no 1º turno (a partir do mesmo % apurado),
 *   corrigido pelo terreno que cada finalista já ganhou ali; sem essa evolução, o % atual da UF;
 *   UF que ainda não começou: o 1º turno dela mais o terreno médio já observado no país.
 * A chance vem de uma margem de erro que encolhe conforme a apuração avança. É estimativa, não pesquisa.
 */
function projectFinal(byUf: ByUf[]): Projection | null {
  const started = byUf.filter((u) => u.r2.a + u.r2.b > 0);
  if (started.length === 0) return null;
  // Terreno médio (pontos de % de A) nas UFs já com votos, ponderado pelos votos.
  let sw = 0;
  let sv = 0;
  for (const u of started) {
    const ref = u.r1SamePoint ?? (u.r1.a + u.r1.b > 0 ? u.r1 : null);
    if (!ref) continue;
    const v = u.r2.a + u.r2.b;
    sw += (shareA(u.r2.a, u.r2.b) - shareA(ref.a, ref.b)) * v;
    sv += v;
  }
  const swing = sv > 0 ? sw / sv : 0;

  let totalA = 0;
  let total = 0;
  let remainingVotes = 0;
  let varIndep = 0;
  const parts: { rem: number }[] = [];
  const out = new Map<string, { shareA: number }>();
  for (const u of byUf) {
    const now = u.r2.a + u.r2.b;
    // Votos válidos dos dois esperados ao fim: pelo ritmo atual (com 10% ou mais apurado) ou pelo 1º turno.
    const fromPace = u.r2.pct >= 10 ? now / (u.r2.pct / 100) : 0;
    const fromR1 = u.r1.valid > 0 ? u.r1.valid * 0.97 : u.r1.a + u.r1.b;
    const expected = Math.max(now, fromPace || fromR1);
    if (expected <= 0) continue;
    const rem = u.r2.pct >= 100 ? 0 : Math.max(0, expected - now);
    let restA: number;
    if (now > 0 && u.r1SamePoint && u.r1.a + u.r1.b > u.r1SamePoint.a + u.r1SamePoint.b) {
      const ra = u.r1.a - u.r1SamePoint.a;
      const rb = u.r1.b - u.r1SamePoint.b;
      restA = shareA(ra, rb) + (shareA(u.r2.a, u.r2.b) - shareA(u.r1SamePoint.a, u.r1SamePoint.b));
    } else if (now > 0) {
      restA = shareA(u.r2.a, u.r2.b);
    } else {
      restA = shareA(u.r1.a, u.r1.b) + swing;
    }
    restA = Math.min(100, Math.max(0, restA));
    const finalA = u.r2.a + (rem * restA) / 100;
    out.set(u.uf, { shareA: (finalA / (now + rem)) * 100 });
    totalA += finalA;
    total += now + rem;
    remainingVotes += rem;
    parts.push({ rem });
  }
  if (total <= 0) return null;
  // Incerteza: 4 pontos por UF (independente) + 2 pontos comuns a todas, sobre a fração ainda não apurada.
  for (const p of parts) varIndep += ((p.rem / total) * 4) ** 2;
  const remaining = remainingVotes / total;
  const sd = Math.sqrt(varIndep + (remaining * 2) ** 2);
  const shareAFinal = (totalA / total) * 100;
  const chanceA = sd < 1e-6 ? (shareAFinal >= 50 ? 1 : 0) : normCdf((shareAFinal - 50) / sd);
  return { shareA: shareAFinal, sd, chanceA, remaining, byUf: out };
}

/** Projeção ao fim e chance de cada finalista terminar à frente (inclusive a de virada de quem está atrás). */
function ProjectionCard({
  p,
  nameA,
  nameB,
  colorA,
  colorB,
  leadNow,
}: {
  p: Projection;
  nameA: string;
  nameB: string;
  colorA: string;
  colorB: string;
  leadNow: number;
}) {
  const chance = (v: number) => (v > 0.995 ? "> 99%" : v < 0.005 ? "< 1%" : `${Math.round(v * 100)}%`);
  const behind = leadNow >= 0 ? { name: nameB, chance: 1 - p.chanceA, color: colorB } : { name: nameA, chance: p.chanceA, color: colorA };
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className="flex flex-wrap items-baseline gap-x-3">
        <h2 className="text-base font-semibold">Projeção ao fim da apuração</h2>
        <span className="text-xs text-muted">faltam cerca de {formatPct(p.remaining * 100)} dos votos · estimativa, não é pesquisa</span>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { name: nameA, color: colorA, share: p.shareA, chance: p.chanceA },
          { name: nameB, color: colorB, share: 100 - p.shareA, chance: 1 - p.chanceA },
        ].map((c) => (
          <Fragment key={c.name}>
            <div>
              <div className="flex items-center gap-2 text-xs text-muted">
                <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: c.color }} />
                {c.name} — projeção
              </div>
              <div className="text-2xl font-bold">{formatPct(c.share)}</div>
              <div className="text-xs text-muted">± {pp(p.sd * 1.96).replace(" pontos", "")} (95%)</div>
            </div>
            <div>
              <div className="text-xs text-muted">Chance de {c.name} terminar à frente</div>
              <div className="text-2xl font-bold" style={{ color: c.color }}>
                {chance(c.chance)}
              </div>
            </div>
          </Fragment>
        ))}
      </div>
      <p className="mt-2 text-sm">
        Chance de virada de <strong style={{ color: behind.color }}>{behind.name}</strong> (hoje atrás):{" "}
        <strong style={{ color: behind.color }}>{chance(behind.chance)}</strong>.
      </p>
      <p className="mt-1 text-xs text-muted">
        Como é feita: em cada estado, os votos que faltam são divididos como o restante do 1º turno daquele estado se dividiu a partir
        do mesmo ponto, corrigido pelo terreno que cada um já ganhou ali; estados que ainda não começaram seguem o 1º turno mais o terreno
        médio do país. A margem de erro encolhe conforme a apuração avança.
      </p>
    </div>
  );
}

/** A frase-resumo em tabela: % de cada finalista (só entre os dois) e a vantagem, agora e no 1º turno, e a variação. */
function SummaryTable({
  rows,
  nameA,
  nameB,
  colorA,
  colorB,
}: {
  rows: { label: string; detail: string; lead: number }[];
  nameA: string;
  nameB: string;
  colorA: string;
  colorB: string;
}) {
  const [now, before] = rows as [(typeof rows)[0], (typeof rows)[0]];
  const d = now.lead - before.lead;
  const signedPp = (v: number) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const leadCell = (v: number) => (
    <span style={{ color: v >= 0 ? colorA : colorB }} className="font-semibold">
      {v >= 0 ? nameA : nameB} +{pp(Math.abs(v))}
    </span>
  );
  return (
    <div className="mt-3 overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-left text-xs text-muted">
          <tr className="border-b border-border">
            <th className="py-2 pr-3">Momento</th>
            <th className="px-3 py-2 text-right">
              <span className="mr-1 inline-block h-2 w-2 rounded-full" style={{ background: colorA }} />
              {nameA}
            </th>
            <th className="px-3 py-2 text-right">
              <span className="mr-1 inline-block h-2 w-2 rounded-full" style={{ background: colorB }} />
              {nameB}
            </th>
            <th className="py-2 pl-3 text-right">À frente</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label} className="border-b border-border">
              <td className="py-2 pr-3">
                <span className="font-medium">{r.label}</span>
                <span className="block text-xs text-muted">{r.detail}</span>
              </td>
              <td className="px-3 py-2 text-right">{formatPct(50 + r.lead / 2)}</td>
              <td className="px-3 py-2 text-right">{formatPct(50 - r.lead / 2)}</td>
              <td className="whitespace-nowrap py-2 pl-3 text-right">{leadCell(r.lead)}</td>
            </tr>
          ))}
          <tr>
            <td className="py-2 pr-3 font-medium">Variação</td>
            <td className="px-3 py-2 text-right" style={{ color: d >= 0 ? colorA : "var(--muted)" }}>
              {signedPp(d / 2)} p.p.
            </td>
            <td className="px-3 py-2 text-right" style={{ color: d < 0 ? colorB : "var(--muted)" }}>
              {signedPp(-d / 2)} p.p.
            </td>
            <td className="whitespace-nowrap py-2 pl-3 text-right font-semibold" style={{ color: d >= 0 ? colorA : colorB }}>
              {d >= 0 ? nameA : nameB} ganhou {pp(Math.abs(d))}
            </td>
          </tr>
        </tbody>
      </table>
      <p className="mt-1 text-xs text-muted">Percentuais considerando só os votos dos dois finalistas.</p>
    </div>
  );
}

/** Gráfico da vantagem (pontos) ao longo da apuração: 1º turno (tracejado, cinza) e 2º turno (contínuo). */
function LeadChart({
  s1,
  s2,
  axis,
  nameA,
  nameB,
  colorA,
  colorB,
}: {
  s1: { x: number; y: number }[];
  s2: { x: number; y: number }[];
  axis: Axis;
  nameA: string;
  nameB: string;
  colorA: string;
  colorB: string;
}) {
  const W = 760;
  const H = 300;
  const pad = { l: 44, r: 16, t: 16, b: 30 };
  const [hover, setHover] = useState<number | null>(null);
  const svg = useRef<SVGSVGElement>(null);

  const all = [...s1, ...s2];
  const xMin = axis === "pct" ? 0 : Math.min(17 * 60, ...all.map((p) => p.x));
  const xMax = axis === "pct" ? 100 : Math.max(xMin + 60, ...all.map((p) => p.x));
  const yAbs = Math.max(5, ...all.map((p) => Math.abs(p.y))) * 1.15;
  const sx = (x: number) => pad.l + ((x - xMin) / (xMax - xMin)) * (W - pad.l - pad.r);
  const sy = (y: number) => pad.t + ((yAbs - y) / (2 * yAbs)) * (H - pad.t - pad.b);
  const path = (s: { x: number; y: number }[]) => s.map((p, i) => `${i ? "L" : "M"}${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`).join(" ");
  const xTicks = axis === "pct" ? [0, 25, 50, 75, 100] : Array.from({ length: Math.floor((xMax - xMin) / 60) + 1 }, (_, i) => Math.ceil(xMin / 60) * 60 + i * 60).filter((m) => m <= xMax);
  const yStep = yAbs > 20 ? 10 : yAbs > 8 ? 5 : 2;
  const yTicks = Array.from({ length: Math.floor(yAbs / yStep) * 2 + 1 }, (_, i) => (i - Math.floor(yAbs / yStep)) * yStep);
  const fmtX = (x: number) => (axis === "pct" ? `${Math.round(x)}%` : hhmm(x));
  const fmtLead = (v: number | null) =>
    v === null ? "—" : `${v >= 0 ? nameA : nameB} +${Math.abs(v).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}`;

  // Percentual de cada um entre os dois, a partir da vantagem: A = 50 + v/2, B = 50 − v/2.
  const fmtShares = (v: number) =>
    `${nameA} ${(50 + v / 2).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}% · ${nameB} ${(50 - v / 2).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;

  const onMove = (e: React.PointerEvent) => {
    const rect = svg.current!.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * W;
    const v = xMin + ((x - pad.l) / (W - pad.l - pad.r)) * (xMax - xMin);
    setHover(v >= xMin && v <= xMax ? v : null);
  };
  const h1 = hover !== null ? at(s1, hover) : null;
  const h2 = hover !== null ? at(s2, hover) : null;
  const last2 = s2[s2.length - 1];
  const last1 = s1[s1.length - 1];

  return (
    <figure className="rounded-xl border border-border bg-surface p-3">
      <figcaption className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
        <span className="font-semibold text-[var(--text)]">Vantagem ao longo da apuração (pontos percentuais)</span>
        <span className="inline-flex items-center gap-1">
          <svg width="22" height="6" aria-hidden>
            <line x1="0" y1="3" x2="22" y2="3" stroke="var(--text)" strokeWidth="2" />
          </svg>
          2º turno
        </span>
        <span className="inline-flex items-center gap-1">
          <svg width="22" height="6" aria-hidden>
            <line x1="0" y1="3" x2="22" y2="3" stroke="var(--muted)" strokeWidth="2" strokeDasharray="4 3" />
          </svg>
          1º turno
        </span>
      </figcaption>
      <div className="relative">
        <svg
          ref={svg}
          viewBox={`0 0 ${W} ${H}`}
          className="h-auto w-full touch-none"
          role="img"
          aria-label={`Vantagem de ${nameA} ou ${nameB} ao longo da apuração, 1º e 2º turnos`}
          onPointerMove={onMove}
          onPointerLeave={() => setHover(null)}
        >
          {/* Faixas: acima do zero, A à frente; abaixo, B à frente. */}
          <rect x={pad.l} y={pad.t} width={W - pad.l - pad.r} height={sy(0) - pad.t} fill={colorA} opacity="0.05" />
          <rect x={pad.l} y={sy(0)} width={W - pad.l - pad.r} height={H - pad.b - sy(0)} fill={colorB} opacity="0.05" />
          <text x={pad.l + 6} y={pad.t + 12} fontSize="11" fill="var(--muted)">
            {nameA} à frente
          </text>
          <text x={pad.l + 6} y={H - pad.b - 6} fontSize="11" fill="var(--muted)">
            {nameB} à frente
          </text>
          {yTicks.map((v) => (
            <g key={v}>
              <line x1={pad.l} x2={W - pad.r} y1={sy(v)} y2={sy(v)} stroke="var(--border)" strokeWidth={v === 0 ? 1.5 : 1} />
              <text x={pad.l - 6} y={sy(v) + 4} fontSize="10" textAnchor="end" fill="var(--muted)">
                {v === 0 ? "0" : `${v > 0 ? "+" : "−"}${Math.abs(v)}`}
              </text>
            </g>
          ))}
          {xTicks.map((x) => (
            <text key={x} x={sx(x)} y={H - 10} fontSize="10" textAnchor="middle" fill="var(--muted)">
              {fmtX(x)}
            </text>
          ))}
          {s1.length > 1 && <path d={path(s1)} fill="none" stroke="var(--muted)" strokeWidth="2" strokeDasharray="5 4" />}
          {s2.length > 1 && <path d={path(s2)} fill="none" stroke="var(--text)" strokeWidth="2" />}
          {last1 && <circle cx={sx(last1.x)} cy={sy(last1.y)} r="4" fill="var(--muted)" stroke="var(--surface)" strokeWidth="2" />}
          {last2 && <circle cx={sx(last2.x)} cy={sy(last2.y)} r="5" fill={last2.y >= 0 ? colorA : colorB} stroke="var(--surface)" strokeWidth="2" />}
          {hover !== null && (
            <g>
              <line x1={sx(hover)} x2={sx(hover)} y1={pad.t} y2={H - pad.b} stroke="var(--muted)" strokeWidth="1" />
              {h1 !== null && <circle cx={sx(hover)} cy={sy(h1)} r="4" fill="var(--muted)" stroke="var(--surface)" strokeWidth="2" />}
              {h2 !== null && <circle cx={sx(hover)} cy={sy(h2)} r="4" fill="var(--text)" stroke="var(--surface)" strokeWidth="2" />}
            </g>
          )}
        </svg>
        {hover !== null && (h1 !== null || h2 !== null) && (
          <div
            className="pointer-events-none absolute top-2 rounded-lg border border-border bg-surface px-3 py-2 text-xs shadow"
            style={{ left: `${Math.min(70, Math.max(2, (sx(hover) / W) * 100))}%` }}
          >
            <div className="font-semibold">{axis === "pct" ? `${fmtX(hover)} apurado` : `às ${fmtX(hover)}`}</div>
            <div>
              2º turno: {fmtLead(h2)}
              {h2 !== null && <span className="text-muted"> ({fmtShares(h2)})</span>}
            </div>
            <div className="text-muted">
              1º turno: {fmtLead(h1)}
              {h1 !== null && <> ({fmtShares(h1)})</>}
            </div>
            {h1 !== null && h2 !== null && (
              <div className="font-semibold" style={{ color: h2 - h1 >= 0 ? colorA : colorB }}>
                {h2 - h1 >= 0 ? nameA : nameB} ganhou {Math.abs(h2 - h1).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} pts
              </div>
            )}
          </div>
        )}
      </div>
    </figure>
  );
}
