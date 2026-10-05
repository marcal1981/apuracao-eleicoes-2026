import type { NextRequest } from "next/server";
import { getSectionTracker } from "@/lib/server/ingestor";
import { csvResponse } from "@/lib/csv";

export const dynamic = "force-dynamic";

/** Abstenção por seção em planilha: /api/v1/export/sections?cidade=sao-jose-dos-campos */
export function GET(req: NextRequest) {
  const slug = req.nextUrl.searchParams.get("cidade") ?? "sao-jose-dos-campos";
  const tracker = getSectionTracker(slug);
  if (!tracker) return new Response("Abstenção por seção não disponível para esta cidade", { status: 404 });
  tracker.ensureStarted();
  const snap = tracker.getSnapshot();
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
