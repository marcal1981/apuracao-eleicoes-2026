import type { NextRequest } from "next/server";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { formatDateTimeBrasilia, formatInt, formatPct } from "@apuracao/core";
import { getSectionTracker } from "@/lib/server/ingestor";

export const dynamic = "force-dynamic";

const INK = rgb(0.1, 0.12, 0.16);
const MUTED = rgb(0.42, 0.45, 0.5);
const LINE = rgb(0.86, 0.88, 0.91);
const ACCENT = rgb(0.11, 0.31, 0.85);
const BAR = rgb(0.75, 0.82, 0.98);
const ZEBRA = rgb(0.975, 0.98, 0.985);
const M = 40;
const ROW = 15;

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
const n = (code: string) => String(Number(code));
const title = (s: string) =>
  s
    .toLowerCase()
    .replace(/(^|\s|\()\S/g, (c) => c.toUpperCase())
    .replace(/ (Da|De|Do|Das|Dos|E)(?= )/g, (w) => w.toLowerCase());
const officeLabel = (o: string) => (o === "deputado-federal" ? "Deputado Federal" : o === "deputado-estadual" ? "Deputado Estadual" : o);
const NO_BAIRRO = "(SEM BAIRRO NO CADASTRO)";

interface PlaceAgg {
  name: string;
  bairro: string;
  sections: number;
  turnout: number;
  electorate: number;
  abstention: number;
  votes: Record<string, number>;
}

/**
 * Relatório em PDF dos votos por bairro (mesma conta da aba "Votos por bairro"):
 * /api/v1/export/bairros-pdf?cidade=sao-jose-dos-campos&numero=2533 — um candidato (com o detalhe por local de votação)
 * /api/v1/export/bairros-pdf?cidade=sao-jose-dos-campos&numero=todos — comparação dos candidatos (página deitada)
 */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const slug = sp.get("cidade") ?? "sao-jose-dos-campos";
  const numero = sp.get("numero") ?? "todos";
  const tracker = getSectionTracker(slug);
  if (!tracker) return new Response("Cidade não disponível", { status: 404 });
  const snap = tracker.getSnapshot();
  const all = numero === "todos";
  const candidates = all ? snap.candidates : snap.candidates.filter((c) => c.number === numero);
  if (candidates.length === 0) return new Response("Candidato não encontrado entre os destaques", { status: 404 });

  // Mesma soma da página: seções com boletim lido → local de votação → bairro (cadastro do TSE).
  const info = new Map(snap.places.map((p) => [`${n(p.zone)}-${p.code}`, p]));
  const places = new Map<string, PlaceAgg>();
  const read = snap.sections.filter((s) => s.done && s.votes);
  for (const s of read) {
    const key = `${n(s.zone)}-${s.place ?? "?"}`;
    const p = s.place ? info.get(key) : undefined;
    let agg = places.get(key);
    if (!agg) {
      agg = {
        name: p?.name || (s.place ? `Local ${s.place} (zona ${n(s.zone)})` : "Local não identificado"),
        bairro: (p?.bairro || NO_BAIRRO).trim().toUpperCase(),
        sections: 0,
        turnout: 0,
        electorate: 0,
        abstention: 0,
        votes: {},
      };
      places.set(key, agg);
    }
    agg.sections++;
    agg.turnout += s.turnout;
    agg.electorate += s.electorate;
    agg.abstention += s.abstention;
    for (const [num, v] of Object.entries(s.votes!)) agg.votes[num] = (agg.votes[num] ?? 0) + v;
  }
  const bairroMap = new Map<string, { name: string; places: PlaceAgg[]; sections: number; turnout: number; electorate: number; abstention: number; votes: Record<string, number> }>();
  for (const p of places.values()) {
    let b = bairroMap.get(p.bairro);
    if (!b) bairroMap.set(p.bairro, (b = { name: p.bairro, places: [], sections: 0, turnout: 0, electorate: 0, abstention: 0, votes: {} }));
    b.places.push(p);
    b.sections += p.sections;
    b.turnout += p.turnout;
    b.electorate += p.electorate;
    b.abstention += p.abstention;
    for (const [num, v] of Object.entries(p.votes)) b.votes[num] = (b.votes[num] ?? 0) + v;
  }
  const valueOf = (votes: Record<string, number>) => candidates.reduce((sum, c) => sum + (votes[c.number] ?? 0), 0);
  const bairros = [...bairroMap.values()]
    .filter((b) => valueOf(b.votes) > 0)
    .sort((a, b) => valueOf(b.votes) - valueOf(a.votes) || a.name.localeCompare(b.name, "pt-BR"));
  const cityTotal = bairros.reduce((sum, b) => sum + valueOf(b.votes), 0);
  const maxBairro = bairros[0] ? valueOf(bairros[0].votes) : 0;

  // Página: em pé para um candidato; deitada para comparar todos.
  const [W, H] = all ? [841.89, 595.28] : [595.28, 841.89];
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const t = (s: string, f: PDFFont = font) => safe(f, s);
  const heading = all ? "Comparação dos candidatos" : `${candidates[0]!.name} (${candidates[0]!.number})`;
  doc.setTitle(`Votos por bairro — ${snap.city} — ${heading}`);
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
  let header: () => void = () => {};
  const newPage = (repeatHeader: boolean) => {
    page = doc.addPage([W, H]);
    pages.push(page);
    y = H - M;
    if (repeatHeader) {
      page.drawText(t(`Votos por bairro — ${snap.city} — ${heading}`, bold), { x: M, y, size: 10, font: bold, color: INK });
      y -= 22;
      header();
    }
  };
  const ensure = (space: number) => {
    if (y < M + 24 + space) newPage(true);
  };

  // Capa: título e resumo.
  newPage(false);
  page.drawText(t(`VOTOS POR BAIRRO · ${snap.city.toUpperCase()}`, bold), { x: M, y, size: 9, font: bold, color: ACCENT });
  y -= 24;
  page.drawText(t(all ? "Comparação dos candidatos em destaque" : candidates[0]!.name, bold), { x: M, y, size: all ? 17 : 20, font: bold, color: INK });
  y -= 18;
  page.drawText(
    t(
      all
        ? candidates.map((c) => `${title(c.name)} (${c.number})`).join(" · ")
        : `${officeLabel(candidates[0]!.office)} · número ${candidates[0]!.number} · Eleições 2026 (1º turno)`,
    ),
    { x: M, y, size: 9.5, font, color: MUTED, maxWidth: W - 2 * M },
  );
  y -= 30;
  const top = bairros[0];
  const stats: [string, string][] = [
    [all ? "Votos dos candidatos na cidade" : "Votos na cidade (boletins)", formatInt(cityTotal)],
    ["Bairros com votos", `${formatInt(bairros.length)} de ${formatInt(bairroMap.size)}`],
    ["Bairro com mais votos", top ? `${title(top.name)} (${formatInt(valueOf(top.votes))})` : "—"],
    ["Seções lidas", `${formatInt(read.length)} de ${formatInt(snap.totals.sections)}`],
  ];
  const boxW = (W - 2 * M - 24) / 4;
  stats.forEach(([label, value], i) => {
    const x = M + i * (boxW + 8);
    page.drawRectangle({ x, y: y - 40, width: boxW, height: 52, borderColor: LINE, borderWidth: 0.8, color: rgb(0.97, 0.98, 1) });
    page.drawText(t(label), { x: x + 8, y: y - 2, size: 7.5, font, color: MUTED });
    let size = 14;
    while (bold.widthOfTextAtSize(t(value, bold), size) > boxW - 16 && size > 7) size -= 0.5;
    page.drawText(t(value, bold), { x: x + 8, y: y - 26, size, font: bold, color: INK });
  });
  y -= 60;
  const partial = read.length < snap.totals.sections;
  const notes = [
    partial
      ? `Atenção: dados parciais — ${formatInt(read.length)} de ${formatInt(snap.totals.sections)} seções com boletim de urna lido até agora.`
      : `Todas as ${formatInt(snap.totals.sections)} seções com boletim de urna lido.`,
    "O bairro de cada seção é o do seu local de votação no cadastro oficial do TSE. Lista só os bairros com votos.",
    `Fonte: Tribunal Superior Eleitoral (boletins de urna)${snap.updatedAt ? ` · dados de ${formatDateTimeBrasilia(snap.updatedAt)}` : ""} · gerado em ${formatDateTimeBrasilia(new Date().toISOString())}`,
  ];
  notes.forEach((note, i) => {
    page.drawText(t(note), { x: M, y, size: i === 2 ? 7.5 : 8.5, font, color: i === 0 && partial ? rgb(0.7, 0.35, 0) : MUTED });
    y -= 12;
  });
  y -= 14;

  if (all) {
    // Tabela comparativa: bairro × candidatos.
    // Colunas o mais largas possível, deixando ~170 pt para o nome do bairro.
    const colW = Math.min(90, (W - 2 * M - 24 - 150) / (candidates.length + 3));
    const totalX = W - M;
    // Uma coluna por candidato e, à direita, a coluna do total.
    const candX = candidates.map((_, i) => totalX - colW * (candidates.length + 1 - i));
    // Eleitores e abstenções do bairro, à esquerda dos candidatos.
    const electX = candX[0]! - colW * 2;
    const abstX = candX[0]! - colW;
    header = () => {
      page.drawText(t("#", bold), { x: M, y, size: 7.5, font: bold, color: MUTED });
      page.drawText(t("Bairro", bold), { x: M + 24, y, size: 7.5, font: bold, color: MUTED });
      // Primeiro e último nome: "Robertinho Padaria", "Dudu Sivinski".
      const short = (name: string) => {
        const w = name.split(/\s+/);
        return title(w.length > 1 ? `${w[0]} ${w[w.length - 1]}` : name);
      };
      right("Eleitores", electX + colW - 4, y, bold, 7.5, MUTED);
      right("Abstenções", abstX + colW - 4, y, bold, 7.5, MUTED);
      candidates.forEach((c, i) => {
        let size = 7.5;
        while (bold.widthOfTextAtSize(t(short(c.name), bold), size) > colW - 6 && size > 6) size -= 0.25;
        right(fit(short(c.name), colW - 6, bold, size), candX[i]! + colW - 4, y, bold, size, MUTED);
      });
      right("Total", totalX, y, bold, 7.5, MUTED);
      page.drawLine({ start: { x: M, y: y - 5 }, end: { x: W - M, y: y - 5 }, thickness: 0.8, color: LINE });
      y -= ROW + 3;
    };
    header();
    bairros.forEach((b, i) => {
      ensure(0);
      if (i % 2 === 1) page.drawRectangle({ x: M - 4, y: y - 4, width: W - 2 * M + 8, height: ROW, color: ZEBRA });
      page.drawText(String(i + 1), { x: M, y, size: 8, font, color: MUTED });
      page.drawText(fit(title(b.name), electX - M - 34), { x: M + 24, y, size: 8.5, font, color: INK });
      right(formatInt(b.electorate), electX + colW - 4, y, font, 8.5, MUTED);
      right(formatInt(b.abstention), abstX + colW - 4, y, font, 8.5, MUTED);
      candidates.forEach((c, j) => right(formatInt(b.votes[c.number] ?? 0), candX[j]! + colW - 4, y, font, 8.5));
      right(formatInt(valueOf(b.votes)), totalX, y, bold, 8.5);
      y -= ROW;
    });
    ensure(10);
    page.drawLine({ start: { x: M, y: y + 9 }, end: { x: W - M, y: y + 9 }, thickness: 0.8, color: LINE });
    page.drawText(t("Total", bold), { x: M + 24, y: y - 4, size: 9, font: bold, color: INK });
    right(formatInt(bairros.reduce((sum, b) => sum + b.electorate, 0)), electX + colW - 4, y - 4, bold, 9);
    right(formatInt(bairros.reduce((sum, b) => sum + b.abstention, 0)), abstX + colW - 4, y - 4, bold, 9);
    candidates.forEach((c, j) =>
      right(formatInt(bairros.reduce((sum, b) => sum + (b.votes[c.number] ?? 0), 0)), candX[j]! + colW - 4, y - 4, bold, 9),
    );
    right(formatInt(cityTotal), totalX, y - 4, bold, 9);
  } else {
    // Parte 1: ranking dos bairros.
    const col = { places: W - M - 315, electorate: W - M - 265, abstention: W - M - 205, votes: W - M - 160, bar: W - M - 152, share: W - M - 55, part: W - M };
    header = () => {
      page.drawText(t("#", bold), { x: M, y, size: 8, font: bold, color: MUTED });
      page.drawText(t("Bairro", bold), { x: M + 26, y, size: 8, font: bold, color: MUTED });
      right("Locais", col.places, y, bold, 8, MUTED);
      right("Eleitores", col.electorate, y, bold, 8, MUTED);
      right("Abstenções", col.abstention, y, bold, 8, MUTED);
      right("Votos", col.votes, y, bold, 8, MUTED);
      right("% no bairro", col.share, y, bold, 8, MUTED);
      right("% do total", col.part, y, bold, 8, MUTED);
      page.drawLine({ start: { x: M, y: y - 5 }, end: { x: W - M, y: y - 5 }, thickness: 0.8, color: LINE });
      y -= ROW + 3;
    };
    page.drawText(t("1. Ranking dos bairros", bold), { x: M, y, size: 11, font: bold, color: INK });
    y -= 20;
    header();
    bairros.forEach((b, i) => {
      ensure(0);
      const v = valueOf(b.votes);
      if (i % 2 === 1) page.drawRectangle({ x: M - 4, y: y - 4, width: W - 2 * M + 8, height: ROW, color: ZEBRA });
      page.drawText(String(i + 1), { x: M, y, size: 8.5, font, color: MUTED });
      page.drawText(fit(title(b.name), col.places - M - 60), { x: M + 26, y, size: 9, font, color: INK });
      right(String(b.places.length), col.places, y, font, 9, MUTED);
      right(formatInt(b.electorate), col.electorate, y, font, 9, MUTED);
      right(formatInt(b.abstention), col.abstention, y, font, 9, MUTED);
      right(formatInt(v), col.votes, y, bold, 9);
      if (maxBairro > 0) page.drawRectangle({ x: col.bar, y: y - 1, width: Math.max(1, (v / maxBairro) * 40), height: 7, color: BAR });
      right(b.turnout > 0 ? formatPct((v / b.turnout) * 100) : "—", col.share, y);
      right(cityTotal > 0 ? formatPct((v / cityTotal) * 100) : "—", col.part, y);
      y -= ROW;
    });
    ensure(10);
    page.drawLine({ start: { x: M, y: y + 9 }, end: { x: W - M, y: y + 9 }, thickness: 0.8, color: LINE });
    page.drawText(t("Total", bold), { x: M + 26, y: y - 4, size: 9.5, font: bold, color: INK });
    right(formatInt(bairros.reduce((sum, b) => sum + b.electorate, 0)), col.electorate, y - 4, bold, 9.5);
    right(formatInt(bairros.reduce((sum, b) => sum + b.abstention, 0)), col.abstention, y - 4, bold, 9.5);
    right(formatInt(cityTotal), col.votes, y - 4, bold, 9.5);
    right("100,00%", col.part, y - 4, bold, 9.5);

    // Parte 2: locais de votação de cada bairro.
    newPage(false);
    page.drawText(t("2. Locais de votação por bairro", bold), { x: M, y, size: 11, font: bold, color: INK });
    y -= 20;
    header = () => {
      page.drawText(t("Local de votação", bold), { x: M + 12, y, size: 8, font: bold, color: MUTED });
      right("Seções", W - M - 230, y, bold, 8, MUTED);
      right("Eleitores", W - M - 175, y, bold, 8, MUTED);
      right("Abstenções", W - M - 115, y, bold, 8, MUTED);
      right("Votos", W - M - 60, y, bold, 8, MUTED);
      right("% no local", W - M, y, bold, 8, MUTED);
      page.drawLine({ start: { x: M, y: y - 5 }, end: { x: W - M, y: y - 5 }, thickness: 0.8, color: LINE });
      y -= ROW + 3;
    };
    header();
    for (const b of bairros) {
      const list = b.places.filter((p) => valueOf(p.votes) > 0).sort((x, z) => valueOf(z.votes) - valueOf(x.votes));
      ensure(ROW * Math.min(3, list.length + 1));
      page.drawRectangle({ x: M - 4, y: y - 4, width: W - 2 * M + 8, height: ROW, color: rgb(0.93, 0.95, 1) });
      page.drawText(fit(title(b.name), W - 2 * M - 120, bold), { x: M, y, size: 9, font: bold, color: INK });
      right(`${formatInt(valueOf(b.votes))} votos`, W - M, y, bold, 9);
      y -= ROW;
      for (const p of list) {
        ensure(0);
        const v = valueOf(p.votes);
        page.drawText(fit(p.name, W - 2 * M - 285), { x: M + 12, y, size: 8.5, font, color: INK });
        right(`${p.sections} seç.`, W - M - 230, y, font, 8, MUTED);
        right(formatInt(p.electorate), W - M - 175, y, font, 8.5, MUTED);
        right(formatInt(p.abstention), W - M - 115, y, font, 8.5, MUTED);
        right(formatInt(v), W - M - 60, y, bold, 8.5);
        right(p.turnout > 0 ? formatPct((v / p.turnout) * 100) : "—", W - M, y, font, 8.5, MUTED);
        y -= ROW - 1;
      }
      y -= 6;
    }
  }

  pages.forEach((p, i) => {
    p.drawText(t(`Apuração Eleições 2026 · Votos por bairro · ${snap.city}`), { x: M, y: 22, size: 7.5, font, color: MUTED });
    const label = t(`Página ${i + 1} de ${pages.length}`);
    p.drawText(label, { x: W - M - font.widthOfTextAtSize(label, 7.5), y: 22, size: 7.5, font, color: MUTED });
  });

  const bytes = await doc.save();
  const fileName = all ? "comparacao" : candidates[0]!.name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  return new Response(Buffer.from(bytes), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="votos-por-bairro-${slug}-${fileName}.pdf"`,
      "cache-control": "no-store",
    },
  });
}
