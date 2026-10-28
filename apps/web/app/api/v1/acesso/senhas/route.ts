import { cookies } from "next/headers";
import { COOKIE, COOKIE_MAX_AGE, addUser, cookieFor, listUsers, protectionEnabled, removeUser, sessionFrom, type Role } from "@/lib/server/site-auth";
import { badRequest, json } from "@/lib/http";

export const dynamic = "force-dynamic";

/** Só administrador — ou qualquer pessoa enquanto o site ainda não tem senha (para criar a primeira). */
async function allowed() {
  if (!protectionEnabled()) return true;
  return sessionFrom((await cookies()).get(COOKIE)?.value)?.role === "admin";
}

export async function GET() {
  if (!(await allowed())) return json({ error: "Só administradores." }, { status: 403, maxAge: 0 });
  return json({ protegido: protectionEnabled(), senhas: listUsers() }, { maxAge: 0 });
}

export async function POST(request: Request) {
  if (!(await allowed())) return json({ error: "Só administradores." }, { status: 403, maxAge: 0 });
  const body = (await request.json().catch(() => ({}))) as { nome?: unknown; senha?: unknown; papel?: unknown };
  const nome = typeof body.nome === "string" ? body.nome.trim().slice(0, 60) : "";
  const senha = typeof body.senha === "string" ? body.senha : "";
  const papel: Role = body.papel === "admin" ? "admin" : "viewer";
  if (!nome) return badRequest("Informe um nome para a senha (ex.: Família, Equipe).");
  if (senha.length < 6) return badRequest("A senha precisa ter pelo menos 6 caracteres.");
  const first = !protectionEnabled();
  const session = addUser(nome, senha, papel);
  const res = json({ ok: true, senhas: listUsers() }, { maxAge: 0 });
  // Quem criou a primeira senha já fica conectado (senão seria trancado para fora na hora).
  if (first) {
    const secure = new URL(request.url).protocol === "https:" || request.headers.get("x-forwarded-proto") === "https";
    res.headers.append("set-cookie", `${COOKIE}=${cookieFor(session)}; Path=/; Max-Age=${COOKIE_MAX_AGE}; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`);
  }
  return res;
}

export async function DELETE(request: Request) {
  if (!(await allowed())) return json({ error: "Só administradores." }, { status: 403, maxAge: 0 });
  const id = new URL(request.url).searchParams.get("id") ?? "";
  const err = removeUser(id);
  if (err) return badRequest(err);
  return json({ ok: true, senhas: listUsers() }, { maxAge: 0 });
}
