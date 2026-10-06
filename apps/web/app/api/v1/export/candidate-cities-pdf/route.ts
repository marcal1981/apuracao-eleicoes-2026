import type { NextRequest } from "next/server";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { OFFICES, formatDateTimeBrasilia, formatInt, formatPct, isOfficeKey, matchesCandidate } from "@apuracao/core";
import { getCandidateCitiesTracker } from "@/lib/server/ingestor";
import { slug } from "@/lib/csv";

export const dynamic = "force-dynamic";

const STATE_NAMES: Record<string, string> = { SP: "São Paulo" };

// Página A4 em pontos.
const W = 595.28;
const H = 841.89;
const M = 42;
const ROW = 15;
const INK = rgb(0.1, 0.12, 0.16);
const MUTED = rgb(0.42, 0.45, 0.5);
const LINE = rgb(0.86, 0.88, 0.91);
const ACCENT = rgb(0.11, 0.31, 0.85);
const BAR = rgb(0.75, 0.82, 0.98);

/** As fontes padrão do PDF usam a codificação WinAnsi: troca o que estiver fora dela. */
const safe = (font: PDFFont, text: string) =>
  [...text]
    .map((ch) => {
      try {
        font.encodeText(ch);
        return ch;
      } catch {
        return "?";
      }
    })
    .join("");

/**
 * Votos por município de um candidato em destaque, em PDF:
 * /api/v1/export/candidate-cities-pdf?uf=sp&office=deputado-federal&numero=2533 (ou &nome=ROBERTINHO)
 */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const uf = (sp.get("uf") ?? "sp").toLowerCase();
  const office = sp.get("office") ?? "";
  const tracker = getCandidateCitiesTracker(office, uf);
  if (!tracker || !isOfficeKey(office)) return new Response("Sem candidatos em destaque nesta disputa", { status: 404 });
  const snap = tracker.getSnapshot();
  const numero = sp.get("numero");
  const nome = sp.get("nome");
  const candidate = snap.candidates.find((c) =>
    numero ? c.number === numero : nome ? matchesCandidate({ name: c.name, number: c.number }, nome) : false,
  );
  if (!candidate) return new Response("Candidato não encontrado entre os destaques", { status: 404 });

  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const t = (s: string, f: PDFFont = font) => safe(f, s);
  doc.setTitle(`Votação por município — ${candidate.name}`);
  doc.setAuthor("Apuração Eleições 2026");
  doc.setSubject("Dados oficiais do TSE");

  const generated = formatDateTimeBrasilia(new Date().toISOString());
  const officeName = OFFICES[office].name;
  const stateName = STATE_NAMES[snap.uf] ?? snap.uf;
  const total = candidate.total;
  const cities = candidate.cities; // já em ordem decrescente de votos
  const withVotes = cities.filter((c) => c.votes > 0).length;
  const maxVotes = cities[0]?.votes ?? 0;
  const complete = snap.citiesRead >= snap.citiesTotal && cities.every((c) => c.sectionsTotalizedPct >= 100);

  const pages: PDFPage[] = [];
  let page!: PDFPage;
  let y = 0;

  // Colunas da tabela.
  const col = { pos: M, city: M + 30, votes: W - M - 175, bar: W - M - 165, share: W - M - 60, part: W - M };
  const right = (p: PDFPage, s: string, x: number, yy: number, f: PDFFont = font, size = 9, color = INK) =>
    p.drawText(t(s, f), { x: x - f.widthOfTextAtSize(t(s, f), size), y: yy, size, font: f, color });

  const tableHeader = () => {
    const yy = y;
    page.drawText(t("#", bold), { x: col.pos, y: yy, size: 8, font: bold, color: MUTED });
    page.drawText(t("Município", bold), { x: col.city, y: yy, size: 8, font: bold, color: MUTED });
    right(page, "Votos", col.votes, yy, bold, 8, MUTED);
    right(page, "% válidos no município", col.share, yy, bold, 8, MUTED);
    right(page, "% do total", col.part, yy, bold, 8, MUTED);
    page.drawLine({ start: { x: M, y: yy - 5 }, end: { x: W - M, y: yy - 5 }, thickness: 0.8, color: LINE });
    y -= ROW + 4;
  };

  const newPage = (first: boolean) => {
    page = doc.addPage([W, H]);
    pages.push(page);
    y = H - M;
    if (!first) {
      page.drawText(t(`${candidate.name} (${candidate.number}) — votação por município`, bold), {
        x: M, y, size: 10, font: bold, color: INK,
      });
      y -= 22;
      tableHeader();
    }
  };

  // Primeira página: título e resumo.
  newPage(true);
  page.drawText(t("VOTAÇÃO POR MUNICÍPIO", bold), { x: M, y, size: 9, font: bold, color: ACCENT });
  y -= 24;
  page.drawText(t(candidate.name, bold), { x: M, y, size: 20, font: bold, color: INK });
  y -= 18;
  page.drawText(t(`${officeName} · número ${candidate.number} · ${stateName} · Eleições 2026 (1º turno)`), {
    x: M, y, size: 10.5, font, color: MUTED,
  });
  y -= 30;

  const stats: [string, string][] = [
    ["Total de votos", formatInt(total)],
    ["Municípios com votos", `${formatInt(withVotes)} de ${formatInt(cities.length)}`],
    ["Município com mais votos", cities[0] && cities[0].votes > 0 ? `${cities[0].name} (${formatInt(cities[0].votes)})` : "—"],
  ];
  const boxW = (W - 2 * M - 16) / 3;
  stats.forEach(([label, value], i) => {
    const x = M + i * (boxW + 8);
    page.drawRectangle({ x, y: y - 40, width: boxW, height: 52, borderColor: LINE, borderWidth: 0.8, color: rgb(0.97, 0.98, 1) });
    page.drawText(t(label), { x: x + 10, y: y - 2, size: 8.5, font, color: MUTED });
    let size = 15;
    while (bold.widthOfTextAtSize(t(value, bold), size) > boxW - 20 && size > 8) size -= 0.5;
    page.drawText(t(value, bold), { x: x + 10, y: y - 26, size, font: bold, color: INK });
  });
  y -= 62;

  const note = complete
    ? `Resultado com 100% das seções totalizadas em todos os ${formatInt(snap.citiesTotal)} municípios.`
    : `Atenção: dados parciais — ${formatInt(snap.citiesRead)} de ${formatInt(snap.citiesTotal)} municípios lidos; alguns ainda sem 100% das seções totalizadas.`;
  page.drawText(t(note), { x: M, y, size: 9, font, color: complete ? MUTED : rgb(0.7, 0.35, 0) });
  y -= 13;
  page.drawText(
    t(`Fonte: Tribunal Superior Eleitoral (resultados.tse.jus.br)${snap.updatedAt ? ` · dados de ${formatDateTimeBrasilia(snap.updatedAt)}` : ""} · gerado em ${generated}`),
    { x: M, y, size: 8, font, color: MUTED },
  );
  y -= 26;
  tableHeader();

  cities.forEach((c, i) => {
    if (y < M + 24) newPage(false);
    if (i % 2 === 1) page.drawRectangle({ x: M - 4, y: y - 4, width: W - 2 * M + 8, height: ROW, color: rgb(0.975, 0.98, 0.985) });
    page.drawText(String(i + 1), { x: col.pos, y, size: 8.5, font, color: MUTED });
    let name = t(c.name);
    while (font.widthOfTextAtSize(name, 9) > col.votes - col.city - 60 && name.length > 4) name = name.slice(0, -2) + "…";
    page.drawText(name, { x: col.city, y, size: 9, font, color: INK });
    right(page, formatInt(c.votes), col.votes, y, c.votes > 0 ? bold : font, 9, c.votes > 0 ? INK : MUTED);
    if (maxVotes > 0 && c.votes > 0) {
      page.drawRectangle({ x: col.bar, y: y - 1, width: Math.max(1, (c.votes / maxVotes) * 50), height: 7, color: BAR });
    }
    right(page, formatPct(c.share), col.share, y);
    right(page, total > 0 ? formatPct((c.votes / total) * 100) : "—", col.part, y);
    y -= ROW;
  });

  // Total ao fim da tabela.
  if (y < M + 30) newPage(false);
  page.drawLine({ start: { x: M, y: y + 9 }, end: { x: W - M, y: y + 9 }, thickness: 0.8, color: LINE });
  page.drawText(t("Total", bold), { x: col.city, y: y - 4, size: 9.5, font: bold, color: INK });
  right(page, formatInt(total), col.votes, y - 4, bold, 9.5);
  right(page, "100,00%", col.part, y - 4, bold, 9.5);

  // Rodapé com numeração.
  pages.forEach((p, i) => {
    p.drawText(t(`Apuração Eleições 2026 · ${candidate.name} · ${officeName} ${snap.uf}`), { x: M, y: 22, size: 7.5, font, color: MUTED });
    right(p, `Página ${i + 1} de ${pages.length}`, W - M, 22, font, 7.5, MUTED);
  });

  const bytes = await doc.save();
  return new Response(Buffer.from(bytes), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="votos-por-municipio-${slug(candidate.name)}.pdf"`,
      "cache-control": "no-store",
    },
  });
}
