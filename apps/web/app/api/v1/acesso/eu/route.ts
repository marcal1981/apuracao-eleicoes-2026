import { cookies } from "next/headers";
import { COOKIE, protectionEnabled, sessionFrom } from "@/lib/server/site-auth";
import { json } from "@/lib/http";

export const dynamic = "force-dynamic";

/** Quem está conectado (para o cabeçalho mostrar "Senhas" e "Sair"). */
export async function GET() {
  const session = sessionFrom((await cookies()).get(COOKIE)?.value);
  return json({ protegido: protectionEnabled(), nome: session?.name ?? null, papel: session?.role ?? null }, { maxAge: 0 });
}
