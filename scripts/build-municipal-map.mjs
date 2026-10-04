// Gera o desenho simplificado (caminhos SVG) dos municípios de uma UF a partir da malha do IBGE.
//
// Uso: node scripts/build-municipal-map.mjs <uf> [caminho-ou-url-do-geojson]
// Padrão: malha municipal do IBGE publicada em github.com/tbrugz/geodata-br (CC0).
// Saída: apps/web/public/maps/<uf>-municipios.json

import { readFile, writeFile } from "node:fs/promises";

const UF_CODES = { ac: 12, al: 27, ap: 16, am: 13, ba: 29, ce: 23, df: 53, es: 32, go: 52, ma: 21, mt: 51, ms: 50, mg: 31, pa: 15, pb: 25, pr: 41, pe: 26, pi: 22, rj: 33, rn: 24, rs: 43, ro: 11, rr: 14, sc: 42, sp: 35, se: 28, to: 17 };
const uf = (process.argv[2] ?? "").toLowerCase();
if (!UF_CODES[uf]) throw new Error("Informe a UF, ex.: node scripts/build-municipal-map.mjs sp");
const source = process.argv[3] ?? `https://raw.githubusercontent.com/tbrugz/geodata-br/master/geojson/geojs-${UF_CODES[uf]}-mun.json`;
const geo = JSON.parse(source.startsWith("http") ? await (await fetch(source)).text() : await readFile(source, "utf8"));

const WIDTH = 1000;
const TOLERANCE = 0.6; // em unidades do SVG

const rings = (g) => (g.type === "Polygon" ? g.coordinates : g.type === "MultiPolygon" ? g.coordinates.flat() : []);
let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
for (const f of geo.features) for (const ring of rings(f.geometry)) for (const [x, y] of ring) {
  minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
}
// Projeção equiretangular corrigida pela latitude média (adequada para a escala de um estado).
const k = Math.cos((((minY + maxY) / 2) * Math.PI) / 180);
const scale = WIDTH / ((maxX - minX) * k);
const height = Math.ceil((maxY - minY) * scale);
const project = ([x, y]) => [(x - minX) * k * scale, (maxY - y) * scale];

// Anéis são fechados (primeiro ponto = último): divide no ponto mais distante antes de simplificar.
function simplifyRing(points) {
  let far = 0, max = -1;
  for (let i = 1; i < points.length; i++) {
    const d = Math.hypot(points[i][0] - points[0][0], points[i][1] - points[0][1]);
    if (d > max) { max = d; far = i; }
  }
  return [...simplify(points.slice(0, far + 1)).slice(0, -1), ...simplify(points.slice(far))];
}

function simplify(points) {
  if (points.length <= 4) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const [ax, ay] = points[a], [bx, by] = points[b];
    const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy) || 1;
    let max = 0, idx = -1;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs(dy * points[i][0] - dx * points[i][1] + bx * ay - by * ax) / len;
      if (d > max) { max = d; idx = i; }
    }
    if (max > TOLERANCE && idx > 0) { keep[idx] = 1; stack.push([a, idx], [idx, b]); }
  }
  return points.filter((_, i) => keep[i]);
}

const r1 = (n) => Math.round(n * 10) / 10;
const municipalities = geo.features.map((f) => {
  const d = rings(f.geometry)
    .map((ring) => simplifyRing(ring.map(project)))
    .filter((pts) => pts.length >= 3)
    .map((pts) => "M" + pts.map(([x, y]) => `${r1(x)} ${r1(y)}`).join("L") + "Z")
    .join("");
  return { ibge: String(f.properties.id ?? f.properties.codarea ?? f.properties.CD_MUN), name: f.properties.name ?? f.properties.NM_MUN, d };
}).sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));

const out = new URL(`../apps/web/public/maps/${uf}-municipios.json`, import.meta.url);
await writeFile(out, JSON.stringify({ uf: uf.toUpperCase(), viewBox: `0 0 ${WIDTH} ${height}`, source: "IBGE (via github.com/tbrugz/geodata-br, CC0)", municipalities }));
console.log(`${municipalities.length} municípios → ${out.pathname}`);
