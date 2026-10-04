import { getIngestor } from "@/lib/server/ingestor";
import { csvResponse } from "@/lib/csv";
import type { AuditEvent } from "@/lib/api-types";

export const dynamic = "force-dynamic";

/** Registro de auditoria completo em planilha. */
export async function GET() {
  const text = await getIngestor().files.readAudit();
  const events = text
    .split("\n")
    .filter(Boolean)
    .map((l) => {
      try {
        return JSON.parse(l) as AuditEvent;
      } catch {
        return null;
      }
    })
    .filter((e): e is AuditEvent => !!e);
  return csvResponse("auditoria.csv", [
    ["Data/hora (UTC)", "Nível", "Mensagem", "Disputa", "SHA-256"],
    ...events.map((e) => [e.at, e.level, e.message, e.key ?? "", e.hash ?? ""]),
  ]);
}
