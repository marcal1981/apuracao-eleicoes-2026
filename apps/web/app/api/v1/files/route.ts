import { getIngestor } from "@/lib/server/ingestor";
import { json } from "@/lib/http";

export const dynamic = "force-dynamic";

/** Lista os arquivos originais do TSE guardados pela plataforma. */
export async function GET() {
  return json({ files: await getIngestor().files.listRaw() }, { maxAge: 0 });
}
