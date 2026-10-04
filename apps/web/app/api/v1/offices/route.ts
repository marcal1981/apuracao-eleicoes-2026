import { OFFICES, STATES } from "@apuracao/core";
import { json } from "@/lib/http";

export function GET() {
  return json({ offices: Object.values(OFFICES), states: STATES }, { maxAge: 3600 });
}
