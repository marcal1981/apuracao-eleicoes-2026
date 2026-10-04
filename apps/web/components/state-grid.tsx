import Link from "next/link";
import { STATES, formatPct } from "@apuracao/core";
import type { RaceSummary } from "@/lib/api-types";

/** Grade de UFs com o percentual totalizado e o primeiro colocado atual de cada uma. */
export function StateGrid({ cargo, summaries }: { cargo: string; summaries: RaceSummary[] }) {
  const byScope = new Map(summaries.map((s) => [s.scope, s]));
  return (
    <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
      {STATES.map((st) => {
        const s = byScope.get(st.uf.toLowerCase());
        const href = `/eleicoes/2026/${cargo === "deputado-estadual" && st.uf === "DF" ? "deputado-distrital" : cargo}/${st.uf.toLowerCase()}`;
        return (
          <li key={st.uf}>
            <Link href={href} className="block rounded-xl border border-border bg-surface p-3 hover:border-accent">
              <div className="flex items-baseline justify-between">
                <span className="font-bold">{st.uf}</span>
                <span className="text-xs text-muted">{s ? formatPct(s.sectionsTotalizedPct) : "—"}</span>
              </div>
              <div className="truncate text-xs text-muted">{st.name}</div>
              <div className="mt-1 truncate text-sm">
                {s?.leader ? (
                  <>
                    <span className="font-medium">{s.leader.name}</span>{" "}
                    <span className="text-muted">{formatPct(s.leader.percentage)}</span>
                  </>
                ) : (
                  <span className="text-muted">Aguardando</span>
                )}
              </div>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
