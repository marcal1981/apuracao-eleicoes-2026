import { getMunicipalTracker } from "@/lib/server/ingestor";
import { json } from "@/lib/http";

export const dynamic = "force-dynamic";

/** Andamento da totalização por município de uma UF (GET /api/v1/states/sp/municipalities). */
export async function GET(_req: Request, { params }: { params: Promise<{ uf: string }> }) {
  const { uf } = await params;
  const tracker = getMunicipalTracker(uf);
  if (!tracker) return json({ error: "Mapa municipal não disponível para esta UF" }, { status: 404, maxAge: 60 });
  return json(tracker.getSnapshot(), { maxAge: 10 });
}
