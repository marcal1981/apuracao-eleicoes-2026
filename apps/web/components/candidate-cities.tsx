"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { formatInt, formatPct, formatTimeBrasilia } from "@apuracao/core";
import { useLive } from "./use-live";
import { binColor } from "./map-scale";

interface CityVotes {
  ibge: string;
  name: string;
  votes: number;
  share: number;
  sectionsTotalizedPct: number;
}
interface Snapshot {
  updatedAt: string | null;
  citiesRead: number;
  citiesTotal: number;
  progress: { running: boolean; done: number; total: number; failures: number; lastError: string | null };
  candidates: { id: string; name: string; number: string; total: number; cities: CityVotes[] }[];
}
interface Shapes {
  viewBox: string;
  municipalities: { ibge: string; name: string; d: string }[];
}

/** Faixas relativas ao município onde o candidato foi mais votado. */
const RATIO_BINS = [
  { min: 0.5, mix: 100 },
  { min: 0.25, mix: 78 },
  { min: 0.1, mix: 58 },
  { min: 0.03, mix: 40 },
  { min: 0, mix: 24 },
];

const PAGE = 20;

/** Votos de um candidato em destaque em cada município: mapa, lista e planilha (CSV). */
export function CandidateCities({
  uf,
  office,
  candidateId,
  candidateNumber,
}: {
  uf: string;
  office: string;
  candidateId: string;
  candidateNumber: string;
}) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<Snapshot | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [shapes, setShapes] = useState<Shapes | null>(null);
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(PAGE);
  const [hover, setHover] = useState<string | null>(null);
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    const r = await fetch(`/api/v1/states/${uf}/candidate-cities?office=${office}`, { cache: "no-store" });
    if (r.status === 404) return setUnavailable(true);
    if (r.ok) setData((await r.json()) as Snapshot);
  }, [uf, office]);

  useEffect(() => {
    if (!open) return;
    load().catch(() => {});
    if (!shapes) fetch(`/maps/${uf}-municipios.json`).then((r) => r.json()).then(setShapes).catch(() => {});
  }, [open, load, shapes, uf]);

  // Enquanto a leitura das cidades está em andamento, atualiza a cada 8 s mesmo sem aviso em tempo real.
  const reading =
    !!data &&
    (data.progress.running ||
      !data.candidates.some((c) => c.id === candidateId || (!!candidateNumber && c.number === candidateNumber)));
  useEffect(() => {
    if (!open || !reading) return;
    const id = setInterval(() => load().catch(() => {}), 8_000);
    return () => clearInterval(id);
  }, [open, reading, load]);

  useLive((event) => {
    if (!open || event.type !== "municipal_update" || event.office !== office) return;
    if (pending.current) return;
    pending.current = setTimeout(() => {
      pending.current = null;
      load().catch(() => {});
    }, 1500);
  });

  const candidate = data?.candidates.find((c) => c.id === candidateId || (!!candidateNumber && c.number === candidateNumber));
  const byIbge = useMemo(() => new Map(candidate?.cities.map((c) => [c.ibge, c])), [candidate]);
  const max = candidate?.cities[0]?.votes ?? 0;
  const withVotes = candidate?.cities.filter((c) => c.votes > 0).length ?? 0;
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (candidate?.cities ?? []).filter((c) => !q || c.name.toLowerCase().includes(q));
  }, [candidate, query]);

  const fill = (votes: number | undefined) => {
    if (!votes || !max) return "var(--map-empty)";
    const bin = RATIO_BINS.find((b) => votes / max >= b.min)!;
    return binColor(bin.mix);
  };

  const downloadCsv = () => {
    if (!candidate) return;
    const rows = [
      ["Município", "Código IBGE", "Votos", "% dos válidos no município", "% seções totalizadas"],
      ...candidate.cities.map((c) => [c.name, c.ibge, String(c.votes), String(c.share).replace(".", ","), String(c.sectionsTotalizedPct).replace(".", ",")]),
    ];
    const csv = "﻿" + rows.map((r) => r.map((v) => `"${v.replace(/"/g, '""')}"`).join(";")).join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `votos-por-cidade-${candidate.name.toLowerCase().replace(/[^a-z0-9]+/gi, "-")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (unavailable)
    return (
      <p className="mt-3 border-t border-border pt-3 text-xs text-muted">
        Votos por cidade indisponíveis para esta disputa (só para Deputados de SP em destaque).
      </p>
    );

  const hovered = hover ? byIbge.get(hover) : undefined;

  return (
    <div className="mt-3 border-t border-border pt-3">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="text-sm font-semibold text-accent hover:underline"
      >
        {open ? "▾" : "▸"} Votos por cidade
      </button>

      {open && (
        <div className="mt-3 space-y-3">
          {!data ? (
            <p className="text-sm text-muted">Carregando…</p>
          ) : !candidate ? (
            <ReadingProgress data={data} />
          ) : (
            <>
              {data.progress.running && <ReadingProgress data={data} compact />}
              <p className="text-xs text-muted">
                Votos em {withVotes} de {data.citiesTotal} cidades · soma {formatInt(candidate.total)} ·{" "}
                {data.citiesRead < data.citiesTotal && `${data.citiesRead} cidades lidas até agora · `}
                atualizado {formatTimeBrasilia(data.updatedAt)}
              </p>

              <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                <div className="relative">
                  {shapes && (
                    <svg viewBox={shapes.viewBox} className="h-auto w-full" role="img" aria-label={`Votos de ${candidate.name} por município`}>
                      {shapes.municipalities.map((m) => (
                        <path
                          key={m.ibge}
                          d={m.d}
                          fill={fill(byIbge.get(m.ibge)?.votes)}
                          stroke="var(--surface)"
                          strokeWidth={hover === m.ibge ? 1.5 : 0.3}
                          onMouseEnter={() => setHover(m.ibge)}
                          onClick={() => setHover(m.ibge)}
                        >
                          <title>
                            {m.name}: {formatInt(byIbge.get(m.ibge)?.votes ?? 0)} votos
                          </title>
                        </path>
                      ))}
                    </svg>
                  )}
                  <div className="mt-1 min-h-5 text-xs" aria-live="polite">
                    {hovered ? (
                      <>
                        <strong>{hovered.name}</strong>: {formatInt(hovered.votes)} votos ({formatPct(hovered.share)} dos válidos)
                      </>
                    ) : (
                      <span className="text-muted">Quanto mais escuro, mais votos. Toque numa cidade para ver o número.</span>
                    )}
                  </div>
                </div>

                <div>
                  <div className="flex gap-2">
                    <input
                      type="search"
                      value={query}
                      onChange={(e) => {
                        setQuery(e.target.value);
                        setLimit(PAGE);
                      }}
                      placeholder="Buscar cidade"
                      className="min-w-0 flex-1 rounded-lg border border-border bg-surface px-3 py-1.5 text-sm"
                    />
                    <button
                      type="button"
                      onClick={downloadCsv}
                      className="rounded-lg border border-border px-3 py-1.5 text-sm hover:border-accent hover:text-accent"
                    >
                      Planilha
                    </button>
                  </div>
                  <table className="mt-2 w-full text-sm">
                    <thead className="text-left text-xs text-muted">
                      <tr className="border-b border-border">
                        <th className="py-1">Cidade</th>
                        <th className="py-1 text-right">Votos</th>
                        <th className="py-1 text-right">% válidos</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.slice(0, limit).map((c) => (
                        <tr key={c.ibge} className="border-b border-border last:border-0" onMouseEnter={() => setHover(c.ibge)}>
                          <td className="py-1">{c.name}</td>
                          <td className="py-1 text-right font-semibold">{formatInt(c.votes)}</td>
                          <td className="py-1 text-right text-muted">{formatPct(c.share)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {filtered.length > limit && (
                    <button
                      type="button"
                      onClick={() => setLimit((l) => l + PAGE * 5)}
                      className="mt-2 w-full rounded-lg border border-border py-1.5 text-sm hover:border-accent"
                    >
                      Mostrar mais ({filtered.length - limit} cidades)
                    </button>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** Barra de progresso da leitura dos arquivos municipais do TSE. */
function ReadingProgress({ data, compact = false }: { data: Snapshot; compact?: boolean }) {
  const { running, done, total, failures, lastError } = data.progress;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  return (
    <div className="space-y-1 text-xs text-muted">
      {running ? (
        <>
          <div>
            Lendo os arquivos das cidades no TSE: {done} de {total} ({pct}%)
            {failures > 0 && ` · ${failures} com falha`}
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-border">
            <div className="h-full bg-accent transition-[width]" style={{ width: `${pct}%` }} />
          </div>
        </>
      ) : (
        !compact && (
          <div>
            {data.citiesRead === 0
              ? "Aguardando a primeira leitura das cidades (começa poucos segundos após iniciar o sistema)."
              : "Candidato ainda não encontrado nos arquivos das cidades lidas."}
          </div>
        )
      )}
      {!compact && lastError && <div>Último problema: {lastError}</div>}
      {!compact && (
        <a href="/status#cidades" className="text-accent underline">
          Diagnosticar a leitura das cidades
        </a>
      )}
    </div>
  );
}
