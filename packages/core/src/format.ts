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

/** Como formatTimeBrasilia, mas inclui a data quando não é o dia de hoje. */
export function formatDateTimeBrasilia(iso: string | null | undefined, now = new Date()): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const day = (x: Date) => x.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
  const time = formatTimeBrasilia(iso);
  return day(d) === day(now) ? time : `${day(d).slice(0, 5)} ${time}`;
}
