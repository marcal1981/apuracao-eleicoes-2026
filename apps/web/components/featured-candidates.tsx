"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { formatInt, formatPct, matchesCandidate, type CandidateResult, type Snapshot } from "@apuracao/core";
import type { PublishedRace } from "@/lib/api-types";
import { CandidateTag, ElectedLine, PositionChange } from "./status-badge";

const storageKey = (raceKey: string) => `apuracao:fixados:${raceKey}`;

/** Candidatos fixados por quem está vendo (salvos neste navegador). */
export function usePinned(raceKey: string) {
  const [pinned, setPinned] = useState<string[]>([]);

  useEffect(() => {
    try {
      setPinned(JSON.parse(localStorage.getItem(storageKey(raceKey)) ?? "[]") as string[]);
    } catch {
      setPinned([]);
    }
  }, [raceKey]);

  const toggle = useCallback(
    (id: string) => {
      setPinned((current) => {
        const next = current.includes(id) ? current.filter((x) => x !== id) : [...current, id];
        try {
          localStorage.setItem(storageKey(raceKey), JSON.stringify(next));
        } catch {}
        return next;
      });
    },
    [raceKey],
  );

  return { pinned, toggle };
}

interface Props {
  race: PublishedRace;
  history: Snapshot[];
  /** Destaques definidos na configuração (nome ou #número). */
  queries: string[];
  /** Ids fixados por quem está vendo. */
  pinned: string[];
  onUnpin: (id: string) => void;
}

/** Cartões fixados no topo com a votação dos candidatos em destaque. */
export function FeaturedCandidates({ race, history, queries, pinned, onUnpin }: Props) {
  const fromConfig = useMemo(
    () => race.candidates.filter((c) => queries.some((q) => matchesCandidate(c, q))),
    [race.candidates, queries],
  );
  const fromUser = race.candidates.filter((c) => pinned.includes(c.id) && !fromConfig.some((f) => f.id === c.id));
  const missing = queries.filter((q) => !race.candidates.some((c) => matchesCandidate(c, q)));

  if (fromConfig.length === 0 && fromUser.length === 0 && missing.length === 0) return null;

  return (
    <div className="space-y-2" aria-label="Candidatos em destaque">
      {[...fromConfig, ...fromUser].map((c) => (
        <FeaturedCard
          key={c.id}
          c={c}
          race={race}
          history={history}
          onUnpin={fromConfig.includes(c) ? undefined : () => onUnpin(c.id)}
        />
      ))}
      {missing.map((q) => (
        <p key={q} className="rounded-lg border border-dashed border-border px-4 py-2 text-sm text-muted">
          Candidato em destaque “{q.split("|").join(" / ")}” não encontrado nesta disputa. Confira o nome de urna, o cargo e a UF.
        </p>
      ))}
    </div>
  );
}

function FeaturedCard({
  c,
  race,
  history,
  onUnpin,
}: {
  c: CandidateResult;
  race: PublishedRace;
  history: Snapshot[];
  onUnpin?: () => void;
}) {
  const series = history
    .map((s) => s.candidates.find((x) => x.id === c.id))
    .filter((x): x is NonNullable<typeof x> => !!x);
  const above = race.candidates[c.position - 2];
  const below = race.candidates[c.position];

  return (
    <article className="rounded-xl border-2 border-accent bg-surface p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[11px] font-bold uppercase tracking-wide text-accent">Em destaque</div>
          <div className="mt-0.5 flex flex-wrap items-center gap-2">
            <h2 className="truncate text-xl font-bold">{c.name}</h2>
            <CandidateTag elected={c.elected} secondRound={c.secondRound} officialStatus={c.officialStatus} />
          </div>
          <ElectedLine
            elected={c.elected}
            officialStatus={c.officialStatus}
            projected={c.projected}
            showProjection={!race.candidates.some((x) => x.elected) && race.status !== "TOTALIZACAO_FINALIZADA"}
          />
          <div className="truncate text-xs text-muted">
            {c.number} · {c.party}
            {c.coalition ? ` (${c.coalition})` : ""}
          </div>
        </div>
        {onUnpin && (
          <button
            onClick={onUnpin}
            className="shrink-0 rounded-full border border-border px-2 py-0.5 text-xs text-muted hover:border-accent hover:text-accent"
            aria-label={`Desafixar ${c.name}`}
          >
            ★ Desafixar
          </button>
        )}
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div>
          <dt className="text-xs text-muted">Votos</dt>
          <dd className="text-2xl font-bold">{formatInt(c.votes)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">% dos válidos</dt>
          <dd className="text-2xl font-bold">{formatPct(c.percentage)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">Posição</dt>
          <dd className="text-2xl font-bold">
            {c.position}º <span className="text-sm font-normal text-muted">de {race.candidates.length}</span>{" "}
            <span className="text-sm">
              <PositionChange change={c.positionChange} />
            </span>
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted">Diferença</dt>
          <dd className="text-sm">
            {above ? (
              <div>
                {above.votes === c.votes
                  ? `Empatado com o ${above.position}º`
                  : `−${formatInt(above.votes - c.votes)} para o ${above.position}º`}
              </div>
            ) : (
              <div>Mais votado</div>
            )}
            {below && (
              <div className="text-muted">
                {below.votes === c.votes
                  ? `Empatado com o ${below.position}º`
                  : `+${formatInt(c.votes - below.votes)} sobre o ${below.position}º`}
              </div>
            )}
          </dd>
        </div>
      </dl>

      {series.length > 1 && <Sparkline values={series.map((s) => s.votes)} />}
      {race.office.startsWith("deputado") && !c.elected && (
        <p className="mt-2 text-[11px] text-muted">
          {c.projected
            ? "Projeção pelas regras do quociente eleitoral com os votos apurados até agora; o oficial é o do TSE."
            : "Pela projeção atual (quociente eleitoral e médias), ainda fora das vagas."}
        </p>
      )}
    </article>
  );
}

/** Evolução da votação ao longo das atualizações recebidas. */
function Sparkline({ values }: { values: number[] }) {
  const w = 300;
  const h = 40;
  const max = Math.max(...values, 1);
  const points = values.map((v, i) => `${(i / (values.length - 1)) * w},${h - (v / max) * (h - 4) - 2}`).join(" ");
  return (
    <div className="mt-3">
      <div className="text-xs text-muted">Evolução dos votos</div>
      <svg viewBox={`0 0 ${w} ${h}`} className="h-10 w-full" preserveAspectRatio="none" aria-hidden>
        <polyline points={points} fill="none" stroke="var(--accent)" strokeWidth={2} vectorEffect="non-scaling-stroke" />
      </svg>
    </div>
  );
}
