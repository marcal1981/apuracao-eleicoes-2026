"use client";

import { useCallback, useEffect, useState } from "react";
import { formatInt, formatPct, formatTimeBrasilia } from "@apuracao/core";

interface Candidate {
  office: string;
  name: string;
  number: string;
}
interface Snapshot {
  city: string;
  area: string;
  areaKind: "district" | "text";
  candidate: { number: string; name: string };
  status: "preparing" | "running" | "done" | "error";
  message: string | null;
  updatedAt: string | null;
  progress: { done: number; total: number; failures: number };
  placesStatus: { status: string; message: string | null; downloadedMb: number; count: number };
  totals: { sections: number; read: number; votes: number; electorate: number; turnout: number };
  places: { zone: string; code: string; name: string; address: string; bairro: string; sections: number; read: number; votes: number }[];
  placesWithoutCoords: number;
}

const SAO_PAULO = "sao paulo";
const norm = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
const title = (s: string) => s.toLowerCase().replace(/(^|\s)\S/g, (c) => c.toUpperCase());

/** Votos de um candidato em destaque num distrito de São Paulo ou num bairro de qualquer cidade. */
export function AreaVotesView() {
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [districts, setDistricts] = useState<{ name: string; subprefeitura: string }[]>([]);
  const [numero, setNumero] = useState("");
  const [cidade, setCidade] = useState("São Paulo");
  const [distrito, setDistrito] = useState("CIDADE TIRADENTES");
  const [bairro, setBairro] = useState("");
  const [query, setQuery] = useState<string | null>(null);
  const [data, setData] = useState<Snapshot | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/v1/votos-por-area")
      .then((r) => r.json())
      .then((d: { candidates: Candidate[]; districts: { name: string; subprefeitura: string }[] }) => {
        setCandidates(d.candidates);
        setDistricts(d.districts);
        setNumero((cur) => cur || d.candidates.find((c) => /ROBERTINHO/i.test(c.name))?.number || d.candidates[0]?.number || "");
      })
      .catch(() => setError("Não foi possível falar com o servidor. Confira se o npm run dev continua aberto."));
  }, []);

  const isSaoPaulo = norm(cidade) === SAO_PAULO;

  const load = useCallback(async (q: string) => {
    try {
      const r = await fetch(`/api/v1/votos-por-area?${q}`, { cache: "no-store", signal: AbortSignal.timeout(20_000) });
      const body = (await r.json()) as Snapshot & { error?: string };
      if (!r.ok) return setError(body.error ?? `O servidor respondeu com erro (HTTP ${r.status}).`);
      setError(null);
      setData(body);
    } catch {
      setError("Não foi possível falar com o servidor. Confira se o npm run dev continua aberto.");
    }
  }, []);

  const busy = !!query && (!data || data.status === "preparing" || data.status === "running");
  useEffect(() => {
    if (!query) return;
    load(query);
    const id = setInterval(() => load(query), busy ? 4_000 : 60_000);
    return () => clearInterval(id);
  }, [query, load, busy]);

  const search = (e: React.FormEvent) => {
    e.preventDefault();
    const params = new URLSearchParams({ uf: "sp", cidade, numero });
    if (isSaoPaulo) params.set("distrito", distrito);
    else params.set("bairro", bairro);
    setData(null);
    setQuery(params.toString());
  };

  const t = data?.totals;
  const p = data?.progress;
  const pct = p && p.total > 0 ? Math.round((p.done / p.total) * 100) : 0;
  const ps = data?.placesStatus;

  return (
    <section className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Votos por distrito ou bairro</h1>
        <p className="text-sm text-muted">
          Soma os boletins de urna das seções cujos locais de votação ficam na área escolhida. Em São Paulo, pelos 96 distritos
          oficiais da Prefeitura; nas outras cidades, pelo nome do bairro.
        </p>
      </div>

      <form onSubmit={search} className="grid gap-3 rounded-xl border border-border bg-surface p-4 sm:grid-cols-[1.4fr_1fr_1.2fr_auto] sm:items-end">
        <label className="space-y-1 text-sm">
          <span className="text-xs text-muted">Candidato</span>
          <select value={numero} onChange={(e) => setNumero(e.target.value)} className="w-full rounded-lg border border-border bg-surface px-2 py-2">
            {candidates.map((c) => (
              <option key={c.number} value={c.number}>
                {c.name} ({c.number}) · {c.office === "deputado-federal" ? "Dep. Federal" : "Dep. Estadual"}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-sm">
          <span className="text-xs text-muted">Cidade</span>
          <input value={cidade} onChange={(e) => setCidade(e.target.value)} className="w-full rounded-lg border border-border bg-surface px-3 py-2" />
        </label>
        {isSaoPaulo ? (
          <label className="space-y-1 text-sm">
            <span className="text-xs text-muted">Distrito</span>
            <select value={distrito} onChange={(e) => setDistrito(e.target.value)} className="w-full rounded-lg border border-border bg-surface px-2 py-2">
              {districts.map((d) => (
                <option key={d.name} value={d.name}>
                  {title(d.name)}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <label className="space-y-1 text-sm">
            <span className="text-xs text-muted">Bairro (ou parte do nome)</span>
            <input
              value={bairro}
              onChange={(e) => setBairro(e.target.value)}
              placeholder="ex.: Santana"
              className="w-full rounded-lg border border-border bg-surface px-3 py-2"
            />
          </label>
        )}
        <button
          type="submit"
          disabled={!numero || !cidade.trim() || (!isSaoPaulo && !bairro.trim())}
          className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          Buscar votos
        </button>
      </form>

      {error && (
        <p role="alert" className="rounded-lg border border-amber-500/50 bg-amber-500/10 px-4 py-2 text-sm">
          {error}
        </p>
      )}

      {query && !data && !error && <p className="text-sm text-muted">Carregando…</p>}

      {data && (
        <>
          <div className="rounded-xl border border-border bg-surface p-4">
            <div className="text-xs font-semibold uppercase tracking-wide text-accent">
              {data.areaKind === "district" ? `Distrito ${title(data.area)}` : `Bairro "${data.area}"`} · {data.city}
            </div>
            <div className="mt-1 text-lg font-bold">
              {data.candidate.name} <span className="font-normal text-muted">({data.candidate.number})</span>
            </div>
            <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div>
                <dt className="text-xs text-muted">Votos na área</dt>
                <dd className="text-3xl font-bold">{t ? formatInt(t.votes) : "—"}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted">% de quem votou na área</dt>
                <dd className="text-2xl font-bold">{t && t.turnout > 0 ? formatPct((t.votes / t.turnout) * 100) : "—"}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted">Locais de votação</dt>
                <dd className="text-2xl font-bold">{formatInt(data.places.length)}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted">Seções lidas</dt>
                <dd className="text-2xl font-bold">
                  {t ? formatInt(t.read) : 0}
                  <span className="text-sm font-normal text-muted"> de {t ? formatInt(t.sections) : 0}</span>
                </dd>
              </div>
            </dl>
            {data.updatedAt && <p className="mt-2 text-xs text-muted">Atualizado às {formatTimeBrasilia(data.updatedAt)}.</p>}
          </div>

          {data.status === "preparing" && (
            <p className="text-sm text-muted">
              {ps?.status === "downloading"
                ? `Baixando do TSE o cadastro dos locais de votação (${formatInt(ps.downloadedMb)} MB)… Isso acontece só uma vez.`
                : ps?.status === "reading"
                  ? "Lendo o cadastro dos locais de votação…"
                  : "Preparando a consulta…"}
            </p>
          )}
          {data.status === "running" && p && (
            <div className="space-y-1 text-xs text-muted">
              <div>
                Lendo os boletins de urna: {formatInt(p.done)} de {formatInt(p.total)} seções ({pct}%)
                {p.failures > 0 && ` · ${p.failures} com falha`}
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-border">
                <div className="h-full bg-accent transition-[width]" style={{ width: `${pct}%` }} />
              </div>
            </div>
          )}
          {data.message && (
            <p className={`text-sm ${data.status === "error" ? "rounded-lg border border-amber-500/50 bg-amber-500/10 px-4 py-2" : "text-muted"}`}>
              {data.status === "error" ? "Problema: " : "Último problema: "}
              {data.message}
            </p>
          )}

          {data.places.length > 0 && (
            <div className="overflow-x-auto rounded-xl border border-border bg-surface">
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-muted">
                  <tr className="border-b border-border">
                    <th className="px-3 py-2">Local de votação</th>
                    <th className="px-3 py-2">Zona</th>
                    <th className="px-3 py-2 text-right">Seções</th>
                    <th className="px-3 py-2 text-right">Votos</th>
                  </tr>
                </thead>
                <tbody>
                  {data.places.map((pl) => (
                    <tr key={`${pl.zone}-${pl.code}`} className="border-b border-border last:border-0">
                      <td className="px-3 py-2">
                        <span className="block">{pl.name}</span>
                        <span className="block text-xs text-muted">
                          {[pl.address, pl.bairro].filter(Boolean).join(" · ")}
                        </span>
                      </td>
                      <td className="px-3 py-2">{pl.zone}</td>
                      <td className="px-3 py-2 text-right">
                        {pl.read < pl.sections ? `${pl.read} de ${pl.sections}` : pl.sections}
                      </td>
                      <td className="px-3 py-2 text-right font-semibold">{formatInt(pl.votes)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <p className="text-xs text-muted">
            {data.areaKind === "district"
              ? "Os locais de votação entram pela localização (latitude e longitude do cadastro do TSE) dentro do contorno oficial do distrito (GeoSampa, Prefeitura de São Paulo)."
              : "Entram os locais de votação cujo bairro ou nome contém o texto buscado (cadastro do TSE)."}{" "}
            Os votos vêm do boletim de urna de cada seção.
            {data.areaKind === "district" && data.placesWithoutCoords > 0 &&
              (data.placesWithoutCoords === 1
                ? " 1 local da cidade está sem coordenadas no cadastro e não pôde ser localizado."
                : ` ${formatInt(data.placesWithoutCoords)} locais da cidade estão sem coordenadas no cadastro e não puderam ser localizados.`)}
          </p>
        </>
      )}
    </section>
  );
}
