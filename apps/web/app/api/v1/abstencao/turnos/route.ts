import { STATES, raceKey } from "@apuracao/core";
import { getIngestor, getSecondRoundIngestor } from "@/lib/server/ingestor";
import type { PublishedRace } from "@/lib/api-types";
import { json } from "@/lib/http";

export const dynamic = "force-dynamic";

/**
 * Abstenção e votos para Presidente nos dois turnos, por UF (resultados do TSE já guardados):
 * GET /api/v1/abstencao/turnos
 */
export function GET() {
  const main = getIngestor();
  const r2ing = getSecondRoundIngestor();
  const r1br = main.getRace(raceKey(1, "presidente", "br"));
  const r2br = r2ing?.getRace(raceKey(2, "presidente", "br")) ?? null;
  const r1Votes = (num: string) => r1br?.candidates.find((c) => c.number === num)?.votes ?? 0;
  const finalists = [...((r2br ?? r1br)?.candidates ?? [])]
    .sort((x, y) => y.votes - x.votes)
    .slice(0, 2)
    .sort((x, y) => r1Votes(y.number) - r1Votes(x.number) || x.number.localeCompare(y.number))
    .map((c) => ({ number: c.number, name: c.name }));
  const [a, b] = [finalists[0]?.number ?? "", finalists[1]?.number ?? ""];

  const summary = (race: PublishedRace | null) => {
    if (!race) return null;
    const va = race.candidates.find((c) => c.number === a)?.votes ?? 0;
    const vb = race.candidates.find((c) => c.number === b)?.votes ?? 0;
    const t = race.totals;
    return {
      pct: race.sectionsTotalizedPct,
      electorate: t.electorate,
      turnout: t.turnout,
      abstention: t.abstention,
      blank: t.blank,
      null: t.null,
      valid: t.valid,
      a: va,
      b: vb,
      others: Math.max(0, t.valid - va - vb),
    };
  };
  const areas = [{ uf: "BR", name: "Brasil" }, ...STATES, { uf: "ZZ", name: "Exterior" }].map((s) => {
    const uf = s.uf.toLowerCase();
    return {
      uf: s.uf,
      name: s.name,
      r1: summary(main.getRace(raceKey(1, "presidente", uf))),
      r2: summary(r2ing?.getRace(raceKey(2, "presidente", uf)) ?? null),
    };
  });
  return json({ finalists, areas }, { maxAge: 60 });
}
