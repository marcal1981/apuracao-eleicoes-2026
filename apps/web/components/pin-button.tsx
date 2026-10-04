"use client";

/** Estrela para fixar/desafixar um candidato no topo da página. */
export function PinButton({ name, active, onClick }: { name: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      aria-label={active ? `Desafixar ${name}` : `Fixar ${name} no topo`}
      title={active ? "Desafixar" : "Fixar no topo"}
      className={`text-base leading-none ${active ? "text-accent" : "text-muted hover:text-accent"}`}
    >
      {active ? "★" : "☆"}
    </button>
  );
}
