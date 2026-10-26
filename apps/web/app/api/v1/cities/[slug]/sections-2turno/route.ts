import { raceKey } from "@apuracao/core";
import { getIngestor, getSecondRoundIngestor, getSectionTracker } from "@/lib/server/ingestor";
import { json } from "@/lib/http";

export const dynamic = "force-dynamic";

/**
 * Presidente por seção nos dois turnos, para a comparação por bairro:
 * GET /api/v1/cities/sao-jose-dos-campos/sections-2turno
 */
export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const t1 = getSectionTracker(slug, 1);
  const t2 = getSectionTracker(slug, 2);
  if (!t1 || !t2) {
    return json(
      { error: t1 ? "Boletins do 2º turno indisponíveis (reinicie o sistema: Ctrl + C e npm run dev; ou SECOND_ROUND=false no .env)" : "Cidade não disponível" },
      { status: 404, maxAge: 0 },
    );
  }
  t1.ensureStarted();
  t2.ensureStarted();
  const s1 = t1.getSnapshot();
  const s2 = t2.getSnapshot();

  // Finalistas na ordem do 1º turno no Brasil (a mesma das outras abas).
  const r1br = getIngestor().getRace(raceKey(1, "presidente", "br"));
  const r2br = getSecondRoundIngestor()?.getRace(raceKey(2, "presidente", "br")) ?? null;
  const r1Votes = (num: string) => r1br?.candidates.find((c) => c.number === num)?.votes ?? 0;
  const finalists = [...((r2br ?? r1br)?.candidates ?? [])]
    .sort((x, y) => y.votes - x.votes)
    .slice(0, 2)
    .sort((x, y) => r1Votes(y.number) - r1Votes(x.number) || x.number.localeCompare(y.number))
    .map((c) => ({ number: c.number, name: c.name }));

  // Sem o resultado nacional (ou com números diferentes), os finalistas saem dos próprios boletins do 2º turno.
  const sums = new Map<string, number>();
  for (const x of s2.sections)
    for (const [k, v] of Object.entries(x.presVotes ?? {})) if (k !== "branco" && k !== "nulo" && k !== "outros") sums.set(k, (sums.get(k) ?? 0) + v);
  if (sums.size >= 2 && finalists.filter((f) => sums.has(f.number)).length < 2) {
    const nameOf = (num: string) => (r2br ?? r1br)?.candidates.find((c) => c.number === num)?.name ?? `Candidato ${num}`;
    finalists.splice(
      0,
      finalists.length,
      ...[...sums]
        .sort((x, y) => y[1] - x[1])
        .slice(0, 2)
        .sort((x, y) => r1Votes(y[0]) - r1Votes(x[0]) || x[0].localeCompare(y[0]))
        .map(([number]) => ({ number, name: nameOf(number) })),
    );
  }

  // Só o necessário de cada seção (a cidade tem mais de mil seções por turno).
  const slim = (s: typeof s1) =>
    s.sections
      .filter((x) => x.done && x.presVotes && Object.keys(x.presVotes).length > 0)
      .map((x) => ({ z: x.zone, s: x.section, p: x.place, e: x.electorate, a: x.abstention, v: x.presVotes }));

  return json(
    {
      city: s2.city,
      finalists,
      r1: { updatedAt: s1.updatedAt, totals: s1.totals, progress: s1.progress, sections: slim(s1) },
      r2: { updatedAt: s2.updatedAt, totals: s2.totals, progress: s2.progress, pleito: s2.pleito, sections: slim(s2) },
      places: s2.places.length > 0 ? s2.places : s1.places,
      placesStatus: s2.places.length > 0 ? s2.placesStatus : s1.placesStatus,
    },
    { maxAge: 10 },
  );
}
