import type { NextRequest } from "next/server";
import { getIngestor } from "@/lib/server/ingestor";
import { badRequest, json } from "@/lib/http";
import { parseRaceParams } from "@/lib/params";

export const dynamic = "force-dynamic";

/** GET /api/v1/results?office=senador&state=SP&round=1 */
export function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const params = parseRaceParams(sp.get("office"), sp.get("state"), sp.get("round"));
  if (typeof params === "string") return badRequest(params);
  const ingestor = getIngestor();
  if (!ingestor.hasRace(params.key)) return json({ error: "Disputa não acompanhada", key: params.key }, { status: 404 });
  const race = ingestor.getRace(params.key);
  if (!race) return json({ key: params.key, status: "AGUARDANDO", message: "Aguardando divulgação oficial do TSE" }, { status: 404, maxAge: 5 });
  return json(race);
}
