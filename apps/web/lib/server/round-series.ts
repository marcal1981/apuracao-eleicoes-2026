// Séries da apuração (votos dos dois finalistas a cada atualização), usadas pelo 2º turno ao vivo e pela calibração.

import type { Snapshot } from "@apuracao/core";
import type { PublishedRace } from "@/lib/api-types";

/** Votos dos dois finalistas num ponto da apuração. */
export interface Point {
  pct: number;
  time: string;
  a: number;
  b: number;
}

/** Série de um turno: votos dos dois finalistas a cada atualização (ids do TSE → números via o resultado do turno). */
export function series(history: Snapshot[], race: PublishedRace | null, a: string, b: string): Point[] {
  if (!race) return [];
  const numberOf = new Map(race.candidates.map((c) => [c.id, c.number]));
  return history
    .map((s) => {
      let va = 0;
      let vb = 0;
      for (const c of s.candidates) {
        const num = numberOf.get(c.id);
        if (num === a) va = c.votes;
        else if (num === b) vb = c.votes;
      }
      return { pct: s.sectionsTotalizedPct, time: s.officialTimestamp ?? s.receivedAt, a: va, b: vb };
    })
    .filter((p) => p.a + p.b > 0)
    .sort((x, y) => x.pct - y.pct || x.time.localeCompare(y.time));
}

/** Votos dos finalistas no 1º turno com o mesmo % apurado (interpolação na série); null fora do trecho guardado. */
export function atPct(points: Point[], pct: number): { a: number; b: number } | null {
  if (points.length === 0 || pct < points[0]!.pct || pct > points[points.length - 1]!.pct) return null;
  for (let i = 1; i < points.length; i++) {
    const p = points[i - 1]!;
    const q = points[i]!;
    if (pct <= q.pct) {
      const f = q.pct === p.pct ? 1 : (pct - p.pct) / (q.pct - p.pct);
      return { a: p.a + (q.a - p.a) * f, b: p.b + (q.b - p.b) * f };
    }
  }
  const last = points[points.length - 1]!;
  return { a: last.a, b: last.b };
}
