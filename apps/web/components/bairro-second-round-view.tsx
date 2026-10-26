"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useState } from "react";
import { formatInt, formatPct, formatTimeBrasilia } from "@apuracao/core";
import type { PlacePoint } from "./places-map";

const PlacesMap = dynamic(() => import("./places-map").then((m) => m.PlacesMap), {
  ssr: false,
  loading: () => <div className="h-[380px] animate-pulse rounded-xl border border-border bg-surface sm:h-[480px]" />,
});

/** Seção resumida: zona, seção, local, eleitores, abstenção e votos para Presidente. */
interface Sec {
  z: string;
  s: string;
  p: string | null;
  e: number;
  a: number;
  v: Record<string, number>;
}
interface RoundData {
  updatedAt: string | null;
  totals: { sections: number; read: number };
  progress: { running: boolean; done: number; total: number; failures: number; lastError: string | null };
  sections: Sec[];
}
interface Place {
  zone: string;
  code: string;
  name: string;
  address: string;
  bairro: string;
  lat: number | null;
  lon: number | null;
}
interface Data {
  city: string;
  finalists: { number: string; name: string }[];
  r1: RoundData;
  r2: RoundData & { pleito: string | null };
  places: Place[];
  placesStatus: { status: string; message: string | null };
}

/** Soma de um turno numa área: votos dos dois finalistas, demais, brancos/nulos, eleitores e abstenção. */
interface Tot {
  a: number;
  b: number;
  others: number;
  blankNull: number;
  electorate: number;
  abstention: number;
}
interface Area {
  key: string;
  name: string;
  sub: string;
  sections: number;
  r1: Tot;
  r2: Tot;
  lat?: number | null;
  lon?: number | null;
}

const FIXED: [RegExp, string][] = [
  [/\bLULA\b/i, "#dc2626"],
  [/\bBOLSONARO\b/i, "#2563eb"],
];
const FALLBACK = ["#7c3aed", "#0891b2"];
const colorFor = (name: string, i: number) => FIXED.find(([re]) => re.test(name))?.[1] ?? FALLBACK[i]!;
const NO_BAIRRO = "(SEM BAIRRO NO CADASTRO)";
const PAGE = 40;
const n = (code: string) => String(Number(code));
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const title = (s: string) =>
  s
    .toLowerCase()
    .replace(/(^|\s|\()\S/g, (c) => c.toUpperCase())
    .replace(/ (Da|De|Do|Das|Dos|E)(?= )/g, (w) => w.toLowerCase());
const shareA = (t: Tot) => (t.a + t.b > 0 ? (t.a / (t.a + t.b)) * 100 : 50);
const pts = (v: number) => v.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const empty = (): Tot => ({ a: 0, b: 0, others: 0, blankNull: 0, electorate: 0, abstention: 0 });
const norm = (s: string) =>
  s
    .toUpperCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");

type Sort = "virada" | "terrenoA" | "terrenoB" | "eleitores" | "nome";
type MapMode = "vencedor" | "terreno";

/** Presidente por bairro: 2º turno × 1º turno, com os bairros que trocaram de candidato. */
export function BairroSecondRoundView({ slug }: { slug: string }) {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sort, setSort] = useState<Sort>("virada");
  const [mapMode, setMapMode] = useState<MapMode>("vencedor");
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(PAGE);
  const [selected, setSelected] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/v1/cities/${slug}/sections-2turno`, { cache: "no-store", signal: AbortSignal.timeout(30_000) });
      const body = (await r.json().catch(() => null)) as (Data & { error?: string }) | null;
      if (!r.ok || !body) return setError(body?.error ?? `O servidor respondeu com erro (HTTP ${r.status}).`);
      setError(null);
      setData(body);
    } catch {
      setError("Não foi possível falar com o servidor. Confira se o npm run dev continua aberto.");
    }
  }, [slug]);

  const busy = !data || data.r2.progress.running || data.r1.progress.running || data.r2.sections.length < data.r2.totals.sections;
  useEffect(() => {
    load();
    const id = setInterval(load, busy ? 10_000 : 60_000);
    return () => clearInterval(id);
  }, [load, busy]);

  const [A, B] = data?.finalists ?? [];
  const nameA = A ? title(A.name) : "Candidato A";
  const nameB = B ? title(B.name) : "Candidato B";
  const colorA = A ? colorFor(A.name, 0) : FALLBACK[0]!;
  const colorB = B ? colorFor(B.name, 1) : FALLBACK[1]!;

  // Bairros e locais: só as seções com boletim lido NOS DOIS turnos, para comparar a mesma área.
  const { bairros, places, city, compared } = useMemo(() => {
    const info = new Map((data?.places ?? []).map((p) => [`${n(p.zone)}-${p.code}`, p]));
    const r1 = new Map((data?.r1.sections ?? []).map((s) => [`${n(s.z)}-${n(s.s)}`, s]));
    const addTo = (t: Tot, s: Sec) => {
      const a = s.v[A?.number ?? ""] ?? 0;
      const b = s.v[B?.number ?? ""] ?? 0;
      let valid = 0;
      for (const [k, x] of Object.entries(s.v)) if (k !== "branco" && k !== "nulo" && k !== "outros") valid += x;
      t.a += a;
      t.b += b;
      t.others += Math.max(0, valid - a - b);
      t.blankNull += (s.v.branco ?? 0) + (s.v.nulo ?? 0);
      t.electorate += s.e;
      t.abstention += s.a;
    };
    const bairroMap = new Map<string, Area>();
    const placeMap = new Map<string, Area>();
    const cityTot: Area = { key: "city", name: "", sub: "", sections: 0, r1: empty(), r2: empty() };
    let compared = 0;
    for (const s2 of data?.r2.sections ?? []) {
      const s1 = r1.get(`${n(s2.z)}-${n(s2.s)}`);
      if (!s1) continue;
      compared++;
      // Local e bairro do 2º turno (o cadastro de locais é o desta eleição); na falta, o do 1º turno.
      const placeCode = s2.p ?? s1.p;
      const p = placeCode ? info.get(`${n(s2.z)}-${placeCode}`) : undefined;
      const bairro = (p?.bairro || NO_BAIRRO).trim().toUpperCase();
      const pk = `${n(s2.z)}-${placeCode ?? "?"}`;
      let place = placeMap.get(pk);
      if (!place) {
        place = {
          key: pk,
          name: p?.name ? title(p.name) : placeCode ? `Local ${placeCode} (zona ${n(s2.z)})` : "Local não identificado",
          sub: title(bairro),
          sections: 0,
          r1: empty(),
          r2: empty(),
          lat: p?.lat ?? null,
          lon: p?.lon ?? null,
        };
        placeMap.set(pk, place);
      }
      let b = bairroMap.get(bairro);
      if (!b) bairroMap.set(bairro, (b = { key: bairro, name: title(bairro), sub: "", sections: 0, r1: empty(), r2: empty() }));
      for (const area of [place, b, cityTot]) {
        area.sections++;
        addTo(area.r1, s1);
        addTo(area.r2, s2);
      }
    }
    for (const b of bairroMap.values()) {
      const nPlaces = [...placeMap.values()].filter((p) => p.sub === b.name).length;
      b.sub = `${b.sections} ${b.sections === 1 ? "seção" : "seções"} · ${nPlaces} ${nPlaces === 1 ? "local" : "locais"}`;
    }
    return { bairros: [...bairroMap.values()], places: [...placeMap.values()], city: cityTot, compared };
  }, [data, A, B]);

  const leaderOf = (t: Tot) => (t.a + t.b === 0 ? null : t.a >= t.b ? "A" : "B");
  const gainA = (x: Area) => (shareA(x.r2) - shareA(x.r1)) * 2; // pontos de vantagem ganhos por A
  const flipped = (x: Area) => leaderOf(x.r1) !== null && leaderOf(x.r2) !== null && leaderOf(x.r1) !== leaderOf(x.r2);

  const flips = useMemo(() => bairros.filter(flipped).sort((x, y) => Math.abs(gainA(y)) - Math.abs(gainA(x))), [bairros]);
  const flipsToA = flips.filter((x) => leaderOf(x.r2) === "A");
  const flipsToB = flips.filter((x) => leaderOf(x.r2) === "B");
  const topA = useMemo(() => [...bairros].filter((x) => x.r2.a + x.r2.b >= 100).sort((x, y) => gainA(y) - gainA(x)).slice(0, 10), [bairros]);
  const topB = useMemo(() => [...bairros].filter((x) => x.r2.a + x.r2.b >= 100).sort((x, y) => gainA(x) - gainA(y)).slice(0, 10), [bairros]);

  const rows = useMemo(() => {
    const q = norm(query.trim());
    const list = bairros.filter((x) => !q || norm(x.name).includes(q));
    const by: Record<Sort, (x: Area, y: Area) => number> = {
      virada: (x, y) => Number(flipped(y)) - Number(flipped(x)) || Math.abs(gainA(y)) - Math.abs(gainA(x)),
      terrenoA: (x, y) => gainA(y) - gainA(x),
      terrenoB: (x, y) => gainA(x) - gainA(y),
      eleitores: (x, y) => y.r2.electorate - x.r2.electorate,
      nome: (x, y) => x.name.localeCompare(y.name, "pt-BR"),
    };
    return list.sort(by[sort]);
  }, [bairros, sort, query]);

  const points = useMemo<PlacePoint[]>(
    () =>
      places
        .filter((p) => p.lat !== null && p.lon !== null && p.r2.a + p.r2.b > 0)
        .map((p) => {
          const g = gainA(p);
          const s1 = shareA(p.r1);
          const s2 = shareA(p.r2);
          return {
            key: p.key,
            lat: p.lat!,
            lon: p.lon!,
            value: mapMode === "vencedor" ? p.r2.a + p.r2.b : Math.abs(g) * Math.sqrt(p.r2.a + p.r2.b),
            color: mapMode === "vencedor" ? (p.r2.a >= p.r2.b ? colorA : colorB) : g >= 0 ? colorA : colorB,
            highlighted: selected ? p.sub === selected : false,
            html:
              `<strong>${esc(p.name)}</strong><br>${esc(p.sub)}<br>` +
              `2º turno: ${esc(nameA)} ${formatPct(s2)} · ${esc(nameB)} ${formatPct(100 - s2)}<br>` +
              `1º turno: ${esc(nameA)} ${formatPct(s1)} · ${esc(nameB)} ${formatPct(100 - s1)}<br>` +
              `<strong>${esc(g >= 0 ? nameA : nameB)} ganhou ${pts(Math.abs(g))} pontos</strong>${flipped(p) ? "<br><strong>Trocou de candidato</strong>" : ""}`,
          };
        }),
    [places, mapMode, selected, nameA, nameB, colorA, colorB],
  );

  const csv = () => {
    const head = ["Bairro", "Seções", `${nameA} 1º turno`, `${nameB} 1º turno`, `${nameA} 2º turno`, `${nameB} 2º turno`, `% ${nameA} 1º (entre os dois)`, `% ${nameA} 2º (entre os dois)`, `Terreno ${nameA} (pontos)`, `Terreno ${nameB} (pontos)`, "À frente no 1º", "À frente no 2º", "Trocou"];
    const num = (v: number) => v.toLocaleString("pt-BR", { maximumFractionDigits: 2 });
    const who = (t: Tot) => (leaderOf(t) === "A" ? nameA : leaderOf(t) === "B" ? nameB : "");
    const lines = rows.map((x) =>
      [x.name, x.sections, x.r1.a, x.r1.b, x.r2.a, x.r2.b, num(shareA(x.r1)), num(shareA(x.r2)), num(gainA(x)), num(-gainA(x)), who(x.r1), who(x.r2), flipped(x) ? "sim" : "não"]
        .map((v) => `"${String(v).replace(/"/g, '""')}"`)
        .join(";"),
    );
    const blob = new Blob(["﻿" + [head.join(";"), ...lines].join("\r\n")], { type: "text/csv;charset=utf-8" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `${slug}-presidente-por-bairro-1o-x-2o-turno.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  };

  const cityName = data?.city ?? "";
  const g = gainA(city);
  const r2Read = data?.r2.sections.length ?? 0;
  const r2Total = data?.r2.totals.sections ?? 0;

  const Chip = ({ x }: { x: Area }) => (
    <button
      type="button"
      onClick={() => setSelected(selected === x.name ? null : x.name)}
      className={`rounded-full border px-2.5 py-0.5 text-xs ${selected === x.name ? "border-accent bg-accent text-white" : "border-border hover:border-accent"}`}
    >
      {x.name} <span className="opacity-70">({pts(Math.abs(gainA(x)))})</span>
    </button>
  );

  return (
    <section className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Presidente por bairro — {cityName || "…"}, 2º turno × 1º turno</h1>
        <p className="text-sm text-muted">
          Os boletins de urna de cada seção nos dois turnos, somados por bairro: quem ganhou terreno e quais bairros trocaram de candidato.
          Compara só as seções já lidas nos dois turnos.
        </p>
      </div>

      {error && (
        <p role="alert" className="rounded-lg border border-amber-500/50 bg-amber-500/10 px-4 py-2 text-sm">
          {error}
        </p>
      )}

      {data && (
        <p className="text-xs text-muted">
          Boletins do 2º turno lidos: {formatInt(r2Read)} de {formatInt(r2Total)}
          {data.r2.progress.running ? ` (lendo: ${data.r2.progress.done} de ${data.r2.progress.total})` : ""} · 1º turno: {formatInt(data.r1.sections.length)} de{" "}
          {formatInt(data.r1.totals.sections)} · comparando {formatInt(compared)} seções
          {data.r2.updatedAt ? ` · atualizado às ${formatTimeBrasilia(data.r2.updatedAt)}` : ""}
          {data.r2.progress.lastError ? ` · ${data.r2.progress.lastError}` : ""}
          {data.placesStatus.message ? ` · ${data.placesStatus.message}` : ""}
        </p>
      )}

      {!data ? (
        !error && <p className="text-sm text-muted">Carregando…</p>
      ) : compared === 0 ? (
        <p className="rounded-lg border border-border bg-surface px-4 py-3 text-sm text-muted">
          Lendo os boletins de urna do 2º turno no TSE (são {formatInt(r2Total || 1500)} seções; leva alguns minutos na primeira vez)…
        </p>
      ) : (
        <>
          <div className="rounded-xl border border-border bg-surface p-4">
            <p className="text-base">
              Nas {formatInt(compared)} seções comparadas, {nameA} foi de <strong>{formatPct(shareA(city.r1))}</strong> para{" "}
              <strong style={{ color: colorA }}>{formatPct(shareA(city.r2))}</strong> e {nameB} de <strong>{formatPct(100 - shareA(city.r1))}</strong> para{" "}
              <strong style={{ color: colorB }}>{formatPct(100 - shareA(city.r2))}</strong> (só entre os dois) —{" "}
              <strong style={{ color: g >= 0 ? colorA : colorB }}>
                {g >= 0 ? nameA : nameB} ganhou {pts(Math.abs(g))} pontos
              </strong>{" "}
              de vantagem em {cityName}.
            </p>
            <p className="mt-2 text-sm">
              <strong>{flips.length}</strong> de {bairros.length} bairros trocaram de candidato:{" "}
              <span style={{ color: colorA }}>
                {flipsToA.length} passaram para {nameA}
              </span>{" "}
              e{" "}
              <span style={{ color: colorB }}>
                {flipsToB.length} para {nameB}
              </span>
              .
            </p>
          </div>

          {flips.length > 0 && (
            <div className="grid gap-3 md:grid-cols-2">
              {[
                { list: flipsToA, name: nameA, from: nameB, color: colorA },
                { list: flipsToB, name: nameB, from: nameA, color: colorB },
              ].map((c) => (
                <div key={c.name} className="rounded-xl border border-border bg-surface p-4">
                  <h2 className="mb-2 text-sm font-semibold" style={{ color: c.color }}>
                    Viraram para {c.name} ({c.list.length})
                  </h2>
                  {c.list.length === 0 ? (
                    <p className="text-xs text-muted">Nenhum bairro onde {c.from} venceu no 1º turno passou para {c.name}.</p>
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      {c.list.map((x) => (
                        <Chip key={x.key} x={x} />
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          <div className="grid gap-3 md:grid-cols-2">
            {[
              { list: topA, name: nameA, color: colorA, sign: 1 },
              { list: topB, name: nameB, color: colorB, sign: -1 },
            ].map((c) => (
              <div key={c.name} className="rounded-xl border border-border bg-surface p-4">
                <h2 className="mb-2 text-sm font-semibold" style={{ color: c.color }}>
                  Onde {c.name} mais ganhou terreno
                </h2>
                <ol className="space-y-1 text-sm">
                  {c.list.map((x, i) => (
                    <li key={x.key} className="flex items-baseline gap-2">
                      <span className="w-5 text-right text-xs text-muted">{i + 1}</span>
                      <button type="button" onClick={() => setSelected(selected === x.name ? null : x.name)} className="truncate text-left hover:text-accent">
                        {x.name}
                      </button>
                      <span className="ml-auto whitespace-nowrap font-semibold" style={{ color: c.sign * gainA(x) > 0 ? c.color : "var(--muted)" }}>
                        {c.sign * gainA(x) >= 0 ? "+" : "−"}
                        {pts(Math.abs(gainA(x)))}
                      </span>
                    </li>
                  ))}
                </ol>
              </div>
            ))}
          </div>

          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="flex overflow-hidden rounded-full border border-border text-sm">
                {(
                  [
                    ["vencedor", "Quem venceu no 2º turno"],
                    ["terreno", "Quem ganhou terreno"],
                  ] as const
                ).map(([m, label]) => (
                  <button key={m} type="button" onClick={() => setMapMode(m)} aria-pressed={mapMode === m} className={`px-3 py-1 ${mapMode === m ? "bg-accent text-white" : "hover:text-accent"}`}>
                    {label}
                  </button>
                ))}
              </span>
              <span className="text-xs text-muted">
                {mapMode === "vencedor"
                  ? "Cada círculo é um local de votação, na cor de quem venceu ali no 2º turno (passe o mouse para ver se trocou de candidato)."
                  : "Círculo maior = mudança maior entre os turnos."}
                {selected ? ` Destacando: ${selected}.` : ""}
              </span>
              {selected && (
                <button type="button" onClick={() => setSelected(null)} className="text-xs underline hover:text-accent">
                  limpar destaque
                </button>
              )}
            </div>
            <PlacesMap points={points} outline={`/maps/${slug}.json`} />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} className="rounded-lg border border-border bg-surface px-2 py-1.5 text-sm" aria-label="Ordenar">
              <option value="virada">Bairros que trocaram primeiro</option>
              <option value="terrenoA">Mais terreno de {nameA}</option>
              <option value="terrenoB">Mais terreno de {nameB}</option>
              <option value="eleitores">Mais eleitores</option>
              <option value="nome">Ordem alfabética</option>
            </select>
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar bairro…" className="rounded-lg border border-border bg-surface px-3 py-1.5 text-sm" />
            <button type="button" onClick={csv} className="ml-auto rounded-full border border-border px-3 py-1 text-sm hover:border-accent hover:text-accent">
              Baixar planilha (CSV)
            </button>
          </div>

          <div className="overflow-x-auto rounded-xl border border-border bg-surface">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted">
                <tr className="border-b border-border">
                  <th className="px-3 py-2">Bairro</th>
                  {[
                    { nm: nameA, c: colorA },
                    { nm: nameB, c: colorB },
                  ].map((x) => (
                    <th key={x.nm} className="px-3 py-2 text-right" colSpan={2}>
                      <span className="mr-1 inline-block h-2 w-2 rounded-full" style={{ background: x.c }} />
                      {x.nm}
                      <span className="block font-normal">1º turno* · 2º turno</span>
                    </th>
                  ))}
                  {[
                    { nm: nameA, c: colorA },
                    { nm: nameB, c: colorB },
                  ].map((x) => (
                    <th key={`t-${x.nm}`} className="px-3 py-2 text-right">
                      <span className="mr-1 inline-block h-2 w-2 rounded-full" style={{ background: x.c }} />
                      Terreno {x.nm}
                      <span className="block font-normal">pontos</span>
                    </th>
                  ))}
                  <th className="px-3 py-2">À frente: 1º → 2º turno</th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, limit).map((x) => {
                  const s1 = shareA(x.r1);
                  const s2 = shareA(x.r2);
                  const gx = gainA(x);
                  const l1 = leaderOf(x.r1);
                  const l2 = leaderOf(x.r2);
                  const dot = (l: string | null) => (
                    <span className="inline-flex items-center gap-1">
                      <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: l === "A" ? colorA : l === "B" ? colorB : "#94a3b8" }} />
                      {l === "A" ? nameA : l === "B" ? nameB : "—"}
                    </span>
                  );
                  return (
                    <tr
                      key={x.key}
                      className={`border-b border-border last:border-0 ${selected === x.name ? "bg-accent/10" : ""}`}
                      onClick={() => setSelected(selected === x.name ? null : x.name)}
                    >
                      <td className="cursor-pointer px-3 py-2">
                        <span className="font-medium">{x.name}</span>
                        <span className="block text-xs text-muted">{x.sub}</span>
                      </td>
                      <td className="px-3 py-2 text-right">{formatPct(s1)}</td>
                      <td className="px-3 py-2 text-right font-semibold">{formatPct(s2)}</td>
                      <td className="px-3 py-2 text-right">{formatPct(100 - s1)}</td>
                      <td className="px-3 py-2 text-right font-semibold">{formatPct(100 - s2)}</td>
                      {[
                        { v: gx, c: colorA },
                        { v: -gx, c: colorB },
                      ].map((t, i) => (
                        <td key={i} className="whitespace-nowrap px-3 py-2 text-right font-semibold" style={{ color: t.v > 0 ? t.c : "var(--muted)" }}>
                          {t.v > 0 ? "+" : t.v < 0 ? "−" : ""}
                          {pts(Math.abs(t.v))}
                        </td>
                      ))}
                      <td className="whitespace-nowrap px-3 py-2 text-xs font-semibold">
                        {dot(l1)} → {dot(l2)}
                        {flipped(x) && <span className="ml-2 rounded-full bg-amber-500/20 px-2 py-0.5 text-[11px] text-amber-700 dark:text-amber-300">trocou</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {rows.length > limit && (
            <button type="button" onClick={() => setLimit(limit + PAGE)} className="text-sm underline hover:text-accent">
              Mostrar mais ({rows.length - limit} restantes)
            </button>
          )}
          <p className="text-xs text-muted">
            * Percentual de {nameA} e de {nameB} considerando só os votos dos dois, para comparar o 1º turno (que teve outros candidatos) com o 2º.
            Terreno: quanto a vantagem de cada um mudou em relação ao 1º turno, em pontos (positivo = ganhou). Bairro conforme o cadastro de
            locais de votação do TSE. Clique num bairro para destacá-lo no mapa.
          </p>
        </>
      )}
    </section>
  );
}
