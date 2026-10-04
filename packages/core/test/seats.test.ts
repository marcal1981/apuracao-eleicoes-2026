import { describe, expect, it } from "vitest";
import { electoralQuotient, parseSimplifiedResult, projectSeats, seatsFor } from "../src";

describe("quociente eleitoral", () => {
  it("despreza fração até 0,5 e arredonda acima disso", () => {
    expect(electoralQuotient(1000, 3)).toBe(333);
    expect(electoralQuotient(1001, 2)).toBe(500);
    expect(electoralQuotient(1003, 2)).toBe(501);
    expect(electoralQuotient(1004, 3)).toBe(335);
  });
});

describe("vagas", () => {
  it("segue a composição da Câmara e o art. 27 da Constituição", () => {
    expect(seatsFor("deputado-federal", "SP")).toBe(70);
    expect(seatsFor("deputado-estadual", "sp")).toBe(94);
    expect(seatsFor("deputado-estadual", "ac")).toBe(24);
    expect(seatsFor("deputado-distrital", "df")).toBe(24);
    expect(seatsFor("governador", "sp")).toBeNull();
  });
});

describe("projectSeats", () => {
  it("distribui por quociente partidário e depois pelas maiores médias (80%/20%)", () => {
    const p = projectSeats(
      [
        { id: "a1", votes: 300, group: "A" },
        { id: "a2", votes: 150, group: "A" },
        { id: "a3", votes: 10, group: "A" },
        { id: "b1", votes: 250, group: "B" },
        { id: "b2", votes: 100, group: "B" },
        { id: "c1", votes: 120, group: "C" },
        { id: "c2", votes: 50, group: "C" },
        { id: "d1", votes: 20, group: "D" },
      ],
      1000,
      5,
    )!;
    expect(p.quotient).toBe(200);
    expect(Object.fromEntries(p.elected)).toEqual({ a1: "QP", a2: "QP", b1: "QP", b2: "média", c1: "média" });
    expect(p.groups.map((g) => [g.name, g.seats])).toEqual([
      ["A", 2],
      ["B", 2],
      ["C", 1],
      ["D", 0],
    ]);
  });

  it("libera as vagas restantes para todos os partidos quando ninguém cumpre as exigências", () => {
    const p = projectSeats(
      [
        { id: "a1", votes: 90, group: "A" },
        { id: "b1", votes: 60, group: "B" },
        { id: "c1", votes: 25, group: "C" },
        { id: "c2", votes: 25, group: "C" },
      ],
      300,
      3,
    )!;
    expect([...p.elected.keys()].sort()).toEqual(["a1", "b1", "c1"]);
  });

  it("soma votos de legenda ao partido", () => {
    const p = projectSeats(
      [
        { id: "a1", votes: 100, group: "A" },
        { id: "b1", votes: 150, group: "B" },
      ],
      400,
      2,
      new Map([["A", 150]]),
    )!;
    expect(p.groups.find((g) => g.name === "A")!.votes).toBe(250);
    expect(p.elected.get("a1")).toBe("QP");
  });

  it("é aplicada pelo parser às disputas proporcionais", () => {
    const r = parseSimplifiedResult(
      {
        tf: "n",
        s: { pst: "50,00" },
        v: { vv: "700" },
        carg: [
          {
            agr: [
              { nm: "Fed X", par: [{ sg: "P1", cand: [{ sqcand: "1", nmu: "UM", vap: "400", dvt: "Válido" }] }, { sg: "P2", cand: [{ sqcand: "2", nmu: "DOIS", vap: "100", dvt: "Válido" }] }] },
              { nm: "P3", par: [{ sg: "P3", cand: [{ sqcand: "3", nmu: "TRES", vap: "200", dvt: "Válido" }] }] },
            ],
          },
        ],
      },
      { office: "deputado-federal", scope: "rr", round: 1 },
    );
    expect(r.projection?.seats).toBe(8);
    expect(r.projection?.groups.find((g) => g.name === "Fed X")?.votes).toBe(500);
    expect(r.candidates.find((c) => c.id === "1")?.projected).toBe("QP");
    expect(r.candidates.every((c) => !c.elected)).toBe(true);
  });
});
