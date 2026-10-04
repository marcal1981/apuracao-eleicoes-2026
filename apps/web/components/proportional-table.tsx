"use client";

import { useMemo, useState } from "react";
import { formatInt, formatPct } from "@apuracao/core";
import type { PublishedRace } from "@/lib/api-types";
import { CandidateTag, PositionChange } from "./status-badge";
import { PinButton } from "./pin-button";

const PAGE = 50;

/**
 * Deputados: a ordem por votos não define os eleitos (há quociente eleitoral e sobras).
 * A lista de eleitos e a distribuição por partido/federação usam apenas a situação oficial do TSE.
 */
export function ProportionalTable({
  race,
  pinned = [],
  onTogglePin,
}: {
  race: PublishedRace;
  pinned?: string[];
  onTogglePin?: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [onlyElected, setOnlyElected] = useState(false);
  const [limit, setLimit] = useState(PAGE);

  const elected = race.candidates.filter((c) => c.elected);
  const byParty = useMemo(() => {
    const map = new Map<string, number>();
    for (const c of elected) {
      const group = c.coalition ?? c.party;
      map.set(group, (map.get(group) ?? 0) + 1);
    }
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  }, [elected]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return race.candidates.filter(
      (c) =>
        (!onlyElected || c.elected) &&
        (!q ||
          c.name.toLowerCase().includes(q) ||
          c.party.toLowerCase().includes(q) ||
          (c.coalition ?? "").toLowerCase().includes(q) ||
          c.number.includes(q)),
    );
  }, [race.candidates, query, onlyElected]);

  return (
    <div className="space-y-4">
      {byParty.length > 0 ? (
        <div className="rounded-xl border border-border bg-surface p-4">
          <h2 className="font-semibold">Cadeiras por partido/federação, conforme resultado oficial ({elected.length})</h2>
          <ul className="mt-2 grid gap-1 text-sm sm:grid-cols-2">
            {byParty.map(([party, seats]) => (
              <li key={party} className="flex justify-between gap-3 border-b border-border py-1">
                <span className="truncate">{party}</span>
                <strong>{seats}</strong>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="rounded-lg border border-border bg-surface px-4 py-2 text-sm text-muted">
          Os eleitos serão indicados quando o TSE divulgar a situação oficial dos candidatos. A posição por votação
          nominal não determina, sozinha, quem ocupa as cadeiras.
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <input
          type="search"
          placeholder="Buscar candidato, partido ou número"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setLimit(PAGE);
          }}
          className="min-w-0 flex-1 rounded-lg border border-border bg-surface px-3 py-2 text-sm"
        />
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={onlyElected} onChange={(e) => setOnlyElected(e.target.checked)} />
          Somente eleitos
        </label>
      </div>

      <div className="overflow-x-auto rounded-xl border border-border bg-surface">
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-muted">
            <tr className="border-b border-border">
              <th className="px-3 py-2 text-right">#</th>
              <th className="px-3 py-2">Candidato</th>
              <th className="px-3 py-2 text-right">Votos</th>
              <th className="px-3 py-2 text-right">%</th>
              <th className="px-3 py-2 text-right">Var.</th>
            </tr>
          </thead>
          <tbody>
            {filtered.slice(0, limit).map((c) => (
              <tr key={c.id} className="border-b border-border last:border-0">
                <td className="px-3 py-2 text-right text-muted">{c.position}</td>
                <td className="px-3 py-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{c.name}</span>
                    <CandidateTag elected={c.elected} secondRound={false} officialStatus={c.officialStatus} />
                    {onTogglePin && (
                      <PinButton name={c.name} active={pinned.includes(c.id)} onClick={() => onTogglePin(c.id)} />
                    )}
                  </div>
                  <div className="text-xs text-muted">
                    {c.number} · {c.party}
                    {c.coalition ? ` (${c.coalition})` : ""}
                  </div>
                </td>
                <td className="px-3 py-2 text-right">{formatInt(c.votes)}</td>
                <td className="px-3 py-2 text-right">{formatPct(c.percentage)}</td>
                <td className="px-3 py-2 text-right">
                  <PositionChange change={c.positionChange} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {filtered.length > limit && (
        <button
          onClick={() => setLimit((l) => l + PAGE)}
          className="w-full rounded-lg border border-border bg-surface py-2 text-sm font-semibold hover:border-accent"
        >
          Mostrar mais ({filtered.length - limit} restantes)
        </button>
      )}
    </div>
  );
}
