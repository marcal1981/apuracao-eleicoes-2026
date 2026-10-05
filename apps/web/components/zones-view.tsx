"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useState } from "react";
import { formatInt, formatPct, formatTimeBrasilia } from "@apuracao/core";
import type { ZoneArea } from "./zone-map";

const ZoneMap = dynamic(() => import("./zone-map").then((m) => m.ZoneMap), {
  ssr: false,
  loading: () => <div className="h-[420px] animate-pulse rounded-xl border border-border bg-surface sm:h-[560px]" />,
});

interface Section {
  zone: string;
  section: string;
  place: string | null;
  status: string;
  electorate: number;
  turnout: number;
  abstention: number;
  done: boolean;
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
  pleito: string | null;
  totals: { sections: number; read: number; electorate: number; turnout: number; abstention: number; abstentionPct: number };
  progress: { running: boolean; done: number; total: number; failures: number; lastError: string | null };
  sample: {
    aux: string[] | null;
    bu: string | null;
    lastAuxUrl?: string | null;
    lastAuxResult?: string | null;
    lastAuxBody?: string | null;
  };
  sections: Section[];
  places: Place[];
  placesStatus: { status: string; source: string | null; message: string | null; downloadedMb: number; count: number };
}

// Escala de cores relativa: da zona com menos abstenção (claro) à com mais (escuro).
const COLORS = ["#fde68a", "#fbbf24", "#f97316", "#dc2626", "#991b1b"];
const n = (code: string) => String(Number(code));

function totalsOf(list: Section[]) {
  const read = list.filter((s) => s.done);
  const electorate = read.reduce((a, s) => a + s.electorate, 0);
  const turnout = read.reduce((a, s) => a + s.turnout, 0);
  const abstention = read.reduce((a, s) => a + s.abstention, 0);
  const counted = turnout + abstention;
  return { sections: list.length, read: read.length, electorate, turnout, abstention, abstentionPct: counted > 0 ? (abstention / counted) * 100 : 0 };
}

/** Abstenção por zona eleitoral de uma cidade, em mapa e tabela. */
export function ZonesView({ slug }: { slug: string }) {
  const [data, setData] = useState<Snapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState("");

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

  const busy = !data || data.progress.running || data.totals.read === 0 || ["idle", "downloading", "reading"].includes(data.placesStatus.status);
  useEffect(() => {
    load();
    const id = setInterval(load, busy ? 8_000 : 60_000);
    return () => clearInterval(id);
  }, [load, busy]);

  const zones = useMemo(() => {
    if (!data) return [];
    const placeInfo = new Map(data.places.map((p) => [`${n(p.zone)}-${p.code}`, p]));
    const byZone = new Map<string, Section[]>();
    for (const s of data.sections) byZone.set(s.zone, [...(byZone.get(s.zone) ?? []), s]);
    const list = [...byZone]
      .sort(([a], [b]) => Number(a) - Number(b))
      .map(([code, sections]) => {
        // Locais de votação da zona, com a abstenção somada das seções de cada um.
        const byPlace = new Map<string, Section[]>();
        for (const s of sections) if (s.place) byPlace.set(s.place, [...(byPlace.get(s.place) ?? []), s]);
        const places = [...byPlace].map(([place, secs]) => {
          const info = placeInfo.get(`${n(code)}-${place}`);
          return { code: place, name: info?.name || `Local ${place}`, bairro: info?.bairro ?? "", lat: info?.lat ?? null, lon: info?.lon ?? null, ...totalsOf(secs) };
        });
        return { code, label: n(code), places, ...totalsOf(sections) };
      });
    const read = list.filter((z) => z.read > 0);
    const min = Math.min(...read.map((z) => z.abstentionPct));
    const max = Math.max(...read.map((z) => z.abstentionPct));
    return list.map((z) => {
      const t = max > min ? (z.abstentionPct - min) / (max - min) : 0.5;
      return { ...z, color: z.read > 0 ? COLORS[Math.min(COLORS.length - 1, Math.floor(t * COLORS.length))]! : "#cbd5e1" };
    });
  }, [data]);

  const areas: ZoneArea[] = useMemo(
    () =>
      zones.map((z) => ({
        ...z,
        points: z.places.filter((p) => p.lat !== null && p.lon !== null).map((p) => ({ lat: p.lat!, lon: p.lon!, name: p.name, bairro: p.bairro })),
      })),
    [zones],
  );
  const hasMap = areas.some((a) => a.points.length > 0);
  const zone = zones.find((z) => z.code === selected);
  const t = zone ?? data?.totals;
  const p = data?.progress;
  const pct = p && p.total > 0 ? Math.round((p.done / p.total) * 100) : 0;
  const ps = data?.placesStatus;
  // Situações das seções ainda sem boletim lido (ajuda a entender por que não há números).
  const pending = useMemo(() => {
    const counts = new Map<string, number>();
    for (const s of data?.sections ?? []) if (!s.done) counts.set(s.status, (counts.get(s.status) ?? 0) + 1);
    return [...counts].sort((a, b) => b[1] - a[1]);
  }, [data]);
  const nothingRead = !!data && data.sections.length > 0 && data.totals.read === 0 && !data.progress.running;
  const range = zones.filter((z) => z.read > 0).map((z) => z.abstentionPct);

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Abstenção por zona eleitoral — {data?.city ?? "São José dos Campos"}</h1>
          <p className="text-sm text-muted">
            Soma dos boletins de urna de todas as seções de cada zona, publicados pelo TSE
            {data?.updatedAt ? ` · atualizado às ${formatTimeBrasilia(data.updatedAt)}` : ""}.
          </p>
        </div>
        <div className="flex gap-2">
          <a
            href={`/api/v1/export/sections?cidade=${slug}&agrupar=zona`}
            className="rounded-full border border-border px-3 py-1 text-xs font-semibold hover:border-accent hover:text-accent"
          >
            Planilha por zona
          </a>
          <a
            href={`/api/v1/export/sections?cidade=${slug}`}
            className="rounded-full border border-border px-3 py-1 text-xs font-semibold hover:border-accent hover:text-accent"
          >
            Planilha por seção
          </a>
        </div>
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
      {p?.lastError && !p.running && <p className="text-xs text-muted">Último problema nos boletins: {p.lastError}</p>}

      {nothingRead && data && (
        <div role="alert" className="space-y-2 rounded-lg border border-amber-500/50 bg-amber-500/10 px-4 py-3 text-sm">
          <p className="font-semibold">Os boletins de urna das seções ainda não foram lidos — por isso os números estão zerados.</p>
          <ul className="list-inside list-disc text-xs">
            {pending.slice(0, 4).map(([status, count]) => (
              <li key={status}>
                {formatInt(count)} seções: {status}
              </li>
            ))}
          </ul>
          {data.sample.lastAuxUrl && (
            <div className="text-xs">
              <div>
                Última consulta: <span className="break-all font-mono">{data.sample.lastAuxUrl}</span>
              </div>
              <div>Resposta: {data.sample.lastAuxResult}</div>
              {data.sample.lastAuxBody && (
                <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-all rounded bg-black/5 p-2 text-[10px]">{data.sample.lastAuxBody}</pre>
              )}
            </div>
          )}
          {data.progress.lastError && <p className="text-xs">Último problema: {data.progress.lastError}</p>}
          {data.progress.failures > 0 && data.sample.bu && (
            <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-all rounded bg-black/5 p-2 text-[10px]">{data.sample.bu}</pre>
          )}
          <p className="text-xs text-muted">
            O sistema tenta de novo a cada 3 minutos. Se continuar assim, mande um print deste quadro.
          </p>
        </div>
      )}

      {data && data.totals.read > 0 && data.totals.abstentionPct > 60 && (
        <p role="alert" className="rounded-lg border border-amber-500/50 bg-amber-500/10 px-4 py-2 text-sm">
          A abstenção calculada ({formatPct(data.totals.abstentionPct)}) está fora do normal — provavelmente o boletim de urna
          não foi lido corretamente. Abra &quot;Detalhes dos arquivos do TSE&quot; no fim da página e mande um print.
        </p>
      )}

      {data && t && t.read > 0 && (
        <dl className="grid grid-cols-2 gap-3 rounded-xl border border-border bg-surface p-4 sm:grid-cols-4">
          <div>
            <dt className="text-xs text-muted">Abstenção {zone ? `na zona ${zone.label}` : "na cidade"}</dt>
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
            <dt className="text-xs text-muted">Seções apuradas</dt>
            <dd className="text-2xl font-bold">
              {formatInt(t.read)}
              <span className="text-sm font-normal text-muted"> de {formatInt(t.sections)}</span>
            </dd>
          </div>
        </dl>
      )}

      {!data ? (
        !error && <p className="text-sm text-muted">Carregando…</p>
      ) : zones.length === 0 ? (
        <p className="rounded-lg border border-border bg-surface px-4 py-3 text-sm text-muted">
          Buscando a lista de zonas e seções da cidade no TSE. A página se atualiza sozinha.
        </p>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
          <div className="min-w-0 space-y-2">
            {hasMap ? (
              <ZoneMap zones={areas} selected={selected} onSelect={(c) => setSelected((cur) => (cur === c ? "" : c))} />
            ) : (
              <div className="flex h-[300px] items-center justify-center rounded-xl border border-border bg-surface px-6 text-center text-sm text-muted">
                {ps?.status === "downloading"
                  ? `Baixando do TSE o cadastro dos locais de votação (${formatInt(ps.downloadedMb)} MB)… Isso acontece só uma vez.`
                  : ps?.status === "reading"
                    ? "Lendo o cadastro dos locais de votação…"
                    : ps?.status === "error"
                      ? `Não foi possível montar o mapa: ${ps.message}`
                      : "Preparando o mapa…"}
              </div>
            )}
            {hasMap && range.length > 0 && (
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
                <span>Menos abstenção ({formatPct(Math.min(...range))})</span>
                <span className="flex overflow-hidden rounded">
                  {COLORS.map((c) => (
                    <span key={c} className="h-3 w-8" style={{ background: c }} />
                  ))}
                </span>
                <span>Mais abstenção ({formatPct(Math.max(...range))})</span>
                <span>· Cada área liga os locais de votação da zona; os pontos brancos são os locais.</span>
              </div>
            )}
          </div>

          <div className="space-y-3">
            <div className="overflow-hidden rounded-xl border border-border bg-surface">
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-muted">
                  <tr className="border-b border-border">
                    <th className="px-3 py-2">Zona</th>
                    <th className="px-3 py-2 text-right">Abstenções</th>
                    <th className="px-3 py-2 text-right">%</th>
                  </tr>
                </thead>
                <tbody>
                  {zones.map((z) => (
                    <tr
                      key={z.code}
                      onClick={() => setSelected((cur) => (cur === z.code ? "" : z.code))}
                      className={`cursor-pointer border-b border-border last:border-0 hover:bg-accent/5 ${selected === z.code ? "bg-accent/10" : ""}`}
                      title="Clique para destacar a zona no mapa"
                    >
                      <td className="px-3 py-2">
                        <span className="mr-2 inline-block h-3 w-3 rounded-sm align-middle" style={{ background: z.color }} />
                        <span className="font-medium">Zona {z.label}</span>
                        <div className="text-xs text-muted">
                          {formatInt(z.electorate)} aptos · {z.read < z.sections ? `${formatInt(z.read)} de ` : ""}
                          {formatInt(z.sections)} seções
                        </div>
                      </td>
                      <td className="px-3 py-2 text-right font-semibold">{formatInt(z.abstention)}</td>
                      <td className="px-3 py-2 text-right font-semibold">{z.read > 0 ? formatPct(z.abstentionPct) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {zone && zone.places.length > 0 && (
              <div className="rounded-xl border border-border bg-surface p-3 text-sm">
                <div className="mb-2 font-semibold">Locais da zona {zone.label} com mais abstenção</div>
                <ol className="space-y-1.5">
                  {[...zone.places]
                    .filter((pl) => pl.read > 0)
                    .sort((a, b) => b.abstentionPct - a.abstentionPct)
                    .slice(0, 8)
                    .map((pl) => (
                      <li key={pl.code} className="flex justify-between gap-2">
                        <span className="min-w-0">
                          <span className="block truncate">{pl.name}</span>
                          {pl.bairro && <span className="block truncate text-xs text-muted">{pl.bairro}</span>}
                        </span>
                        <span className="shrink-0 font-semibold">{formatPct(pl.abstentionPct)}</span>
                      </li>
                    ))}
                </ol>
                <p className="mt-2 text-xs text-muted">{zone.places.length} locais de votação nesta zona.</p>
              </div>
            )}
          </div>
        </div>
      )}

      <p className="text-xs text-muted">
        Abstenção = eleitores aptos que não compareceram (&quot;eleitores faltosos&quot; no boletim de urna). A Justiça Eleitoral não
        publica o desenho oficial das zonas: a área de cada zona no mapa é traçada a partir dos endereços dos seus locais de
        votação (cadastro do TSE).
      </p>
      {data && (data.sample.aux || data.sample.bu || ps?.source) && (
        <details className="text-[10px] text-muted">
          <summary className="cursor-pointer">Detalhes dos arquivos do TSE (diagnóstico)</summary>
          <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap">
            {`pleito: ${data.pleito ?? "?"}\nlocais de votação: ${ps?.status} · ${ps?.count ?? 0} seções · ${ps?.source ?? ""}\nauxiliar: ${JSON.stringify(data.sample.aux)}\n\n${data.sample.bu ?? ""}`}
          </pre>
        </details>
      )}
    </section>
  );
}
