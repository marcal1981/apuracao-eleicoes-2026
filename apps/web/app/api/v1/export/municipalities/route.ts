import type { NextRequest } from "next/server";
import { getMunicipalTracker } from "@/lib/server/ingestor";
import { csvResponse } from "@/lib/csv";

export const dynamic = "force-dynamic";

/** Andamento da apuração por município em planilha: /api/v1/export/municipalities?uf=sp */
export function GET(req: NextRequest) {
  const uf = req.nextUrl.searchParams.get("uf") ?? "sp";
  const tracker = getMunicipalTracker(uf);
  if (!tracker) return new Response("Mapa municipal não disponível para esta UF", { status: 404 });
  const snap = tracker.getSnapshot();
  return csvResponse(`apuracao-por-municipio-${uf.toLowerCase()}.csv`, [
    ["Município", "Código IBGE", "% seções totalizadas", "Situação"],
    ...snap.municipalities
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"))
      .map((m) => [m.name, m.ibge, m.sectionsTotalizedPct, m.status]),
  ]);
}
