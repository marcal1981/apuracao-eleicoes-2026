import type { NextRequest } from "next/server";
import { STATES } from "@apuracao/core";
import { getIngestor } from "@/lib/server/ingestor";
import { getAbstentionProfile } from "@/lib/server/abstention-profile";
import { badRequest, json } from "@/lib/http";

export const dynamic = "force-dynamic";

/**
 * Perfil de quem compareceu e de quem faltou (dados abertos do TSE):
 * /api/v1/abstencao/perfil?uf=BA   (ou uf=BR para o país, uf=ZZ para o exterior)
 */
export function GET(req: NextRequest) {
  const uf = (req.nextUrl.searchParams.get("uf") ?? "BR").toUpperCase();
  if (uf !== "BR" && uf !== "ZZ" && !STATES.some((s) => s.uf === uf)) return badRequest("UF inválida");
  const profile = getAbstentionProfile(getIngestor());
  profile.ensure();
  const turns = profile.profile(uf);
  // Municípios só por UF (o país inteiro teria mais de 5 mil).
  const data = turns
    ? Object.fromEntries(Object.entries(turns).map(([t, p]) => [t, uf === "BR" ? { ...p, cities: {} } : p]))
    : null;
  return json({ uf, status: profile.status, turns: data }, { maxAge: 30 });
}
