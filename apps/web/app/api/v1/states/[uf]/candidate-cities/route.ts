import type { NextRequest } from "next/server";
import { getCandidateCitiesTracker } from "@/lib/server/ingestor";
import { json } from "@/lib/http";

export const dynamic = "force-dynamic";

/** Votos por município dos candidatos em destaque: GET /api/v1/states/sp/candidate-cities?office=deputado-estadual */
export async function GET(req: NextRequest, { params }: { params: Promise<{ uf: string }> }) {
  const { uf } = await params;
  const office = req.nextUrl.searchParams.get("office") ?? "";
  const tracker = getCandidateCitiesTracker(office, uf);
  if (!tracker) return json({ error: "Sem candidatos em destaque com votação por cidade nesta disputa" }, { status: 404, maxAge: 60 });
  try {
    return json(tracker.getSnapshot(), { maxAge: 5 });
  } catch (err) {
    return json({ error: `Falha ao montar os votos por cidade: ${err instanceof Error ? err.message : String(err)}` }, { status: 500, maxAge: 0 });
  }
}
