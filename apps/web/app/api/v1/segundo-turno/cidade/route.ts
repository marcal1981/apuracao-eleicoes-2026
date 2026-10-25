import type { NextRequest } from "next/server";
import { raceKey } from "@apuracao/core";
import { getIngestor, getSecondRoundIngestor } from "@/lib/server/ingestor";
import { cityOptions, getCityRounds } from "@/lib/server/city-rounds";
import { badRequest, json } from "@/lib/http";

export const dynamic = "force-dynamic";

/**
 * Presidente numa cidade de SP, 1º × 2º turno:
 * /api/v1/segundo-turno/cidade?ibge=3549904   (São José dos Campos)
 * /api/v1/segundo-turno/cidade?lista=1        (cidades disponíveis)
 */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  if (sp.get("lista")) return json({ cities: await cityOptions() }, { maxAge: 3600 });
  const ibge = sp.get("ibge") ?? "";
  if (!/^\d{7}$/.test(ibge)) return badRequest("Informe o código IBGE da cidade (7 dígitos)");

  // Finalistas na ordem do 1º turno no Brasil (a mesma das outras abas).
  const r1br = getIngestor().getRace(raceKey(1, "presidente", "br"));
  const r2br = getSecondRoundIngestor()?.getRace(raceKey(2, "presidente", "br")) ?? null;
  const r1Votes = (num: string) => r1br?.candidates.find((c) => c.number === num)?.votes ?? 0;
  const finalists = [...((r2br ?? r1br)?.candidates ?? [])]
    .sort((x, y) => y.votes - x.votes)
    .slice(0, 2)
    .sort((x, y) => r1Votes(y.number) - r1Votes(x.number) || x.number.localeCompare(y.number))
    .map((c) => ({ number: c.number, name: c.name }));

  const city = await getCityRounds(ibge);
  return json({ finalists, ...city }, { maxAge: 15 });
}
