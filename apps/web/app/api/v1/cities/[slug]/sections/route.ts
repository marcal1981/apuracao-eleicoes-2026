import { getSectionTracker } from "@/lib/server/ingestor";
import { json } from "@/lib/http";

export const dynamic = "force-dynamic";

/** Abstenção por seção eleitoral: GET /api/v1/cities/sao-jose-dos-campos/sections */
export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const tracker = getSectionTracker(slug);
  if (!tracker) return json({ error: "Abstenção por seção não disponível para esta cidade" }, { status: 404, maxAge: 60 });
  tracker.ensureStarted();
  try {
    return json(tracker.getSnapshot(), { maxAge: 5 });
  } catch (err) {
    return json({ error: `Falha ao montar a abstenção por seção: ${err instanceof Error ? err.message : String(err)}` }, { status: 500, maxAge: 0 });
  }
}
