import type { RaceStatus } from "@apuracao/core";
import type { LiveConnection } from "./use-live";

const LABELS: Record<RaceStatus, string> = {
  AGUARDANDO: "Aguardando",
  APURACAO_EM_ANDAMENTO: "Apuração em andamento",
  TOTALIZACAO_FINALIZADA: "Totalização finalizada",
};

export function StatusBadge({
  status,
  stale,
  connection,
}: {
  status: RaceStatus;
  stale: boolean;
  connection?: LiveConnection;
}) {
  const live = status === "APURACAO_EM_ANDAMENTO" && !stale && connection === "open";
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-border bg-surface px-3 py-1 text-xs font-semibold uppercase tracking-wide">
      {live && <span className="h-2 w-2 animate-pulse rounded-full bg-down" aria-hidden />}
      {stale ? "Dados sendo atualizados" : LABELS[status]}
    </span>
  );
}

export function PositionChange({ change }: { change: number | null }) {
  if (change === null || change === 0) return <span className="text-muted">—</span>;
  return change > 0 ? (
    <span className="text-up" title={`Subiu ${change} posição(ões)`}>↑{change}</span>
  ) : (
    <span className="text-down" title={`Caiu ${-change} posição(ões)`}>↓{-change}</span>
  );
}

/** Situação oficial do candidato. "Eleito" só aparece quando o TSE informa. */
export function CandidateTag({ elected, secondRound, officialStatus }: { elected: boolean; secondRound: boolean; officialStatus: string }) {
  if (elected)
    return <span className="rounded bg-elected/15 px-1.5 py-0.5 text-[11px] font-bold uppercase text-elected">{officialStatus || "Eleito"}</span>;
  if (secondRound)
    return <span className="rounded bg-accent/15 px-1.5 py-0.5 text-[11px] font-bold uppercase text-accent">2º turno</span>;
  return null;
}
