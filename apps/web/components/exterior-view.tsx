"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { formatInt, formatPct, formatTimeBrasilia } from "@apuracao/core";

interface Summary {
  pct: number;
  electorate: number;
  turnout: number;
  valid: number;
  blank: number;
  null: number;
  a: number;
  b: number;
  others: number;
}
interface City {
  code: string;
  name: string;
  country: string;
  r1: Summary | null;
  r2: Summary | null;
}
interface Data {
  finalists: { number: string; name: string; party: string }[];
  restartNeeded: boolean;
  total: { r1: Summary | null; r2: Summary | null; r2Timestamp: string | null };
  updatedAt: string | null;
  progress: { running: boolean; done: number; total: number; failures: number; lastError: string | null } | null;
  rounds: Record<"1" | "2", { citiesListed: number; listError: string | null }> | null;
  cities: City[];
}

// Cores fixas por candidato (as mesmas das outras abas).
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
/** Percentual de A considerando só os votos dos dois finalistas. */
const shareA = (a: number, b: number) => (a + b > 0 ? (a / (a + b)) * 100 : 50);
const pts = (v: number) => v.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const signed = (v: number) => `${v >= 0 ? "+" : "−"}${formatInt(Math.abs(v))}`;

/** Soma de vários resumos (cidades de um país, por exemplo). */
function add(list: (Summary | null)[]): Summary | null {
  const xs = list.filter((x): x is Summary => x !== null);
  if (xs.length === 0) return null;
  const sum = (k: keyof Summary) => xs.reduce((s, x) => s + x[k], 0);
  const sections = sum("electorate");
  return {
    // % apurado ponderado pelo eleitorado de cada cidade.
    pct: sections > 0 ? xs.reduce((s, x) => s + x.pct * x.electorate, 0) / sections : xs.reduce((s, x) => s + x.pct, 0) / xs.length,
    electorate: sections,
    turnout: sum("turnout"),
    valid: sum("valid"),
    blank: sum("blank"),
    null: sum("null"),
    a: sum("a"),
    b: sum("b"),
    others: sum("others"),
  };
}

interface Row {
  key: string;
  name: string;
  sub: string;
  r1: Summary | null;
  r2: Summary | null;
}

type Mode = "pais" | "cidade";
type Sort = "votos" | "terreno" | "nome";

export function ExteriorView() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>("pais");
  const [sort, setSort] = useState<Sort>("votos");
  const [q, setQ] = useState("");

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/v1/exterior", { cache: "no-store", signal: AbortSignal.timeout(20_000) });
      if (!r.ok) return setError(`O servidor respondeu com erro (HTTP ${r.status}).`);
      setError(null);
      setData((await r.json()) as Data);
    } catch {
      setError("Não foi possível falar com o servidor. Confira se o npm run dev continua aberto.");
    }
  }, []);
  useEffect(() => {
    load();
    const id = setInterval(load, 20_000);
    return () => clearInterval(id);
  }, [load]);

  const [A, B] = data?.finalists ?? [];
  const nameA = A ? title(A.name) : "Candidato A";
  const nameB = B ? title(B.name) : "Candidato B";
  const colorA = A ? colorFor(A.name, 0) : FALLBACK[0]!;
  const colorB = B ? colorFor(B.name, 1) : FALLBACK[1]!;

  const rows = useMemo<Row[]>(() => {
    const cities = data?.cities ?? [];
    let out: Row[];
    if (mode === "cidade") {
      out = cities.map((c) => ({ key: c.code, name: title(c.name), sub: c.country, r1: c.r1, r2: c.r2 }));
    } else {
      const groups = new Map<string, City[]>();
      for (const c of cities) groups.set(c.country, [...(groups.get(c.country) ?? []), c]);
      out = [...groups].map(([country, cs]) => ({
        key: country,
        name: country,
        sub: `${cs.length} ${cs.length === 1 ? "cidade" : "cidades"}`,
        // Com o 2º turno em andamento, o país compara só as cidades que já têm urnas apuradas nos dois turnos.
        ...((withR2) => ({
          r1: add((withR2.length > 0 ? withR2 : cs).map((c) => c.r1)),
          r2: add(withR2.map((c) => c.r2)),
        }))(cs.filter((c) => c.r2 && c.r2.a + c.r2.b > 0)),
      }));
    }
    const needle = q.trim().toLowerCase();
    if (needle) out = out.filter((r) => `${r.name} ${r.sub}`.toLowerCase().includes(needle));
    const gain = (r: Row) => (r.r1 && r.r2 && r.r2.a + r.r2.b > 0 ? shareA(r.r2.a, r.r2.b) - shareA(r.r1.a, r.r1.b) : -Infinity);
    const votes = (r: Row) => (r.r2?.valid ?? 0) * 1e6 + (r.r1?.valid ?? 0);
    return out.sort((x, y) =>
      sort === "nome" ? x.name.localeCompare(y.name, "pt-BR") : sort === "terreno" ? gain(y) - gain(x) : votes(y) - votes(x),
    );
  }, [data, mode, sort, q]);

  const t1 = data?.total.r1 ?? null;
  const t2 = data?.total.r2 ?? null;
  const has2 = !!t2 && t2.a + t2.b > 0;
  // A diferença de votos entre os turnos só faz sentido com o 2º turno inteiro apurado.
  const done2 = has2 && t2!.pct >= 100;
  const lead1 = t1 ? shareA(t1.a, t1.b) : null;
  const lead2 = has2 ? shareA(t2!.a, t2!.b) : null;

  const csv = () => {
    const head = ["Nome", mode === "pais" ? "Cidades" : "País", `${nameA} 1º turno`, `${nameB} 1º turno`, `${nameA} 2º turno`, `${nameB} 2º turno`, `% ${nameA} entre os dois 1º turno`, `% ${nameA} entre os dois 2º turno`, "Comparecimento 1º turno", "Comparecimento 2º turno", "% apurado 2º turno"];
    const n = (v: number) => v.toLocaleString("pt-BR", { maximumFractionDigits: 2 });
    const lines = rows.map((r) =>
      [r.name, r.sub, r.r1?.a ?? "", r.r1?.b ?? "", r.r2?.a ?? "", r.r2?.b ?? "", r.r1 ? n(shareA(r.r1.a, r.r1.b)) : "", r.r2 && r.r2.a + r.r2.b > 0 ? n(shareA(r.r2.a, r.r2.b)) : "", r.r1?.turnout ?? "", r.r2?.turnout ?? "", r.r2 ? n(r.r2.pct) : ""]
        .map((v) => `"${String(v).replace(/"/g, '""')}"`)
        .join(";"),
    );
    const blob = new Blob(["﻿" + [head.join(";"), ...lines].join("\r\n")], { type: "text/csv;charset=utf-8" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `exterior-1o-x-2o-turno-por-${mode}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  };

  const r2Listed = data?.rounds?.["2"].citiesListed ?? 0;
  // O TSE publica os arquivos das cidades zerados antes da divulgação: conta só as que já têm votos.
  const counted = (r: Summary | null) => !!r && (r.pct > 0 || r.a + r.b > 0);
  const r2Read = (data?.cities ?? []).filter((c) => counted(c.r2)).length;
  const r1Read = (data?.cities ?? []).filter((c) => counted(c.r1)).length;

  return (
    <section className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Exterior — Presidente, 1º turno × 2º turno</h1>
        <p className="text-sm text-muted">
          Como votaram os brasileiros que moram fora do país nos dois turnos: o total, cada país e cada cidade onde houve votação.
          Os votos do exterior só são divulgados pelo TSE depois do fim da votação no Brasil.
        </p>
      </div>

      {error && (
        <p role="alert" className="rounded-lg border border-amber-500/50 bg-amber-500/10 px-4 py-2 text-sm">
          {error}
        </p>
      )}
      {data?.restartNeeded && (
        <p className="rounded-lg border border-amber-500/50 bg-amber-500/10 px-4 py-2 text-sm">
          Para ler as cidades do exterior, feche o sistema (Ctrl + C no cmd) e rode <code>npm run dev</code> de novo.
        </p>
      )}

      {!data ? (
        !error && <p className="text-sm text-muted">Carregando…</p>
      ) : (
        <>
          {/* Total do exterior nos dois turnos */}
          <div className="rounded-xl border border-border bg-surface p-4">
            {has2 && lead1 !== null && lead2 !== null ? (
              <p className="text-base">
                No exterior, com <strong>{formatPct(t2!.pct)}</strong> das urnas apuradas
                {data.total.r2Timestamp ? ` (às ${formatTimeBrasilia(data.total.r2Timestamp)})` : ""}, {nameA} tem{" "}
                <strong style={{ color: colorA }}>{formatPct(lead2)}</strong> e {nameB}{" "}
                <strong style={{ color: colorB }}>{formatPct(100 - lead2)}</strong> dos votos dos dois. No 1º turno, entre os dois, foram{" "}
                {formatPct(lead1)} e {formatPct(100 - lead1)} —{" "}
                <strong style={{ color: lead2 - lead1 >= 0 ? colorA : colorB }}>
                  {lead2 - lead1 >= 0 ? nameA : nameB} ganhou {pts(Math.abs(lead2 - lead1) * 2)} pontos
                </strong>{" "}
                de vantagem.
              </p>
            ) : (
              <p className="text-sm">
                Aguardando o TSE divulgar os votos do 2º turno no exterior (só depois do fim da votação no Brasil, às 19h de Brasília). Números
                que circulam antes disso vêm de boletins de urna afixados nos locais de votação no exterior, não do TSE. {t1 ? `O 1º turno já está carregado (${formatPct(t1.pct)} apurado).` : ""} A página se
                atualiza sozinha a cada 20 segundos.
              </p>
            )}
          </div>

          {t1 && (
            <div className="overflow-x-auto rounded-xl border border-border bg-surface">
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-muted">
                  <tr className="border-b border-border">
                    <th className="px-3 py-2">Total do exterior</th>
                    <th className="px-3 py-2 text-right">1º turno</th>
                    <th className="px-3 py-2 text-right">2º turno{has2 ? ` (${formatPct(t2!.pct)} apurado)` : ""}</th>
                    <th className="px-3 py-2 text-right">Diferença{has2 && !done2 ? " (com 100% apurado)" : ""}</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    { label: nameA, color: colorA, v1: t1.a, v2: t2?.a, p1: (t1.a / Math.max(1, t1.valid)) * 100, p2: t2 ? (t2.a / Math.max(1, t2.valid)) * 100 : null },
                    { label: nameB, color: colorB, v1: t1.b, v2: t2?.b, p1: (t1.b / Math.max(1, t1.valid)) * 100, p2: t2 ? (t2.b / Math.max(1, t2.valid)) * 100 : null },
                    { label: "Demais candidatos", color: "#94a3b8", v1: t1.others, v2: t2?.others, p1: (t1.others / Math.max(1, t1.valid)) * 100, p2: null },
                  ].map((r) => (
                    <tr key={r.label} className="border-b border-border">
                      <td className="px-3 py-2 font-medium">
                        <span className="mr-2 inline-block h-2.5 w-2.5 rounded-full" style={{ background: r.color }} />
                        {r.label}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {formatInt(r.v1)} <span className="text-xs text-muted">({formatPct(r.p1)} dos válidos)</span>
                      </td>
                      <td className="px-3 py-2 text-right font-semibold">
                        {has2 && r.v2 !== undefined ? formatInt(r.v2) : "—"}
                        {has2 && r.p2 !== null && <span className="text-xs font-normal text-muted"> ({formatPct(r.p2)})</span>}
                      </td>
                      <td className="px-3 py-2 text-right">{done2 && r.v2 !== undefined ? signed(r.v2 - r.v1) : "—"}</td>
                    </tr>
                  ))}
                  {[
                    { label: "Compareceram", v1: t1.turnout, v2: t2?.turnout, p1: (t1.turnout / Math.max(1, t1.electorate)) * 100, p2: t2 ? (t2.turnout / Math.max(1, t2.electorate)) * 100 : null, note: "do eleitorado" },
                    { label: "Brancos e nulos", v1: t1.blank + t1.null, v2: t2 ? t2.blank + t2.null : undefined, p1: ((t1.blank + t1.null) / Math.max(1, t1.turnout)) * 100, p2: t2 ? ((t2.blank + t2.null) / Math.max(1, t2.turnout)) * 100 : null, note: "de quem votou" },
                  ].map((r) => (
                    <tr key={r.label} className="border-b border-border last:border-0 text-muted">
                      <td className="px-3 py-2">{r.label}</td>
                      <td className="px-3 py-2 text-right">
                        {formatInt(r.v1)} <span className="text-xs">({formatPct(r.p1)} {r.note})</span>
                      </td>
                      <td className="px-3 py-2 text-right">
                        {has2 && r.v2 !== undefined ? formatInt(r.v2) : "—"}
                        {has2 && r.p2 !== null && <span className="text-xs"> ({formatPct(r.p2)})</span>}
                      </td>
                      <td className="px-3 py-2 text-right">{done2 && r.v2 !== undefined ? signed(r.v2 - r.v1) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <G1Section nameA={nameA} nameB={nameB} colorA={colorA} colorB={colorB} aIsLula={/lula/i.test(A?.name ?? "LULA")} />

          {/* Leitura das cidades */}
          <p className="text-xs text-muted">
            Cidades com urnas apuradas: 1º turno {r1Read} de {data.rounds?.["1"].citiesListed ?? 0} · 2º turno {r2Read} de {r2Listed}
            {data.progress?.running ? ` · lendo agora ${data.progress.done} de ${data.progress.total}…` : ""}
            {data.updatedAt ? ` · atualizado às ${formatTimeBrasilia(data.updatedAt)}` : ""}
            {data.rounds?.["1"].listError ? ` · ${data.rounds["1"].listError}` : ""}
            {data.rounds?.["2"].listError ? ` · ${data.rounds["2"].listError}` : ""}
            {data.progress?.failures ? ` · ${data.progress.failures} falhas (ex.: ${data.progress.lastError})` : ""}
          </p>

          <div className="flex flex-wrap items-center gap-2">
            <span className="flex overflow-hidden rounded-full border border-border text-sm">
              {(
                [
                  ["pais", "Por país"],
                  ["cidade", "Por cidade"],
                ] as const
              ).map(([m, label]) => (
                <button key={m} type="button" onClick={() => setMode(m)} aria-pressed={mode === m} className={`px-3 py-1 ${mode === m ? "bg-accent text-white" : "hover:text-accent"}`}>
                  {label}
                </button>
              ))}
            </span>
            <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} className="rounded-lg border border-border bg-surface px-2 py-1.5 text-sm" aria-label="Ordenar">
              <option value="votos">Mais votos primeiro</option>
              <option value="terreno">Quem mais mudou primeiro</option>
              <option value="nome">Ordem alfabética</option>
            </select>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={mode === "pais" ? "Buscar país…" : "Buscar cidade ou país…"}
              className="rounded-lg border border-border bg-surface px-3 py-1.5 text-sm"
            />
            <button type="button" onClick={csv} disabled={rows.length === 0} className="ml-auto rounded-full border border-border px-3 py-1 text-sm hover:border-accent hover:text-accent disabled:opacity-50">
              Baixar planilha (CSV)
            </button>
          </div>

          {rows.length === 0 ? (
            <p className="rounded-lg border border-border bg-surface px-4 py-3 text-sm text-muted">
              {data.cities.length === 0 ? "Ainda lendo a lista de cidades do exterior no TSE…" : "Nada encontrado."}
            </p>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-border bg-surface">
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-muted">
                  <tr className="border-b border-border">
                    <th className="px-3 py-2">{mode === "pais" ? "País" : "Cidade"}</th>
                    {[
                      { name: nameA, color: colorA },
                      { name: nameB, color: colorB },
                    ].map((c) => (
                      <th key={c.name} className="px-3 py-2 text-right" colSpan={2}>
                        <span className="mr-1 inline-block h-2 w-2 rounded-full" style={{ background: c.color }} />
                        {c.name}
                        <span className="block font-normal">1º turno* · 2º turno</span>
                      </th>
                    ))}
                    <th className="px-3 py-2 text-right">Quem ganhou terreno</th>
                    <th className="px-3 py-2 text-right">
                      Votos dos dois
                      <span className="block font-normal">1º turno · 2º turno</span>
                    </th>
                    <th className="px-3 py-2 text-right">Apurado (2º)</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const s1 = r.r1 && r.r1.a + r.r1.b > 0 ? shareA(r.r1.a, r.r1.b) : null;
                    const s2 = r.r2 && r.r2.a + r.r2.b > 0 ? shareA(r.r2.a, r.r2.b) : null;
                    const d = s1 !== null && s2 !== null ? (s2 - s1) * 2 : null;
                    return (
                      <tr key={r.key} className="border-b border-border last:border-0">
                        <td className="px-3 py-2">
                          <span className="font-medium">{r.name}</span>
                          <span className="block text-xs text-muted">{r.sub}</span>
                        </td>
                        {[
                          { s1, s2 },
                          { s1: s1 === null ? null : 100 - s1, s2: s2 === null ? null : 100 - s2 },
                        ].map((c, i) => (
                          <FragmentCells key={i} s1={c.s1} s2={c.s2} />
                        ))}
                        <td className="whitespace-nowrap px-3 py-2 text-right font-semibold" style={{ color: d === null ? undefined : d >= 0 ? colorA : colorB }}>
                          {d === null ? "—" : `${d >= 0 ? nameA : nameB} +${pts(Math.abs(d))}`}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-right text-xs text-muted">
                          {r.r1 ? formatInt(r.r1.a + r.r1.b) : "—"} · {r.r2 ? formatInt(r.r2.a + r.r2.b) : "—"}
                        </td>
                        <td className="px-3 py-2 text-right">{r.r2 ? formatPct(r.r2.pct) : "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <p className="text-xs text-muted">
            * Percentual de {nameA} e de {nameB} considerando só os votos dos dois finalistas, para comparar o 1º turno (que teve outros candidatos)
            com o 2º. &quot;Quem ganhou terreno&quot;: quanto a vantagem entre os dois mudou, em pontos. Por país, enquanto o 2º turno é apurado, os dois turnos somam só as
            cidades que já têm urnas apuradas no 2º. País a partir do nome da cidade informado pelo TSE (&quot;Outros&quot; quando a cidade não está na tabela da plataforma).
          </p>
        </>
      )}
    </section>
  );
}

interface G1Data {
  url: string;
  readAt: string;
  error: string | null;
  countries: { country: string; region: string; r1: { lula: number; flavio: number } | null; r2: { lula: number; flavio: number } | null }[];
}

/** Parcial do g1 (boletins de urna somados pela imprensa), à parte do resultado oficial do TSE. */
function G1Section({ nameA, nameB, colorA, colorB, aIsLula }: { nameA: string; nameB: string; colorA: string; colorB: string; aIsLula: boolean }) {
  const [g1, setG1] = useState<G1Data | null>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const load = () =>
      fetch("/api/v1/exterior/g1", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .then((d: G1Data | null) => d && setG1(d))
        .catch(() => {});
    load();
    const id = setInterval(load, 120_000);
    return () => clearInterval(id);
  }, []);
  if (!g1) return null;
  // Lula/Flávio do g1 → finalistas A/B da página.
  const ab = (v: { lula: number; flavio: number } | null) => (v ? (aIsLula ? { a: v.lula, b: v.flavio } : { a: v.flavio, b: v.lula }) : null);
  const rows = g1.countries
    .map((c) => ({ ...c, v1: ab(c.r1), v2: ab(c.r2) }))
    .sort((x, y) => (y.v2 ? y.v2.a + y.v2.b : -1) - (x.v2 ? x.v2.a + x.v2.b : -1) || (y.v1 ? y.v1.a + y.v1.b : 0) - (x.v1 ? x.v1.a + x.v1.b : 0));
  const withR2 = rows.filter((r) => r.v2 && r.v1);
  const sum = (list: typeof rows, k: "v1" | "v2") => list.reduce((s, r) => ({ a: s.a + (r[k]?.a ?? 0), b: s.b + (r[k]?.b ?? 0) }), { a: 0, b: 0 });
  const t2 = sum(rows, "v2");
  const same1 = sum(withR2, "v1");
  const s2 = shareA(t2.a, t2.b);
  const s1 = shareA(same1.a, same1.b);
  const d = (s2 - s1) * 2;
  return (
    <div className="space-y-2 rounded-xl border border-amber-500/40 bg-amber-500/5 p-4 text-sm">
      <div className="flex flex-wrap items-baseline gap-2">
        <h2 className="text-base font-semibold">Parcial do g1 — boletins de urna (não oficial)</h2>
        <span className="text-xs text-muted">
          lido às {formatTimeBrasilia(g1.readAt)} ·{" "}
          <a href={g1.url} target="_blank" rel="noreferrer" className="underline hover:text-accent">
            reportagem
          </a>
        </span>
      </div>
      {g1.error && <p className="text-xs text-muted">{g1.error}</p>}
      {withR2.length > 0 ? (
        <p>
          Somando os boletins de <strong>{withR2.length}</strong> de {rows.length} países: {nameA}{" "}
          <strong style={{ color: colorA }}>
            {formatInt(t2.a)} ({formatPct(s2)})
          </strong>{" "}
          × {nameB}{" "}
          <strong style={{ color: colorB }}>
            {formatInt(t2.b)} ({formatPct(100 - s2)})
          </strong>
          . Nesses mesmos países, no 1º turno, entre os dois: {formatPct(s1)} × {formatPct(100 - s1)} —{" "}
          <strong style={{ color: d >= 0 ? colorA : colorB }}>
            {d >= 0 ? nameA : nameB} ganhou {pts(Math.abs(d))} pontos
          </strong>
          .
        </p>
      ) : (
        <p>O g1 ainda não publicou boletins do 2º turno.</p>
      )}
      <p className="text-xs text-muted">
        A imprensa soma as fotos dos boletins impressos pelas urnas lá fora; o TSE só divulga o exterior depois do fim da votação no Brasil. Os
        números oficiais aparecem nas tabelas desta página assim que o TSE liberar.
      </p>
      <button type="button" onClick={() => setOpen(!open)} className="text-xs underline hover:text-accent">
        {open ? "Esconder" : "Ver"} os {rows.length} países do g1
      </button>
      {open && (
        <div className="overflow-x-auto rounded-lg border border-border bg-surface">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted">
              <tr className="border-b border-border">
                <th className="px-3 py-2">País</th>
                <th className="px-3 py-2 text-right">
                  <span className="mr-1 inline-block h-2 w-2 rounded-full" style={{ background: colorA }} />
                  {nameA}
                  <span className="block font-normal">1º turno · 2º turno</span>
                </th>
                <th className="px-3 py-2 text-right">
                  <span className="mr-1 inline-block h-2 w-2 rounded-full" style={{ background: colorB }} />
                  {nameB}
                  <span className="block font-normal">1º turno · 2º turno</span>
                </th>
                <th className="px-3 py-2 text-right">% entre os dois (2º)</th>
                <th className="px-3 py-2 text-right">Quem ganhou terreno</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const g = r.v1 && r.v2 && r.v1.a + r.v1.b > 0 && r.v2.a + r.v2.b > 0 ? (shareA(r.v2.a, r.v2.b) - shareA(r.v1.a, r.v1.b)) * 2 : null;
                return (
                  <tr key={r.country} className="border-b border-border last:border-0">
                    <td className="px-3 py-2">
                      <span className="font-medium">{r.country}</span>
                      <span className="block text-xs text-muted">{title(r.region)}</span>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right">
                      {r.v1 ? formatInt(r.v1.a) : "—"} · <strong>{r.v2 ? formatInt(r.v2.a) : "—"}</strong>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right">
                      {r.v1 ? formatInt(r.v1.b) : "—"} · <strong>{r.v2 ? formatInt(r.v2.b) : "—"}</strong>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right">
                      {r.v2 && r.v2.a + r.v2.b > 0 ? `${formatPct(shareA(r.v2.a, r.v2.b))} × ${formatPct(100 - shareA(r.v2.a, r.v2.b))}` : <span className="text-xs text-muted">aguardando boletins</span>}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right font-semibold" style={{ color: g === null ? undefined : g >= 0 ? colorA : colorB }}>
                      {g === null ? "—" : `${g >= 0 ? nameA : nameB} +${pts(Math.abs(g))}`}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function FragmentCells({ s1, s2 }: { s1: number | null; s2: number | null }) {
  return (
    <>
      <td className="px-3 py-2 text-right">{s1 === null ? "—" : formatPct(s1)}</td>
      <td className="px-3 py-2 text-right font-semibold">{s2 === null ? "—" : formatPct(s2)}</td>
    </>
  );
}
