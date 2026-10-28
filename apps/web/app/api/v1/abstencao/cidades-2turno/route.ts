import type { NextRequest } from "next/server";
import { STATES } from "@apuracao/core";
import { compareCitiesByProfile } from "@/lib/server/city-profile-compare";
import { badRequest, json } from "@/lib/http";

export const dynamic = "force-dynamic";

/** Abstenção dos municípios do estado nos dois turnos, por grupos de perfil: /api/v1/abstencao/cidades-2turno?uf=BA */
export function GET(req: NextRequest) {
  const uf = (req.nextUrl.searchParams.get("uf") ?? "").toUpperCase();
  if (!STATES.some((s) => s.uf === uf)) return badRequest("Escolha um estado (a comparação usa os municípios dele)");
  return json({ uf, ...compareCitiesByProfile(uf) }, { maxAge: 30 });
}
