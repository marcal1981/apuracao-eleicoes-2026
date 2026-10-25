import { getG1Exterior } from "@/lib/server/g1-exterior";
import { json } from "@/lib/http";

export const dynamic = "force-dynamic";

/** Parcial do exterior segundo o g1 (boletins de urna; não oficial). /api/v1/exterior/g1 */
export async function GET() {
  return json(await getG1Exterior(), { maxAge: 60 });
}
