// "Quase eleitos": candidatos não eleitos que ficaram mais perto da vaga, nas eleições proporcionais.
//
// Na eleição proporcional, a vaga é do partido/federação, e o candidato disputa com os colegas de lista.
// Por isso a comparação é com o ÚLTIMO ELEITO DA PRÓPRIA LISTA: quantos votos faltaram para alcançá-lo.
// Listas que não conquistaram nenhuma vaga ficam de fora (não há "último eleito" para comparar).

import type { CandidateResult, RaceResult } from "./types";

export interface NearMiss {
  rank: number;
  name: string;
  number: string;
  party: string;
  /** Partido ou federação (a lista que disputa as vagas). */
  list: string;
  votes: number;
  /** Posição entre os não eleitos da lista (1 = 1º suplente). */
  suplente: number;
  lastElected: { name: string; number: string; votes: number };
  /** Votos que faltaram para empatar com o último eleito da lista. */
  gap: number;
  /** Vagas conquistadas pela lista. */
  listSeats: number;
}

export interface NearMissReport {
  /** "oficial" quando o TSE já informou os eleitos; "projeção" quando vem do cálculo da plataforma. */
  basis: "oficial" | "projeção";
  items: NearMiss[];
}

export function nearMisses(race: Pick<RaceResult, "candidates">, limit = 20): NearMissReport {
  const official = race.candidates.some((c) => c.elected);
  const isElected = (c: CandidateResult) => (official ? c.elected : c.projected != null);
  const lists = new Map<string, CandidateResult[]>();
  for (const c of race.candidates) {
    if (!/v[aá]lido/i.test(c.voteDestination || "Válido")) continue;
    const key = c.coalition ?? c.party;
    lists.set(key, [...(lists.get(key) ?? []), c]);
  }
  const all: Omit<NearMiss, "rank">[] = [];
  for (const [list, members] of lists) {
    const elected = members.filter(isElected);
    if (elected.length === 0) continue;
    const last = elected.reduce((a, b) => (b.votes < a.votes ? b : a));
    const losers = members.filter((c) => !isElected(c) && c.votes > 0).sort((a, b) => b.votes - a.votes);
    losers.forEach((c, i) => {
      const gap = last.votes - c.votes;
      if (gap < 0) return; // (não acontece pelas regras; protege contra dados inconsistentes)
      all.push({
        name: c.name,
        number: c.number,
        party: c.party,
        list,
        votes: c.votes,
        suplente: i + 1,
        lastElected: { name: last.name, number: last.number, votes: last.votes },
        gap,
        listSeats: elected.length,
      });
    });
  }
  all.sort((a, b) => a.gap - b.gap || b.votes - a.votes);
  return { basis: official ? "oficial" : "projeção", items: all.slice(0, limit).map((x, i) => ({ rank: i + 1, ...x })) };
}
