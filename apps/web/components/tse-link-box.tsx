"use client";

import { formatTimeBrasilia } from "@apuracao/core";

export interface TseLink {
  source: "tse" | "mock";
  tse: "online" | "offline" | "unknown";
  cycles: number;
  pollIntervalMs: number;
  lastCycleFinishedAt: string | null;
  lastReceivedAt: string | null;
  racesTracked: number;
  racesWithData: number;
  errorsLastCycle: number;
  notPublishedLastCycle: number;
  notPublishedExample: string | null;
  forbidden: number;
  lastError: string | null;
  sampleUrl: string | null;
  electionCodes: { federal: string; state: string };
  now: string;
}

type Tone = "ok" | "wait" | "bad";

/** Situação da ligação com o TSE para o 2º turno, em linguagem simples (substitui olhar o cmd). */
function diagnose(l: TseLink): { tone: Tone; title: string; detail: string } {
  const published = l.racesTracked - l.notPublishedLastCycle;
  const late = l.lastCycleFinishedAt !== null && Date.parse(l.now) - Date.parse(l.lastCycleFinishedAt) > l.pollIntervalMs * 3 + 60_000;
  if (l.source === "mock") return { tone: "wait", title: "Modo simulação", detail: "Os números são simulados (TSE_SOURCE=mock no .env)." };
  if (l.cycles === 0) return { tone: "wait", title: "Conectando ao TSE…", detail: "A primeira consulta ainda está em andamento." };
  if (late)
    return { tone: "bad", title: "Consultas paradas", detail: "O sistema não consulta o TSE há alguns minutos. Feche e abra de novo o npm run dev." };
  if (l.tse === "offline" && l.forbidden > 0 && l.forbidden >= l.notPublishedLastCycle && published === 0)
    return { tone: "bad", title: "O TSE está recusando o acesso (HTTP 403)", detail: "Pode ser bloqueio temporário por excesso de consultas ou da rede. Tente outra rede ou aguarde alguns minutos." };
  if (l.tse === "offline")
    return { tone: "bad", title: "Sem resposta do TSE", detail: l.lastError ? `Último erro: ${l.lastError}` : "Confira a internet do computador." };
  if (l.racesWithData === 0 && l.notPublishedLastCycle > 0)
    return {
      tone: "wait",
      title: "Conectado ao TSE — arquivos do 2º turno ainda não publicados",
      detail: "Normal antes do fim da votação (19h de Brasília, com a prorrogação). Se continuar assim depois das 19h30, os códigos da eleição podem ser outros.",
    };
  if (l.errorsLastCycle > 0)
    return { tone: "wait", title: "Conectado ao TSE, com falhas pontuais", detail: `${l.errorsLastCycle} consultas falharam no último ciclo e serão repetidas. ${l.lastError ?? ""}` };
  return {
    tone: "ok",
    title: "Conectado ao TSE — recebendo o 2º turno",
    detail: `${published} de ${l.racesTracked} arquivos do 2º turno publicados pelo TSE.`,
  };
}

const TONE: Record<Tone, { dot: string; box: string }> = {
  ok: { dot: "bg-emerald-500", box: "border-emerald-500/40 bg-emerald-500/5" },
  wait: { dot: "bg-amber-500", box: "border-amber-500/50 bg-amber-500/10" },
  bad: { dot: "bg-red-600", box: "border-red-600/50 bg-red-600/10" },
};

export function TseLinkBox({ link }: { link: TseLink }) {
  const d = diagnose(link);
  const t = TONE[d.tone];
  return (
    <details className={`rounded-xl border px-4 py-3 text-sm ${t.box}`}>
      <summary className="flex cursor-pointer flex-wrap items-center gap-x-3 gap-y-1">
        <span className={`inline-block h-2.5 w-2.5 rounded-full ${t.dot} ${d.tone === "ok" ? "animate-pulse" : ""}`} aria-hidden />
        <strong>{d.title}</strong>
        <span className="text-muted">
          {link.lastCycleFinishedAt ? `última consulta às ${formatTimeBrasilia(link.lastCycleFinishedAt)}` : ""}
          {link.lastReceivedAt ? ` · último dado novo às ${formatTimeBrasilia(link.lastReceivedAt)}` : ""}
        </span>
        <span className="ml-auto text-xs text-muted">detalhes</span>
      </summary>
      <div className="mt-2 space-y-1 text-muted">
        <p>{d.detail}</p>
        <p>
          Eleição consultada: {link.electionCodes.federal} (Presidente) e {link.electionCodes.state} (Governador), a cada{" "}
          {Math.round(link.pollIntervalMs / 1000)} segundos · {link.cycles} consultas desde que o sistema abriu. Se o TSE usar outros
          códigos, ajuste TSE_ELECTION_FEDERAL_R2 e TSE_ELECTION_STATE_R2 no .env.
        </p>
        {(link.notPublishedExample ?? link.sampleUrl) && (
          <p className="break-all">
            Para conferir no navegador:{" "}
            <a href={link.notPublishedExample ?? link.sampleUrl!} target="_blank" rel="noreferrer" className="underline hover:text-accent">
              {link.notPublishedExample ?? link.sampleUrl}
            </a>
          </p>
        )}
      </div>
    </details>
  );
}
