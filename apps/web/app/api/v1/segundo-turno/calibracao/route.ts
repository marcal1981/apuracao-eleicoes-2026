import { STATES, raceKey } from "@apuracao/core";
import { getIngestor, getSecondRoundIngestor } from "@/lib/server/ingestor";
import { atPct, series, type Point } from "@/lib/server/round-series";
import type { UfState } from "@/lib/projection";
import { json } from "@/lib/http";

export const dynamic = "force-dynamic";

/** Quantos momentos da noite devolver (amostrados por igual ao longo da apuração). */
const MAX_MOMENTS = 240;

/**
 * "Rebobina" a apuração do 2º turno guardada pelo sistema: em cada momento, o estado de cada UF
 * (2º turno até ali e 1º turno no mesmo % apurado), para recalcular a projeção e comparar com o resultado final.
 * GET /api/v1/segundo-turno/calibracao
 */
export function GET() {
  const main = getIngestor();
  const r2ing = getSecondRoundIngestor();
  if (!r2ing) return json({ error: "Acompanhamento do 2º turno desligado (SECOND_ROUND=false)" }, { status: 404, maxAge: 0 });

  const r1br = main.getRace(raceKey(1, "presidente", "br"));
  const r2br = r2ing.getRace(raceKey(2, "presidente", "br"));
  if (!r2br) return json({ error: "Sem o resultado do 2º turno guardado" }, { status: 404, maxAge: 0 });
  const r1Votes = (num: string) => r1br?.candidates.find((c) => c.number === num)?.votes ?? 0;
  const finalists = [...r2br.candidates]
    .sort((x, y) => y.votes - x.votes)
    .slice(0, 2)
    .sort((x, y) => r1Votes(y.number) - r1Votes(x.number) || x.number.localeCompare(y.number))
    .map((c) => ({ number: c.number, name: c.name }));
  const [a, b] = [finalists[0]?.number ?? "", finalists[1]?.number ?? ""];
  const votes = (race: typeof r2br | null, num: string) => race?.candidates.find((c) => c.number === num)?.votes ?? 0;

  const byTime = (p: Point[]) => [...p].sort((x, y) => Date.parse(x.time) - Date.parse(y.time));
  const ufs = [...STATES.map((s) => s.uf), "ZZ"].map((UF) => {
    const uf = UF.toLowerCase();
    const u1 = main.getRace(raceKey(1, "presidente", uf));
    const u2 = r2ing.getRace(raceKey(2, "presidente", uf));
    return {
      uf: UF,
      r1: { a: votes(u1, a), b: votes(u1, b), pct: u1?.sectionsTotalizedPct ?? 0, valid: u1?.totals.valid ?? 0 },
      r1Series: series(main.getHistory(raceKey(1, "presidente", uf)), u1, a, b),
      r2Series: byTime(series(r2ing.getHistory(raceKey(2, "presidente", uf)), u2, a, b)),
    };
  });
  const brSeries = byTime(series(r2ing.getHistory(raceKey(2, "presidente", "br")), r2br, a, b));

  // Momentos: as atualizações do total nacional (amostradas), cada UF no último dado recebido até ali.
  const step = Math.max(1, Math.ceil(brSeries.length / MAX_MOMENTS));
  const picked = brSeries.filter((_, i) => i % step === 0 || i === brSeries.length - 1);
  const cursor = new Map<string, number>();
  const moments = picked.map((p) => {
    const t = Date.parse(p.time);
    const states: UfState[] = ufs.map((u) => {
      let i = cursor.get(u.uf) ?? -1;
      while (i + 1 < u.r2Series.length && Date.parse(u.r2Series[i + 1]!.time) <= t) i++;
      cursor.set(u.uf, i);
      const cur = i >= 0 ? u.r2Series[i]! : null;
      const r2 = cur ? { a: cur.a, b: cur.b, pct: cur.pct } : { a: 0, b: 0, pct: 0 };
      return { uf: u.uf, r1: u.r1, r1SamePoint: r2.pct > 0 ? atPct(u.r1Series, r2.pct) : null, r2 };
    });
    return { time: p.time, pct: p.pct, count: { a: p.a, b: p.b }, ufs: states };
  });

  return json(
    {
      finalists,
      final: { a: votes(r2br, a), b: votes(r2br, b), pct: r2br.sectionsTotalizedPct, status: r2br.status },
      // Quantas UFs têm a evolução do 1º turno guardada (sem ela, a projeção usa só o resultado final do 1º turno).
      ufsWithR1History: ufs.filter((u) => u.r1Series.length > 1).length,
      updates: brSeries.length,
      moments,
    },
    { maxAge: 60 },
  );
}
