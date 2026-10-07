"use client";

import { useEffect, useRef } from "react";
import "leaflet/dist/leaflet.css";

export interface PlacePoint {
  key: string;
  lat: number;
  lon: number;
  value: number;
  /** Texto do balão (HTML já escapado). */
  html: string;
  highlighted?: boolean;
}

/** Mapa da cidade com um círculo por local de votação, de tamanho proporcional ao valor (votos). */
export function PlacesMap({ points, outline, color = "#2563eb" }: { points: PlacePoint[]; outline: string; color?: string }) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<import("leaflet").Map | null>(null);
  const layer = useRef<import("leaflet").LayerGroup | null>(null);
  const fitted = useRef(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const L = (await import("leaflet")).default;
      if (cancelled || !el.current || map.current) return;
      const m = L.map(el.current, { scrollWheelZoom: false, zoomSnap: 0.5 }).setView([-23.2, -45.88], 11);
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 18,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> · IBGE · TSE',
      }).addTo(m);
      const shape = await fetch(outline).then((r) => r.json()).catch(() => null);
      if (shape && !cancelled) L.geoJSON(shape, { style: { color: "#334155", weight: 2, fill: false, dashArray: "4 4" }, interactive: false }).addTo(m);
      layer.current = L.layerGroup().addTo(m);
      map.current = m;
      el.current.dispatchEvent(new Event("map-ready"));
    })();
    return () => {
      cancelled = true;
      map.current?.remove();
      map.current = null;
    };
  }, [outline]);

  useEffect(() => {
    const draw = async () => {
      const L = (await import("leaflet")).default;
      const m = map.current;
      const group = layer.current;
      if (!m || !group) return;
      group.clearLayers();
      const max = Math.max(1, ...points.map((p) => p.value));
      const bounds = L.latLngBounds([]);
      const anyHighlight = points.some((p) => p.highlighted);
      // Menores por cima, para não sumirem atrás dos maiores.
      for (const p of [...points].sort((a, b) => b.value - a.value)) {
        bounds.extend([p.lat, p.lon]);
        const dim = anyHighlight && !p.highlighted;
        L.circleMarker([p.lat, p.lon], {
          radius: p.value > 0 ? 3 + 15 * Math.sqrt(p.value / max) : 2.5,
          color: p.highlighted ? "#0f172a" : p.value > 0 ? color : "#94a3b8",
          weight: p.highlighted ? 2 : 1,
          fillColor: p.value > 0 ? color : "#cbd5e1",
          fillOpacity: dim ? 0.12 : p.value > 0 ? 0.55 : 0.5,
          opacity: dim ? 0.3 : 1,
        })
          .bindTooltip(p.html)
          .addTo(group);
      }
      if (!fitted.current && bounds.isValid()) {
        m.fitBounds(bounds.pad(0.05));
        fitted.current = true;
      }
    };
    void draw();
    const node = el.current;
    node?.addEventListener("map-ready", draw);
    return () => node?.removeEventListener("map-ready", draw);
  }, [points, color]);

  return <div ref={el} className="h-[380px] w-full overflow-hidden rounded-xl border border-border sm:h-[480px]" role="img" aria-label="Mapa dos locais de votação" />;
}
