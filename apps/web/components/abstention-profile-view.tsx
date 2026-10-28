"use client";

import { useEffect, useMemo, useState } from "react";
import { STATES, formatInt, formatPct } from "@apuracao/core";

interface Sum {
  pct: number;
  electorate: number;
  turnout: number;
  abstention: number;
  blank: number;
  null: number;
  valid: number;
  a: number;
  b: number;
  others: number;
}
interface Area {
  uf: string;
  name: string;
  r1: Sum | null;
  r2: Sum | null;
}
interface TurnsData {
  finalists: { number: string; name: string }[];
  areas: Area[];
}
type Row4 = [string, number, number, number];
interface TurnProfile {
  total: [number, number, number];
  dims: Record<string, Record<string, Row4>>;
  obrigatorio: [number, number];
  facultativo: [number, number];
  deficiencia: [number, number];
  cities: Record<string, Row4>;
}
interface ProfileData {
  uf: string;
  status: {
    status: string;
    message: string | null;
    downloadedMb: number;
    totalMb: number | null;
    readingUf: string | null;
    ufsRead: number;
    ufsTotal: number;
    lastModified: string | null;
    turns: number[];
  };
  turns: Record<string, TurnProfile> | null;
}

const DIMS: { key: string; label: string; byCode: boolean }[] = [
  { key: "faixa", label: "Faixa etária", byCode: true },
  { key: "instrucao", label: "Escolaridade", byCode: true },
  { key: "genero", label: "Gênero", byCode: false },
  { key: "corRaca", label: "Cor/raça", byCode: false },
  { key: "estadoCivil", label: "Estado civil", byCode: false },
];
const FIXED: [RegExp, string][] = [
  [/\bLULA\b/i, "#dc2626"],
  [/\bBOLSONARO\b/i, "#2563eb"],
];
const FALLBACK = ["#7c3aed", "#0891b2"];
const BAR1 = "#94a3b8";
const BAR2 = "#0f766e";
const colorFor = (name: string, i: number) => FIXED.find(([re]) => re.test(name))?.[1] ?? FALLBACK[i]!;
const title = (s: string) =>
  s
    .toLowerCase()
    .replace(/(^|\s|\/|\()\S/g, (c) => c.toUpperCase())
    .replace(/ (Da|De|Do|Das|Dos|E|A|Ou)(?= )/g, (w) => w.toLowerCase());
const pct = (n: number, d: number) => (d > 0 ? (n / d) * 100 : 0);
const signed = (v: number) => `${v >= 0 ? "+" : "−"}${formatInt(Math.abs(v))}`;
const pp = (v: number) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} p.p.`;
const shareA = (s: Sum) => (s.a + s.b > 0 ? (s.a / (s.a + s.b)) * 100 : 50);
const isUnknown = (label: string) => /n[ãa]o informad|inv[áa]lid/i.test(label);

/** Abstenção nos dois turnos e o perfil de quem faltou. */
export function AbstentionProfileView() {
  const [uf, setUf] = useState("BR");
  const [turns, setTurns] = useState<TurnsData | null>(null);
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [citySort, setCitySort] = useState<"alta" | "baixa" | "queda">("alta");

  useEffect(() => {
    fetch("/api/v1/abstencao/turnos")
      .then((r) => r.json())
      .then(setTurns)
      .catch(() => {});
  }, []);
  useEffect(() => {
    let stop = false;
    const load = () =>
      fetch(`/api/v1/abstencao/perfil?uf=${uf}`, { cache: "no-store" })
        .then((r) => r.json())
        .then((d: ProfileData) => {
          if (stop) return;
          setProfile(d);
          // Pronto: não precisa mais consultar.
          if (d.status.status === "ready" || d.status.status === "error") clearInterval(id);
        })
        .catch(() => {});
    setProfile(null);
    const id = setInterval(load, 5_000);
    load();
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, [uf]);
  // Depois de pronto, não precisa mais consultar a cada 5 s.
  const ready = profile?.status.status === "ready" && profile.turns;

  const [A, B] = turns?.finalists ?? [];
  const nameA = A ? title(A.name) : "Candidato A";
  const nameB = B ? title(B.name) : "Candidato B";
  const colorA = A ? colorFor(A.name, 0) : FALLBACK[0]!;
  const colorB = B ? colorFor(B.name, 1) : FALLBACK[1]!;
  const area = turns?.areas.find((x) => x.uf === uf) ?? null;
  const name = uf === "BR" ? "Brasil" : uf === "ZZ" ? "Exterior" : (STATES.find((s) => s.uf === uf)?.name ?? uf);

  const states = useMemo(
    () =>
      (turns?.areas ?? [])
        .filter((x) => x.uf !== "BR" && x.r1 && x.r2 && x.r2.turnout > 0)
        .map((x) => {
          const ab1 = pct(x.r1!.abstention, x.r1!.electorate);
          const ab2 = pct(x.r2!.abstention, x.r2!.electorate);
          const extra = x.r2!.a + x.r2!.b - (x.r1!.a + x.r1!.b);
          return {
            ...x,
            ab1,
            ab2,
            drop: ab1 - ab2,
            moreTurnout: x.r2!.turnout - x.r1!.turnout,
            moreA: x.r2!.a - x.r1!.a,
            moreB: x.r2!.b - x.r1!.b,
            // Só quando os dois ganharam votos (senão a divisão passa de 100% e confunde).
            toA: extra > 0 && x.r2!.a >= x.r1!.a && x.r2!.b >= x.r1!.b ? pct(x.r2!.a - x.r1!.a, extra) : null,
            gainA: (shareA(x.r2!) - shareA(x.r1!)) * 2,
          };
        })
        .sort((p, q) => q.drop - p.drop),
    [turns],
  );

  return (
    <section className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Abstenção — quem faltou, 1º × 2º turno</h1>
        <p className="text-sm text-muted">
          Quantos eleitores deixaram de votar em cada turno, para onde foram os votos de quem voltou a votar no 2º turno, e o perfil de quem
          faltou (idade, escolaridade, gênero, cor/raça), pelos dados abertos do TSE.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <select value={uf} onChange={(e) => setUf(e.target.value)} className="rounded-lg border border-border bg-surface px-2 py-1.5 text-sm" aria-label="Abrangência">
          <option value="BR">Brasil</option>
          {STATES.map((s) => (
            <option key={s.uf} value={s.uf}>
              {s.name}
            </option>
          ))}
          <option value="ZZ">Exterior</option>
        </select>
        <span className="text-xs text-muted">Clique num estado na tabela ou no gráfico para ver os detalhes dele.</span>
      </div>

      {/* 1. Os dois turnos na área escolhida */}
      {area?.r1 && (
        <TwoRounds area={area} name={name} nameA={nameA} nameB={nameB} colorA={colorA} colorB={colorB} />
      )}

      {/* 2. Todos os estados */}
      {states.length > 0 && (
        <>
          <Scatter states={states} selected={uf} onPick={setUf} nameA={nameA} colorA={colorA} colorB={colorB} nameB={nameB} />
          <div className="overflow-x-auto rounded-xl border border-border bg-surface">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted">
                <tr className="border-b border-border">
                  <th className="px-3 py-2">Estado</th>
                  <th className="px-3 py-2 text-right">Abstenção 1º turno</th>
                  <th className="px-3 py-2 text-right">Abstenção 2º turno</th>
                  <th className="px-3 py-2 text-right">Variação</th>
                  <th className="px-3 py-2 text-right">Compareceram a mais</th>
                  <th className="px-3 py-2 text-right">
                    <span className="mr-1 inline-block h-2 w-2 rounded-full" style={{ background: colorA }} />
                    Votos a mais {nameA}
                  </th>
                  <th className="px-3 py-2 text-right">
                    <span className="mr-1 inline-block h-2 w-2 rounded-full" style={{ background: colorB }} />
                    Votos a mais {nameB}
                  </th>
                  <th className="px-3 py-2 text-right">
                    Dos votos a mais
                    <span className="block font-normal">
                      % para {nameA} · {nameB}
                    </span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {states.map((s) => (
                  <tr
                    key={s.uf}
                    onClick={() => setUf(s.uf)}
                    className={`cursor-pointer border-b border-border last:border-0 hover:bg-accent/5 ${s.uf === uf ? "bg-accent/10" : ""}`}
                  >
                    <td className="px-3 py-2 font-medium">{s.name}</td>
                    <td className="px-3 py-2 text-right">{formatPct(s.ab1)}</td>
                    <td className="px-3 py-2 text-right font-semibold">{formatPct(s.ab2)}</td>
                    <td className={`whitespace-nowrap px-3 py-2 text-right font-semibold ${s.drop >= 0 ? "text-emerald-600" : "text-amber-600"}`}>{pp(-s.drop)}</td>
                    <td className="px-3 py-2 text-right">{signed(s.moreTurnout)}</td>
                    <td className="px-3 py-2 text-right" style={{ color: s.moreA > 0 ? colorA : "var(--muted)" }}>
                      {signed(s.moreA)}
                    </td>
                    <td className="px-3 py-2 text-right" style={{ color: s.moreB > 0 ? colorB : "var(--muted)" }}>
                      {signed(s.moreB)}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right">
                      {s.toA === null ? "—" : `${formatPct(s.toA)} · ${formatPct(100 - s.toA)}`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-muted">
            Variação negativa (verde) = a abstenção caiu no 2º turno. &quot;Dos votos a mais&quot;: como se dividiu, entre {nameA} e {nameB}, o
            aumento de votos dos dois do 1º para o 2º turno (vindo de quem voltou a votar, de quem votou nos demais candidatos e de quem votou
            branco/nulo no 1º turno); &quot;—&quot; quando um dos dois perdeu votos.
          </p>
        </>
      )}

      {/* 3. Perfil de quem faltou */}
      <ProfileSection
        profile={profile}
        ready={!!ready}
        name={name}
        uf={uf}
        citySort={citySort}
        setCitySort={setCitySort}
      />
    </section>
  );
}

function TwoRounds({ area, name, nameA, nameB, colorA, colorB }: { area: Area; name: string; nameA: string; nameB: string; colorA: string; colorB: string }) {
  const r1 = area.r1!;
  const r2 = area.r2;
  const done = !!r2 && r2.pct >= 100;
  const rows = [
    { label: "Eleitores", v1: r1.electorate, v2: r2?.electorate, b1: 0, b2: 0, note: "" },
    { label: "Compareceram", v1: r1.turnout, v2: r2?.turnout, b1: r1.electorate, b2: r2?.electorate ?? 0, note: "" },
    { label: "Abstenção", v1: r1.abstention, v2: r2?.abstention, b1: r1.electorate, b2: r2?.electorate ?? 0, note: "" },
    { label: "Brancos", v1: r1.blank, v2: r2?.blank, b1: r1.turnout, b2: r2?.turnout ?? 0, note: "de quem votou" },
    { label: "Nulos", v1: r1.null, v2: r2?.null, b1: r1.turnout, b2: r2?.turnout ?? 0, note: "de quem votou" },
    { label: "Votos válidos", v1: r1.valid, v2: r2?.valid, b1: 0, b2: 0, note: "" },
  ];
  const moreA = r2 ? r2.a - r1.a : 0;
  const moreB = r2 ? r2.b - r1.b : 0;
  const fromAbst = r2 ? r1.abstention - r2.abstention : 0;
  const fromBlankNull = r2 ? r1.blank + r1.null - (r2.blank + r2.null) : 0;
  return (
    <div className="space-y-3 rounded-xl border border-border bg-surface p-4">
      <h2 className="text-base font-semibold">{name}: 1º turno × 2º turno</h2>
      {!r2 ? (
        <p className="text-sm text-muted">Sem o resultado do 2º turno guardado.</p>
      ) : (
        <>
          {!done && <p className="text-xs text-amber-600">2º turno ainda em apuração ({formatPct(r2.pct)}): os números do 2º turno estão parciais.</p>}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted">
                <tr className="border-b border-border">
                  <th className="py-2 pr-3" />
                  <th className="px-3 py-2 text-right">1º turno</th>
                  <th className="px-3 py-2 text-right">2º turno</th>
                  <th className="px-3 py-2 text-right">Diferença</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.label} className="border-b border-border last:border-0">
                    <td className="py-2 pr-3 font-medium">{r.label}</td>
                    <td className="px-3 py-2 text-right">
                      {formatInt(r.v1)}
                      {r.b1 > 0 && <span className="text-xs text-muted"> ({formatPct(pct(r.v1, r.b1))})</span>}
                    </td>
                    <td className="px-3 py-2 text-right font-semibold">
                      {formatInt(r.v2 ?? 0)}
                      {r.b2 > 0 && <span className="text-xs font-normal text-muted"> ({formatPct(pct(r.v2 ?? 0, r.b2))})</span>}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {signed((r.v2 ?? 0) - r.v1)}
                      {r.b1 > 0 && r.b2 > 0 && <span className="block text-xs text-muted">{pp(pct(r.v2 ?? 0, r.b2) - pct(r.v1, r.b1))}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="rounded-lg border border-border p-3 text-sm">
              <h3 className="mb-1 font-semibold">Votos a mais de cada finalista</h3>
              {[
                { n: nameA, c: colorA, v1: r1.a, v2: r2.a, d: moreA },
                { n: nameB, c: colorB, v1: r1.b, v2: r2.b, d: moreB },
              ].map((x) => (
                <p key={x.n}>
                  <span className="mr-1 inline-block h-2.5 w-2.5 rounded-full" style={{ background: x.c }} />
                  {x.n}: {formatInt(x.v1)} → {formatInt(x.v2)}{" "}
                  <strong style={{ color: x.d > 0 ? x.c : undefined }}>({signed(x.d)})</strong>
                </p>
              ))}
              {moreA + moreB > 0 && (
                <p className="mt-1 text-xs text-muted">
                  Dos {formatInt(moreA + moreB)} votos a mais dos dois, {formatPct(pct(moreA, moreA + moreB))} foram para {nameA} e{" "}
                  {formatPct(pct(moreB, moreA + moreB))} para {nameB}.
                </p>
              )}
            </div>
            <div className="rounded-lg border border-border p-3 text-sm">
              <h3 className="mb-1 font-semibold">De onde vieram os votos a mais</h3>
              <p>
                <strong>{signed(fromAbst)}</strong> eleitores a mais foram votar (queda da abstenção)
              </p>
              <p>
                <strong>{formatInt(r1.others)}</strong> votos tinham ido para os demais candidatos no 1º turno
              </p>
              <p>
                <strong>{signed(fromBlankNull)}</strong> {fromBlankNull >= 0 ? "brancos/nulos a menos" : "brancos/nulos a mais"}
              </p>
              <p className="mt-1 text-xs text-muted">
                Somados ({formatInt(fromAbst + r1.others + fromBlankNull)}), batem com os votos a mais dos dois (
                {formatInt(moreA + moreB)}); a pequena diferença vem da mudança no número de eleitores aptos. O TSE só publica totais: dá
                para saber o saldo de cada grupo, não o caminho de cada eleitor.
              </p>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

type StateRow = Area & { ab1: number; ab2: number; drop: number; gainA: number };

/** Cada estado: queda da abstenção (eixo X) × terreno ganho pelo 1º finalista (eixo Y). */
function Scatter({
  states,
  selected,
  onPick,
  nameA,
  nameB,
  colorA,
  colorB,
}: {
  states: StateRow[];
  selected: string;
  onPick: (uf: string) => void;
  nameA: string;
  nameB: string;
  colorA: string;
  colorB: string;
}) {
  const W = 760;
  const H = 340;
  const pad = { l: 52, r: 16, t: 16, b: 40 };
  const xs = states.map((s) => s.drop);
  const ys = states.map((s) => s.gainA);
  const xlo = Math.floor(Math.min(0, ...xs) - 0.5);
  const xhi = Math.ceil(Math.max(0, ...xs) + 0.5);
  const yAbs = Math.ceil(Math.max(2, ...ys.map(Math.abs)) + 1);
  const sx = (v: number) => pad.l + ((v - xlo) / (xhi - xlo)) * (W - pad.l - pad.r);
  const sy = (v: number) => pad.t + ((yAbs - v) / (2 * yAbs)) * (H - pad.t - pad.b);
  const [hover, setHover] = useState<StateRow | null>(null);
  const xStep = xhi - xlo > 10 ? 2 : 1;
  const yStep = yAbs > 12 ? 4 : yAbs > 6 ? 2 : 1;
  return (
    <figure className="rounded-xl border border-border bg-surface p-3">
      <figcaption className="mb-1 text-xs text-muted">
        <span className="font-semibold text-[var(--text)]">Cada estado: queda da abstenção × terreno ganho entre os turnos</span> — mais à direita, a
        abstenção caiu mais; mais acima, {nameA} ganhou mais terreno (abaixo de zero, {nameB}). Passe o mouse ou clique num ponto.
      </figcaption>
      <div className="relative">
        <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="Queda da abstenção e terreno por estado">
          {Array.from({ length: Math.floor((xhi - xlo) / xStep) + 1 }, (_, i) => xlo + i * xStep).map((v) => (
            <g key={`x${v}`}>
              <line x1={sx(v)} x2={sx(v)} y1={pad.t} y2={H - pad.b} stroke="var(--border)" strokeWidth={v === 0 ? 1.5 : 1} />
              <text x={sx(v)} y={H - pad.b + 16} fontSize="10" textAnchor="middle" fill="var(--muted)">
                {v > 0 ? `${v} p.p.` : v}
              </text>
            </g>
          ))}
          {Array.from({ length: Math.floor((2 * yAbs) / yStep) + 1 }, (_, i) => -Math.floor(yAbs / yStep) * yStep + i * yStep).map((v) => (
            <g key={`y${v}`}>
              <line x1={pad.l} x2={W - pad.r} y1={sy(v)} y2={sy(v)} stroke="var(--border)" strokeWidth={v === 0 ? 1.5 : 1} />
              <text x={pad.l - 6} y={sy(v) + 4} fontSize="10" textAnchor="end" fill="var(--muted)">
                {v > 0 ? `+${v}` : v}
              </text>
            </g>
          ))}
          <text x={(pad.l + W - pad.r) / 2} y={H - 6} fontSize="11" textAnchor="middle" fill="var(--muted)">
            queda da abstenção do 1º para o 2º turno (pontos percentuais)
          </text>
          <text x={pad.l + 6} y={pad.t + 12} fontSize="11" fill={colorA}>
            {nameA} ganhou terreno ↑
          </text>
          <text x={pad.l + 6} y={H - pad.b - 6} fontSize="11" fill={colorB}>
            {nameB} ganhou terreno ↓
          </text>
          {states.map((s) => (
            <g key={s.uf} onClick={() => onPick(s.uf)} onPointerEnter={() => setHover(s)} onPointerLeave={() => setHover(null)} style={{ cursor: "pointer" }}>
              <circle cx={sx(s.drop)} cy={sy(s.gainA)} r="14" fill="transparent" />
              <circle
                cx={sx(s.drop)}
                cy={sy(s.gainA)}
                r={s.uf === selected ? 7 : 5}
                fill={s.gainA >= 0 ? colorA : colorB}
                stroke={s.uf === selected ? "var(--text)" : "var(--surface)"}
                strokeWidth="2"
              />
              <text x={sx(s.drop) + 8} y={sy(s.gainA) + 4} fontSize="10" fill="var(--text)" stroke="var(--surface)" strokeWidth="3" paintOrder="stroke">
                {s.uf}
              </text>
            </g>
          ))}
        </svg>
        {hover && (
          <div
            className="pointer-events-none absolute rounded-lg border border-border bg-surface px-3 py-2 text-xs shadow"
            style={{ left: `${Math.min(70, (sx(hover.drop) / W) * 100)}%`, top: `${Math.min(70, (sy(hover.gainA) / H) * 100)}%` }}
          >
            <div className="font-semibold">{hover.name}</div>
            <div>
              Abstenção: {formatPct(hover.ab1)} → {formatPct(hover.ab2)}
            </div>
            <div>
              Terreno: {hover.gainA >= 0 ? nameA : nameB} +{Math.abs(hover.gainA).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} pontos
            </div>
          </div>
        )}
      </div>
    </figure>
  );
}

function ProfileSection({
  profile,
  ready,
  name,
  uf,
  citySort,
  setCitySort,
}: {
  profile: ProfileData | null;
  ready: boolean;
  name: string;
  uf: string;
  citySort: "alta" | "baixa" | "queda";
  setCitySort: (v: "alta" | "baixa" | "queda") => void;
}) {
  const st = profile?.status;
  const t1 = profile?.turns?.["1"] ?? null;
  const t2 = profile?.turns?.["2"] ?? null;

  const cities = useMemo(() => {
    if (!t1) return [];
    const rows = Object.entries(t1.cities)
      .map(([code, [nm, aptos, , abst]]) => {
        const c2 = t2?.cities[code];
        return { code, name: title(nm), aptos, rate1: pct(abst, aptos), rate2: c2 ? pct(c2[3], c2[1]) : null };
      })
      .filter((c) => c.aptos >= 1000);
    const by =
      citySort === "alta"
        ? (a: (typeof rows)[0], b: (typeof rows)[0]) => b.rate1 - a.rate1
        : citySort === "baixa"
          ? (a: (typeof rows)[0], b: (typeof rows)[0]) => a.rate1 - b.rate1
          : (a: (typeof rows)[0], b: (typeof rows)[0]) => (a.rate2 ?? 0) - a.rate1 - ((b.rate2 ?? 0) - b.rate1);
    return rows.sort(by).slice(0, 20);
  }, [t1, t2, citySort]);

  return (
    <div className="space-y-3">
      <div>
        <h2 className="text-lg font-semibold">Perfil de quem faltou — {name}</h2>
        <p className="text-xs text-muted">
          Dados abertos do TSE (&quot;perfil do comparecimento e abstenção&quot;).{" "}
          {st?.turns.length === 1 && st.turns[0] === 1
            ? "O TSE publicou até agora só o 1º turno; quando publicar o 2º, a comparação aparece aqui sozinha (o sistema confere a cada 6 horas)."
            : ""}
        </p>
      </div>
      {!ready ? (
        <p className="rounded-lg border border-border bg-surface px-4 py-3 text-sm text-muted">
          {!st
            ? "Carregando…"
            : st.status === "downloading" || st.status === "checking"
              ? `Baixando o arquivo do TSE: ${formatInt(st.downloadedMb)} de ${st.totalMb ? formatInt(st.totalMb) : "?"} MB (só na primeira vez)…`
              : st.status === "reading"
                ? `Lendo os dados de cada estado: ${st.ufsRead} de ${st.ufsTotal}${st.readingUf ? ` (agora: ${st.readingUf})` : ""}… leva alguns minutos na primeira vez.`
                : st.status === "error"
                  ? st.message
                  : "Preparando…"}
        </p>
      ) : !t1 ? (
        <p className="text-sm text-muted">Sem dados de perfil para {name}.</p>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            {[
              { label: "Abstenção geral", c: t1.total[1], ab: t1.total[2], c2: t2 ? t2.total[1] : null, ab2: t2 ? t2.total[2] : null },
              { label: "Voto obrigatório (18 a 69 anos)", c: t1.obrigatorio[0], ab: t1.obrigatorio[1], c2: t2?.obrigatorio[0] ?? null, ab2: t2?.obrigatorio[1] ?? null },
              { label: "Voto facultativo (16–17, 70+ e analfabetos)", c: t1.facultativo[0], ab: t1.facultativo[1], c2: t2?.facultativo[0] ?? null, ab2: t2?.facultativo[1] ?? null },
            ].map((x) => (
              <div key={x.label} className="rounded-xl border border-border bg-surface p-3">
                <div className="text-xs text-muted">{x.label}</div>
                <div className="text-2xl font-bold">{formatPct(pct(x.ab, x.c + x.ab))}</div>
                <div className="text-xs text-muted">
                  {formatInt(x.ab)} faltaram (1º turno)
                  {x.ab2 !== null && x.c2 !== null ? ` · 2º turno: ${formatPct(pct(x.ab2, x.c2 + x.ab2))}` : ""}
                </div>
              </div>
            ))}
          </div>
          <Highlights t1={t1} />
          <div className="grid gap-3 lg:grid-cols-2">
            {DIMS.map((d) => (
              <DimCard key={d.key} label={d.label} rows1={t1.dims[d.key] ?? {}} rows2={t2?.dims[d.key] ?? null} byCode={d.byCode} total={t1.total[2]} />
            ))}
          </div>
          {uf !== "BR" && cities.length > 0 && (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-base font-semibold">Cidades de {name}</h3>
                <select value={citySort} onChange={(e) => setCitySort(e.target.value as "alta" | "baixa" | "queda")} className="rounded-lg border border-border bg-surface px-2 py-1 text-sm">
                  <option value="alta">Maior abstenção (1º turno)</option>
                  <option value="baixa">Menor abstenção (1º turno)</option>
                  {t2 && <option value="queda">Maior queda no 2º turno</option>}
                </select>
                <span className="text-xs text-muted">cidades com pelo menos 1.000 eleitores; 20 primeiras</span>
              </div>
              <div className="overflow-x-auto rounded-xl border border-border bg-surface">
                <table className="w-full text-sm">
                  <thead className="text-left text-xs text-muted">
                    <tr className="border-b border-border">
                      <th className="px-3 py-2">Cidade</th>
                      <th className="px-3 py-2 text-right">Eleitores</th>
                      <th className="px-3 py-2 text-right">Abstenção 1º turno</th>
                      {t2 && <th className="px-3 py-2 text-right">Abstenção 2º turno</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {cities.map((c) => (
                      <tr key={c.code} className="border-b border-border last:border-0">
                        <td className="px-3 py-2 font-medium">{c.name}</td>
                        <td className="px-3 py-2 text-right">{formatInt(c.aptos)}</td>
                        <td className="px-3 py-2 text-right font-semibold">{formatPct(c.rate1)}</td>
                        {t2 && <td className="px-3 py-2 text-right">{c.rate2 === null ? "—" : formatPct(c.rate2)}</td>}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** Frases com os grupos que mais faltaram. */
function Highlights({ t1 }: { t1: TurnProfile }) {
  const top = (key: string, minShare = 0.01) => {
    const rows = Object.values(t1.dims[key] ?? {}).filter(([label, aptos]) => !isUnknown(label) && aptos >= t1.total[0] * minShare);
    return rows.sort((a, b) => pct(b[3], b[1]) - pct(a[3], a[1]))[0];
  };
  const items = [
    { k: "faixa", what: "Faixa etária" },
    { k: "instrucao", what: "Escolaridade" },
    { k: "estadoCivil", what: "Estado civil" },
  ]
    .map((x) => ({ ...x, row: top(x.k) }))
    .filter((x) => x.row);
  const overall = pct(t1.total[2], t1.total[0]);
  return (
    <div className="rounded-xl border border-border bg-surface p-4 text-sm">
      <h3 className="mb-1 font-semibold">Onde a abstenção foi mais alta (1º turno)</h3>
      <ul className="list-inside list-disc space-y-0.5">
        {items.map(({ what, row }) => (
          <li key={what}>
            {what}: <strong>{title(row![0])}</strong> — {formatPct(pct(row![3], row![1]))} faltaram ({(pct(row![3], row![1]) - overall).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} pontos acima da média de{" "}
            {formatPct(overall)})
          </li>
        ))}
      </ul>
      <p className="mt-1 text-xs text-muted">Só grupos com pelo menos 1% dos eleitores; &quot;não informado&quot; fica de fora.</p>
    </div>
  );
}

function DimCard({
  label,
  rows1,
  rows2,
  byCode,
  total,
}: {
  label: string;
  rows1: Record<string, Row4>;
  rows2: Record<string, Row4> | null;
  byCode: boolean;
  total: number;
}) {
  const rows = Object.entries(rows1)
    .filter(([, r]) => r[1] > 0)
    .sort(([ka, a], [kb, b]) => {
      if (isUnknown(a[0]) !== isUnknown(b[0])) return isUnknown(a[0]) ? 1 : -1;
      return byCode ? Number(ka) - Number(kb) : b[1] - a[1];
    });
  const max = Math.max(1, ...rows.map(([, r]) => pct(r[3], r[1])), ...rows.map(([k]) => (rows2?.[k] ? pct(rows2[k]![3], rows2[k]![1]) : 0)));
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className="mb-2 flex flex-wrap items-baseline gap-x-3">
        <h3 className="text-sm font-semibold">{label}</h3>
        <span className="flex items-center gap-1 text-xs text-muted">
          <span className="inline-block h-2 w-3 rounded-sm" style={{ background: BAR1 }} /> abstenção 1º turno
        </span>
        {rows2 && (
          <span className="flex items-center gap-1 text-xs text-muted">
            <span className="inline-block h-2 w-3 rounded-sm" style={{ background: BAR2 }} /> 2º turno
          </span>
        )}
      </div>
      <ul className="space-y-1.5">
        {rows.map(([k, r]) => {
          const rate = pct(r[3], r[1]);
          const r2 = rows2?.[k];
          const rate2 = r2 ? pct(r2[3], r2[1]) : null;
          return (
            <li key={k} className="grid grid-cols-[minmax(0,11rem)_1fr_auto] items-center gap-2 text-xs" title={`${formatInt(r[1])} eleitores · ${formatInt(r[3])} faltaram`}>
              <span className="truncate">{title(r[0])}</span>
              <span className="space-y-0.5">
                <span className="block h-2.5 rounded-r" style={{ width: `${(rate / max) * 100}%`, background: BAR1 }} />
                {rate2 !== null && <span className="block h-2.5 rounded-r" style={{ width: `${(rate2 / max) * 100}%`, background: BAR2 }} />}
              </span>
              <span className="whitespace-nowrap text-right tabular-nums">
                <strong>{formatPct(rate)}</strong>
                {rate2 !== null && <span className="text-muted"> → {formatPct(rate2)}</span>}
                <span className="block text-[10px] text-muted">{formatPct(pct(r[3], total))} dos faltosos</span>
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
