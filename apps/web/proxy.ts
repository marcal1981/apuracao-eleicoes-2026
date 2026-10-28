import { NextResponse, type NextRequest } from "next/server";
import { COOKIE, protectionEnabled, sessionFrom } from "@/lib/server/site-auth";

/** Senha de acesso: sem cookie válido, páginas vão para /entrar e a API responde 401. */
export function proxy(request: NextRequest) {
  if (!protectionEnabled()) return NextResponse.next();
  const session = sessionFrom(request.cookies.get(COOKIE)?.value);
  const { pathname, search } = request.nextUrl;
  if (session) {
    // Gerenciar senhas é só para administradores.
    if ((pathname === "/senhas" || pathname.startsWith("/api/v1/acesso/senhas")) && session.role !== "admin") {
      return pathname.startsWith("/api/") ? Response.json({ error: "Só administradores." }, { status: 403 }) : NextResponse.redirect(new URL("/", request.url));
    }
    return NextResponse.next();
  }
  if (pathname.startsWith("/api/")) return Response.json({ error: "Senha de acesso necessária." }, { status: 401, headers: { "cache-control": "no-store" } });
  const url = new URL("/entrar", request.url);
  if (pathname !== "/") url.searchParams.set("voltar", pathname + search);
  return NextResponse.redirect(url);
}

export const config = {
  // Tudo, menos a própria tela de entrada, o login e os arquivos do Next/ícones.
  matcher: ["/((?!entrar|api/v1/acesso/entrar|api/v1/acesso/eu|_next/static|_next/image|icon.svg|favicon.ico|manifest.webmanifest).*)"],
};
