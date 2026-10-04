import { getIngestor } from "@/lib/server/ingestor";
import { json } from "@/lib/http";

export const dynamic = "force-dynamic";

export function GET() {
  const s = getIngestor().getStatus();
  return json(
    {
      status: s.status,
      tse: s.tse,
      source: s.source,
      lastUpdate: s.lastPublishedAt,
      ingestion: s.lastCycleFinishedAt ? "running" : "starting",
    },
    { maxAge: 0 },
  );
}
