import { raceKey } from "@apuracao/core";
import { getExteriorTracker, getIngestor, getSecondRoundIngestor } from "@/lib/server/ingestor";
import type { ExteriorCityRound } from "@/lib/server/exterior";
import { countryOf } from "@/lib/exterior-countries";
import type { PublishedRace } from "@/lib/api-types";
import { json } from "@/lib/http";

export const dynamic = "force-dynamic";

/** Resumo de um turno: votos dos dois finalistas, demais candidatos, brancos, nulos e comparecimento. */
function summary(
  r: { pct: number; electorate: number; turnout: number; valid: number; blank: number; null: number; votes: Record<string, number> } | null,
  a: string,
  b: string,
) {
  if (!r) return null;
  const va = r.votes[a] ?? 0;
  const vb = r.votes[b] ?? 0;
  return {
    pct: r.pct,
    electorate: r.electorate,
    turnout: r.turnout,
    valid: r.valid,
    blank: r.blank,
    null: r.null,
    a: va,
    b: vb,
    others: Math.max(0, r.valid - va - vb),
  };
}

const fromRace = (race: PublishedRace | null) =>
  race
    ? {
        pct: race.sectionsTotalizedPct,
        electorate: race.totals.electorate,
        turnout: race.totals.turnout,
        valid: race.totals.valid,
        blank: race.totals.blank,
        null: race.totals.null,
        votes: Object.fromEntries(race.candidates.map((c) => [c.number, c.votes])),
      }
    : null;

/** Presidente no exterior, 1º × 2º turno: total e cada cidade. /api/v1/exterior */
export function GET() {
  const main = getIngestor();
  const r2ing = getSecondRoundIngestor();
  const tracker = getExteriorTracker();
  const r1br = main.getRace(raceKey(1, "presidente", "br"));
  const r1zz = main.getRace(raceKey(1, "presidente", "zz"));
  const r2zz = r2ing?.getRace(raceKey(2, "presidente", "zz")) ?? null;
  const r2br = r2ing?.getRace(raceKey(2, "presidente", "br")) ?? null;

  // Finalistas: os do 2º turno (ou os dois mais votados do 1º), na ordem do resultado do 1º turno no Brasil.
  const base = r2br ?? r2zz ?? r1br;
  const r1Votes = (num: string) => r1br?.candidates.find((c) => c.number === num)?.votes ?? 0;
  const finalists = [...(base?.candidates ?? [])]
    .sort((x, y) => y.votes - x.votes)
    .slice(0, 2)
    .sort((x, y) => r1Votes(y.number) - r1Votes(x.number) || x.number.localeCompare(y.number))
    .map((c) => ({ number: c.number, name: c.name, party: c.party }));
  const [a, b] = [finalists[0]?.number ?? "", finalists[1]?.number ?? ""];

  const snap = tracker?.getSnapshot() ?? null;
  return json(
    {
      finalists,
      restartNeeded: !tracker,
      total: { r1: summary(fromRace(r1zz), a, b), r2: summary(fromRace(r2zz), a, b), r2Timestamp: r2zz?.officialTimestamp ?? null },
      updatedAt: snap?.updatedAt ?? null,
      progress: snap?.progress ?? null,
      rounds: snap?.rounds ?? null,
      cities: (snap?.cities ?? []).map((c) => ({
        code: c.code,
        name: c.name,
        country: countryOf(c.name),
        r1: summary(c.r1 as ExteriorCityRound | null, a, b),
        r2: summary(c.r2 as ExteriorCityRound | null, a, b),
      })),
    },
    { maxAge: 15 },
  );
}
