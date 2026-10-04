// Projeção da distribuição de cadeiras em eleições proporcionais (Deputados).
//
// Regras do Código Eleitoral (arts. 106 a 109, com a Lei 14.211/2021 e a decisão do STF nas ADIs 7228/7263/7325):
//   1. Quociente eleitoral (QE) = votos válidos ÷ vagas (fração ≤ 0,5 é desprezada; > 0,5 arredonda para cima).
//   2. Quociente partidário (QP) = votos do partido/federação ÷ QE (parte inteira). Elegem-se, na ordem de
//      votação, até QP candidatos que tenham ao menos 10% do QE.
//   3. Sobras: maior média (votos ÷ (cadeiras obtidas + 1)) entre partidos com ao menos 80% do QE e que tenham
//      candidato com ao menos 20% do QE.
//   4. Se ainda restarem vagas: maior média entre todos os partidos, sem exigências de votação mínima.
//
// É uma PROJEÇÃO com os votos apurados até o momento. O resultado oficial é sempre o do TSE.

import type { OfficeKey } from "./domain";

/** Cadeiras na Câmara dos Deputados por UF (composição de 513 deputados). */
export const FEDERAL_SEATS: Record<string, number> = {
  sp: 70, mg: 53, rj: 46, ba: 39, rs: 31, pr: 30, pe: 25, ce: 22, ma: 18, go: 17, pa: 17, sc: 16, pb: 12,
  es: 10, pi: 10, al: 9, am: 8, df: 8, ms: 8, mt: 8, rn: 8, ro: 8, to: 8, ac: 8, ap: 8, rr: 8, se: 8,
};

/** Vagas por cargo/UF (Constituição, art. 27: triplo da bancada federal até 36; depois +1 por deputado acima de 12). */
export function seatsFor(office: OfficeKey, uf: string): number | null {
  const fed = FEDERAL_SEATS[uf.toLowerCase()];
  if (!fed) return null;
  if (office === "deputado-federal") return fed;
  if (office === "deputado-distrital") return 24;
  if (office === "deputado-estadual") return fed <= 12 ? fed * 3 : 36 + (fed - 12);
  return null;
}

export function electoralQuotient(validVotes: number, seats: number): number {
  const q = validVotes / seats;
  const floor = Math.floor(q);
  return q - floor > 0.5 ? floor + 1 : floor;
}

export interface SeatCandidate {
  id: string;
  votes: number;
  /** Partido ou federação (federações contam como um único partido). */
  group: string;
  /** Desempate: ordem oficial do candidato. */
  seq?: number;
}

export type SeatMethod = "QP" | "média";

export interface SeatProjection {
  seats: number;
  validVotes: number;
  quotient: number;
  groups: { name: string; votes: number; seats: number }[];
  /** id do candidato → forma da eleição projetada. */
  elected: Map<string, SeatMethod>;
}

export function projectSeats(
  candidates: SeatCandidate[],
  validVotes: number,
  seats: number,
  legendVotes: Map<string, number> = new Map(),
): SeatProjection | null {
  if (seats <= 0 || validVotes <= 0) return null;
  const quotient = electoralQuotient(validVotes, seats);
  if (quotient <= 0) return null;

  interface Group {
    name: string;
    votes: number;
    seats: number;
    queue: SeatCandidate[];
  }
  const groups = new Map<string, Group>();
  for (const c of candidates) {
    const g = groups.get(c.group) ?? { name: c.group, votes: legendVotes.get(c.group) ?? 0, seats: 0, queue: [] };
    g.votes += c.votes;
    g.queue.push(c);
    groups.set(c.group, g);
  }
  for (const [name, votes] of legendVotes) {
    if (!groups.has(name)) groups.set(name, { name, votes, seats: 0, queue: [] });
  }
  for (const g of groups.values()) g.queue.sort((a, b) => b.votes - a.votes || (a.seq ?? 0) - (b.seq ?? 0));

  const elected = new Map<string, SeatMethod>();
  let remaining = seats;
  const take = (g: Group, method: SeatMethod, minVotes: number): boolean => {
    const next = g.queue[0];
    if (!next || next.votes < minVotes || next.votes <= 0) return false;
    g.queue.shift();
    g.seats++;
    remaining--;
    elected.set(next.id, method);
    return true;
  };

  // 1. Quociente partidário.
  for (const g of groups.values()) {
    const qp = Math.floor(g.votes / quotient);
    for (let i = 0; i < qp && remaining > 0; i++) if (!take(g, "QP", 0.1 * quotient)) break;
  }

  // 2 e 3. Maiores médias (com e depois sem as exigências de 80%/20% do QE).
  const bestAverage = (eligible: (g: Group) => boolean) => {
    let best: Group | null = null;
    let bestAvg = -1;
    for (const g of groups.values()) {
      if (!eligible(g)) continue;
      const avg = g.votes / (g.seats + 1);
      if (avg > bestAvg || (avg === bestAvg && best && g.votes > best.votes)) {
        best = g;
        bestAvg = avg;
      }
    }
    return best;
  };
  while (remaining > 0) {
    const g = bestAverage((x) => x.votes >= 0.8 * quotient && (x.queue[0]?.votes ?? 0) >= 0.2 * quotient);
    if (!g || !take(g, "média", 0.2 * quotient)) break;
  }
  while (remaining > 0) {
    const g = bestAverage((x) => (x.queue[0]?.votes ?? 0) > 0);
    if (!g || !take(g, "média", 0)) break;
  }

  return {
    seats,
    validVotes,
    quotient,
    groups: [...groups.values()]
      .filter((g) => g.votes > 0)
      .sort((a, b) => b.seats - a.seats || b.votes - a.votes)
      .map(({ name, votes, seats }) => ({ name, votes, seats })),
    elected,
  };
}
