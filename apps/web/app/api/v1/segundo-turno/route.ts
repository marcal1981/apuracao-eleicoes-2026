import type { NextRequest } from "next/server";
import { STATES, raceKey } from "@apuracao/core";
import { getIngestor, getSecondRoundIngestor } from "@/lib/server/ingestor";
import type { PublishedRace } from "@/lib/api-types";
import { badRequest, json } from "@/lib/http";
import { atPct, series } from "@/lib/server/round-series";

export const dynamic = "force-dynamic";

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
  if (office === "governador" && scope === "zz") return badRequest("No exterior só há votação para Presidente");
  if (scope !== "br" && scope !== "zz" && !STATES.some((s) => s.uf.toLowerCase() === scope)) return badRequest("UF inválida");

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
      ? [...STATES, { uf: "ZZ", name: "Exterior" }].map((s) => {
          const uf = s.uf.toLowerCase();
          const u1 = main.getRace(raceKey(1, "presidente", uf));
          const u2 = r2ing?.getRace(raceKey(2, "presidente", uf)) ?? null;
          // 1º turno da UF no mesmo % apurado que o 2º turno tem agora (quando a evolução foi guardada).
          const same = u2 ? atPct(series(main.getHistory(raceKey(1, "presidente", uf)), u1, a, b), u2.sectionsTotalizedPct) : null;
          return {
            uf: s.uf,
            name: s.name,
            r1: { a: votesOf(u1, a), b: votesOf(u1, b), pct: u1?.sectionsTotalizedPct ?? 0, valid: u1?.totals.valid ?? 0 },
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
      // Ligação com o TSE do acompanhamento do 2º turno (para a página avisar se algo não está chegando).
      link: r2ing
        ? {
            ...r2ing.getStatus(),
            ...r2ing.getLinkDiagnostics(),
            electionCodes: r2ing.config.electionCodes,
            now: new Date().toISOString(),
          }
        : null,
    },
    { maxAge: 10 },
  );
}
