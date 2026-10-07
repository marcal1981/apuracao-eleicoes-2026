"use client";

import dynamic from "next/dynamic";
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { formatInt, formatPct, formatTimeBrasilia } from "@apuracao/core";
import type { PlacePoint } from "./places-map";

const PlacesMap = dynamic(() => import("./places-map").then((m) => m.PlacesMap), {
  ssr: false,
  loading: () => <div className="h-[380px] animate-pulse rounded-xl border border-border bg-surface sm:h-[480px]" />,
});

interface Section {
  zone: string;
  section: string;
  place: string | null;
  electorate: number;
  abstention: number;
  done: boolean;
  presVotes?: Record<string, number>;
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
interface Snapshot {
  city: string;
  updatedAt: string | null;
  totals: { sections: number; read: number };
  progress: { running: boolean; done: number; total: number; failures: number };
  sections: Section[];
  places: Place[];
  placesStatus: { status: string; message: string | null; downloadedMb: number };
  presidentCandidates?: { number: string; name: string; party: string }[];
}

interface Agg {
  electorate: number;
  abstention: number;
  sections: number;
  /** Votos por número do candidato, mais "branco", "nulo" e "outros". */
  votes: Record<string, number>;
}
interface PlaceAgg extends Agg {
  key: string;
  name: string;
  address: string;
  bairro: string;
  lat: number | null;
  lon: number | null;
}
interface BairroAgg extends Agg {
  name: string;
  places: PlaceAgg[];
}

// Cores dos principais candidatos (os demais ficam em "Outros").
// Cores fixas por candidato (pelo nome de urna); os demais recebem as cores seguintes, sem repetir.
const FIXED_COLORS: [RegExp, string][] = [
  [/\bLULA\b/i, "#dc2626"], // vermelho
  [/\bBOLSONARO\b/i, "#2563eb"], // azul
];
const COLORS = ["#16a34a", "#f59e0b", "#7c3aed", "#0891b2", "#db2777", "#65a30d"];
const OTHER = "#94a3b8";
const MAX_SHOWN = 6;
const PAGE = 40;
const NO_BAIRRO = "(SEM BAIRRO NO CADASTRO)";
const NOT_CANDIDATE = new Set(["branco", "nulo", "outros"]);
const n = (code: string) => String(Number(code));
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const title = (s: string) =>
  s
    .toLowerCase()
    .replace(/(^|\s|\()\S/g, (c) => c.toUpperCase())
    .replace(/ (Da|De|Do|Das|Dos|E)(?= )/g, (w) => w.toLowerCase());
/** Nome curto para colunas: o sobrenome ("Simone Tebet" → "Tebet"); nome de uma palavra fica igual. */
const shortOf = (name: string) => {
  const w = name.trim().split(/\s+/);
  return w[w.length - 1]!;
};
const valid = (v: Record<string, number>) => Object.entries(v).reduce((s, [k, x]) => (NOT_CANDIDATE.has(k) ? s : s + x), 0);
const winnerOf = (v: Record<string, number>) => {
  let best: string | null = null;
  for (const [k, x] of Object.entries(v)) if (!NOT_CANDIDATE.has(k) && x > 0 && (best === null || x > v[best]!)) best = k;
  return best;
};

/** Votação para Presidente por bairro de uma cidade, somando os boletins de urna de cada seção. */
export function PresidentBairroView({ slug }: { slug: string }) {
  const [data, setData] = useState<Snapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<string>("electorate");
  const [limit, setLimit] = useState(PAGE);
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/v1/cities/${slug}/sections`, { cache: "no-store", signal: AbortSignal.timeout(20_000) });
      if (!r.ok) {
        const body = (await r.json().catch(() => null)) as { error?: string } | null;
        return setError(body?.error ?? `O servidor respondeu com erro (HTTP ${r.status}).`);
      }
      setError(null);
      setData((await r.json()) as Snapshot);
    } catch {
      setError("Não foi possível falar com o servidor. Confira se o npm run dev continua aberto.");
    }
  }, [slug]);

  const withVotes = useMemo(() => (data?.sections ?? []).filter((s) => s.done && s.presVotes && Object.keys(s.presVotes).length), [data]);
  const busy = !data || data.progress.running || withVotes.length < (data?.totals.read ?? 0) || data.places.length === 0;
  useEffect(() => {
    load();
    const id = setInterval(load, busy ? 8_000 : 60_000);
    return () => clearInterval(id);
  }, [load, busy]);

  const names = useMemo(() => new Map((data?.presidentCandidates ?? []).map((c) => [c.number, c])), [data]);
  const nameOf = useCallback((num: string) => (names.get(num) ? title(names.get(num)!.name) : `Candidato ${num}`), [names]);

  const { bairros, city } = useMemo(() => {
    const info = new Map((data?.places ?? []).map((p) => [`${n(p.zone)}-${p.code}`, p]));
    const places = new Map<string, PlaceAgg>();
    const city: Agg = { electorate: 0, abstention: 0, sections: 0, votes: {} };
    const addTo = (a: Agg, s: Section) => {
      a.electorate += s.electorate;
      a.abstention += s.abstention;
      a.sections++;
      for (const [k, v] of Object.entries(s.presVotes!)) a.votes[k] = (a.votes[k] ?? 0) + v;
    };
    for (const s of withVotes) {
      const key = `${n(s.zone)}-${s.place ?? "?"}`;
      const p = s.place ? info.get(key) : undefined;
      let agg = places.get(key);
      if (!agg) {
        agg = {
          key,
          name: p?.name || (s.place ? `Local ${s.place} (zona ${n(s.zone)})` : "Local não identificado"),
          address: p?.address ?? "",
          bairro: (p?.bairro || NO_BAIRRO).trim().toUpperCase(),
          lat: p?.lat ?? null,
          lon: p?.lon ?? null,
          electorate: 0,
          abstention: 0,
          sections: 0,
          votes: {},
        };
        places.set(key, agg);
      }
      addTo(agg, s);
      addTo(city, s);
    }
    const byBairro = new Map<string, BairroAgg>();
    for (const p of places.values()) {
      let b = byBairro.get(p.bairro);
      if (!b) byBairro.set(p.bairro, (b = { name: p.bairro, places: [], electorate: 0, abstention: 0, sections: 0, votes: {} }));
      b.places.push(p);
      b.electorate += p.electorate;
      b.abstention += p.abstention;
      b.sections += p.sections;
      for (const [k, v] of Object.entries(p.votes)) b.votes[k] = (b.votes[k] ?? 0) + v;
    }
    return { bairros: [...byBairro.values()], city };
  }, [data, withVotes]);

  // Candidatos em ordem de votos na cidade; os principais ganham coluna e cor, o resto vira "Outros".
  const ranking = useMemo(
    () =>
      Object.entries(city.votes)
        .filter(([k]) => !NOT_CANDIDATE.has(k))
        .sort((a, b) => b[1] - a[1])
        .map(([num]) => num),
    [city],
  );
  const cityValid = valid(city.votes);
  const shown = ranking.filter((num, i) => i < MAX_SHOWN && (i < 2 || (city.votes[num] ?? 0) / Math.max(1, cityValid) >= 0.01));
  const colorMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const num of shown) {
      const fixed = FIXED_COLORS.find(([re]) => re.test(names.get(num)?.name ?? ""));
      if (fixed) map.set(num, fixed[1]);
    }
    const free = COLORS.filter((c) => ![...map.values()].includes(c));
    for (const num of shown) if (!map.has(num)) map.set(num, free.shift() ?? OTHER);
    return map;
  }, [shown, names]);
  const colorOf = useCallback((num: string | null) => (num ? (colorMap.get(num) ?? OTHER) : OTHER), [colorMap]);
  const others = (v: Record<string, number>) => valid(v) - shown.reduce((s, num) => s + (v[num] ?? 0), 0);
  // Coluna "Outros" só quando há votos fora dos candidatos mostrados.
  const hasOthers = others(city.votes) > 0;

  const rows = useMemo(() => {
    const q = query.trim().toUpperCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
    const pct = (b: Agg, num: string) => (b.votes[num] ?? 0) / Math.max(1, valid(b.votes));
    return bairros
      .filter((b) => !q || b.name.normalize("NFD").replace(/[̀-ͯ]/g, "").includes(q))
      .sort((a, b) => (sort === "electorate" ? b.electorate - a.electorate : pct(b, sort) - pct(a, sort)) || a.name.localeCompare(b.name, "pt-BR"));
  }, [bairros, query, sort]);

  const points: PlacePoint[] = useMemo(
    () =>
      bairros.flatMap((b) =>
        b.places
          .filter((p) => p.lat !== null && p.lon !== null)
          .map((p) => {
            const w = winnerOf(p.votes);
            const total = valid(p.votes);
            const lines = ranking
              .slice(0, 4)
              .map((num) => `${esc(nameOf(num))}: ${formatInt(p.votes[num] ?? 0)} (${formatPct(((p.votes[num] ?? 0) / Math.max(1, total)) * 100)})`)
              .join("<br>");
            return {
              key: p.key,
              lat: p.lat!,
              lon: p.lon!,
              value: total,
              color: colorOf(w),
              highlighted: open !== null && b.name === open,
              html: `<strong>${esc(p.name)}</strong><br>${esc(title(p.bairro))}<br>${lines}`,
            };
          }),
      ),
    [bairros, ranking, nameOf, colorOf, open],
  );

  const winsByCandidate = useMemo(() => {
    const m = new Map<string, number>();
    for (const b of bairros) {
      const w = winnerOf(b.votes);
      if (w) m.set(w, (m.get(w) ?? 0) + 1);
    }
    return m;
  }, [bairros]);

  const p = data?.progress;
  const pctRead = p && p.total > 0 ? Math.round((p.done / p.total) * 100) : 0;
  const first = ranking[0];
  const second = ranking[1];

  const downloadCsv = () => {
    const header = ["Bairro", "Locais de votação", "Seções", "Eleitores", "Abstenções", ...ranking.map((num) => `${nameOf(num)} (${num})`), "Brancos", "Nulos", "Vencedor"];
    const lines = [...bairros]
      .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"))
      .map((b) => {
        const w = winnerOf(b.votes);
        return [
          b.name,
          String(b.places.length),
          String(b.sections),
          String(b.electorate),
          String(b.abstention),
          ...ranking.map((num) => String(b.votes[num] ?? 0)),
          String(b.votes.branco ?? 0),
          String(b.votes.nulo ?? 0),
          w ? nameOf(w) : "",
        ];
      });
    const csv = "﻿" + [header, ...lines].map((r) => r.map((v) => `"${v.replace(/"/g, '""')}"`).join(";")).join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `presidente-por-bairro-${slug}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const Cells = ({ a, small }: { a: Agg; small?: boolean }) => {
    const total = valid(a.votes);
    const w = winnerOf(a.votes);
    const pad = small ? "px-3 py-1.5" : "px-3 py-2";
    return (
      <>
        <td className={`${pad} text-right`}>{formatInt(a.electorate)}</td>
        <td className={`${pad} text-right`}>
          {formatInt(a.abstention)}
          <span className="ml-1 text-xs text-muted">({a.electorate > 0 ? formatPct((a.abstention / a.electorate) * 100) : "—"})</span>
        </td>
        {shown.map((num) => (
          <td key={num} className={`${pad} text-right ${w === num ? "font-semibold" : ""}`}>
            {formatInt(a.votes[num] ?? 0)}
            <span className="block text-xs text-muted">{formatPct(((a.votes[num] ?? 0) / Math.max(1, total)) * 100)}</span>
          </td>
        ))}
        {hasOthers && (
          <td className={`${pad} text-right`}>
            {formatInt(others(a.votes))}
            <span className="block text-xs text-muted">{formatPct((others(a.votes) / Math.max(1, total)) * 100)}</span>
          </td>
        )}
        <td className={`${pad} text-right`}>{formatInt((a.votes.branco ?? 0) + (a.votes.nulo ?? 0))}</td>
        <td className={`${pad}`}>
          {w && (
            <span className="inline-flex items-center gap-1 whitespace-nowrap text-xs font-semibold">
              <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: colorOf(w) }} />
              {shortOf(nameOf(w))}
            </span>
          )}
        </td>
      </>
    );
  };

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Presidente por bairro — {data?.city ?? "São José dos Campos"}</h1>
          <p className="text-sm text-muted">
            Votos para Presidente da República somados por bairro, a partir dos boletins de urna de cada seção
            {data?.updatedAt ? ` · atualizado às ${formatTimeBrasilia(data.updatedAt)}` : ""}.
          </p>
        </div>
        {bairros.length > 0 && (
          <button
            type="button"
            onClick={downloadCsv}
            className="rounded-full border border-border px-3 py-1 text-xs font-semibold hover:border-accent hover:text-accent"
          >
            Baixar planilha
          </button>
        )}
      </div>

      {error && (
        <p role="alert" className="rounded-lg border border-amber-500/50 bg-amber-500/10 px-4 py-2 text-sm">
          {error}
        </p>
      )}

      {p?.running && (
        <div className="space-y-1 text-xs text-muted">
          <div>
            Lendo os boletins de urna no TSE: {formatInt(p.done)} de {formatInt(p.total)} seções ({pctRead}%)
            {p.failures > 0 && ` · ${p.failures} com falha`}
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-border">
            <div className="h-full bg-accent transition-[width]" style={{ width: `${pctRead}%` }} />
          </div>
        </div>
      )}

      {!data ? (
        !error && <p className="text-sm text-muted">Carregando…</p>
      ) : withVotes.length === 0 ? (
        <p className="rounded-lg border border-border bg-surface px-4 py-3 text-sm text-muted">
          Lendo os votos para Presidente nos boletins de urna das seções. Na primeira vez leva alguns minutos; a página se atualiza
          sozinha.
        </p>
      ) : (
        <>
          <dl className="grid grid-cols-2 gap-3 rounded-xl border border-border bg-surface p-4 sm:grid-cols-4">
            {[first, second].map(
              (num, i) =>
                num && (
                  <div key={num}>
                    <dt className="text-xs text-muted">{i === 0 ? "1º na cidade" : "2º na cidade"}</dt>
                    <dd className="flex items-center gap-2 text-lg font-bold">
                      <span className="inline-block h-3 w-3 rounded-full" style={{ background: colorOf(num) }} />
                      <span className="truncate">{nameOf(num)}</span>
                    </dd>
                    <dd className="text-sm text-muted">
                      {formatInt(city.votes[num] ?? 0)} votos · {formatPct(((city.votes[num] ?? 0) / Math.max(1, cityValid)) * 100)} dos válidos ·
                      vence em {formatInt(winsByCandidate.get(num) ?? 0)} bairros
                    </dd>
                  </div>
                ),
            )}
            <div>
              <dt className="text-xs text-muted">Votos válidos</dt>
              <dd className="text-2xl font-bold">{formatInt(cityValid)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted">Seções lidas</dt>
              <dd className="text-2xl font-bold">
                {formatInt(withVotes.length)}
                <span className="text-sm font-normal text-muted"> de {formatInt(data.totals.sections)}</span>
              </dd>
            </div>
          </dl>

          <div className="flex flex-wrap gap-3 text-xs">
            {shown.map((num) => (
              <span key={num} className="inline-flex items-center gap-1">
                <span className="inline-block h-3 w-3 rounded-full" style={{ background: colorOf(num) }} />
                {nameOf(num)} ({num})
              </span>
            ))}
            {hasOthers && (
              <span className="inline-flex items-center gap-1">
                <span className="inline-block h-3 w-3 rounded-full" style={{ background: OTHER }} />
                Outros
              </span>
            )}
          </div>
          <PlacesMap points={points} outline={`/maps/${slug}.json`} />
          <p className="text-xs text-muted">
            Cada círculo é um local de votação, na cor do candidato mais votado ali; quanto maior, mais votos válidos. Clique num
            bairro na tabela para destacá-lo no mapa.
          </p>

          <div className="flex flex-wrap items-center gap-2">
            <input
              type="search"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setLimit(PAGE);
              }}
              placeholder="Buscar bairro"
              className="min-w-0 flex-1 rounded-lg border border-border bg-surface px-3 py-2 text-sm sm:max-w-sm"
            />
            <label className="flex items-center gap-2 text-sm">
              Ordenar por
              <select value={sort} onChange={(e) => setSort(e.target.value)} className="rounded-lg border border-border bg-surface px-2 py-1.5">
                <option value="electorate">Eleitores</option>
                {shown.map((num) => (
                  <option key={num} value={num}>
                    % de {nameOf(num)}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="overflow-x-auto rounded-xl border border-border bg-surface">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted">
                <tr className="border-b border-border">
                  <th className="px-3 py-2">#</th>
                  <th className="px-3 py-2">Bairro</th>
                  <th className="px-3 py-2 text-right">Locais</th>
                  <th className="px-3 py-2 text-right">Eleitores</th>
                  <th className="px-3 py-2 text-right">Abstenções</th>
                  {shown.map((num) => (
                    <th key={num} className="whitespace-nowrap px-3 py-2 text-right" title={nameOf(num)}>
                      <span className="mr-1 inline-block h-2 w-2 rounded-full" style={{ background: colorOf(num) }} />
                      {shortOf(nameOf(num))}
                    </th>
                  ))}
                  {hasOthers && <th className="px-3 py-2 text-right">Outros</th>}
                  <th className="whitespace-nowrap px-3 py-2 text-right">Brancos e nulos</th>
                  <th className="px-3 py-2">Vencedor</th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, limit).map((b, i) => {
                  const isOpen = open === b.name;
                  return (
                    <Fragment key={b.name}>
                      <tr
                        onClick={() => setOpen(isOpen ? null : b.name)}
                        className={`cursor-pointer border-b border-border hover:bg-accent/5 ${isOpen ? "bg-accent/10" : ""}`}
                        title="Clique para ver os locais de votação do bairro"
                      >
                        <td className="px-3 py-2 text-xs text-muted">{i + 1}</td>
                        <td className="px-3 py-2 font-medium">
                          {isOpen ? "▾" : "▸"} {title(b.name)}
                          {/* Barra com a divisão dos votos válidos no bairro. */}
                          <span className="mt-1 flex h-1.5 w-40 overflow-hidden rounded-full bg-border">
                            {[...shown, "outros"].map((num) => {
                              const v = num === "outros" ? others(b.votes) : (b.votes[num] ?? 0);
                              return <span key={num} style={{ width: `${(v / Math.max(1, valid(b.votes))) * 100}%`, background: num === "outros" ? OTHER : colorOf(num) }} />;
                            })}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-right">{b.places.length}</td>
                        <Cells a={b} />
                      </tr>
                      {isOpen &&
                        [...b.places]
                          .sort((x, y) => y.electorate - x.electorate)
                          .map((pl) => (
                            <tr key={pl.key} className="border-b border-border bg-black/[0.02] text-xs">
                              <td />
                              <td className="px-3 py-1.5 pl-7">
                                <span className="block">{pl.name}</span>
                                {pl.address && <span className="block text-muted">{pl.address}</span>}
                              </td>
                              <td className="px-3 py-1.5 text-right text-muted">{pl.sections} seç.</td>
                              <Cells a={pl} small />
                            </tr>
                          ))}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
          {rows.length > limit && (
            <button
              type="button"
              onClick={() => setLimit((l) => l + PAGE * 3)}
              className="w-full rounded-lg border border-border bg-surface py-2 text-sm font-semibold hover:border-accent"
            >
              Mostrar mais ({formatInt(rows.length - limit)} bairros)
            </button>
          )}
          <p className="text-xs text-muted">
            Percentuais sobre os votos válidos (sem brancos e nulos). O bairro de cada seção é o do seu local de votação no cadastro
            oficial do TSE. Os votos vêm do boletim de urna de cada seção; a soma da cidade pode ficar um pouco abaixo do resultado
            oficial enquanto houver seções sem boletim lido.
          </p>
        </>
      )}
    </section>
  );
}
