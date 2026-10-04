import type { Metadata, Viewport } from "next";
import Link from "next/link";
import "./globals.css";
import { loadConfig } from "@/lib/server/config";

export const metadata: Metadata = {
  title: { default: "Apuração Eleições 2026 em tempo real", template: "%s · Apuração Eleições 2026" },
  description:
    "Plataforma independente de acompanhamento da apuração das Eleições 2026 a partir dos dados oficiais do TSE: presidente, governador, senador e deputados.",
  manifest: "/manifest.webmanifest",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f6f7f9" },
    { media: "(prefers-color-scheme: dark)", color: "#0e1116" },
  ],
};

const NAV = [
  { href: "/eleicoes/2026/presidente", label: "Presidente" },
  { href: "/eleicoes/2026/governador", label: "Governador" },
  { href: "/eleicoes/2026/senador", label: "Senador" },
  { href: "/eleicoes/2026/deputado-federal", label: "Dep. Federal" },
  { href: "/eleicoes/2026/deputado-estadual", label: "Dep. Estadual" },
];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const simulated = loadConfig().source === "mock";
  return (
    <html lang="pt-BR">
      <body className="min-h-screen antialiased">
        {simulated && (
          <div className="bg-amber-400 px-4 py-1.5 text-center text-sm font-semibold text-black">
            MODO SIMULAÇÃO — candidatos e votos fictícios, apenas para testes
          </div>
        )}
        <header className="border-b border-border bg-surface">
          <div className="mx-auto max-w-6xl px-4 py-3">
            <Link href="/" className="text-lg font-bold tracking-tight">
              Apuração Eleições 2026
            </Link>
            <nav className="-mx-4 mt-2 flex gap-1 overflow-x-auto px-4 text-sm" aria-label="Cargos">
              {NAV.map((n) => (
                <Link
                  key={n.href}
                  href={n.href}
                  className="whitespace-nowrap rounded-full border border-border px-3 py-1 hover:border-accent hover:text-accent"
                >
                  {n.label}
                </Link>
              ))}
            </nav>
          </div>
        </header>
        <main className="mx-auto max-w-6xl px-4 py-5">{children}</main>
        <footer className="mx-auto max-w-6xl px-4 pb-8 pt-4 text-xs text-muted">
          <p>
            Fonte: Tribunal Superior Eleitoral (TSE). Plataforma independente: gráficos, variações e comparações são
            análises derivadas dos dados oficiais e não substituem a divulgação oficial em{" "}
            <a className="underline" href="https://resultados.tse.jus.br/" target="_blank" rel="noreferrer">
              resultados.tse.jus.br
            </a>
            .
          </p>
          <p className="mt-2">
            <Link className="underline" href="/como-funciona">Como funciona</Link> ·{" "}
            <Link className="underline" href="/status">Status da atualização</Link>
          </p>
        </footer>
      </body>
    </html>
  );
}
