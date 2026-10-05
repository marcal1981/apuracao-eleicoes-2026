"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { formatInt, formatPct, formatTimeBrasilia } from "@apuracao/core";

interface Section {
  zone: string;
  section: string;
  place: string | null;
  status: string;
  electorate: number;
  turnout: number;
  abstention: number;
  abstentionPct: number;
  done: boolean;
}
interface Snapshot {
  city: string;
  uf: string;
  updatedAt: string | null;
  pleito: string | null;
  totals: { sections: number; read: number; electorate: number; turnout: number; abstention: number; abstentionPct: number };
  progress: { running: boolean; done: number; total: number; failures: number; lastError: string | null };
  sample: { aux: string[] | null; bu: string | null };
  sections: Section[];
}

type SortKey = "abstentionPct" | "abstention" | "electorate" | "section";
const SORTS: { key: SortKey; label: string }[] = [
  { key: "abstentionPct", label: "% de abstenção" },
  { key: "abstention", label: "Abstenções" },
  { key: "electorate", label: "Eleitores aptos" },
  { key: "section", label: "Zona e seção" },
];
const PAGE = 100;

const z = (code: string) => String(Number(code));

function sum(list: Section[]) {
  const read = list.filter((s) => s.done);
  const electorate = read.reduce((n, s) => n + s.electorate, 0);
  const turnout = read.reduce((n, s) => n + s.turnout, 0);
  const abstention = read.reduce((n, s) => n + s.abstention, 0);
  const counted = turnout + abstention;
  return { sections: list.length, read: read.length, electorate, turnout, abstention, abstentionPct: counted > 0 ? (abstention / counted) * 100 : 0 };
}

/** Abstenção por seção eleitoral de uma cidade, com resumo por zona e por local de votação. */
export function SectionsView({ slug }: { slug: string }) {
  const [data, setData] = useState<Snapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [zone, setZone] = useState("");
  const [place, setPlace] = useState("");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("abstentionPct");
  const [asc, setAsc] = useState(false);
  const [limit, setLimit] = useState(PAGE);

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

  const reading = !data || data.progress.running || data.totals.read < data.totals.sections;
  useEffect(() => {
    load();
    const id = setInterval(load, reading ? 8_000 : 60_000);
    return () => clearInterval(id);
  }, [load, reading]);

  const sections = useMemo(() => data?.sections ?? [], [data]);
  const zones = useMemo(() => {
    const byZone = new Map<string, Section[]>();
    for (const s of sections) byZone.set(s.zone, [...(byZone.get(s.zone) ?? []), s]);
    return [...byZone].sort(([a], [b]) => Number(a) - Number(b)).map(([code, list]) => ({ code, ...sum(list) }));
  }, [sections]);

  // Locais de votação da zona escolhida (ou de todas), com a abstenção somada das seções.
  const places = useMemo(() => {
    const byPlace = new Map<string, Section[]>();
    for (const s of sections) {
      if (!s.place || (zone && s.zone !== zone)) continue;
      const key = `${s.zone}|${s.place}`;
      byPlace.set(key, [...(byPlace.get(key) ?? []), s]);
    }
    return [...byPlace]
      .map(([key, list]) => {
        const [zoneCode, placeCode] = key.split("|") as [string, string];
        return { key, zone: zoneCode, place: placeCode, ...sum(list) };
      })
      .sort((a, b) => b.abstentionPct - a.abstentionPct);
  }, [sections, zone]);

  const rows = useMemo(() => {
    const q = query.trim().replace(/^0+/, "");
    const list = sections.filter(
      (s) =>
        (!zone || s.zone === zone) &&
        (!place || `${s.zone}|${s.place}` === place) &&
        (!q || z(s.section).startsWith(q) || (s.place ?? "").includes(q)),
    );
    const dir = asc ? 1 : -1;
    const bySection = (a: Section, b: Section) => Number(a.zone) - Number(b.zone) || Number(a.section) - Number(b.section);
    return list.sort((a, b) => {
      if (sort === "section") return dir * bySection(a, b);
      if (a.done !== b.done) return a.done ? -1 : 1;
      return dir * (a[sort] - b[sort]) || bySection(a, b);
    });
  }, [sections, zone, place, query, sort, asc]);

  const t = zone || place ? sum(rows) : data?.totals;
  const p = data?.progress;
  const pct = p && p.total > 0 ? Math.round((p.done / p.total) * 100) : 0;
  const placeLabel = place ? places.find((x) => x.key === place) : null;

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Abstenção por seção — {data?.city ?? "São José dos Campos"}</h1>
          <p className="text-sm text-muted">
            Eleitores que não compareceram em cada seção eleitoral, lidos dos boletins de urna publicados pelo TSE
            {data?.updatedAt ? ` · atualizado às ${formatTimeBrasilia(data.updatedAt)}` : ""}.
          </p>
        </div>
        <a
          href={`/api/v1/export/sections?cidade=${slug}`}
          className="rounded-full border border-border px-3 py-1 text-xs font-semibold hover:border-accent hover:text-accent"
        >
          Baixar planilha
        </a>
      </div>

      {error && (
        <p role="alert" className="rounded-lg border border-amber-500/50 bg-amber-500/10 px-4 py-2 text-sm">
          {error}
        </p>
      )}

      {p?.running && (
        <div className="space-y-1 text-xs text-muted">
          <div>
            Lendo os boletins de urna no TSE: {formatInt(p.done)} de {formatInt(p.total)} seções ({pct}%)
            {p.failures > 0 && ` · ${p.failures} com falha`}
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-border">
            <div className="h-full bg-accent transition-[width]" style={{ width: `${pct}%` }} />
          </div>
        </div>
      )}
      {p?.lastError && !p.running && <p className="text-xs text-muted">Último problema: {p.lastError}</p>}

      {data && t && t.read > 0 && (
        <dl className="grid grid-cols-2 gap-3 rounded-xl border border-border bg-surface p-4 sm:grid-cols-4">
          <div>
            <dt className="text-xs text-muted">
              Abstenção{zone ? ` na zona ${z(zone)}` : ""}
              {placeLabel ? ` no local ${placeLabel.place}` : ""}
            </dt>
            <dd className="text-2xl font-bold">{formatPct(t.abstentionPct)}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted">Eleitores que não votaram</dt>
            <dd className="text-2xl font-bold">{formatInt(t.abstention)}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted">Comparecimento</dt>
            <dd className="text-2xl font-bold">{formatInt(t.turnout)}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted">Seções lidas</dt>
            <dd className="text-2xl font-bold">
              {formatInt(t.read)}
              <span className="text-sm font-normal text-muted"> de {formatInt(t.sections)}</span>
            </dd>
          </div>
        </dl>
      )}

      {zones.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-border bg-surface">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted">
              <tr className="border-b border-border">
                <th className="px-3 py-2">Zona eleitoral</th>
                <th className="px-3 py-2 text-right">Seções</th>
                <th className="px-3 py-2 text-right">Eleitores aptos</th>
                <th className="px-3 py-2 text-right">Abstenções</th>
                <th className="px-3 py-2 text-right">% abstenção</th>
              </tr>
            </thead>
            <tbody>
              {zones.map((zn) => (
                <tr
                  key={zn.code}
                  onClick={() => {
                    setZone((cur) => (cur === zn.code ? "" : zn.code));
                    setPlace("");
                    setLimit(PAGE);
                  }}
                  className={`cursor-pointer border-b border-border last:border-0 hover:bg-accent/5 ${zone === zn.code ? "bg-accent/10" : ""}`}
                  title="Clique para ver só as seções desta zona"
                >
                  <td className="px-3 py-2 font-medium">Zona {z(zn.code)}</td>
                  <td className="px-3 py-2 text-right">
                    {zn.read < zn.sections ? `${formatInt(zn.read)} de ${formatInt(zn.sections)}` : formatInt(zn.sections)}
                  </td>
                  <td className="px-3 py-2 text-right">{formatInt(zn.electorate)}</td>
                  <td className="px-3 py-2 text-right font-semibold">{formatInt(zn.abstention)}</td>
                  <td className="px-3 py-2 text-right font-semibold">{zn.read > 0 ? formatPct(zn.abstentionPct) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!data ? (
        !error && <p className="text-sm text-muted">Carregando…</p>
      ) : sections.length === 0 ? (
        <p className="rounded-lg border border-border bg-surface px-4 py-3 text-sm text-muted">
          Buscando a lista de seções da cidade no TSE. A página se atualiza sozinha.
        </p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="search"
              inputMode="numeric"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setLimit(PAGE);
              }}
              placeholder="Buscar seção ou local"
              className="min-w-0 flex-1 rounded-lg border border-border bg-surface px-3 py-2 text-sm"
            />
            <select
              value={zone}
              onChange={(e) => {
                setZone(e.target.value);
                setPlace("");
                setLimit(PAGE);
              }}
              className="rounded-lg border border-border bg-surface px-2 py-1.5 text-sm"
              aria-label="Zona eleitoral"
            >
              <option value="">Todas as zonas</option>
              {zones.map((zn) => (
                <option key={zn.code} value={zn.code}>
                  Zona {z(zn.code)}
                </option>
              ))}
            </select>
            {places.length > 0 && (
              <select
                value={place}
                onChange={(e) => {
                  setPlace(e.target.value);
                  setLimit(PAGE);
                }}
                className="max-w-full rounded-lg border border-border bg-surface px-2 py-1.5 text-sm"
                aria-label="Local de votação"
              >
                <option value="">Todos os locais</option>
                {places.map((pl) => (
                  <option key={pl.key} value={pl.key}>
                    Local {pl.place} (zona {z(pl.zone)}) · {formatPct(pl.abstentionPct)}
                  </option>
                ))}
              </select>
            )}
            <label className="flex items-center gap-2 text-sm">
              Ordenar por
              <select
                value={sort}
                onChange={(e) => {
                  const key = e.target.value as SortKey;
                  setSort(key);
                  setAsc(key === "section");
                }}
                className="rounded-lg border border-border bg-surface px-2 py-1.5"
              >
                {SORTS.map((s) => (
                  <option key={s.key} value={s.key}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              onClick={() => setAsc((a) => !a)}
              className="rounded-lg border border-border px-3 py-1.5 text-sm hover:border-accent hover:text-accent"
              title="Inverter a ordem"
            >
              {asc ? "↑ Crescente" : "↓ Decrescente"}
            </button>
          </div>

          <div className="overflow-x-auto rounded-xl border border-border bg-surface">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted">
                <tr className="border-b border-border">
                  <th className="px-3 py-2">Zona / Seção</th>
                  <th className="px-3 py-2">Local</th>
                  <th className="px-3 py-2 text-right">Aptos</th>
                  <th className="px-3 py-2 text-right">Compareceram</th>
                  <th className="px-3 py-2 text-right">Abstenções</th>
                  <th className="px-3 py-2 text-right">% abstenção</th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, limit).map((s) => (
                  <tr key={`${s.zone}-${s.section}`} className="border-b border-border last:border-0">
                    <td className="whitespace-nowrap px-3 py-2">
                      <span className="text-muted">{z(s.zone)} /</span> <span className="font-medium">{z(s.section)}</span>
                    </td>
                    <td className="px-3 py-2 text-muted">{s.place ?? "—"}</td>
                    {s.done ? (
                      <>
                        <td className="px-3 py-2 text-right">{formatInt(s.electorate)}</td>
                        <td className="px-3 py-2 text-right">{formatInt(s.turnout)}</td>
                        <td className="px-3 py-2 text-right font-semibold">{formatInt(s.abstention)}</td>
                        <td className="px-3 py-2 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <div className="hidden h-1.5 w-16 overflow-hidden rounded-full bg-border sm:block">
                              <div className="h-full bg-accent/70" style={{ width: `${Math.min(100, s.abstentionPct * 2)}%` }} />
                            </div>
                            <span className="w-14 font-semibold">{formatPct(s.abstentionPct)}</span>
                          </div>
                        </td>
                      </>
                    ) : (
                      <td colSpan={4} className="px-3 py-2 text-right text-xs text-muted">
                        {s.status}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {rows.length > limit && (
            <button
              type="button"
              onClick={() => setLimit((l) => l + PAGE * 3)}
              className="w-full rounded-lg border border-border bg-surface py-2 text-sm font-semibold hover:border-accent"
            >
              Mostrar mais ({formatInt(rows.length - limit)} seções)
            </button>
          )}
          <p className="text-xs text-muted">
            Abstenção = eleitores aptos da seção que não compareceram (&quot;eleitores faltosos&quot; no boletim de urna).
            O local de votação aparece pelo número usado pela Justiça Eleitoral.
          </p>
          {(data.sample.aux || data.sample.bu) && (
            <details className="text-[10px] text-muted">
              <summary className="cursor-pointer">Exemplo do arquivo do TSE (diagnóstico)</summary>
              <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap">
                {`pleito: ${data.pleito ?? "?"}\nauxiliar: ${JSON.stringify(data.sample.aux)}\n\n${data.sample.bu ?? ""}`}
              </pre>
            </details>
          )}
        </>
      )}
    </section>
  );
}
