import type { NextRequest } from "next/server";
import { getIngestor } from "@/lib/server/ingestor";
import { json } from "@/lib/http";

export const dynamic = "force-dynamic";

/** Resumo de todas as disputas acompanhadas (filtros opcionais: office, state). */
export function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const races = getIngestor().listRaces({
    office: sp.get("office") ?? undefined,
    scope: sp.get("state") ?? undefined,
  });
  return json({ races });
}
