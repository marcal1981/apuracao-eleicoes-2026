"use client";

import { useEffect, useMemo, useState } from "react";
import { STATES, formatTimeBrasilia } from "@apuracao/core";

interface RawGroup {
  election: string;
  file: string;
  versions: { path: string; receivedAt: string; hash: string; size: number }[];
}

const OFFICES = [
  { key: "presidente", label: "Presidente" },
  { key: "governador", label: "Governador" },
  { key: "senador", label: "Senador" },
  { key: "deputado-federal", label: "Deputado Federal" },
  { key: "deputado-estadual", label: "Deputado Estadual/Distrital" },
];

const kb = (n: number) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/** Nome amigável do arquivo do TSE, ex.: "sp-c0007-e006259-u" → "Deputado Estadual — SP". */
function describe(file: string): string {
  const m = /^([a-z]{2})(\d*)-c(\d{4})-/.exec(file);
  if (!m) return file;
  const cargo: Record<string, string> = {
    "0001": "Presidente",
    "0003": "Governador",
    "0005": "Senador",
    "0006": "Deputado Federal",
    "0007": "Deputado Estadual",
    "0008": "Deputado Distrital",
  };
  return `${cargo[m[3]!] ?? `Cargo ${m[3]}`} — ${m[1]!.toUpperCase()}${m[2] ? ` (município ${m[2]})` : ""}`;
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-border bg-surface p-4">
      <h2 className="font-semibold">{title}</h2>
      <div className="mt-3 text-sm">{children}</div>
    </section>
  );
}

const btn = "inline-block rounded-lg border border-border px-3 py-1.5 hover:border-accent hover:text-accent";

export default function Arquivos() {
  const [office, setOffice] = useState("deputado-estadual");
  const [uf, setUf] = useState("SP");
  const [files, setFiles] = useState<RawGroup[] | null>(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/v1/files", { cache: "no-store" })
      .then((r) => r.json() as Promise<{ files: RawGroup[] }>)
      .then((d) => setFiles(d.files))
      .catch(() => setFiles([]));
  }, []);

  const resultsHref = useMemo(() => {
    const realOffice = office === "deputado-estadual" && uf === "DF" ? "deputado-distrital" : office;
    const state = office === "presidente" && uf === "BR" ? "BR" : uf;
    return `/api/v1/export/results?office=${realOffice}&state=${state}`;
  }, [office, uf]);

  const filtered = (files ?? []).filter((g) => {
    const q = query.trim().toLowerCase();
    return !q || g.file.includes(q) || describe(g.file).toLowerCase().includes(q);
  });

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold tracking-tight">Arquivos</h1>
      <p className="text-sm text-muted">
        Tudo o que a plataforma recebeu e calculou, para abrir ou baixar. As planilhas abrem no Excel.
      </p>

      <Card title="Planilha de resultados">
        <div className="flex flex-wrap items-center gap-2">
          <select value={office} onChange={(e) => setOffice(e.target.value)} className="rounded-lg border border-border bg-surface px-2 py-1.5">
            {OFFICES.map((o) => (
              <option key={o.key} value={o.key}>
                {o.label}
              </option>
            ))}
          </select>
          <select value={uf} onChange={(e) => setUf(e.target.value)} className="rounded-lg border border-border bg-surface px-2 py-1.5">
            {office === "presidente" && <option value="BR">Brasil</option>}
            {STATES.map((s) => (
              <option key={s.uf} value={s.uf}>
                {s.uf} — {s.name}
              </option>
            ))}
          </select>
          <a href={resultsHref} className={btn}>
            Baixar planilha
          </a>
        </div>
        <p className="mt-2 text-xs text-muted">Todos os candidatos com votos, %, situação oficial e projeção de eleitos.</p>
      </Card>

      <Card title="Votos por cidade dos candidatos em destaque (SP)">
        <div className="flex flex-wrap gap-2">
          <a href="/api/v1/export/candidate-cities?uf=sp&office=deputado-federal" className={btn}>
            Deputado Federal
          </a>
          <a href="/api/v1/export/candidate-cities?uf=sp&office=deputado-estadual" className={btn}>
            Deputado Estadual
          </a>
        </div>
        <p className="mt-2 text-xs text-muted">Uma linha por candidato e cidade (645 cidades de SP).</p>
      </Card>


      <Card title="Abstenção por município">
        <div className="flex flex-wrap gap-2">
          <a href="/api/v1/export/abstention?uf=sp" className={btn}>
            Estado de SP
          </a>
          <a href="/api/v1/export/abstention?uf=sp&regiao=vale-do-paraiba" className={btn}>
            Vale do Paraíba e Litoral Norte
          </a>
          <a href="/api/v1/export/sections?cidade=sao-jose-dos-campos" className={btn}>
            São José dos Campos (por seção)
          </a>
        </div>
      </Card>

      <Card title="Registro de auditoria">
        <div className="flex flex-wrap gap-2">
          <a href="/api/v1/files/audit" className={btn}>
            Baixar planilha
          </a>
          <a href="/status" className={btn}>
            Ver na tela
          </a>
        </div>
      </Card>

      <Card title="Arquivos originais recebidos do TSE">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filtrar (ex.: estadual, sp, governador)"
          className="w-full rounded-lg border border-border bg-surface px-3 py-2"
        />
        {files === null ? (
          <p className="mt-3 text-muted">Carregando…</p>
        ) : filtered.length === 0 ? (
          <p className="mt-3 text-muted">Nenhum arquivo guardado ainda. Eles aparecem quando o TSE começa a publicar.</p>
        ) : (
          <ul className="mt-3 divide-y divide-border">
            {filtered.map((g) => {
              const id = `${g.election}/${g.file}`;
              const latest = g.versions[0]!;
              return (
                <li key={id} className="py-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-medium">{describe(g.file)}</div>
                      <div className="text-xs text-muted">
                        {g.file}.json · eleição {g.election} · {g.versions.length} {g.versions.length === 1 ? "versão" : "versões"} · última às{" "}
                        {formatTimeBrasilia(latest.receivedAt)}
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <a href={`/api/v1/files/raw?path=${encodeURIComponent(latest.path)}`} target="_blank" rel="noreferrer" className={btn}>
                        Abrir
                      </a>
                      <a href={`/api/v1/files/raw?path=${encodeURIComponent(latest.path)}&download=1`} className={btn}>
                        Baixar
                      </a>
                      {g.versions.length > 1 && (
                        <button type="button" onClick={() => setOpen(open === id ? null : id)} className={btn}>
                          {open === id ? "Ocultar versões" : "Versões"}
                        </button>
                      )}
                    </div>
                  </div>
                  {open === id && (
                    <ul className="mt-2 space-y-1 pl-3 text-xs">
                      {g.versions.map((v) => (
                        <li key={v.path} className="flex flex-wrap items-center gap-2">
                          <span>{formatTimeBrasilia(v.receivedAt)}</span>
                          <span className="font-mono text-muted">{v.hash}</span>
                          <span className="text-muted">{kb(v.size)}</span>
                          <a className="text-accent underline" href={`/api/v1/files/raw?path=${encodeURIComponent(v.path)}`} target="_blank" rel="noreferrer">
                            abrir
                          </a>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
