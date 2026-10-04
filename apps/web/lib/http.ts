/** Respostas JSON com cache curto em CDN: protege a origem nos picos sem atrasar a atualização. */
export function json(data: unknown, init?: { status?: number; maxAge?: number }) {
  const maxAge = init?.maxAge ?? 5;
  return Response.json(data, {
    status: init?.status ?? 200,
    headers: {
      "cache-control": maxAge > 0 ? `public, max-age=0, s-maxage=${maxAge}, stale-while-revalidate=${maxAge * 2}` : "no-store",
    },
  });
}

export function badRequest(message: string) {
  return json({ error: message }, { status: 400, maxAge: 0 });
}
