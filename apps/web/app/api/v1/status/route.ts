import { getIngestor } from "@/lib/server/ingestor";
import { json } from "@/lib/http";

export const dynamic = "force-dynamic";

export function GET() {
  const ingestor = getIngestor();
  return json({ ...ingestor.getStatus(), audit: ingestor.getAudit(50) }, { maxAge: 2 });
}
