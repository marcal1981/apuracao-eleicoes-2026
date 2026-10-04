"use client";

import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatPct, formatTimeBrasilia, type Snapshot } from "@apuracao/core";
import type { PublishedRace } from "@/lib/api-types";

// Paleta neutra (não associada a partidos), para manter a plataforma imparcial.
const SERIES = ["#2563eb", "#d97706", "#0d9488", "#9333ea", "#64748b"];

/** Evolução do percentual dos 5 primeiros colocados, ao longo das seções totalizadas. */
export function EvolutionChart({ race, history }: { race: PublishedRace; history: Snapshot[] }) {
  const top = race.candidates.slice(0, 5);
  const data = history.map((s) => {
    const point: Record<string, number | string> = {
      time: formatTimeBrasilia(s.officialTimestamp ?? s.receivedAt),
      totalized: s.sectionsTotalizedPct,
    };
    for (const c of top) {
      const found = s.candidates.find((x) => x.id === c.id);
      if (found) point[c.id] = found.percentage;
    }
    return point;
  });

  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <h2 className="font-semibold">Evolução da apuração</h2>
      <p className="text-xs text-muted">Percentual dos votos válidos a cada atualização oficial recebida.</p>
      <div className="mt-3 h-64">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 5, right: 10, left: -15, bottom: 0 }}>
            <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
            <XAxis dataKey="time" tick={{ fontSize: 11, fill: "var(--muted)" }} minTickGap={30} />
            <YAxis tick={{ fontSize: 11, fill: "var(--muted)" }} unit="%" domain={[0, "auto"]} />
            <Tooltip
              contentStyle={{ background: "var(--surface)", border: "1px solid var(--border)", fontSize: 12 }}
              formatter={(value, name) => [formatPct(Number(value)), top.find((c) => c.id === name)?.name ?? String(name)]}
              labelFormatter={(label, payload) => {
                const totalized = payload?.[0]?.payload?.totalized;
                return typeof totalized === "number" ? `${label} · ${formatPct(totalized)} seções` : String(label);
              }}
            />
            <Legend formatter={(id) => top.find((c) => c.id === id)?.name ?? id} wrapperStyle={{ fontSize: 12 }} />
            {top.map((c, i) => (
              <Line key={c.id} dataKey={c.id} stroke={SERIES[i]} strokeWidth={2} dot={false} isAnimationActive={false} />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
