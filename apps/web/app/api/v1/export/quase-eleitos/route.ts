import type { NextRequest } from "next/server";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { OFFICES, formatDateTimeBrasilia, formatInt, formatPct, nearMisses } from "@apuracao/core";
import { getIngestor } from "@/lib/server/ingestor";
import { parseRaceParams } from "@/lib/params";
import { badRequest } from "@/lib/http";
import { slug } from "@/lib/csv";

export const dynamic = "force-dynamic";

const W = 595.28;
const H = 841.89;
const M = 40;
const INK = rgb(0.1, 0.12, 0.16);
const MUTED = rgb(0.42, 0.45, 0.5);
const LINE = rgb(0.86, 0.88, 0.91);
const ACCENT = rgb(0.11, 0.31, 0.85);
const RED = rgb(0.75, 0.13, 0.13);
const ZEBRA = rgb(0.975, 0.98, 0.985);

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
 * Os candidatos não eleitos que ficaram mais perto da vaga (eleições proporcionais), em PDF:
 * /api/v1/export/quase-eleitos?office=deputado-federal&state=SP (&limite=20)
 */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const params = parseRaceParams(sp.get("office"), sp.get("state"), sp.get("round"));
  if (typeof params === "string") return badRequest(params);
  if (OFFICES[params.office].system !== "proporcional") return badRequest("Lista disponível só para Deputado Federal, Estadual e Distrital");
  const race = getIngestor().getRace(params.key);
  if (!race) return new Response("Ainda sem dados para esta disputa", { status: 404 });
  const limit = Math.min(100, Math.max(1, Number(sp.get("limite")) || 20));
  const report = nearMisses(race, limit);

  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const t = (s: string, f: PDFFont = font) => safe(f, s);
  const uf = race.scope.toUpperCase();
  doc.setTitle(`Quase eleitos — ${race.officeName} ${uf}`);
  doc.setAuthor("Apuração Eleições 2026");

  const pages: PDFPage[] = [];
  let page!: PDFPage;
  let y = 0;
  const right = (s: string, x: number, yy: number, f: PDFFont = font, size = 9, color = INK) =>
    page.drawText(t(s, f), { x: x - f.widthOfTextAtSize(t(s, f), size), y: yy, size, font: f, color });
  const fit = (s: string, max: number, f: PDFFont = font, size = 9) => {
    let out = t(s, f);
    while (f.widthOfTextAtSize(out, size) > max && out.length > 4) out = out.slice(0, -2) + "…";
    return out;
  };
  // Colunas: # | Candidato | Votos | Último eleito da lista | Faltaram
  const col = { rank: M, cand: M + 22, votes: M + 268, last: M + 280, gap: W - M };
  const ROW = 30;
  const header = () => {
    page.drawText(t("#", bold), { x: col.rank, y, size: 8, font: bold, color: MUTED });
    page.drawText(t("Candidato (partido · lista)", bold), { x: col.cand, y, size: 8, font: bold, color: MUTED });
    right("Votos", col.votes, y, bold, 8, MUTED);
    page.drawText(t("Último eleito da lista", bold), { x: col.last, y, size: 8, font: bold, color: MUTED });
    right("Faltaram", col.gap, y, bold, 8, MUTED);
    page.drawLine({ start: { x: M, y: y - 6 }, end: { x: W - M, y: y - 6 }, thickness: 0.8, color: LINE });
    y -= 22;
  };
  const newPage = (first: boolean) => {
    page = doc.addPage([W, H]);
    pages.push(page);
    y = H - M;
    if (!first) {
      page.drawText(t(`Quase eleitos — ${race.officeName} ${uf}`, bold), { x: M, y, size: 10, font: bold, color: INK });
      y -= 22;
      header();
    }
  };

  newPage(true);
  page.drawText(t(`ELEIÇÕES 2026 · ${race.officeName.toUpperCase()} · ${uf}`, bold), { x: M, y, size: 9, font: bold, color: ACCENT });
  y -= 24;
  page.drawText(t(`Os ${report.items.length} que perderam por menos votos`, bold), { x: M, y, size: 19, font: bold, color: INK });
  y -= 18;
  const lines = [
    "Na eleição proporcional, a vaga é do partido ou federação: o candidato disputa com os colegas da própria lista.",
    "Por isso, para cada candidato não eleito, a conta é quantos votos faltaram para alcançar o último eleito da sua lista.",
    "Listas que não conquistaram nenhuma vaga ficam de fora (não há último eleito para comparar).",
  ];
  for (const line of lines) {
    page.drawText(t(line), { x: M, y, size: 8.5, font, color: MUTED });
    y -= 12;
  }
  y -= 4;
  const basis =
    report.basis === "oficial"
      ? `Eleitos conforme o TSE · ${formatPct(race.sectionsTotalizedPct)} das seções totalizadas.`
      : `Atenção: o TSE ainda não informou os eleitos — lista baseada na projeção da plataforma (${formatPct(race.sectionsTotalizedPct)} das seções totalizadas).`;
  page.drawText(t(basis), { x: M, y, size: 8.5, font, color: report.basis === "oficial" ? MUTED : rgb(0.7, 0.35, 0) });
  y -= 12;
  page.drawText(
    t(`Fonte: Tribunal Superior Eleitoral${race.officialTimestamp ? ` · dados de ${formatDateTimeBrasilia(race.officialTimestamp)}` : ""} · gerado em ${formatDateTimeBrasilia(new Date().toISOString())}`),
    { x: M, y, size: 7.5, font, color: MUTED },
  );
  y -= 26;

  if (report.items.length === 0) {
    page.drawText(t("Ainda não há eleitos (nem projeção) para montar a lista."), { x: M, y, size: 11, font, color: INK });
  } else {
    header();
    report.items.forEach((it, i) => {
      if (y < M + 30) newPage(false);
      if (i % 2 === 1) page.drawRectangle({ x: M - 4, y: y - 14, width: W - 2 * M + 8, height: ROW, color: ZEBRA });
      page.drawText(String(it.rank), { x: col.rank, y, size: 9, font: bold, color: MUTED });
      page.drawText(fit(`${it.name} (${it.number})`, col.votes - col.cand - 60, bold, 9.5), { x: col.cand, y, size: 9.5, font: bold, color: INK });
      const listLabel = it.list !== it.party ? `${it.party} · ${it.list}` : it.party;
      page.drawText(fit(`${listLabel} · ${it.suplente}º suplente`, col.votes - col.cand - 60, font, 8), { x: col.cand, y: y - 11, size: 8, font, color: MUTED });
      right(formatInt(it.votes), col.votes, y, font, 9.5);
      page.drawText(fit(`${it.lastElected.name} (${it.lastElected.number})`, col.gap - col.last - 70), { x: col.last, y, size: 9, font, color: INK });
      page.drawText(t(`${formatInt(it.lastElected.votes)} votos · lista com ${it.listSeats} ${it.listSeats === 1 ? "vaga" : "vagas"}`), {
        x: col.last,
        y: y - 11,
        size: 8,
        font,
        color: MUTED,
      });
      right(formatInt(it.gap), col.gap, y, bold, 11, RED);
      right("votos", col.gap, y - 11, font, 7.5, MUTED);
      y -= ROW;
    });
  }

  pages.forEach((p, i) => {
    p.drawText(t(`Apuração Eleições 2026 · Quase eleitos · ${race.officeName} ${uf}`), { x: M, y: 22, size: 7.5, font, color: MUTED });
    const label = t(`Página ${i + 1} de ${pages.length}`);
    p.drawText(label, { x: W - M - font.widthOfTextAtSize(label, 7.5), y: 22, size: 7.5, font, color: MUTED });
  });

  const bytes = await doc.save();
  return new Response(Buffer.from(bytes), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="quase-eleitos-${slug(race.officeName)}-${race.scope}.pdf"`,
      "cache-control": "no-store",
    },
  });
}
