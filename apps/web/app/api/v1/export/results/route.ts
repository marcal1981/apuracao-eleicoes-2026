import { formatPct } from "@apuracao/core";
import type { NextRequest } from "next/server";
import { getIngestor } from "@/lib/server/ingestor";
import { parseRaceParams } from "@/lib/params";
import { badRequest } from "@/lib/http";
import { csvResponse, slug } from "@/lib/csv";

export const dynamic = "force-dynamic";

/** Resultado de uma disputa em planilha: /api/v1/export/results?office=deputado-estadual&state=SP */
export function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const params = parseRaceParams(sp.get("office"), sp.get("state"), sp.get("round"));
  if (typeof params === "string") return badRequest(params);
  const race = getIngestor().getRace(params.key);
  if (!race) return new Response("Ainda sem dados para esta disputa", { status: 404 });
  const final = race.status === "TOTALIZACAO_FINALIZADA" || race.candidates.some((c) => c.elected);
  return csvResponse(`resultado-${slug(race.officeName)}-${race.scope}.csv`, [
    [`${race.officeName} — ${race.scope.toUpperCase()} — ${formatPct(race.sectionsTotalizedPct)} das seções totalizadas`],
    ["Posição", "Candidato", "Número", "Partido", "Federação/coligação", "Votos", "% válidos", "Situação oficial", "Projeção"],
    ...race.candidates.map((c) => [
      c.position,
      c.name,
      c.number,
      c.party,
      c.coalition ?? "",
      c.votes,
      c.percentage,
      c.officialStatus,
      !final && c.projected ? `Eleito por ${c.projected === "QP" ? "QP" : "média"} (projeção)` : "",
    ]),
  ]);
}
