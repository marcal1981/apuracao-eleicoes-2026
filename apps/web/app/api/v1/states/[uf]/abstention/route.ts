import { getAbstentionTracker } from "@/lib/server/ingestor";
import { json } from "@/lib/http";

export const dynamic = "force-dynamic";

/** Abstenção por município: GET /api/v1/states/sp/abstention */
export async function GET(_req: Request, { params }: { params: Promise<{ uf: string }> }) {
  const { uf } = await params;
  const tracker = getAbstentionTracker(uf);
  if (!tracker) return json({ error: "Abstenção por município não disponível para esta UF" }, { status: 404, maxAge: 60 });
  try {
    return json(tracker.getSnapshot(), { maxAge: 5 });
  } catch (err) {
    return json({ error: `Falha ao montar a abstenção: ${err instanceof Error ? err.message : String(err)}` }, { status: 500, maxAge: 0 });
  }
}
