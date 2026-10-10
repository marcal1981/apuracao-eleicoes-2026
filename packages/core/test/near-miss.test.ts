import { describe, expect, it } from "vitest";
import { nearMisses, type CandidateResult } from "../src";

const cand = (name: string, party: string, coalition: string | null, votes: number, elected: boolean): CandidateResult => ({
  position: 0, previousPosition: null, positionChange: null, id: name, number: name.slice(-4), name, running: null, party, coalition,
  votes, percentage: 0, gapToPrevious: null, officialStatus: elected ? "Eleito" : "Suplente", elected, secondRound: false, voteDestination: "Válido",
});

describe("quase eleitos", () => {
  it("compara com o último eleito da própria lista (federação conta como uma lista)", () => {
    const report = nearMisses({
      candidates: [
        cand("A1 1001", "PA", "FED X", 50_000, true),
        cand("A2 1002", "PB", "FED X", 30_000, true), // último eleito da federação X
        cand("A3 1003", "PA", "FED X", 29_900, false), // faltaram 100
        cand("A4 1004", "PB", "FED X", 20_000, false), // faltaram 10.000
        cand("B1 2001", "PC", null, 40_000, true),
        cand("B2 2002", "PC", null, 39_990, false), // faltaram 10
        cand("C1 3001", "PD", null, 45_000, false), // lista sem vaga: fica de fora
      ],
    });
    expect(report.basis).toBe("oficial");
    expect(report.items.map((i) => [i.name, i.gap, i.suplente, i.lastElected.name])).toEqual([
      ["B2 2002", 10, 1, "B1 2001"],
      ["A3 1003", 100, 1, "A2 1002"],
      ["A4 1004", 10_000, 2, "A2 1002"],
    ]);
  });

  it("usa a projeção enquanto o TSE não informa os eleitos", () => {
    const a = { ...cand("A1 1001", "PA", null, 100, false), projected: "QP" as const };
    const b = cand("A2 1002", "PA", null, 90, false);
    const report = nearMisses({ candidates: [a, b] }, 20);
    expect(report.basis).toBe("projeção");
    expect(report.items[0]).toMatchObject({ name: "A2 1002", gap: 10, listSeats: 1 });
  });
});
