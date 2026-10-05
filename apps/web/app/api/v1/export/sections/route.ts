import type { NextRequest } from "next/server";
import { getSectionTracker } from "@/lib/server/ingestor";
import { csvResponse } from "@/lib/csv";

export const dynamic = "force-dynamic";

/** Abstenção por seção em planilha: /api/v1/export/sections?cidade=sao-jose-dos-campos (&agrupar=zona para o resumo por zona) */
export function GET(req: NextRequest) {
  const slug = req.nextUrl.searchParams.get("cidade") ?? "sao-jose-dos-campos";
  const tracker = getSectionTracker(slug);
  if (!tracker) return new Response("Abstenção por seção não disponível para esta cidade", { status: 404 });
  tracker.ensureStarted();
  const snap = tracker.getSnapshot();
  if (req.nextUrl.searchParams.get("agrupar") === "zona") {
    const zones = new Map<string, typeof snap.sections>();
    for (const s of snap.sections) zones.set(s.zone, [...(zones.get(s.zone) ?? []), s]);
    return csvResponse(`abstencao-por-zona-${slug}.csv`, [
      ["Zona", "Seções", "Seções apuradas", "Eleitores aptos", "Comparecimento", "Abstenção", "% abstenção"],
      ...[...zones]
        .sort(([a], [b]) => Number(a) - Number(b))
        .map(([zone, list]) => {
          const read = list.filter((s) => s.done);
          const electorate = read.reduce((n, s) => n + s.electorate, 0);
          const turnout = read.reduce((n, s) => n + s.turnout, 0);
          const abstention = read.reduce((n, s) => n + s.abstention, 0);
          const pct = turnout + abstention > 0 ? Math.round((abstention / (turnout + abstention)) * 10_000) / 100 : 0;
          return [Number(zone), list.length, read.length, electorate, turnout, abstention, pct];
        }),
    ]);
  }
  return csvResponse(`abstencao-por-secao-${slug}.csv`, [
    ["Zona", "Seção", "Local de votação", "Situação", "Eleitores aptos", "Comparecimento", "Abstenção", "% abstenção"],
    ...snap.sections.map((s) => [
      Number(s.zone),
      Number(s.section),
      s.place ?? "",
      s.status,
      s.done ? s.electorate : "",
      s.done ? s.turnout : "",
      s.done ? s.abstention : "",
      s.done ? s.abstentionPct : "",
    ]),
  ]);
}
