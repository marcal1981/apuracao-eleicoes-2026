"use client";

import { useCallback, useEffect, useState } from "react";
import { OFFICES, formatDateTimeBrasilia, formatInt, formatPct, formatTimeBrasilia, type OfficeKey } from "@apuracao/core";
import type { PublishedRace } from "@/lib/api-types";
import { useLive } from "./use-live";
import { MajoritarianTable } from "./majoritarian-table";
import { ProportionalTable } from "./proportional-table";
import { StatusBadge } from "./status-badge";
import { FeaturedCandidates, usePinned } from "./featured-candidates";

interface Props {
  office: OfficeKey;
  scope: string;
  round: number;
  raceKey: string;
  title: string;
  initial: PublishedRace | null;
  /** Candidatos fixados pela configuração do servidor (nome ou #número). */
  featuredQueries?: string[];
}

export function RaceView({ office, scope, round, raceKey, title, initial, featuredQueries = [] }: Props) {
  const { pinned, toggle } = usePinned(raceKey);
  const [race, setRace] = useState(initial);
  const query = `office=${office}&state=${scope.toUpperCase()}&round=${round}`;

  const refresh = useCallback(async () => {
    const r = await fetch(`/api/v1/results?${query}`, { cache: "no-store" });
    if (r.ok) setRace((await r.json()) as PublishedRace);
  }, [query]);

  const connection = useLive((event) => {
    if (event.type === "result_update" && event.key === raceKey) refresh().catch(() => {});
  });

  // Se o canal em tempo real cair, faz uma consulta periódica à API própria (nunca ao TSE).
  useEffect(() => {
    if (connection === "open") return;
    const id = setInterval(() => refresh().catch(() => {}), 30_000);
    return () => clearInterval(id);
  }, [connection, refresh]);

  const def = OFFICES[office];

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
          <p className="text-sm text-muted">
            {round}º turno · {def.system === "majoritario" ? `Vagas em disputa: ${def.seats ?? 1}` : "Eleição proporcional"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {race && def.system === "proporcional" && (
            <a
              href={`/api/v1/export/quase-eleitos?${query}`}
              className="rounded-full border border-border px-3 py-1 text-xs font-semibold hover:border-accent hover:text-accent"
              title="PDF com os 20 candidatos não eleitos que ficaram mais perto da vaga na própria lista"
            >
              PDF: quase eleitos
            </a>
          )}
          {race && (
            <a
              href={`/api/v1/export/results?${query}`}
              className="rounded-full border border-border px-3 py-1 text-xs font-semibold hover:border-accent hover:text-accent"
            >
              Baixar planilha
            </a>
          )}
          <StatusBadge status={race?.status ?? "AGUARDANDO"} stale={race?.stale ?? false} connection={connection} />
        </div>
      </div>

      {!race ? (
        <div className="rounded-xl border border-border bg-surface p-6 text-center text-muted">
          Aguardando a divulgação oficial do TSE. A página será atualizada automaticamente.
        </div>
      ) : (
        <>
          {race.stale && (
            <div role="alert" className="rounded-lg border border-amber-500/50 bg-amber-500/10 px-4 py-2 text-sm">
              Dados temporariamente sem atualização. Última atualização oficial recebida às{" "}
              <strong>{formatTimeBrasilia(race.receivedAt)}</strong>.
            </div>
          )}
          <FeaturedCandidates
            race={race}
            queries={featuredQueries}
            pinned={pinned}
            onUnpin={toggle}
          />
          <Indicators race={race} />
          {def.system === "majoritario" ? (
            <MajoritarianTable race={race} seats={def.seats ?? 1} pinned={pinned} onTogglePin={toggle} />
          ) : (
            <ProportionalTable race={race} pinned={pinned} onTogglePin={toggle} />
          )}
          <SourceNote race={race} />
        </>
      )}
    </section>
  );
}

function Indicators({ race }: { race: PublishedRace }) {
  const t = race.totals;
  const items = [
    { label: "Comparecimento", value: formatInt(t.turnout), sub: formatPct(t.turnoutPct) },
    { label: "Abstenção", value: formatInt(t.abstention), sub: formatPct(t.abstentionPct) },
    { label: "Votos válidos", value: formatInt(t.valid), sub: formatPct(t.validPct) },
    { label: "Brancos", value: formatInt(t.blank), sub: formatPct(t.blankPct) },
    { label: "Nulos", value: formatInt(t.null), sub: formatPct(t.nullPct) },
    { label: "Eleitorado", value: formatInt(t.electorate), sub: "" },
  ];
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm text-muted">Seções totalizadas</span>
        <span className="text-sm text-muted">
          Atualização oficial: <strong className="text-text">{formatDateTimeBrasilia(race.officialTimestamp)}</strong>
        </span>
      </div>
      <div className="mt-1 text-3xl font-bold">{formatPct(race.sectionsTotalizedPct)}</div>
      <div
        className="mt-2 h-2 overflow-hidden rounded-full bg-border"
        role="progressbar"
        aria-valuenow={race.sectionsTotalizedPct}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div className="h-full bg-accent transition-[width] duration-700" style={{ width: `${race.sectionsTotalizedPct}%` }} />
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3 lg:grid-cols-6">
        {items.map((i) => (
          <div key={i.label}>
            <dt className="text-xs text-muted">{i.label}</dt>
            <dd className="font-semibold">{i.value}</dd>
            {i.sub && <dd className="text-xs text-muted">{i.sub}</dd>}
          </div>
        ))}
      </dl>
    </div>
  );
}

function SourceNote({ race }: { race: PublishedRace }) {
  return (
    <details className="rounded-lg border border-border bg-surface px-4 py-2 text-xs text-muted">
      <summary className="cursor-pointer">Origem dos dados</summary>
      <dl className="mt-2 grid gap-1 break-all">
        <div>
          <dt className="inline font-semibold">Arquivo oficial: </dt>
          <dd className="inline">{race.sourceUrl}</dd>
        </div>
        <div>
          <dt className="inline font-semibold">SHA-256: </dt>
          <dd className="inline font-mono">{race.sourceHash}</dd>
        </div>
        <div>
          <dt className="inline font-semibold">Recebido / publicado: </dt>
          <dd className="inline">
            {formatTimeBrasilia(race.receivedAt)} / {formatTimeBrasilia(race.processedAt)}
          </dd>
        </div>
      </dl>
    </details>
  );
}
