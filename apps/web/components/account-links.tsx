"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

/** "Senhas" e "Sair" no cabeçalho, quando o site está protegido por senha. */
export function AccountLinks() {
  const pathname = usePathname();
  const [me, setMe] = useState<{ protegido: boolean; papel: string | null } | null>(null);
  useEffect(() => {
    fetch("/api/v1/acesso/eu", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then(setMe)
      .catch(() => {});
  }, [pathname]);
  if (!me?.protegido || !me.papel) return null;
  return (
    <>
      {me.papel === "admin" && (
        <Link href="/senhas" className="hover:text-accent">
          Senhas
        </Link>
      )}
      <a href="/api/v1/acesso/sair" className="hover:text-accent">
        Sair
      </a>
    </>
  );
}
