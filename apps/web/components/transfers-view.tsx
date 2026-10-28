"use client";

import { useEffect, useMemo, useState } from "react";
import { STATES, formatInt, formatPct } from "@apuracao/core";

type Dest = "Lula" | "Flávio" | "Branco/nulo" | "Abstenção";
interface Flow {
  Lula: number;
  Flávio: number;
  "Branco/nulo": number;
  Abstenção: number;
  votos: number;
}
interface Homog {
  Lula: number;
  Flávio: number;
  "Branco/nulo": number;
  Abstenção: number;
  secoes: number;
  excesso_pts: number;
  confiavel: boolean;
}
interface Urna {
  uf: string;
  municipio: string;
  zona: string;
  secao: string;
  local: string;
  endereco: string;
  aptos: number;
  pct: number;
  votos: number;
  lula1: number;
  flavio1: number;
  lula2: number;
  flavio2: number;
  abst1: number;
  abst2: number;
  bn1: number;
  bn2: number;
}
interface Scope {
  label: string;
  secoes: number;
  fluxos: Record<string, { principal: Flow; alternativo: Flow; homogeneas?: Homog }>;
  urnas: Record<string, Urna[]>;
  totais: Record<string, number>;
}
interface Data {
  gerado: string;
  fonte: string;
  escopos: Record<string, Scope>;
}

const DESTS: { key: Dest; label: string; color: string }[] = [
  { key: "Lula", label: "Lula", color: "#dc2626" },
  { key: "Flávio", label: "Flávio", color: "#2563eb" },
  { key: "Branco/nulo", label: "Branco ou nulo", color: "#94a3b8" },
  { key: "Abstenção", label: "Não votou", color: "#d97706" },
];
const SOURCES: { key: string; label: string; note?: string }[] = [
  { key: "Cury", label: "Augusto Cury" },
  { key: "Renan", label: "Renan Santos" },
  { key: "Caiado", label: "Ronaldo Caiado" },
  { key: "Zema", label: "Romeu Zema", note: "poucos votos: estimativa frágil" },
  { key: "Outros", label: "Demais candidatos", note: "poucos votos: estimativa frágil" },
  { key: "Branco/nulo", label: "Branco ou nulo no 1º turno" },
  { key: "Abstenção", label: "Não votou no 1º turno" },
];
const URNA_CANDS = [
  { key: "Cury", label: "Augusto Cury" },
  { key: "Renan", label: "Renan Santos" },
  { key: "Caiado", label: "Ronaldo Caiado" },
  { key: "Zema", label: "Romeu Zema" },
];
const title = (s: string) =>
  s
    .toLowerCase()
    .replace(/(^|\s|\/|\(|-)\S/g, (c) => c.toUpperCase())
    .replace(/ (Da|De|Do|Das|Dos|E|A)(?= )/g, (w) => w.toLowerCase());
const pct0 = (v: number) => `${Math.round(v).toLocaleString("pt-BR")}%`;
const signed = (v: number) => `${v >= 0 ? "+" : "−"}${formatInt(Math.abs(v))}`;
const thousand = (v: number) =>
  v >= 1_000_000 ? `${(v / 1_000_000).toLocaleString("pt-BR", { maximumFractionDigits: 2 })} mi` : `${formatInt(Math.round(v / 1000))} mil`;

/** Para onde foram, no 2º turno, os votos de quem escolheu outro candidato (ou não votou) no 1º turno. */
export function TransfersView() {
  const [data, setData] = useState<Data | null>(null);
  const [scope, setScope] = useState("BR");
  const [cand, setCand] = useState("Renan");

  useEffect(() => {
    fetch("/data/transferencias-2026.json")
      .then((r) => r.json())
      .then(setData)
      .catch(() => {});
  }, []);

  const sc = data?.escopos[scope] ?? null;
  const scopeName = scope === "BR" ? "Brasil" : scope === "SJC" ? "São José dos Campos" : (STATES.find((s) => s.uf === scope)?.name ?? scope);

  // De onde vieram os votos novos de cada finalista.
  const gains = useMemo(() => {
    if (!sc) return null;
    const out: Record<"Lula" | "Flávio", { key: string; label: string; votes: number }[]> = { Lula: [], Flávio: [] };
    for (const s of SOURCES) {
      const f = sc.fluxos[s.key]?.principal;
      if (!f) continue;
      for (const d of ["Lula", "Flávio"] as const) out[d].push({ key: s.key, label: s.label, votes: (f[d] / 100) * f.votos });
    }
    return out;
  }, [sc]);

  if (!data || !sc) return <p className="text-sm text-muted">Carregando…</p>;

  return (
    <section className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Para onde foram os votos — 1º → 2º turno</h1>
        <p className="text-sm text-muted">
          Quem votou em Augusto Cury, Renan Santos, Ronaldo Caiado, Romeu Zema e nos demais candidatos no 1º turno: votou em Lula, em Flávio,
          anulou ou ficou em casa no 2º turno? Estimativa feita comparando, seção por seção, os resultados oficiais dos dois turnos.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <select value={scope} onChange={(e) => setScope(e.target.value)} className="rounded-lg border border-border bg-surface px-2 py-1.5 text-sm" aria-label="Abrangência">
          <option value="BR">Brasil</option>
          {STATES.map((s) => (
            <option key={s.uf} value={s.uf}>
              {s.name}
            </option>
          ))}
          <option value="SJC">São José dos Campos</option>
        </select>
        <span className="text-xs text-muted">{formatInt(sc.secoes)} seções eleitorais comparadas</span>
      </div>

      {/* 1. Destino dos votos */}
      <div className="rounded-xl border border-border bg-surface p-4">
        <h2 className="text-lg font-semibold">De cada 100 eleitores no 1º turno, o que fizeram no 2º — {scopeName}</h2>
        <div className="mt-2 flex flex-wrap gap-3 text-sm">
          {DESTS.map((d) => (
            <span key={d.key} className="inline-flex items-center gap-1.5">
              <span className="inline-block h-3 w-3 rounded-sm" style={{ background: d.color }} />
              {d.label}
            </span>
          ))}
        </div>
        <div className="mt-4 space-y-4">
          {SOURCES.map((s) => {
            const f = sc.fluxos[s.key];
            if (!f || f.principal.votos <= 0) return null;
            const p = f.principal;
            const a = f.alternativo;
            const lo = Math.min(p.Lula, a.Lula);
            const hi = Math.max(p.Lula, a.Lula);
            const flo = Math.min(p["Flávio"], a["Flávio"]);
            const fhi = Math.max(p["Flávio"], a["Flávio"]);
            const weak = !!s.note || p.votos < 5000;
            return (
              <div key={s.key}>
                <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <span className="font-medium">
                    {s.label}
                    <span className="ml-2 text-xs font-normal text-muted">{formatInt(p.votos)} votos no 1º turno</span>
                  </span>
                  {weak && <span className="text-xs text-amber-600">{s.note ?? "poucos votos: estimativa frágil"}</span>}
                </div>
                <div className="mt-1 flex h-8 overflow-hidden rounded-md">
                  {DESTS.map((d) => {
                    const v = p[d.key];
                    if (v <= 0.4) return null;
                    return (
                      <div
                        key={d.key}
                        title={`${d.label}: ${formatPct(v)}`}
                        className="flex items-center justify-center text-sm font-semibold text-white"
                        style={{ width: `${v}%`, background: d.color }}
                      >
                        {v >= 7 ? pct0(v) : ""}
                      </div>
                    );
                  })}
                </div>
                <p className="mt-1 text-xs text-muted">
                  Faixa entre métodos: Lula {pct0(lo)}–{pct0(hi)} · Flávio {pct0(flo)}–{pct0(fhi)}
                  {f.homogeneas?.confiavel && (
                    <>
                      {" "}
                      · seções onde foi mais forte: Lula {pct0(f.homogeneas.Lula)}, Flávio {pct0(f.homogeneas["Flávio"])}
                    </>
                  )}
                </p>
              </div>
            );
          })}
        </div>
      </div>

      {/* 2. De onde vieram os votos novos */}
      {gains && (
        <div className="grid gap-4 md:grid-cols-2">
          {(["Lula", "Flávio"] as const).map((d) => {
            const rows = gains[d].filter((g) => g.votes > 0).sort((x, y) => y.votes - x.votes);
            const total = rows.reduce((t, g) => t + g.votes, 0);
            const max = Math.max(...rows.map((g) => g.votes), 1);
            const color = d === "Lula" ? "#dc2626" : "#2563eb";
            return (
              <div key={d} className="rounded-xl border border-border bg-surface p-4">
                <h3 className="font-semibold" style={{ color }}>
                  De onde vieram os votos novos de {d}
                </h3>
                <p className="text-xs text-muted">Votos recebidos no 2º turno de quem não votou nele no 1º (estimativa, {scopeName}).</p>
                <div className="mt-3 space-y-2">
                  {rows.map((g) => (
                    <div key={g.key} className="text-sm">
                      <div className="flex justify-between gap-2">
                        <span>{g.label}</span>
                        <span className="font-semibold">
                          {thousand(g.votes)} <span className="font-normal text-muted">({pct0((g.votes / total) * 100)})</span>
                        </span>
                      </div>
                      <div className="mt-0.5 h-2.5 rounded bg-border/40">
                        <div className="h-2.5 rounded" style={{ width: `${(g.votes / max) * 100}%`, background: color }} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* 3. A ideia original: as urnas onde cada candidato foi mais forte */}
      <div className="rounded-xl border border-border bg-surface p-4">
        <h2 className="text-lg font-semibold">As urnas onde cada candidato foi mais forte — {scopeName}</h2>
        <p className="text-sm text-muted">
          As 10 seções (com pelo menos 150 eleitores) onde o candidato teve a maior porcentagem no 1º turno, e quanto Lula e Flávio cresceram
          nelas no 2º turno. Uma urna sozinha é só um exemplo: mesmo nela, os eleitores do candidato são minoria.
        </p>
        <div className="mt-3 flex flex-wrap gap-1">
          {URNA_CANDS.map((c) => (
            <button
              key={c.key}
              onClick={() => setCand(c.key)}
              className={`rounded-full border px-3 py-1 text-sm ${cand === c.key ? "border-accent text-accent" : "border-border hover:border-accent hover:text-accent"}`}
            >
              {c.label}
            </button>
          ))}
        </div>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted">
              <tr className="border-b border-border">
                <th className="px-2 py-2">Local de votação</th>
                <th className="px-2 py-2 text-right">% no 1º turno</th>
                <th className="px-2 py-2 text-right" style={{ color: "#dc2626" }}>
                  Lula 1º → 2º
                </th>
                <th className="px-2 py-2 text-right" style={{ color: "#2563eb" }}>
                  Flávio 1º → 2º
                </th>
                <th className="px-2 py-2 text-right">Cresceu mais</th>
                <th className="px-2 py-2 text-right">Abstenção 1º → 2º</th>
              </tr>
            </thead>
            <tbody>
              {(sc.urnas[cand] ?? []).map((u) => {
                const dl = u.lula2 - u.lula1;
                const df = u.flavio2 - u.flavio1;
                return (
                  <tr key={`${u.uf}-${u.zona}-${u.secao}-${u.municipio}`} className="border-b border-border last:border-0">
                    <td className="px-2 py-2">
                      <div className="font-medium">{title(u.local)}</div>
                      <div className="text-xs text-muted">
                        {title(u.municipio)} ({u.uf}) · zona {u.zona}, seção {u.secao} · {formatInt(u.aptos)} eleitores
                      </div>
                    </td>
                    <td className="px-2 py-2 text-right font-semibold">
                      {formatPct(u.pct)}
                      <div className="text-xs font-normal text-muted">{formatInt(u.votos)} votos</div>
                    </td>
                    <td className="whitespace-nowrap px-2 py-2 text-right">
                      {formatInt(u.lula1)} → {formatInt(u.lula2)}
                      <div className="text-xs" style={{ color: "#dc2626" }}>
                        {signed(dl)}
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-2 py-2 text-right">
                      {formatInt(u.flavio1)} → {formatInt(u.flavio2)}
                      <div className="text-xs" style={{ color: "#2563eb" }}>
                        {signed(df)}
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-2 py-2 text-right font-semibold" style={{ color: dl > df ? "#dc2626" : df > dl ? "#2563eb" : undefined }}>
                      {dl > df ? "Lula" : df > dl ? "Flávio" : "empate"}
                    </td>
                    <td className="whitespace-nowrap px-2 py-2 text-right text-muted">
                      {formatPct(u.abst1)} → {formatPct(u.abst2)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* 4. Conferência: seções homogêneas */}
      <div className="rounded-xl border border-border bg-surface p-4">
        <h2 className="text-lg font-semibold">Conferência: o 1% de seções onde cada candidato foi mais forte</h2>
        <p className="text-sm text-muted">
          Em vez de uma urna, um grupo: as seções onde o candidato teve mais votos do que a média da própria cidade. Comparamos o que mudou
          nelas com o resto da cidade. Quando o grupo é pequeno ou o candidato quase não se destaca, o resultado não é confiável e aparece
          esmaecido.
        </p>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted">
              <tr className="border-b border-border">
                <th className="px-2 py-2">Candidato</th>
                <th className="px-2 py-2 text-right">Seções</th>
                <th className="px-2 py-2 text-right">Acima da média da cidade</th>
                {DESTS.map((d) => (
                  <th key={d.key} className="px-2 py-2 text-right" style={{ color: d.color }}>
                    {d.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {URNA_CANDS.map((c) => {
                const h = sc.fluxos[c.key]?.homogeneas;
                if (!h) return null;
                return (
                  <tr key={c.key} className={`border-b border-border last:border-0 ${h.confiavel ? "" : "opacity-45"}`}>
                    <td className="px-2 py-2 font-medium">
                      {c.label}
                      {!h.confiavel && <span className="ml-2 text-xs font-normal text-amber-600">não confiável</span>}
                    </td>
                    <td className="px-2 py-2 text-right">{formatInt(h.secoes)}</td>
                    <td className="px-2 py-2 text-right">
                      +{h.excesso_pts.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} pts
                    </td>
                    {DESTS.map((d) => (
                      <td key={d.key} className="px-2 py-2 text-right">
                        {h.confiavel ? pct0(h[d.key]) : "—"}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-surface p-4 text-sm text-muted">
        <h2 className="mb-1 font-semibold text-[var(--text)]">Como ler</h2>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            A barra principal é uma estimativa estatística (regressão ecológica): compara as seções de cada cidade e estima que fração dos
            eleitores de cada candidato do 1º turno foi para Lula, para Flávio, para o voto branco/nulo ou deixou de votar. Ninguém sabe como
            cada pessoa votou — o voto é secreto; o que se mede é o padrão das seções.
          </li>
          <li>
            &quot;Faixa entre métodos&quot; mostra o resultado de uma segunda forma de calcular (agrupando por estado em vez de por cidade). Quanto
            mais estreita a faixa, mais firme a conclusão.
          </li>
          <li>
            Candidatos com poucos votos (Zema e os demais) têm estimativas frágeis. Os números contam apenas as seções que existiram nos dois
            turnos com o mesmo eleitorado (sem voto em trânsito e exterior), por isso os totais são um pouco menores que os oficiais.
          </li>
        </ul>
        <p className="mt-2 text-xs">Fonte: {data.fonte}. Cálculo de {data.gerado.split("-").reverse().join("/")}.</p>
      </div>
    </section>
  );
}
