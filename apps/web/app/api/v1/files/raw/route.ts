import type { NextRequest } from "next/server";
import { getIngestor } from "@/lib/server/ingestor";

export const dynamic = "force-dynamic";

/** Abre (ou baixa, com ?download=1) um arquivo original do TSE guardado. */
export async function GET(req: NextRequest) {
  const rel = req.nextUrl.searchParams.get("path") ?? "";
  const body = await getIngestor().files.readRaw(rel);
  if (body === null) return new Response("Arquivo não encontrado", { status: 404 });
  const name = rel.split("/").slice(-2).join("_");
  const download = req.nextUrl.searchParams.get("download") === "1";
  return new Response(body, {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `${download ? "attachment" : "inline"}; filename="${name}"`,
      "cache-control": "no-store",
    },
  });
}
