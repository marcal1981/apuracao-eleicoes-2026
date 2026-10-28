"use client";

import { useState } from "react";

/** Tela de senha: depois de entrar, volta para a página que a pessoa tentou abrir. */
export function LoginForm() {
  const [senha, setSenha] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function entrar(e: React.FormEvent) {
    e.preventDefault();
    setEnviando(true);
    setErro(null);
    try {
      const r = await fetch("/api/v1/acesso/entrar", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ senha }) });
      const d = (await r.json().catch(() => ({}))) as { error?: string };
      if (!r.ok) {
        setErro(d.error ?? "Não foi possível entrar.");
        return;
      }
      const voltar = new URLSearchParams(window.location.search).get("voltar");
      window.location.href = voltar && voltar.startsWith("/") && !voltar.startsWith("//") ? voltar : "/";
    } catch {
      setErro("Sem conexão com o site. Tente de novo.");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <section className="mx-auto mt-10 max-w-sm">
      <form onSubmit={entrar} className="space-y-4 rounded-xl border border-border bg-surface p-6 shadow-sm">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Acesso restrito</h1>
          <p className="mt-1 text-sm text-muted">Digite a senha de acesso para ver o site.</p>
        </div>
        <label className="block text-sm font-medium">
          Senha
          <input
            type="password"
            autoFocus
            autoComplete="current-password"
            value={senha}
            onChange={(e) => setSenha(e.target.value)}
            className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-base"
          />
        </label>
        {erro && <p className="text-sm text-[var(--down)]">{erro}</p>}
        <button
          type="submit"
          disabled={enviando || !senha}
          className="w-full rounded-lg bg-accent px-4 py-2 font-semibold text-white disabled:opacity-50"
        >
          {enviando ? "Entrando…" : "Entrar"}
        </button>
      </form>
    </section>
  );
}
