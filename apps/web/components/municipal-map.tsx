"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { findState, formatPct, formatTimeBrasilia } from "@apuracao/core";
import { useLive } from "./use-live";
import { BINS, binColor, fillFor } from "./map-scale";

interface Shape {
  ibge: string;
  name: string;
  d: string;
}
interface Status {
  ibge: string;
  name: string;
  sectionsTotalizedPct: number;
  status: string;
  officialTimestamp: string | null;
}
interface Snapshot {
  matched: number;
  total: number;
  updatedAt: string | null;
  municipalities: Status[];
}

const ZOOMS = [1, 1.5, 2, 3, 4];

/**
 * Mapa municipal do andamento da totalização. O percentual de seções totalizadas de um município
 * vale para todos os cargos da urna (Governador, Senador, Deputados Federal e Estadual).
 */
export function MunicipalMap({ uf }: { uf: string }) {
  const [shapes, setShapes] = useState<{ viewBox: string; municipalities: Shape[] } | null>(null);
  const [data, setData] = useState<Snapshot | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [zoom, setZoom] = useState(0);
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const stateName = findState(uf)?.name ?? uf.toUpperCase();

  useEffect(() => {
    fetch(`/maps/${uf}-municipios.json`)
      .then((r) => r.json())
      .then(setShapes)
      .catch(() => {});
  }, [uf]);

  const load = useCallback(async () => {
    const r = await fetch(`/api/v1/states/${uf}/municipalities`, { cache: "no-store" });
    if (r.ok) setData((await r.json()) as Snapshot);
  }, [uf]);

  useEffect(() => {
    load().catch(() => {});
  }, [load]);

  useLive((event) => {
    if (event.type !== "municipal_update" || event.state?.toLowerCase() !== uf) return;
    if (pending.current) return;
    pending.current = setTimeout(() => {
      pending.current = null;
      load().catch(() => {});
    }, 1000);
  });

  const byIbge = useMemo(() => new Map(data?.municipalities.map((m) => [m.ibge, m])), [data]);
  const counts = useMemo(() => {
    const list = data?.municipalities ?? [];
    const done = list.filter((m) => m.sectionsTotalizedPct >= 100).length;
    const started = list.filter((m) => m.sectionsTotalizedPct > 0).length;
    return { done, inProgress: started - done, waiting: list.length - started, total: list.length };
  }, [data]);

  const names = useMemo(() => shapes?.municipalities.map((m) => m.name) ?? [], [shapes]);
  const selectByName = (name: string) => {
    setQuery(name);
    const found = shapes?.municipalities.find((m) => m.name.toLowerCase() === name.trim().toLowerCase());
    if (found) setSelected(found.ibge);
  };

  // Ao aproximar, mantém o município selecionado visível.
  useEffect(() => {
    if (!selected || !scroller.current) return;
    const el = scroller.current.querySelector<SVGPathElement>(`path[data-ibge="${selected}"]`);
    const box = el?.getBoundingClientRect();
    const host = scroller.current.getBoundingClientRect();
    if (box && (box.left < host.left || box.right > host.right || box.top < host.top || box.bottom > host.bottom)) {
      scroller.current.scrollBy({
        left: box.left - host.left - host.width / 2 + box.width / 2,
        top: box.top - host.top - host.height / 2 + box.height / 2,
        behavior: "smooth",
      });
    }
  }, [selected, zoom]);

  const sel = selected ? byIbge.get(selected) : undefined;
  const selName = selected ? shapes?.municipalities.find((m) => m.ibge === selected)?.name : undefined;

  return (
    <section className="rounded-xl border border-border bg-surface p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="font-semibold">Apuração por município — {stateName}</h2>
          <p className="text-xs text-muted">
            Seções totalizadas em cada município. Vale para todos os cargos (a urna é totalizada de uma vez).
          </p>
        </div>
        <div className="flex items-center gap-1" role="group" aria-label="Zoom">
          <button
            onClick={() => setZoom((z) => Math.max(0, z - 1))}
            disabled={zoom === 0}
            className="h-8 w-8 rounded-lg border border-border text-lg leading-none disabled:opacity-40"
            aria-label="Afastar"
          >
            −
          </button>
          <button
            onClick={() => setZoom((z) => Math.min(ZOOMS.length - 1, z + 1))}
            disabled={zoom === ZOOMS.length - 1}
            className="h-8 w-8 rounded-lg border border-border text-lg leading-none disabled:opacity-40"
            aria-label="Aproximar"
          >
            +
          </button>
        </div>
      </div>

      <div className="mt-3 grid gap-4 md:grid-cols-[minmax(0,1fr)_240px]">
        <div ref={scroller} className="max-h-[70vh] overflow-auto rounded-lg">
          {shapes ? (
            <svg
              viewBox={shapes.viewBox}
              style={{ width: `${ZOOMS[zoom]! * 100}%` }}
              className="h-auto"
              role="img"
              aria-label={`Mapa dos municípios de ${stateName} por andamento da apuração`}
            >
              {shapes.municipalities.map((m) => (
                <path
                  key={m.ibge}
                  data-ibge={m.ibge}
                  d={m.d}
                  fill={fillFor(byIbge.get(m.ibge)?.sectionsTotalizedPct)}
                  stroke={selected === m.ibge ? "var(--text)" : "var(--surface)"}
                  strokeWidth={selected === m.ibge ? 2 : 0.4}
                  className="cursor-pointer transition-[fill] duration-700"
                  onMouseEnter={() => setSelected(m.ibge)}
                  onClick={() => setSelected(m.ibge)}
                >
                  <title>{m.name}</title>
                </path>
              ))}
              {selected && shapes.municipalities.find((m) => m.ibge === selected) && (
                // Redesenha o selecionado por cima para o contorno não ficar escondido pelos vizinhos.
                <path
                  d={shapes.municipalities.find((m) => m.ibge === selected)!.d}
                  fill="none"
                  stroke="var(--text)"
                  strokeWidth={2}
                  className="pointer-events-none"
                />
              )}
            </svg>
          ) : (
            <div className="flex h-64 items-center justify-center text-sm text-muted">Carregando mapa…</div>
          )}
        </div>

        <div className="space-y-3 text-sm">
          <div>
            <label htmlFor={`busca-${uf}`} className="sr-only">
              Buscar município
            </label>
            <input
              id={`busca-${uf}`}
              list={`municipios-${uf}`}
              value={query}
              onChange={(e) => selectByName(e.target.value)}
              placeholder="Buscar município"
              className="w-full rounded-lg border border-border bg-surface px-3 py-2"
            />
            <datalist id={`municipios-${uf}`}>
              {names.map((n) => (
                <option key={n} value={n} />
              ))}
            </datalist>
          </div>

          <div className="rounded-lg border border-border p-3" aria-live="polite">
            {selected ? (
              <>
                <div className="font-semibold">{selName}</div>
                <div className="text-2xl font-bold">{formatPct(sel?.sectionsTotalizedPct ?? 0)}</div>
                <div className="text-xs text-muted">
                  seções totalizadas
                  {sel?.officialTimestamp ? ` · ${formatTimeBrasilia(sel.officialTimestamp)}` : ""}
                </div>
              </>
            ) : (
              <div className="text-xs text-muted">Passe o mouse, toque ou busque um município.</div>
            )}
          </div>

          <dl className="grid grid-cols-3 gap-2 text-center">
            <div className="rounded-lg border border-border p-2">
              <dt className="text-[11px] text-muted">Concluídos</dt>
              <dd className="font-bold">{counts.done}</dd>
            </div>
            <div className="rounded-lg border border-border p-2">
              <dt className="text-[11px] text-muted">Apurando</dt>
              <dd className="font-bold">{counts.inProgress}</dd>
            </div>
            <div className="rounded-lg border border-border p-2">
              <dt className="text-[11px] text-muted">Aguardando</dt>
              <dd className="font-bold">{counts.waiting}</dd>
            </div>
          </dl>

          <ul className="space-y-1 text-xs" aria-label="Legenda">
            {BINS.map((b) => (
              <li key={b.label} className="flex items-center gap-2">
                <span className="h-3 w-5 rounded-sm" style={{ background: binColor(b.mix) }} />
                {b.label}
              </li>
            ))}
            <li className="flex items-center gap-2">
              <span className="h-3 w-5 rounded-sm border border-border" style={{ background: "var(--map-empty)" }} />
              Não iniciada
            </li>
          </ul>
          {data && data.matched < data.total && (
            <p className="text-xs text-muted">
              {data.matched === 0
                ? "Aguardando a lista oficial de municípios do TSE."
                : `${data.total - data.matched} municípios sem correspondência na lista do TSE.`}
            </p>
          )}
        </div>
      </div>

      <p className="mt-2 text-[10px] text-muted">
        Malha municipal: IBGE (via geodata-br, CC0). Atualização a cada minuto; mostra só o andamento, não quem está à frente.
      </p>
    </section>
  );
}
