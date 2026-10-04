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

/** Marca "2º turno" ao lado do nome. A situação de eleito aparece em verde abaixo do nome (ElectedLine). */
export function CandidateTag({ secondRound }: { elected?: boolean; secondRound: boolean; officialStatus?: string }) {
  if (secondRound)
    return <span className="rounded bg-accent/15 px-1.5 py-0.5 text-[11px] font-bold uppercase text-accent">2º turno</span>;
  return null;
}

/**
 * Linha verde abaixo do nome: "Eleito" oficial (TSE) ou "Eleito — projeção" calculada com os votos
 * apurados até agora. A projeção some quando o TSE passa a informar a situação oficial.
 */
export function ElectedLine({
  elected,
  officialStatus,
  projected,
  showProjection,
}: {
  elected: boolean;
  officialStatus: string;
  projected?: "QP" | "média" | null;
  showProjection: boolean;
}) {
  if (elected)
    return <div className="text-xs font-bold text-elected">✔ {officialStatus || "Eleito"} (oficial TSE)</div>;
  if (showProjection && projected)
    return (
      <div className="text-xs font-semibold text-elected">
        Eleito {projected === "QP" ? "por QP" : "por média"} — projeção
      </div>
    );
  return null;
}
