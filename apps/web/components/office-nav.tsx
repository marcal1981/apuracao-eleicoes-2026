"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

const NAV = [
  { cargo: "presidente", label: "Presidente" },
  { cargo: "governador", label: "Governador" },
  { cargo: "senador", label: "Senador" },
  { cargo: "deputado-federal", label: "Dep. Federal" },
  { cargo: "deputado-estadual", label: "Dep. Estadual" },
];

const STORAGE_KEY = "apuracao:uf";
const UF_IN_PATH = /^\/eleicoes\/2026\/[a-z-]+\/([a-z]{2})$/;

/** Menu de cargos que mantém a UF escolhida ao trocar de cargo (Presidente continua nacional). */
export function OfficeNav() {
  const pathname = usePathname();
  const [uf, setUf] = useState<string | null>(null);

  useEffect(() => {
    const fromPath = UF_IN_PATH.exec(pathname)?.[1] ?? null;
    if (fromPath && !pathname.includes("/presidente/")) {
      setUf(fromPath);
      try {
        localStorage.setItem(STORAGE_KEY, fromPath);
      } catch {}
      return;
    }
    try {
      setUf(localStorage.getItem(STORAGE_KEY));
    } catch {}
  }, [pathname]);

  const hrefFor = (cargo: string) => {
    if (cargo === "presidente" || !uf) return `/eleicoes/2026/${cargo}`;
    if (cargo === "deputado-estadual" && uf === "df") return "/eleicoes/2026/deputado-distrital/df";
    return `/eleicoes/2026/${cargo}/${uf}`;
  };

  return (
    <nav className="-mx-4 mt-2 flex gap-1 overflow-x-auto px-4 text-sm" aria-label="Cargos">
      {NAV.map((n) => {
        const active =
          pathname.startsWith(`/eleicoes/2026/${n.cargo}`) ||
          (n.cargo === "deputado-estadual" && pathname.startsWith("/eleicoes/2026/deputado-distrital"));
        return (
          <Link
            key={n.cargo}
            href={hrefFor(n.cargo)}
            aria-current={active ? "page" : undefined}
            className={`whitespace-nowrap rounded-full border px-3 py-1 hover:border-accent hover:text-accent ${
              active ? "border-accent text-accent" : "border-border"
            }`}
          >
            {n.label}
          </Link>
        );
      })}
      {uf && (
        <Link
          href={pathname.startsWith("/eleicoes/2026/") ? pathname.replace(/\/[a-z]{2}$/, "") : "/eleicoes/2026/governador"}
          className="ml-auto whitespace-nowrap rounded-full border border-border px-3 py-1 text-muted hover:border-accent hover:text-accent"
          title="Trocar estado"
        >
          {uf.toUpperCase()} · trocar
        </Link>
      )}
    </nav>
  );
}
