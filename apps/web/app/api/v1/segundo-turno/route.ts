import type { NextRequest } from "next/server";
import { STATES, raceKey, type Snapshot } from "@apuracao/core";
import { getIngestor, getSecondRoundIngestor } from "@/lib/server/ingestor";
import type { PublishedRace } from "@/lib/api-types";
import { badRequest, json } from "@/lib/http";

export const dynamic = "force-dynamic";

/** Votos dos dois finalistas num ponto da apuração. */
interface Point {
  pct: number;
  time: string;
  a: number;
  b: number;
}

/** Série de um turno: votos dos dois finalistas a cada atualização (ids do TSE → números via o resultado do turno). */
function series(history: Snapshot[], race: PublishedRace | null, a: string, b: string): Point[] {
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
function atPct(points: Point[], pct: number): { a: number; b: number } | null {
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

const votesOf = (race: PublishedRace | null, num: string) => race?.candidates.find((c) => c.number === num)?.votes ?? 0;

/**
 * Comparação ao vivo do 2º turno com o 1º turno:
 * /api/v1/segundo-turno?office=presidente&state=BR   (ou state=SP)
 * /api/v1/segundo-turno?office=governador&state=SP
 */
export function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const office = sp.get("office") === "governador" ? "governador" : "presidente";
  const scope = (sp.get("state") ?? (office === "presidente" ? "BR" : "SP")).toLowerCase();
  if (office === "governador" && scope === "br") return badRequest("Governador exige uma UF");
  if (scope !== "br" && !STATES.some((s) => s.uf.toLowerCase() === scope)) return badRequest("UF inválida");

  const main = getIngestor();
  const r2ing = getSecondRoundIngestor();
  const r1 = main.getRace(raceKey(1, office, scope));
  const r2 = r2ing?.getRace(raceKey(2, office, scope)) ?? null;

  // Finalistas: os dois do 2º turno (antes de sair o 1º arquivo, os dois mais votados do 1º turno).
  // A ordem fica FIXA pelo resultado do 1º turno, para o gráfico não inverter quando houver virada.
  const base = r2 ?? r1;
  const r1Votes = (num: string) => r1?.candidates.find((c) => c.number === num)?.votes ?? 0;
  const finalists = [...(base?.candidates ?? [])]
    .sort((x, y) => y.votes - x.votes)
    .slice(0, 2)
    .sort((x, y) => r1Votes(y.number) - r1Votes(x.number) || x.number.localeCompare(y.number))
    .map((c) => ({ number: c.number, name: c.name, party: c.party }));
  const [a, b] = [finalists[0]?.number ?? "", finalists[1]?.number ?? ""];

  // Presidente no Brasil: cada UF nos dois turnos, para comparar só onde o 2º turno já foi apurado.
  const byUf =
    office === "presidente" && scope === "br"
      ? STATES.map((s) => {
          const uf = s.uf.toLowerCase();
          const u1 = main.getRace(raceKey(1, "presidente", uf));
          const u2 = r2ing?.getRace(raceKey(2, "presidente", uf)) ?? null;
          // 1º turno da UF no mesmo % apurado que o 2º turno tem agora (quando a evolução foi guardada).
          const same = u2 ? atPct(series(main.getHistory(raceKey(1, "presidente", uf)), u1, a, b), u2.sectionsTotalizedPct) : null;
          return {
            uf: s.uf,
            name: s.name,
            r1: { a: votesOf(u1, a), b: votesOf(u1, b), pct: u1?.sectionsTotalizedPct ?? 0 },
            r1SamePoint: same,
            r2: { a: votesOf(u2, a), b: votesOf(u2, b), pct: u2?.sectionsTotalizedPct ?? 0 },
          };
        })
      : [];

  return json(
    {
      office,
      scope: scope.toUpperCase(),
      secondRoundEnabled: r2ing !== null,
      finalists,
      r1: r1
        ? { a: votesOf(r1, a), b: votesOf(r1, b), pct: r1.sectionsTotalizedPct, status: r1.status, timestamp: r1.officialTimestamp }
        : null,
      r2: r2
        ? { a: votesOf(r2, a), b: votesOf(r2, b), pct: r2.sectionsTotalizedPct, status: r2.status, timestamp: r2.officialTimestamp }
        : null,
      r1Series: series(main.getHistory(raceKey(1, office, scope)), r1, a, b),
      r2Series: r2ing ? series(r2ing.getHistory(raceKey(2, office, scope)), r2, a, b) : [],
      byUf,
    },
    { maxAge: 10 },
  );
}
