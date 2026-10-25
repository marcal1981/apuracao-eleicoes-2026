"use client";

import { useEffect, useRef } from "react";
import "leaflet/dist/leaflet.css";

export interface UfShade {
  uf: string;
  /** Cor de preenchimento; null = ainda sem urnas apuradas (cinza). */
  fill: string | null;
  opacity: number;
  /** Texto do balão (HTML já escapado). */
  html: string;
}

/** Mapa do Brasil por UF (contornos do IBGE), com cor e balão por estado. Clicar escolhe a UF. */
export function UfMap({ shades, onPick }: { shades: UfShade[]; onPick?: (uf: string) => void }) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<import("leaflet").Map | null>(null);
  const layer = useRef<import("leaflet").GeoJSON | null>(null);
  const latest = useRef({ shades, onPick });
  latest.current = { shades, onPick };

  const paint = () => {
    const byUf = new Map(latest.current.shades.map((s) => [s.uf, s]));
    layer.current?.eachLayer((l) => {
      const path = l as import("leaflet").Path & { feature?: { properties: { uf: string; name: string } } };
      const uf = path.feature?.properties.uf ?? "";
      const s = byUf.get(uf);
      path.setStyle({
        fillColor: s?.fill ?? "#cbd5e1",
        fillOpacity: s?.fill ? s.opacity : 0.35,
        color: "#ffffff",
        weight: 1,
      });
      path.unbindTooltip();
      path.bindTooltip(s?.html ?? `<strong>${path.feature?.properties.name ?? uf}</strong><br>Sem urnas apuradas`, { sticky: true });
    });
  };

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const L = (await import("leaflet")).default;
      if (cancelled || !el.current || map.current) return;
      const m = L.map(el.current, { scrollWheelZoom: false, zoomSnap: 0.25, attributionControl: true }).setView([-14.5, -52], 4);
      m.attributionControl.addAttribution("IBGE · TSE");
      const shape = await fetch("/maps/brasil-ufs.json").then((r) => r.json()).catch(() => null);
      if (cancelled || !shape) return;
      layer.current = L.geoJSON(shape, {
        onEachFeature: (f, l) => {
          l.on("click", () => latest.current.onPick?.((f.properties as { uf: string }).uf));
          l.on("mouseover", () => (l as import("leaflet").Path).setStyle({ weight: 2.5, color: "#0f172a" }));
          l.on("mouseout", () => (l as import("leaflet").Path).setStyle({ weight: 1, color: "#ffffff" }));
        },
      }).addTo(m);
      m.fitBounds(layer.current.getBounds(), { padding: [4, 4] });
      map.current = m;
      paint();
    })();
    return () => {
      cancelled = true;
      map.current?.remove();
      map.current = null;
      layer.current = null;
    };
  }, []);

  useEffect(paint, [shades]);

  return <div ref={el} className="h-[380px] w-full overflow-hidden rounded-xl border border-border sm:h-[480px]" style={{ background: "var(--surface)" }} role="img" aria-label="Mapa do Brasil por estado" />;
}
