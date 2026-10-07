"use client";

import dynamic from "next/dynamic";
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { formatInt, formatPct, formatTimeBrasilia } from "@apuracao/core";
import type { PlacePoint } from "./places-map";

const PlacesMap = dynamic(() => import("./places-map").then((m) => m.PlacesMap), {
  ssr: false,
  loading: () => <div className="h-[380px] animate-pulse rounded-xl border border-border bg-surface sm:h-[480px]" />,
});

interface Section {
  zone: string;
  section: string;
  place: string | null;
  turnout: number;
  done: boolean;
  votes?: Record<string, number>;
}
interface Place {
  zone: string;
  code: string;
  name: string;
  address: string;
  bairro: string;
  lat: number | null;
  lon: number | null;
}
interface Candidate {
  number: string;
  name: string;
  office: string;
}
interface Snapshot {
  city: string;
  updatedAt: string | null;
  totals: { sections: number; read: number };
  progress: { running: boolean; done: number; total: number; failures: number; lastError: string | null };
  sections: Section[];
  candidates: Candidate[];
  places: Place[];
  placesStatus: { status: string; message: string | null; downloadedMb: number };
}

interface PlaceAgg {
  key: string;
  name: string;
  address: string;
  bairro: string;
  lat: number | null;
  lon: number | null;
  sections: number;
  turnout: number;
  votes: Record<string, number>;
}
interface BairroAgg {
  name: string;
  places: PlaceAgg[];
  sections: number;
  turnout: number;
  votes: Record<string, number>;
}

const ALL = "todos";
const PAGE = 40;
const n = (code: string) => String(Number(code));
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
// Nomes em maiúsculas → "Jardim da Granja" (preposições em minúsculas).
const title = (s: string) =>
  s
    .toLowerCase()
    .replace(/(^|\s|\()\S/g, (c) => c.toUpperCase())
    .replace(/ (Da|De|Do|Das|Dos|E)(?= )/g, (w) => w.toLowerCase());
const shortName = (name: string) => title(name.split(" ").slice(0, 2).join(" "));
const officeLabel = (o: string) => (o === "deputado-federal" ? "Dep. Federal" : o === "deputado-estadual" ? "Dep. Estadual" : o);
const NO_BAIRRO = "(SEM BAIRRO NO CADASTRO)";

/** Votos dos candidatos em destaque por bairro de São José dos Campos (boletins de urna + cadastro de locais do TSE). */
export function BairroVotesView({ slug }: { slug: string }) {
  const [data, setData] = useState<Snapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string>("");
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(PAGE);
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/v1/cities/${slug}/sections`, { cache: "no-store", signal: AbortSignal.timeout(20_000) });
      if (!r.ok) {
        const body = (await r.json().catch(() => null)) as { error?: string } | null;
        return setError(body?.error ?? `O servidor respondeu com erro (HTTP ${r.status}).`);
      }
      setError(null);
      setData((await r.json()) as Snapshot);
    } catch {
      setError("Não foi possível falar com o servidor. Confira se o npm run dev continua aberto.");
    }
  }, [slug]);

  const candidates = useMemo(() => data?.candidates ?? [], [data]);
  const withVotes = useMemo(() => (data?.sections ?? []).filter((s) => s.done && s.votes), [data]);
  const busy = !data || data.progress.running || withVotes.length < (data?.totals.read ?? 0) || data.places.length === 0;
  useEffect(() => {
    load();
    const id = setInterval(load, busy ? 8_000 : 60_000);
    return () => clearInterval(id);
  }, [load, busy]);

  // Começa no Robertinho da Padaria, se estiver entre os destaques.
  useEffect(() => {
    if (!selected && candidates.length) setSelected(candidates.find((c) => /ROBERTINHO/i.test(c.name))?.number ?? candidates[0]!.number);
  }, [candidates, selected]);

  const { bairros, cityVotes } = useMemo(() => {
    const info = new Map((data?.places ?? []).map((p) => [`${n(p.zone)}-${p.code}`, p]));
    const places = new Map<string, PlaceAgg>();
    const cityVotes: Record<string, number> = {};
    for (const s of withVotes) {
      const key = `${n(s.zone)}-${s.place ?? "?"}`;
      const p = s.place ? info.get(key) : undefined;
      let agg = places.get(key);
      if (!agg) {
        agg = {
          key,
          name: p?.name || (s.place ? `Local ${s.place} (zona ${n(s.zone)})` : "Local não identificado"),
          address: p?.address ?? "",
          bairro: (p?.bairro || NO_BAIRRO).trim().toUpperCase(),
          lat: p?.lat ?? null,
          lon: p?.lon ?? null,
          sections: 0,
          turnout: 0,
          votes: {},
        };
        places.set(key, agg);
      }
      agg.sections++;
      agg.turnout += s.turnout;
      for (const [num, v] of Object.entries(s.votes!)) {
        agg.votes[num] = (agg.votes[num] ?? 0) + v;
        cityVotes[num] = (cityVotes[num] ?? 0) + v;
      }
    }
    const byBairro = new Map<string, BairroAgg>();
    for (const p of places.values()) {
      let b = byBairro.get(p.bairro);
      if (!b) byBairro.set(p.bairro, (b = { name: p.bairro, places: [], sections: 0, turnout: 0, votes: {} }));
      b.places.push(p);
      b.sections += p.sections;
      b.turnout += p.turnout;
      for (const [num, v] of Object.entries(p.votes)) b.votes[num] = (b.votes[num] ?? 0) + v;
    }
    return { bairros: [...byBairro.values()], cityVotes };
  }, [data, withVotes]);

  const all = selected === ALL;
  const valueOf = useCallback(
    (votes: Record<string, number>) => (all ? candidates.reduce((sum, c) => sum + (votes[c.number] ?? 0), 0) : (votes[selected] ?? 0)),
    [all, candidates, selected],
  );
  const cityTotal = valueOf(cityVotes);

  const rows = useMemo(() => {
    const q = query.trim().toUpperCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
    return bairros
      .filter((b) => !q || b.name.normalize("NFD").replace(/[̀-ͯ]/g, "").includes(q))
      .sort((a, b) => valueOf(b.votes) - valueOf(a.votes) || a.name.localeCompare(b.name, "pt-BR"));
  }, [bairros, query, valueOf]);

  const points: PlacePoint[] = useMemo(
    () =>
      bairros.flatMap((b) =>
        b.places
          .filter((p) => p.lat !== null && p.lon !== null)
          .map((p) => {
            const v = valueOf(p.votes);
            const detail = all
              ? candidates.map((c) => `${esc(shortName(c.name))}: ${formatInt(p.votes[c.number] ?? 0)}`).join("<br>")
              : `${formatInt(v)} votos`;
            return {
              key: p.key,
              lat: p.lat!,
              lon: p.lon!,
              value: v,
              highlighted: open !== null && b.name === open,
              html: `<strong>${esc(p.name)}</strong><br>${esc(title(p.bairro))}<br>${detail}`,
            };
          }),
      ),
    [bairros, valueOf, all, candidates, open],
  );

  const current = candidates.find((c) => c.number === selected);
  const bairrosWithVotes = bairros.filter((b) => valueOf(b.votes) > 0).length;
  const top = rows.find((b) => valueOf(b.votes) > 0);
  const p = data?.progress;
  const pct = p && p.total > 0 ? Math.round((p.done / p.total) * 100) : 0;
  const ps = data?.placesStatus;

  const downloadCsv = () => {
    const header = ["Bairro", "Locais de votação", "Seções", "Comparecimento", ...candidates.map((c) => `${c.name} (${c.number})`)];
    const lines = [...bairros]
      .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"))
      .map((b) => [b.name, String(b.places.length), String(b.sections), String(b.turnout), ...candidates.map((c) => String(b.votes[c.number] ?? 0))]);
    const csv = "﻿" + [header, ...lines].map((r) => r.map((v) => `"${v.replace(/"/g, '""')}"`).join(";")).join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `votos-por-bairro-${slug}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Votos por bairro — {data?.city ?? "São José dos Campos"}</h1>
          <p className="text-sm text-muted">
            Votos dos candidatos em destaque somados por bairro, a partir dos boletins de urna de cada seção
            {data?.updatedAt ? ` · atualizado às ${formatTimeBrasilia(data.updatedAt)}` : ""}.
          </p>
        </div>
        {bairros.length > 0 && (
          <div className="flex gap-2">
            <a
              href={`/api/v1/export/bairros-pdf?cidade=${slug}&numero=${all ? "todos" : selected}`}
              className="rounded-full border border-accent bg-accent px-3 py-1 text-xs font-semibold text-white hover:opacity-90"
              title={all ? "Relatório comparando os candidatos por bairro" : "Relatório do candidato selecionado por bairro e local de votação"}
            >
              PDF
            </a>
            <button
              type="button"
              onClick={downloadCsv}
              className="rounded-full border border-border px-3 py-1 text-xs font-semibold hover:border-accent hover:text-accent"
            >
              Baixar planilha
            </button>
          </div>
        )}
      </div>

      {error && (
        <p role="alert" className="rounded-lg border border-amber-500/50 bg-amber-500/10 px-4 py-2 text-sm">
          {error}
        </p>
      )}

      {candidates.length > 0 && (
        <div className="flex flex-wrap gap-2" role="tablist" aria-label="Candidato">
          {candidates.map((c) => (
            <button
              key={c.number}
              type="button"
              onClick={() => setSelected(c.number)}
              aria-pressed={selected === c.number}
              className={`rounded-full border px-3 py-1 text-sm ${selected === c.number ? "border-accent bg-accent text-white" : "border-border hover:border-accent hover:text-accent"}`}
            >
              {title(c.name)} <span className="opacity-70">· {officeLabel(c.office)}</span>
            </button>
          ))}
          <button
            type="button"
            onClick={() => setSelected(ALL)}
            aria-pressed={all}
            className={`rounded-full border px-3 py-1 text-sm ${all ? "border-accent bg-accent text-white" : "border-border hover:border-accent hover:text-accent"}`}
          >
            Comparar todos
          </button>
        </div>
      )}

      {p?.running && (
        <div className="space-y-1 text-xs text-muted">
          <div>
            Lendo os boletins de urna no TSE: {formatInt(p.done)} de {formatInt(p.total)} seções ({pct}%)
            {p.failures > 0 && ` · ${p.failures} com falha`}
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-border">
            <div className="h-full bg-accent transition-[width]" style={{ width: `${pct}%` }} />
          </div>
        </div>
      )}
      {ps && ps.status !== "ready" && (
        <p className="text-sm text-muted">
          {ps.status === "downloading"
            ? `Baixando do TSE o cadastro dos locais de votação (${formatInt(ps.downloadedMb)} MB)…`
            : ps.status === "error"
              ? `Cadastro de locais de votação indisponível: ${ps.message}`
              : "Lendo o cadastro dos locais de votação…"}
        </p>
      )}

      {!data ? (
        !error && <p className="text-sm text-muted">Carregando…</p>
      ) : candidates.length === 0 ? (
        <p className="rounded-lg border border-border bg-surface px-4 py-3 text-sm text-muted">
          Os candidatos em destaque ainda não foram identificados. Abra uma vez a página de Dep. Federal ou Dep. Estadual de SP e volte
          aqui.
        </p>
      ) : withVotes.length === 0 ? (
        <p className="rounded-lg border border-border bg-surface px-4 py-3 text-sm text-muted">
          Lendo os votos nos boletins de urna das seções. A página se atualiza sozinha.
        </p>
      ) : (
        <>
          <dl className="grid grid-cols-2 gap-3 rounded-xl border border-border bg-surface p-4 sm:grid-cols-4">
            <div>
              <dt className="text-xs text-muted">{all ? "Votos dos destaques na cidade" : `Votos de ${current ? title(current.name) : ""}`}</dt>
              <dd className="text-2xl font-bold">{formatInt(cityTotal)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted">Bairros com votos</dt>
              <dd className="text-2xl font-bold">
                {formatInt(bairrosWithVotes)}
                <span className="text-sm font-normal text-muted"> de {formatInt(bairros.length)}</span>
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted">Bairro com mais votos</dt>
              <dd className="truncate text-lg font-bold" title={top?.name}>
                {top ? `${title(top.name)} (${formatInt(valueOf(top.votes))})` : "—"}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted">Seções lidas</dt>
              <dd className="text-2xl font-bold">
                {formatInt(withVotes.length)}
                <span className="text-sm font-normal text-muted"> de {formatInt(data.totals.sections)}</span>
              </dd>
            </div>
          </dl>

          <PlacesMap points={points} outline={`/maps/${slug}.json`} />
          <p className="text-xs text-muted">
            Cada círculo é um local de votação; quanto maior, mais votos{all ? " dos candidatos em destaque somados" : ""}. Clique num
            bairro na tabela para destacá-lo no mapa.
          </p>

          <input
            type="search"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setLimit(PAGE);
            }}
            placeholder="Buscar bairro"
            className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm sm:max-w-sm"
          />

          <div className="overflow-x-auto rounded-xl border border-border bg-surface">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted">
                <tr className="border-b border-border">
                  <th className="px-3 py-2">#</th>
                  <th className="px-3 py-2">Bairro</th>
                  <th className="px-3 py-2 text-right">Locais</th>
                  {all ? (
                    <>
                      {candidates.map((c) => (
                        <th key={c.number} className="whitespace-nowrap px-3 py-2 text-right" title={c.name}>
                          {shortName(c.name)}
                        </th>
                      ))}
                      <th className="px-3 py-2 text-right">Total</th>
                    </>
                  ) : (
                    <>
                      <th className="px-3 py-2 text-right">Votos</th>
                      <th className="px-3 py-2 text-right" title="Votos do candidato sobre o total de eleitores que votaram no bairro">
                        % no bairro
                      </th>
                      <th className="px-3 py-2 text-right" title="Parte dos votos do candidato na cidade que veio deste bairro">
                        % do total
                      </th>
                    </>
                  )}
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, limit).map((b, i) => {
                  const v = valueOf(b.votes);
                  const isOpen = open === b.name;
                  return (
                    <Fragment key={b.name}>
                      <tr
                        onClick={() => setOpen(isOpen ? null : b.name)}
                        className={`cursor-pointer border-b border-border hover:bg-accent/5 ${isOpen ? "bg-accent/10" : ""}`}
                        title="Clique para ver os locais de votação do bairro"
                      >
                        <td className="px-3 py-2 text-xs text-muted">{i + 1}</td>
                        <td className="px-3 py-2 font-medium">
                          {isOpen ? "▾" : "▸"} {title(b.name)}
                        </td>
                        <td className="px-3 py-2 text-right">{b.places.length}</td>
                        {all ? (
                          <>
                            {candidates.map((c) => (
                              <td key={c.number} className="px-3 py-2 text-right">
                                {formatInt(b.votes[c.number] ?? 0)}
                              </td>
                            ))}
                            <td className="px-3 py-2 text-right font-semibold">{formatInt(v)}</td>
                          </>
                        ) : (
                          <>
                            <td className="px-3 py-2 text-right font-semibold">{formatInt(v)}</td>
                            <td className="px-3 py-2 text-right">{b.turnout > 0 ? formatPct((v / b.turnout) * 100) : "—"}</td>
                            <td className="px-3 py-2 text-right">{cityTotal > 0 ? formatPct((v / cityTotal) * 100) : "—"}</td>
                          </>
                        )}
                      </tr>
                      {isOpen &&
                        [...b.places]
                          .sort((x, y) => valueOf(y.votes) - valueOf(x.votes))
                          .map((pl) => (
                            <tr key={pl.key} className="border-b border-border bg-black/[0.02] text-xs">
                              <td />
                              <td className="px-3 py-1.5 pl-7">
                                <span className="block">{pl.name}</span>
                                {pl.address && <span className="block text-muted">{pl.address}</span>}
                              </td>
                              <td className="px-3 py-1.5 text-right text-muted">{pl.sections} seç.</td>
                              {all ? (
                                <>
                                  {candidates.map((c) => (
                                    <td key={c.number} className="px-3 py-1.5 text-right">
                                      {formatInt(pl.votes[c.number] ?? 0)}
                                    </td>
                                  ))}
                                  <td className="px-3 py-1.5 text-right font-semibold">{formatInt(valueOf(pl.votes))}</td>
                                </>
                              ) : (
                                <>
                                  <td className="px-3 py-1.5 text-right font-semibold">{formatInt(valueOf(pl.votes))}</td>
                                  <td className="px-3 py-1.5 text-right">
                                    {pl.turnout > 0 ? formatPct((valueOf(pl.votes) / pl.turnout) * 100) : "—"}
                                  </td>
                                  <td />
                                </>
                              )}
                            </tr>
                          ))}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
          {rows.length > limit && (
            <button
              type="button"
              onClick={() => setLimit((l) => l + PAGE * 3)}
              className="w-full rounded-lg border border-border bg-surface py-2 text-sm font-semibold hover:border-accent"
            >
              Mostrar mais ({formatInt(rows.length - limit)} bairros)
            </button>
          )}
          <p className="text-xs text-muted">
            O bairro de cada seção é o do seu local de votação no cadastro oficial do TSE (eleitores votam perto de onde moram, mas
            não necessariamente no próprio bairro). Os votos vêm do boletim de urna de cada seção; a soma da cidade pode ficar um
            pouco abaixo do resultado oficial enquanto houver seções sem boletim lido.
          </p>
        </>
      )}
    </section>
  );
}
