"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import brazilMap from "@svg-maps/brazil";
import { STATES, formatPct, formatTimeBrasilia } from "@apuracao/core";
import type { RaceSummary } from "@/lib/api-types";
import { useLive } from "./use-live";
import { BINS, binColor, fillFor } from "./map-scale";

interface MapLocation {
  id: string;
  name: string;
  path: string;
}
const MAP = brazilMap as unknown as { viewBox: string; locations: MapLocation[] };

const OFFICE_OPTIONS = [
  { key: "presidente", label: "Presidente" },
  { key: "governador", label: "Governador" },
  { key: "senador", label: "Senador" },
  { key: "deputado-federal", label: "Dep. Federal" },
  { key: "deputado-estadual", label: "Dep. Estadual" },
] as const;

const pageFor = (office: string, uf: string) => {
  if (office === "deputado-estadual" && uf === "df") return "/eleicoes/2026/deputado-distrital/df";
  return `/eleicoes/2026/${office}/${uf}`;
};

/**
 * Mapa do Brasil com o percentual de seções totalizadas por UF.
 * Mostra apenas o andamento da totalização oficial; não indica vencedores.
 */
export function TotalizationMap({ initialOffice = "presidente" }: { initialOffice?: string }) {
  const router = useRouter();
  const [office, setOffice] = useState(initialOffice);
  const [races, setRaces] = useState<Map<string, RaceSummary>>(new Map());
  const [hover, setHover] = useState<string | null>(null);
  const [centers, setCenters] = useState<Record<string, { x: number; y: number }>>({});
  const pathRefs = useRef<Record<string, SVGPathElement | null>>({});
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    const offices = office === "deputado-estadual" ? ["deputado-estadual", "deputado-distrital"] : [office];
    const lists = await Promise.all(
      offices.map((o) =>
        fetch(`/api/v1/races?office=${o}`, { cache: "no-store" })
          .then((r) => r.json() as Promise<{ races: RaceSummary[] }>)
          .then((d) => d.races),
      ),
    );
    setRaces(new Map(lists.flat().filter((r) => r.scope !== "br").map((r) => [r.scope, r])));
  }, [office]);

  useEffect(() => {
    load().catch(() => {});
  }, [load]);

  // Várias UFs atualizam juntas: agrupa os avisos e recarrega uma vez.
  useLive((event) => {
    if (event.type !== "result_update") return;
    if (pending.current) return;
    pending.current = setTimeout(() => {
      pending.current = null;
      load().catch(() => {});
    }, 1500);
  });

  useEffect(() => {
    const next: Record<string, { x: number; y: number }> = {};
    for (const loc of MAP.locations) {
      const box = pathRefs.current[loc.id]?.getBBox();
      if (box) next[loc.id] = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    }
    setCenters(next);
  }, []);

  const all = STATES.map((s) => races.get(s.uf.toLowerCase())?.sectionsTotalizedPct ?? 0);
  const finished = all.filter((p) => p >= 100).length;
  const started = all.filter((p) => p > 0).length;
  const hovered = hover ? races.get(hover) : undefined;
  const hoveredName = hover ? STATES.find((s) => s.uf.toLowerCase() === hover)?.name : undefined;

  return (
    <section className="rounded-xl border border-border bg-surface p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="font-semibold">Mapa da apuração</h2>
          <p className="text-xs text-muted">Percentual de seções totalizadas pelo TSE em cada estado.</p>
        </div>
        <label className="text-sm">
          <span className="sr-only">Cargo</span>
          <select
            value={office}
            onChange={(e) => setOffice(e.target.value)}
            className="rounded-lg border border-border bg-surface px-2 py-1"
          >
            {OFFICE_OPTIONS.map((o) => (
              <option key={o.key} value={o.key}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="mt-3 grid gap-4 md:grid-cols-[minmax(0,560px)_220px] md:justify-between">
        <div className="relative">
          <svg viewBox={MAP.viewBox} className="h-auto w-full" role="img" aria-label="Mapa do Brasil por andamento da apuração">
            {MAP.locations.map((loc) => {
              const race = races.get(loc.id);
              const pct = race?.sectionsTotalizedPct;
              return (
                <path
                  key={loc.id}
                  ref={(el) => {
                    pathRefs.current[loc.id] = el;
                  }}
                  d={loc.path}
                  fill={fillFor(pct)}
                  stroke="var(--surface)"
                  strokeWidth={hover === loc.id ? 2.5 : 1}
                  className="cursor-pointer transition-[fill] duration-700 hover:opacity-80"
                  onMouseEnter={() => setHover(loc.id)}
                  onMouseLeave={() => setHover((h) => (h === loc.id ? null : h))}
                  onFocus={() => setHover(loc.id)}
                  onClick={() => router.push(pageFor(office, loc.id))}
                  tabIndex={0}
                  role="link"
                  aria-label={`${loc.name}: ${pct ? formatPct(pct) : "apuração não iniciada"}`}
                  onKeyDown={(e) => e.key === "Enter" && router.push(pageFor(office, loc.id))}
                />
              );
            })}
            {MAP.locations.map((loc) => {
              const c = centers[loc.id];
              if (!c || loc.id === "df") return null;
              const pct = races.get(loc.id)?.sectionsTotalizedPct ?? 0;
              return (
                <text
                  key={`t-${loc.id}`}
                  x={c.x}
                  y={c.y}
                  textAnchor="middle"
                  dominantBaseline="central"
                  className="pointer-events-none select-none font-semibold"
                  fontSize={11}
                  fill={pct >= 50 ? "var(--surface)" : "var(--text)"}
                >
                  {loc.id.toUpperCase()}
                </text>
              );
            })}
          </svg>
        </div>

        <div className="space-y-3 text-sm">
          <div className="rounded-lg border border-border p-3" aria-live="polite">
            {hover ? (
              <>
                <div className="font-semibold">{hoveredName}</div>
                <div className="text-2xl font-bold">{formatPct(hovered?.sectionsTotalizedPct ?? 0)}</div>
                <div className="text-xs text-muted">
                  seções totalizadas
                  {hovered?.officialTimestamp ? ` · ${formatTimeBrasilia(hovered.officialTimestamp)}` : ""}
                </div>
                <div className="mt-1 text-xs text-muted">Toque/clique para ver os resultados</div>
              </>
            ) : (
              <>
                <div className="text-2xl font-bold">
                  {finished}/27 <span className="text-sm font-normal text-muted">concluídos</span>
                </div>
                <div className="text-xs text-muted">
                  {started} com apuração iniciada · {27 - started} aguardando
                </div>
              </>
            )}
          </div>

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
        </div>
      </div>

      <p className="mt-2 text-[10px] text-muted">
        O mapa mostra só o andamento da totalização, não quem está à frente. Mapa: @svg-maps/brazil (CC BY 4.0).
      </p>
    </section>
  );
}
