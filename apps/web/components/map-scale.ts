/** Faixas de apuração compartilhadas pelos mapas. Quanto mais escuro, mais seções totalizadas. */
export const BINS = [
  { min: 100, label: "100%", mix: 100 },
  { min: 75, label: "75–99%", mix: 78 },
  { min: 50, label: "50–75%", mix: 58 },
  { min: 25, label: "25–50%", mix: 40 },
  { min: 0.0001, label: "até 25%", mix: 24 },
];

export const binColor = (mix: number) => `color-mix(in srgb, var(--accent) ${mix}%, var(--surface))`;

export function fillFor(pct: number | undefined): string {
  if (!pct) return "var(--map-empty)";
  const bin = BINS.find((b) => pct >= b.min) ?? BINS[BINS.length - 1]!;
  return binColor(bin.mix);
}
