import { COOKIE, COOKIE_MAX_AGE, checkPassword, cookieFor, protectionEnabled } from "@/lib/server/site-auth";
import { json } from "@/lib/http";

export const dynamic = "force-dynamic";

// Freio simples contra tentativas em série (por IP, em memória).
const attempts = new Map<string, { n: number; until: number }>();

export async function POST(request: Request) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  const now = Date.now();
  const a = attempts.get(ip);
  if (a && a.until > now) return json({ error: "Muitas tentativas. Espere um minuto e tente de novo." }, { status: 429, maxAge: 0 });

  const body = (await request.json().catch(() => ({}))) as { senha?: unknown };
  const senha = typeof body.senha === "string" ? body.senha : "";
  if (!protectionEnabled()) return json({ ok: true }, { maxAge: 0 });
  const session = senha ? checkPassword(senha) : null;
  if (!session) {
    // 5 erros seguidos: bloqueia por 1 minuto.
    const n = (a?.n ?? 0) + 1;
    attempts.set(ip, n >= 5 ? { n: 0, until: now + 60_000 } : { n, until: 0 });
    return json({ error: "Senha incorreta." }, { status: 401, maxAge: 0 });
  }
  attempts.delete(ip);
  const res = json({ ok: true, nome: session.name, papel: session.role }, { maxAge: 0 });
  const secure = new URL(request.url).protocol === "https:" || request.headers.get("x-forwarded-proto") === "https";
  res.headers.append("set-cookie", `${COOKIE}=${cookieFor(session)}; Path=/; Max-Age=${COOKIE_MAX_AGE}; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`);
  return res;
}
