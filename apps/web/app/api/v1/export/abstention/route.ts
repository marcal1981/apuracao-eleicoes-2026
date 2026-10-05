import type { NextRequest } from "next/server";
import { getAbstentionTracker } from "@/lib/server/ingestor";
import { csvResponse } from "@/lib/csv";

export const dynamic = "force-dynamic";

/** Abstenção por município em planilha: /api/v1/export/abstention?uf=sp */
export function GET(req: NextRequest) {
  const uf = req.nextUrl.searchParams.get("uf") ?? "sp";
  const tracker = getAbstentionTracker(uf);
  if (!tracker) return new Response("Abstenção por município não disponível para esta UF", { status: 404 });
  const snap = tracker.getSnapshot();
  return csvResponse(`abstencao-por-municipio-${uf.toLowerCase()}.csv`, [
    ["Município", "Código IBGE", "Eleitorado", "Comparecimento", "Abstenção", "% abstenção", "% seções totalizadas"],
    ...snap.cities
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"))
      .map((c) => [c.name, c.ibge, c.electorate, c.turnout, c.abstention, c.abstentionPct, c.sectionsTotalizedPct]),
  ]);
}
