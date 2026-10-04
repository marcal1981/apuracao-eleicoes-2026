import type { NextRequest } from "next/server";
import { getIngestor } from "@/lib/server/ingestor";
import { badRequest, json } from "@/lib/http";
import { parseRaceParams } from "@/lib/params";

export const dynamic = "force-dynamic";

/** Série histórica de snapshots da apuração, para gráficos de evolução. */
export function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const params = parseRaceParams(sp.get("office"), sp.get("state"), sp.get("round"));
  if (typeof params === "string") return badRequest(params);
  return json({ key: params.key, snapshots: getIngestor().getHistory(params.key) }, { maxAge: 10 });
}
