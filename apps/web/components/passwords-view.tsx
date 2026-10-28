"use client";

import { useEffect, useState } from "react";

interface Senha {
  id: string;
  name: string;
  role: "admin" | "viewer";
  createdAt: string;
}
interface Data {
  protegido: boolean;
  senhas: Senha[];
}

/** Cadastro das senhas de acesso ao site (só administradores; ou qualquer um enquanto não há senha). */
export function PasswordsView() {
  const [data, setData] = useState<Data | null>(null);
  const [erroCarga, setErroCarga] = useState<string | null>(null);
  const [nome, setNome] = useState("");
  const [senha, setSenha] = useState("");
  const [confirma, setConfirma] = useState("");
  const [papel, setPapel] = useState<"viewer" | "admin">("viewer");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [enviando, setEnviando] = useState(false);

  const carregar = () =>
    fetch("/api/v1/acesso/senhas", { cache: "no-store" })
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error ?? "Sem permissão.");
        setData(d);
      })
      .catch((e: Error) => setErroCarga(e.message));
  useEffect(() => {
    carregar();
  }, []);

  async function adicionar(e: React.FormEvent) {
    e.preventDefault();
    if (senha !== confirma) {
      setMsg({ ok: false, text: "As duas senhas não são iguais." });
      return;
    }
    setEnviando(true);
    setMsg(null);
    const primeira = data && !data.protegido;
    const r = await fetch("/api/v1/acesso/senhas", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ nome, senha, papel }),
    });
    const d = await r.json().catch(() => ({}));
    setEnviando(false);
    if (!r.ok) {
      setMsg({ ok: false, text: d.error ?? "Não foi possível salvar." });
      return;
    }
    setNome("");
    setSenha("");
    setConfirma("");
    setPapel("viewer");
    setMsg({ ok: true, text: primeira ? "Pronto! O site agora pede senha. Você já está conectado neste aparelho." : "Senha adicionada." });
    carregar();
  }

  async function remover(s: Senha) {
    if (!confirm(`Remover a senha "${s.name}"? Quem entrou com ela perde o acesso na hora.`)) return;
    const r = await fetch(`/api/v1/acesso/senhas?id=${encodeURIComponent(s.id)}`, { method: "DELETE" });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) setMsg({ ok: false, text: d.error ?? "Não foi possível remover." });
    else {
      setMsg({ ok: true, text: `Senha "${s.name}" removida.` });
      carregar();
    }
  }

  if (erroCarga) return <p className="text-sm text-muted">{erroCarga}</p>;
  if (!data) return <p className="text-sm text-muted">Carregando…</p>;

  return (
    <section className="mx-auto max-w-2xl space-y-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Senhas de acesso</h1>
        <p className="text-sm text-muted">
          Quem não tiver uma destas senhas não consegue abrir o site. Crie uma senha para cada pessoa ou grupo (ex.: &quot;Família&quot;,
          &quot;Equipe&quot;) — assim dá para tirar o acesso de um sem mudar o dos outros.
        </p>
      </div>

      {!data.protegido && (
        <div className="rounded-xl border border-amber-400 bg-amber-50 p-4 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          <b>O site está aberto para qualquer pessoa.</b> Crie a primeira senha abaixo: ela será a de administrador (a única que pode
          cadastrar e remover senhas) e, a partir daí, o site passa a pedir senha.
        </div>
      )}

      <form onSubmit={adicionar} className="space-y-3 rounded-xl border border-border bg-surface p-4">
        <h2 className="font-semibold">{data.protegido ? "Adicionar senha" : "Criar a senha de administrador"}</h2>
        <label className="block text-sm font-medium">
          Nome (para você identificar)
          <input value={nome} onChange={(e) => setNome(e.target.value)} maxLength={60} placeholder="Ex.: Família" className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2" />
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-sm font-medium">
            Senha (mínimo 6 caracteres)
            <input type="password" autoComplete="new-password" value={senha} onChange={(e) => setSenha(e.target.value)} className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2" />
          </label>
          <label className="block text-sm font-medium">
            Repita a senha
            <input type="password" autoComplete="new-password" value={confirma} onChange={(e) => setConfirma(e.target.value)} className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2" />
          </label>
        </div>
        {data.protegido && (
          <fieldset className="flex flex-wrap gap-4 text-sm">
            <label className="inline-flex items-center gap-2">
              <input type="radio" checked={papel === "viewer"} onChange={() => setPapel("viewer")} />
              Só ver o site
            </label>
            <label className="inline-flex items-center gap-2">
              <input type="radio" checked={papel === "admin"} onChange={() => setPapel("admin")} />
              Administrador (também gerencia senhas)
            </label>
          </fieldset>
        )}
        {msg && <p className={`text-sm ${msg.ok ? "text-[var(--up)]" : "text-[var(--down)]"}`}>{msg.text}</p>}
        <button type="submit" disabled={enviando || !nome.trim() || senha.length < 6 || !confirma} className="rounded-lg bg-accent px-4 py-2 font-semibold text-white disabled:opacity-50">
          {enviando ? "Salvando…" : data.protegido ? "Adicionar senha" : "Criar senha e proteger o site"}
        </button>
      </form>

      {data.senhas.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-border bg-surface">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted">
              <tr className="border-b border-border">
                <th className="px-3 py-2">Nome</th>
                <th className="px-3 py-2">Tipo</th>
                <th className="px-3 py-2">Criada em</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {data.senhas.map((s) => (
                <tr key={s.id} className="border-b border-border last:border-0">
                  <td className="px-3 py-2 font-medium">{s.name}</td>
                  <td className="px-3 py-2">{s.role === "admin" ? "Administrador" : "Só ver"}</td>
                  <td className="px-3 py-2 text-muted">{new Date(s.createdAt).toLocaleDateString("pt-BR")}</td>
                  <td className="px-3 py-2 text-right">
                    <button onClick={() => remover(s)} className="rounded-lg border border-border px-2 py-1 text-xs hover:border-[var(--down)] hover:text-[var(--down)]">
                      Remover
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-muted">
        As senhas são guardadas só como código embaralhado (hash), nunca em texto. Cada aparelho fica conectado por 30 dias ou até a senha
        dele ser removida. Esqueceu a senha de administrador? Defina SITE_PASSWORD nas variáveis de ambiente da hospedagem e entre com ela.
      </p>
    </section>
  );
}
