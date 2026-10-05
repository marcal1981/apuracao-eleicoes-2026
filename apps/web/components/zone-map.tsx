"use client";

import { useEffect, useRef } from "react";
import "leaflet/dist/leaflet.css";
import { formatInt, formatPct } from "@apuracao/core";

export interface ZoneArea {
  code: string;
  label: string;
  color: string;
  abstention: number;
  abstentionPct: number;
  electorate: number;
  read: number;
  sections: number;
  /** Locais de votação da zona, com coordenadas. */
  points: { lat: number; lon: number; name: string; bairro: string }[];
}

/** Fecho convexo (cadeia monótona) dos pontos, em [lat, lon]. */
function hull(points: [number, number][]): [number, number][] {
  const pts = [...new Map(points.map((p) => [p.join(","), p])).values()].sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  if (pts.length < 3) return pts;
  const cross = (o: [number, number], a: [number, number], b: [number, number]) =>
    (a[1] - o[1]) * (b[0] - o[0]) - (a[0] - o[0]) * (b[1] - o[1]);
  const lower: [number, number][] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: [number, number][] = [];
  for (const p of [...pts].reverse()) {
    while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, p) <= 0) upper.pop();
    upper.push(p);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

/** Pontos da zona sem os muito distantes do centro (mais de 3× a distância mediana e mais de ~4 km). */
function core(points: [number, number][]): [number, number][] {
  if (points.length < 5) return points;
  const mid = (vals: number[]) => [...vals].sort((a, b) => a - b)[Math.floor(vals.length / 2)]!;
  const c: [number, number] = [mid(points.map((p) => p[0])), mid(points.map((p) => p[1]))];
  const k = Math.cos((c[0] * Math.PI) / 180);
  const dist = (p: [number, number]) => Math.hypot(p[0] - c[0], (p[1] - c[1]) * k);
  const limit = Math.max(3 * mid(points.map(dist)), 0.036);
  const kept = points.filter((p) => dist(p) <= limit);
  return kept.length >= 3 ? kept : points;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/** Mapa da cidade com a área de cada zona eleitoral (formada pelos locais de votação dela). */
export function ZoneMap({
  zones,
  selected,
  onSelect,
}: {
  zones: ZoneArea[];
  selected: string;
  onSelect: (code: string) => void;
}) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<import("leaflet").Map | null>(null);
  const layer = useRef<import("leaflet").LayerGroup | null>(null);
  const fitted = useRef(false);
  const select = useRef(onSelect);
  select.current = onSelect;

  // Cria o mapa uma vez: ruas do OpenStreetMap + contorno do município (IBGE).
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
      const outline = await fetch("/maps/sao-jose-dos-campos.json").then((r) => r.json()).catch(() => null);
      if (outline && !cancelled) L.geoJSON(outline, { style: { color: "#334155", weight: 2, fill: false, dashArray: "4 4" }, interactive: false }).addTo(m);
      layer.current = L.layerGroup().addTo(m);
      map.current = m;
      el.current.dispatchEvent(new Event("map-ready"));
    })();
    return () => {
      cancelled = true;
      map.current?.remove();
      map.current = null;
    };
  }, []);

  // Desenha as zonas sempre que os dados ou a seleção mudam.
  useEffect(() => {
    const draw = async () => {
      const L = (await import("leaflet")).default;
      const m = map.current;
      const group = layer.current;
      if (!m || !group) return;
      group.clearLayers();
      const bounds = L.latLngBounds([]);
      for (const z of zones) {
        if (z.points.length === 0) continue;
        const dim = selected && selected !== z.code;
        const active = selected === z.code;
        const latlngs = z.points.map((p) => [p.lat, p.lon] as [number, number]);
        latlngs.forEach((p) => bounds.extend(p));
        // Locais muito afastados (ex.: distrito de São Francisco Xavier) ficam fora da área, só como ponto,
        // para a zona não virar um triângulo enorme sobre a zona rural.
        const ring = hull(core(latlngs));
        const style = {
          color: active ? "#0f172a" : z.color,
          weight: active ? 3 : 2,
          fillColor: z.color,
          fillOpacity: dim ? 0.08 : 0.45,
          opacity: dim ? 0.3 : 1,
        };
        const popup =
          `<strong>Zona ${esc(z.label)}</strong><br>Abstenção: <strong>${formatPct(z.abstentionPct)}</strong>` +
          `<br>${formatInt(z.abstention)} de ${formatInt(z.electorate)} eleitores<br>${z.points.length} locais de votação`;
        const shape = ring.length >= 3 ? L.polygon(ring, style) : L.circle(ring[0] ?? latlngs[0]!, { ...style, radius: 600 });
        shape.bindPopup(popup).on("click", () => select.current(z.code)).addTo(group);
        // Locais de votação (pontos pequenos) e o rótulo da zona no centro.
        if (!dim) {
          for (const p of z.points) {
            L.circleMarker([p.lat, p.lon], { radius: 3, color: "#0f172a", weight: 1, fillColor: "#fff", fillOpacity: 1 })
              .bindTooltip(`${esc(p.name)}${p.bairro ? ` · ${esc(p.bairro)}` : ""}`)
              .addTo(group);
          }
        }
        const inner = core(latlngs);
        const c = inner.reduce((a, p) => [a[0] + p[0] / inner.length, a[1] + p[1] / inner.length], [0, 0]);
        L.marker(c as [number, number], {
          interactive: false,
          icon: L.divIcon({
            className: "",
            iconSize: [0, 0],
            html: `<div style="transform:translate(-50%,-50%);width:max-content;white-space:nowrap;font:600 12px system-ui;color:#0f172a;background:#fff;border:1px solid #cbd5e1;border-radius:9999px;padding:2px 8px;opacity:${dim ? 0.4 : 1}">Zona ${esc(z.label)} · ${formatPct(z.abstentionPct)}</div>`,
          }),
        }).addTo(group);
      }
      if (!fitted.current && bounds.isValid()) {
        m.fitBounds(bounds.pad(0.08));
        fitted.current = true;
      }
    };
    void draw();
    const node = el.current;
    node?.addEventListener("map-ready", draw);
    return () => node?.removeEventListener("map-ready", draw);
  }, [zones, selected]);

  return <div ref={el} className="h-[420px] w-full overflow-hidden rounded-xl border border-border sm:h-[560px]" role="img" aria-label="Mapa das zonas eleitorais" />;
}
