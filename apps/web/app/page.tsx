import Link from "next/link";
import { RacePage } from "@/lib/server/race-page";
import { getIngestor } from "@/lib/server/ingestor";
import { StateGrid } from "@/components/state-grid";
import { TotalizationMap } from "@/components/totalization-map";

export const dynamic = "force-dynamic";

export default function Home() {
  const ingestor = getIngestor();
  const governors = ingestor.listRaces({ office: "governador" });
  return (
    <div className="space-y-8">
      <RacePage office="presidente" scope="br" />
      <TotalizationMap initialOffice="presidente" />
      {governors.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-baseline justify-between">
            <h2 className="text-xl font-bold">Governador por estado</h2>
            <Link href="/eleicoes/2026/governador" className="text-sm text-accent underline">
              Ver todos
            </Link>
          </div>
          <StateGrid cargo="governador" summaries={governors} />
        </section>
      )}
    </div>
  );
}
