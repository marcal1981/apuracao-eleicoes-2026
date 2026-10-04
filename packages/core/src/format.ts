const intFmt = new Intl.NumberFormat("pt-BR");
const pctFmt = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const formatInt = (n: number) => intFmt.format(n);
export const formatPct = (n: number) => `${pctFmt.format(n)}%`;

/** Formata um horário ISO no fuso de Brasília (hh:mm:ss). */
export function formatTimeBrasilia(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour12: false });
}
