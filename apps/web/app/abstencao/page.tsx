"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { formatInt, formatPct, formatTimeBrasilia } from "@apuracao/core";

interface City {
  ibge: string;
  name: string;
  electorate: number;
  turnout: number;
  abstention: number;
  abstentionPct: number;
  sectionsTotalizedPct: number;
}
interface Snapshot {
  updatedAt: string | null;
  totals: { electorate: number; turnout: number; abstention: number; abstentionPct: number };
  progress: { running: boolean; done: number; total: number; failures: number; lastError: string | null };
  fileKeys: Record<string, string[]> | null;
  cities: City[];
}

type SortKey = "abstentionPct" | "abstention" | "electorate" | "name";
const SORTS: { key: SortKey; label: string }[] = [
  { key: "abstentionPct", label: "% de abstenção" },
  { key: "abstention", label: "Abstenções" },
  { key: "electorate", label: "Eleitorado" },
  { key: "name", label: "Nome" },
];
const PAGE = 50;

/** Abstenção por município de SP (eleitores que não compareceram). */
export default function AbstencaoPage() {
  const [data, setData] = useState<Snapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("abstentionPct");
  const [asc, setAsc] = useState(false);
  const [limit, setLimit] = useState(PAGE);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/v1/states/sp/abstention", { cache: "no-store", signal: AbortSignal.timeout(20_000) });
      if (!r.ok) {
        const body = (await r.json().catch(() => null)) as { error?: string } | null;
        return setError(body?.error ?? `O servidor respondeu com erro (HTTP ${r.status}).`);
      }
      setError(null);
      setData((await r.json()) as Snapshot);
    } catch {
      setError("Não foi possível falar com o servidor. Confira se o npm run dev continua aberto.");
    }
  }, []);

  // Atualiza a cada 8 s enquanto lê as cidades; depois, a cada 60 s.
  const reading = !data || data.progress.running || data.cities.length === 0;
  useEffect(() => {
    load();
    const id = setInterval(load, reading ? 8_000 : 60_000);
    return () => clearInterval(id);
  }, [load, reading]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = (data?.cities ?? []).filter((c) => !q || c.name.toLowerCase().includes(q));
    const dir = asc ? 1 : -1;
    return list.sort((a, b) =>
      sort === "name" ? dir * a.name.localeCompare(b.name, "pt-BR") : dir * (a[sort] - b[sort]) || a.name.localeCompare(b.name, "pt-BR"),
    );
  }, [data, query, sort, asc]);

  const t = data?.totals;
  const p = data?.progress;
  const pct = p && p.total > 0 ? Math.round((p.done / p.total) * 100) : 0;

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Abstenção por cidade — São Paulo</h1>
          <p className="text-sm text-muted">
            Eleitores que não compareceram, em cada um dos 645 municípios. Dados oficiais do TSE
            {data?.updatedAt ? ` · atualizado às ${formatTimeBrasilia(data.updatedAt)}` : ""}.
          </p>
        </div>
        <a
          href="/api/v1/export/abstention?uf=sp"
          className="rounded-full border border-border px-3 py-1 text-xs font-semibold hover:border-accent hover:text-accent"
        >
          Baixar planilha
        </a>
      </div>

      {error && (
        <p role="alert" className="rounded-lg border border-amber-500/50 bg-amber-500/10 px-4 py-2 text-sm">
          {error}
        </p>
      )}

      {p?.running && (
        <div className="space-y-1 text-xs text-muted">
          <div>
            Lendo os arquivos das cidades no TSE: {p.done} de {p.total} ({pct}%){p.failures > 0 && ` · ${p.failures} com falha`}
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-border">
            <div className="h-full bg-accent transition-[width]" style={{ width: `${pct}%` }} />
          </div>
        </div>
      )}
      {p?.lastError && !p.running && <p className="text-xs text-muted">Último problema: {p.lastError}</p>}

      {t && data.cities.length > 0 && (
        <dl className="grid grid-cols-2 gap-3 rounded-xl border border-border bg-surface p-4 sm:grid-cols-4">
          <div>
            <dt className="text-xs text-muted">Abstenção no estado</dt>
            <dd className="text-2xl font-bold">{formatPct(t.abstentionPct)}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted">Eleitores que não votaram</dt>
            <dd className="text-2xl font-bold">{formatInt(t.abstention)}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted">Comparecimento</dt>
            <dd className="text-2xl font-bold">{formatInt(t.turnout)}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted">Eleitorado</dt>
            <dd className="text-2xl font-bold">{formatInt(t.electorate)}</dd>
          </div>
        </dl>
      )}

      {!data ? (
        !error && <p className="text-sm text-muted">Carregando…</p>
      ) : data.cities.length === 0 ? (
        <p className="rounded-lg border border-border bg-surface px-4 py-3 text-sm text-muted">
          Aguardando a leitura das cidades no TSE. A página se atualiza sozinha.
        </p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="search"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setLimit(PAGE);
              }}
              placeholder="Buscar cidade"
              className="min-w-0 flex-1 rounded-lg border border-border bg-surface px-3 py-2 text-sm"
            />
            <label className="flex items-center gap-2 text-sm">
              Ordenar por
              <select
                value={sort}
                onChange={(e) => {
                  const key = e.target.value as SortKey;
                  setSort(key);
                  setAsc(key === "name");
                }}
                className="rounded-lg border border-border bg-surface px-2 py-1.5"
              >
                {SORTS.map((s) => (
                  <option key={s.key} value={s.key}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              onClick={() => setAsc((a) => !a)}
              className="rounded-lg border border-border px-3 py-1.5 text-sm hover:border-accent hover:text-accent"
              title="Inverter a ordem"
            >
              {asc ? "↑ Crescente" : "↓ Decrescente"}
            </button>
          </div>

          <div className="overflow-x-auto rounded-xl border border-border bg-surface">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted">
                <tr className="border-b border-border">
                  <th className="px-3 py-2">Cidade</th>
                  <th className="px-3 py-2 text-right">Eleitorado</th>
                  <th className="px-3 py-2 text-right">Compareceram</th>
                  <th className="px-3 py-2 text-right">Abstenções</th>
                  <th className="px-3 py-2 text-right">% abstenção</th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, limit).map((c) => (
                  <tr key={c.ibge} className="border-b border-border last:border-0">
                    <td className="px-3 py-2">
                      {c.name}
                      {c.sectionsTotalizedPct < 100 && (
                        <span className="ml-1 text-xs text-muted">({formatPct(c.sectionsTotalizedPct)} apurado)</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">{formatInt(c.electorate)}</td>
                    <td className="px-3 py-2 text-right">{formatInt(c.turnout)}</td>
                    <td className="px-3 py-2 text-right font-semibold">{formatInt(c.abstention)}</td>
                    <td className="px-3 py-2 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <div className="hidden h-1.5 w-16 overflow-hidden rounded-full bg-border sm:block">
                          <div className="h-full bg-accent/70" style={{ width: `${Math.min(100, c.abstentionPct * 2)}%` }} />
                        </div>
                        <span className="w-14 font-semibold">{formatPct(c.abstentionPct)}</span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {rows.length > limit && (
            <button
              type="button"
              onClick={() => setLimit((l) => l + PAGE * 4)}
              className="w-full rounded-lg border border-border bg-surface py-2 text-sm font-semibold hover:border-accent"
            >
              Mostrar mais ({rows.length - limit} cidades)
            </button>
          )}
          <p className="text-xs text-muted">
            Abstenção = eleitores aptos que não compareceram. O comparecimento é o mesmo para todos os cargos da urna.
            {data.cities.length < 645 && ` ${data.cities.length} de 645 cidades lidas até agora.`}
          </p>
          {data.fileKeys && (
            <details className="text-[10px] text-muted">
              <summary className="cursor-pointer">Campos do arquivo do TSE (diagnóstico)</summary>
              <pre className="mt-1 overflow-auto">{JSON.stringify(data.fileKeys)}</pre>
            </details>
          )}
        </>
      )}
    </section>
  );
}
