import type { NextRequest } from "next/server";
import { STATES } from "@apuracao/core";
import { estimateSecondRoundByAge } from "@/lib/server/age-estimate";
import { badRequest, json } from "@/lib/http";

export const dynamic = "force-dynamic";

/** Estimativa (não oficial) da abstenção do 2º turno por faixa de idade: /api/v1/abstencao/estimativa-idade?uf=BA */
export function GET(req: NextRequest) {
  const uf = (req.nextUrl.searchParams.get("uf") ?? "").toUpperCase();
  if (!STATES.some((s) => s.uf === uf)) return badRequest("Escolha um estado (a estimativa usa os municípios dele)");
  return json({ uf, ...estimateSecondRoundByAge(uf) }, { maxAge: 30 });
}
