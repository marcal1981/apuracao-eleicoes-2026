"use client";

import { useEffect, useState } from "react";
import { formatTimeBrasilia } from "@apuracao/core";
import type { AuditEvent, IngestionStatus } from "@/lib/api-types";

type Status = IngestionStatus & { audit: AuditEvent[] };

export default function StatusPage() {
  const [data, setData] = useState<Status | null>(null);

  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch("/api/v1/status", { cache: "no-store" })
        .then((r) => r.json() as Promise<Status>)
        .then((d) => alive && setData(d))
        .catch(() => {});
    load();
    const id = setInterval(load, 5_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  if (!data) return <p className="text-muted">Carregando…</p>;

  const rows: [string, string][] = [
    ["Situação", data.status === "operational" ? "Operacional" : "Instável"],
    ["Fonte", data.source === "mock" ? "Simulação" : "TSE"],
    ["TSE", data.tse === "online" ? "Respondendo" : data.tse === "offline" ? "Sem resposta" : "Verificando"],
    ["Códigos das eleições", data.electionCode],
    ["Turno", `${data.round}º`],
    ["Intervalo de consulta", `${data.pollIntervalMs / 1000}s`],
    ["Disputas acompanhadas", `${data.racesWithData} com dados de ${data.racesTracked} (${data.racesFinished} finalizadas)`],
    ["Último dado recebido do TSE", formatTimeBrasilia(data.lastReceivedAt)],
    ["Último processamento", formatTimeBrasilia(data.lastProcessedAt)],
    ["Última publicação", formatTimeBrasilia(data.lastPublishedAt)],
    ["Último ciclo de consulta", formatTimeBrasilia(data.lastCycleFinishedAt)],
    ["Erros no último ciclo", String(data.errorsLastCycle)],
    ["Arquivos ainda não publicados pelo TSE", String(data.notPublishedLastCycle)],
  ];

  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-bold tracking-tight">Status da atualização</h1>
      <dl className="divide-y divide-border rounded-xl border border-border bg-surface text-sm">
        {rows.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-4 px-4 py-2">
            <dt className="text-muted">{k}</dt>
            <dd className="text-right font-medium">{v}</dd>
          </div>
        ))}
      </dl>
      <CityDiagnostics />
      <h2 className="text-lg font-semibold">Registro de auditoria</h2>
      <ol className="space-y-1 rounded-xl border border-border bg-surface p-3 font-mono text-xs">
        {data.audit.map((e, i) => (
          <li key={i} className={e.level === "error" ? "text-down" : e.level === "warn" ? "text-amber-600" : ""}>
            {formatTimeBrasilia(e.at)} {e.message}
            {e.hash ? ` · ${e.hash.slice(0, 12)}` : ""}
          </li>
        ))}
      </ol>
    </section>
  );
}

/** Testa ao vivo a leitura dos votos por cidade no TSE e mostra o resultado de cada etapa. */
function CityDiagnostics() {
  const [office, setOffice] = useState("deputado-federal");
  const [result, setResult] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  const run = async () => {
    setRunning(true);
    setResult(null);
    try {
      const r = await fetch(`/api/v1/diagnostico/cidades?office=${office}&uf=sp`, { cache: "no-store" });
      setResult(JSON.stringify(await r.json(), null, 2));
    } catch (err) {
      setResult(String(err));
    } finally {
      setRunning(false);
    }
  };

  return (
    <section id="cidades" className="space-y-2 rounded-xl border border-border bg-surface p-4">
      <h2 className="text-lg font-semibold">Diagnóstico dos votos por cidade</h2>
      <p className="text-xs text-muted">
        Testa no TSE a lista de municípios e o arquivo da capital, e verifica se os candidatos em destaque aparecem. Pode
        levar até 1 minuto.
      </p>
      <div className="flex flex-wrap gap-2">
        <select value={office} onChange={(e) => setOffice(e.target.value)} className="rounded-lg border border-border bg-surface px-2 py-1.5 text-sm">
          <option value="deputado-federal">Deputado Federal SP</option>
          <option value="deputado-estadual">Deputado Estadual SP</option>
        </select>
        <button
          type="button"
          onClick={run}
          disabled={running}
          className="rounded-lg border border-border px-3 py-1.5 text-sm font-semibold hover:border-accent hover:text-accent disabled:opacity-50"
        >
          {running ? "Testando…" : "Testar agora"}
        </button>
      </div>
      {result && (
        <pre className="max-h-[60vh] overflow-auto rounded-lg border border-border p-3 text-xs">{result}</pre>
      )}
    </section>
  );
}
