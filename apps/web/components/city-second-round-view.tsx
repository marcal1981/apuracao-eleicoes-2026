"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { formatInt, formatPct, formatTimeBrasilia } from "@apuracao/core";
import { LeadChart } from "./second-round-view";

interface Round {
  status: string;
  pct: number;
  sectionsTotalized: number;
  sections: number;
  electorate: number;
  turnout: number;
  abstention: number;
  valid: number;
  blank: number;
  null: number;
  candidates: { number: string; name: string; votes: number }[];
  timestamp: string | null;
}
interface Data {
  finalists: { number: string; name: string }[];
  ibge: string;
  name: string;
  error: string | null;
  r1: Round | null;
  r2: Round | null;
  series: { pct: number; time: string; votes: Record<string, number> }[];
}

const SJC = "3549904";
const FIXED: [RegExp, string][] = [
  [/\bLULA\b/i, "#dc2626"],
  [/\bBOLSONARO\b/i, "#2563eb"],
];
const FALLBACK = ["#7c3aed", "#0891b2"];
const colorFor = (name: string, i: number) => FIXED.find(([re]) => re.test(name))?.[1] ?? FALLBACK[i]!;
const title = (s: string) =>
  s
    .toLowerCase()
    .replace(/(^|\s)\S/g, (c) => c.toUpperCase())
    .replace(/ (Da|De|Do|Das|Dos|E)(?= )/g, (w) => w.toLowerCase());
const shareA = (a: number, b: number) => (a + b > 0 ? (a / (a + b)) * 100 : 50);
const lead = (a: number, b: number) => (a + b > 0 ? ((a - b) / (a + b)) * 100 : 0);
const pp = (v: number) => `${v.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} pontos`;
const pct = (n: number, d: number) => (d > 0 ? (n / d) * 100 : 0);
const signedP = (v: number) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} p.p.`;

/** Presidente numa cidade de SP: 2º turno ao vivo comparado com o 1º turno da própria cidade. */
export function CitySecondRoundView() {
  const [ibge, setIbge] = useState(SJC);
  const [cities, setCities] = useState<{ ibge: string; name: string }[]>([]);
  const [query, setQuery] = useState("");
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    try {
      const saved = localStorage.getItem("segundo-turno-cidade");
      if (saved && /^\d{7}$/.test(saved)) setIbge(saved);
    } catch {
      // sem armazenamento local
    }
    fetch("/api/v1/segundo-turno/cidade?lista=1")
      .then((r) => r.json())
      .then((d: { cities: { ibge: string; name: string }[] }) => setCities(d.cities ?? []))
      .catch(() => {});
  }, []);

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/v1/segundo-turno/cidade?ibge=${ibge}`, { cache: "no-store", signal: AbortSignal.timeout(30_000) });
      const body = (await r.json()) as Data & { error?: string };
      if (!r.ok) return setError(body.error ?? `O servidor respondeu com erro (HTTP ${r.status}).`);
      setError(null);
      setData(body);
    } catch {
      setError("Não foi possível falar com o servidor. Confira se o npm run dev continua aberto.");
    }
  }, [ibge]);
  useEffect(() => {
    setData(null);
    load();
    const id = setInterval(load, 30_000);
    return () => clearInterval(id);
  }, [load]);

  const pick = (name: string) => {
    const c = cities.find((x) => x.name.toLowerCase() === name.trim().toLowerCase());
    if (!c) return;
    setIbge(c.ibge);
    setQuery("");
    try {
      localStorage.setItem("segundo-turno-cidade", c.ibge);
    } catch {
      // sem armazenamento local
    }
  };

  const [A, B] = data?.finalists ?? [];
  const nameA = A ? title(A.name) : "Candidato A";
  const nameB = B ? title(B.name) : "Candidato B";
  const colorA = A ? colorFor(A.name, 0) : FALLBACK[0]!;
  const colorB = B ? colorFor(B.name, 1) : FALLBACK[1]!;
  const votes = (r: Round | null, num?: string) => r?.candidates.find((c) => c.number === num)?.votes ?? 0;

  const r1 = data?.r1 ?? null;
  const r2 = data?.r2 ?? null;
  const a1 = votes(r1, A?.number);
  const b1 = votes(r1, B?.number);
  const a2 = votes(r2, A?.number);
  const b2 = votes(r2, B?.number);
  const has2 = a2 + b2 > 0;
  const lead1 = lead(a1, b1);
  const lead2 = lead(a2, b2);
  const others1 = r1 ? r1.valid - a1 - b1 : 0;
  const done2 = r2?.status === "TOTALIZACAO_FINALIZADA" || (r2?.pct ?? 0) >= 100;

  const s2 = useMemo(
    () => (data?.series ?? []).map((p) => ({ x: p.pct, y: lead(p.votes[A?.number ?? ""] ?? 0, p.votes[B?.number ?? ""] ?? 0) })).filter((p) => p.x > 0),
    [data, A, B],
  );
  // 1º turno: só o resultado final da cidade (linha de referência).
  const s1 = r1 ? [{ x: 0, y: lead1 }, { x: 100, y: lead1 }] : [];
  const ahead = (v: number) => (v >= 0 ? nameA : nameB);
  const cityName = data?.name ? title(data.name) : "";

  return (
    <section className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">2º turno na cidade{cityName ? ` — ${cityName}` : ""}</h1>
        <p className="text-sm text-muted">
          Presidente: o 2º turno da cidade ao vivo, comparado com o resultado do 1º turno na mesma cidade. Atualiza a cada 30 segundos.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <input
          list="cidades-sp"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            pick(e.target.value);
          }}
          placeholder="Trocar de cidade (SP)…"
          className="w-64 rounded-lg border border-border bg-surface px-3 py-1.5 text-sm"
          aria-label="Cidade"
        />
        <datalist id="cidades-sp">
          {cities.map((c) => (
            <option key={c.ibge} value={c.name} />
          ))}
        </datalist>
        {ibge !== SJC && (
          <button type="button" onClick={() => pick("São José dos Campos")} className="text-sm underline hover:text-accent">
            voltar para São José dos Campos
          </button>
        )}
      </div>

      {error && (
        <p role="alert" className="rounded-lg border border-amber-500/50 bg-amber-500/10 px-4 py-2 text-sm">
          {error}
        </p>
      )}
      {data?.error && <p className="rounded-lg border border-amber-500/50 bg-amber-500/10 px-4 py-2 text-sm">Última leitura do TSE falhou: {data.error}</p>}

      {!data ? (
        !error && <p className="text-sm text-muted">Carregando…</p>
      ) : (
        <>
          <div className="rounded-xl border border-border bg-surface p-4">
            {has2 && r2 ? (
              <p className="text-base">
                Com <strong>{formatPct(r2.pct)}</strong> das seções apuradas ({formatInt(r2.sectionsTotalized)} de {formatInt(r2.sections)}
                {r2.timestamp ? `, às ${formatTimeBrasilia(r2.timestamp)}` : ""}), <strong style={{ color: lead2 >= 0 ? colorA : colorB }}>{ahead(lead2)}</strong>{" "}
                está <strong>{pp(Math.abs(lead2))}</strong> à frente em {cityName}. No 1º turno, entre os dois, {ahead(lead1)} teve{" "}
                {pp(Math.abs(lead1))} de vantagem na cidade —{" "}
                <strong style={{ color: lead2 - lead1 >= 0 ? colorA : colorB }}>
                  {ahead(lead2 - lead1)} ganhou {pp(Math.abs(lead2 - lead1))}
                </strong>
                .
                {!done2 && (
                  <span className="mt-1 block text-xs text-muted">
                    Atenção: com poucas seções apuradas, o resultado depende de quais bairros já foram contados; a comparação fica firme perto
                    dos 100%.
                  </span>
                )}
              </p>
            ) : (
              <p className="text-sm">Aguardando as primeiras seções do 2º turno de {cityName} no TSE.</p>
            )}

            {has2 && r1 && (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-xs text-muted">
                    <tr className="border-b border-border">
                      <th className="py-2 pr-3">Momento</th>
                      {[
                        { n: nameA, c: colorA },
                        { n: nameB, c: colorB },
                      ].map((x) => (
                        <th key={x.n} className="px-3 py-2 text-right">
                          <span className="mr-1 inline-block h-2 w-2 rounded-full" style={{ background: x.c }} />
                          {x.n}
                        </th>
                      ))}
                      <th className="py-2 pl-3 text-right">À frente</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[
                      { label: "2º turno — agora", detail: `${formatPct(r2!.pct)} apurado`, l: lead2 },
                      { label: "1º turno — resultado final", detail: "só entre os dois", l: lead1 },
                    ].map((r) => (
                      <tr key={r.label} className="border-b border-border">
                        <td className="py-2 pr-3">
                          <span className="font-medium">{r.label}</span>
                          <span className="block text-xs text-muted">{r.detail}</span>
                        </td>
                        <td className="px-3 py-2 text-right">{formatPct(50 + r.l / 2)}</td>
                        <td className="px-3 py-2 text-right">{formatPct(50 - r.l / 2)}</td>
                        <td className="whitespace-nowrap py-2 pl-3 text-right font-semibold" style={{ color: r.l >= 0 ? colorA : colorB }}>
                          {ahead(r.l)} +{pp(Math.abs(r.l))}
                        </td>
                      </tr>
                    ))}
                    <tr>
                      <td className="py-2 pr-3 font-medium">Variação</td>
                      <td className="px-3 py-2 text-right" style={{ color: lead2 - lead1 >= 0 ? colorA : "var(--muted)" }}>
                        {signedP((lead2 - lead1) / 2)}
                      </td>
                      <td className="px-3 py-2 text-right" style={{ color: lead2 - lead1 < 0 ? colorB : "var(--muted)" }}>
                        {signedP(-(lead2 - lead1) / 2)}
                      </td>
                      <td className="whitespace-nowrap py-2 pl-3 text-right font-semibold" style={{ color: lead2 - lead1 >= 0 ? colorA : colorB }}>
                        {ahead(lead2 - lead1)} ganhou {pp(Math.abs(lead2 - lead1))}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {r1 && (
            <div className="overflow-x-auto rounded-xl border border-border bg-surface">
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-muted">
                  <tr className="border-b border-border">
                    <th className="px-3 py-2">{cityName}</th>
                    <th className="px-3 py-2 text-right">1º turno (final)</th>
                    <th className="px-3 py-2 text-right">2º turno{r2 ? ` (${formatPct(r2.pct)} apurado)` : ""}</th>
                    <th className="px-3 py-2 text-right">Mudança no %</th>
                    <th className="px-3 py-2 text-right">Diferença de votos{has2 && !done2 ? " (com 100%)" : ""}</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    { label: nameA, color: colorA, v1: a1, v2: a2, base1: r1.valid, base2: r2?.valid ?? 0, note: "dos válidos" },
                    { label: nameB, color: colorB, v1: b1, v2: b2, base1: r1.valid, base2: r2?.valid ?? 0, note: "dos válidos" },
                    { label: "Demais candidatos", color: "#94a3b8", v1: others1, v2: 0, base1: r1.valid, base2: r2?.valid ?? 0, note: "dos válidos" },
                    { label: "Brancos", v1: r1.blank, v2: r2?.blank ?? 0, base1: r1.turnout, base2: r2?.turnout ?? 0, note: "de quem votou" },
                    { label: "Nulos", v1: r1.null, v2: r2?.null ?? 0, base1: r1.turnout, base2: r2?.turnout ?? 0, note: "de quem votou" },
                    { label: "Compareceram", v1: r1.turnout, v2: r2?.turnout ?? 0, base1: r1.turnout + r1.abstention, base2: (r2?.turnout ?? 0) + (r2?.abstention ?? 0), note: "dos eleitores das seções" },
                    { label: "Abstenção", v1: r1.abstention, v2: r2?.abstention ?? 0, base1: r1.turnout + r1.abstention, base2: (r2?.turnout ?? 0) + (r2?.abstention ?? 0), note: "dos eleitores das seções" },
                  ].map((r) => {
                    const p1 = pct(r.v1, r.base1);
                    const p2 = pct(r.v2, r.base2);
                    return (
                      <tr key={r.label} className="border-b border-border last:border-0">
                        <td className="px-3 py-2 font-medium">
                          {"color" in r && r.color && <span className="mr-2 inline-block h-2.5 w-2.5 rounded-full" style={{ background: r.color }} />}
                          {r.label}
                        </td>
                        <td className="px-3 py-2 text-right">
                          {formatInt(r.v1)} <span className="text-xs text-muted">({formatPct(p1)})</span>
                        </td>
                        <td className="px-3 py-2 text-right font-semibold">
                          {has2 ? formatInt(r.v2) : "—"}
                          {has2 && <span className="text-xs font-normal text-muted"> ({formatPct(p2)})</span>}
                        </td>
                        <td className="px-3 py-2 text-right">{has2 ? signedP(p2 - p1) : "—"}</td>
                        <td className="px-3 py-2 text-right">{done2 ? `${r.v2 - r.v1 >= 0 ? "+" : "−"}${formatInt(Math.abs(r.v2 - r.v1))}` : "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <p className="px-3 pb-3 pt-1 text-xs text-muted">
                Percentuais: candidatos sobre os votos válidos; brancos e nulos sobre quem votou; comparecimento e abstenção sobre os eleitores
                das seções já apuradas — por isso dá para comparar mesmo com a apuração em andamento. No 1º turno, {formatInt(others1)} votos
                foram para os demais candidatos; no 2º turno eles se dividem entre os dois, votam em branco/nulo ou não comparecem.
              </p>
            </div>
          )}

          {has2 && (
            <>
              <LeadChart s1={s1} s2={s2} axis="pct" nameA={nameA} nameB={nameB} colorA={colorA} colorB={colorB} />
              <p className="text-xs text-muted">
                Linha cheia: vantagem no 2º turno em {cityName} conforme as seções são apuradas (registrada enquanto o sistema está aberto).
                Tracejada: vantagem no resultado final do 1º turno na cidade.
              </p>
            </>
          )}
        </>
      )}
    </section>
  );
}
