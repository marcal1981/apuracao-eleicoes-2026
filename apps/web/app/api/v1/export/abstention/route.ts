import type { NextRequest } from "next/server";
import { getAbstentionTracker } from "@/lib/server/ingestor";
import { csvResponse } from "@/lib/csv";
import { REGIONS, subregionOf } from "@/lib/regions";

export const dynamic = "force-dynamic";

/** Abstenção por município em planilha: /api/v1/export/abstention?uf=sp */
export function GET(req: NextRequest) {
  const uf = req.nextUrl.searchParams.get("uf") ?? "sp";
  const tracker = getAbstentionTracker(uf);
  if (!tracker) return new Response("Abstenção por município não disponível para esta UF", { status: 404 });
  const snap = tracker.getSnapshot();
  const region = REGIONS[req.nextUrl.searchParams.get("regiao") ?? ""];
  const cities = snap.cities
    .map((c) => ({ ...c, subregion: region ? subregionOf(region, c.name) : null }))
    .filter((c) => !region || c.subregion)
    .sort((a, b) => (a.subregion ?? "").localeCompare(b.subregion ?? "", "pt-BR") || a.name.localeCompare(b.name, "pt-BR"));
  return csvResponse(`abstencao-por-municipio-${region ? region.slug : uf.toLowerCase()}.csv`, [
    [...(region ? ["Sub-região"] : []), "Município", "Código IBGE", "Eleitorado", "Comparecimento", "Abstenção", "% abstenção", "% seções totalizadas"],
    ...cities.map((c) => [
      ...(region ? [c.subregion] : []),
      c.name,
      c.ibge,
      c.electorate,
      c.turnout,
      c.abstention,
      c.abstentionPct,
      c.sectionsTotalizedPct,
    ]),
  ]);
}
