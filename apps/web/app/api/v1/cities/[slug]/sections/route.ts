import { raceKey } from "@apuracao/core";
import { getIngestor, getSectionTracker } from "@/lib/server/ingestor";
import { json } from "@/lib/http";

export const dynamic = "force-dynamic";

/** Abstenção por seção eleitoral: GET /api/v1/cities/sao-jose-dos-campos/sections */
export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const tracker = getSectionTracker(slug);
  if (!tracker) return json({ error: "Abstenção por seção não disponível para esta cidade" }, { status: 404, maxAge: 60 });
  tracker.ensureStarted();
  try {
    // Nomes dos candidatos a Presidente (resultado nacional), para a análise por bairro.
    const ingestor = getIngestor();
    const race = ingestor.getRace(raceKey(ingestor.config.round, "presidente", "br"));
    const presidentCandidates = (race?.candidates ?? []).map((c) => ({ number: c.number, name: c.name, party: c.party ?? "" }));
    return json({ ...tracker.getSnapshot(), presidentCandidates }, { maxAge: 5 });
  } catch (err) {
    return json({ error: `Falha ao montar a abstenção por seção: ${err instanceof Error ? err.message : String(err)}` }, { status: 500, maxAge: 0 });
  }
}
