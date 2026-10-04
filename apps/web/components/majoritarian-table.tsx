import { formatInt, formatPct } from "@apuracao/core";
import type { PublishedRace } from "@/lib/api-types";
import { CandidateTag, PositionChange } from "./status-badge";

/** Ranking de cargos majoritários. A linha divisória marca as vagas em disputa (ex.: 2 no Senado). */
export function MajoritarianTable({ race, seats }: { race: PublishedRace; seats: number }) {
  const final = race.status === "TOTALIZACAO_FINALIZADA";
  return (
    <ol className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface">
      {race.candidates.map((c) => {
        const isLeader = c.position === 1 && !final && c.votes > 0;
        return (
          <li
            key={c.id}
            className={`px-4 py-3 ${c.position === seats + 1 ? "border-t-2 border-dashed border-t-muted/60" : ""}`}
          >
            <div className="flex items-center gap-3">
              <span className="w-6 text-right text-lg font-bold text-muted">{c.position}º</span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="truncate font-semibold">{c.name}</span>
                  <CandidateTag elected={c.elected} secondRound={c.secondRound} officialStatus={c.officialStatus} />
                  {isLeader && !c.elected && (
                    <span className="rounded border border-border px-1.5 py-0.5 text-[11px] font-semibold uppercase text-muted">
                      Líder
                    </span>
                  )}
                </div>
                <div className="truncate text-xs text-muted">
                  {c.number} · {c.party}
                  {c.coalition ? ` (${c.coalition})` : ""}
                  {c.running ? ` · ${c.running}` : ""}
                </div>
              </div>
              <div className="text-right">
                <div className="text-lg font-bold">{formatPct(c.percentage)}</div>
                <div className="text-xs text-muted">{formatInt(c.votes)} votos</div>
              </div>
            </div>
            <div className="ml-9 mt-2 flex items-center gap-3">
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-border">
                <div className="h-full bg-accent/70" style={{ width: `${Math.min(100, c.percentage)}%` }} />
              </div>
              <span className="w-8 text-right text-xs">
                <PositionChange change={c.positionChange} />
              </span>
              <span className="w-28 text-right text-xs text-muted">
                {c.gapToPrevious ? `−${formatInt(c.gapToPrevious)} do ${c.position - 1}º` : ""}
              </span>
            </div>
            {c.voteDestination && !/^v[áa]lido$/i.test(c.voteDestination) && (
              <div className="ml-9 mt-1 text-xs text-muted">Destinação dos votos: {c.voteDestination}</div>
            )}
          </li>
        );
      })}
    </ol>
  );
}
