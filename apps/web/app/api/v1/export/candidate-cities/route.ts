import type { NextRequest } from "next/server";
import { getCandidateCitiesTracker } from "@/lib/server/ingestor";
import { csvResponse } from "@/lib/csv";

export const dynamic = "force-dynamic";

/** Votos por cidade de todos os candidatos em destaque: ?uf=sp&office=deputado-estadual */
export function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const uf = sp.get("uf") ?? "sp";
  const office = sp.get("office") ?? "";
  const tracker = getCandidateCitiesTracker(office, uf);
  if (!tracker) return new Response("Sem candidatos em destaque nesta disputa", { status: 404 });
  const snap = tracker.getSnapshot();
  return csvResponse(`votos-por-cidade-${office}-${uf.toLowerCase()}.csv`, [
    ["Candidato", "Número", "Município", "Código IBGE", "Votos", "% válidos no município", "% seções totalizadas"],
    ...snap.candidates.flatMap((c) =>
      c.cities.map((city) => [c.name, c.number, city.name, city.ibge, city.votes, city.share, city.sectionsTotalizedPct]),
    ),
  ]);
}
