import { COOKIE } from "@/lib/server/site-auth";

export const dynamic = "force-dynamic";

export function GET(request: Request) {
  const res = Response.redirect(new URL("/entrar", request.url), 303);
  const headers = new Headers(res.headers);
  headers.append("set-cookie", `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`);
  return new Response(null, { status: 303, headers });
}
