import { describe, expect, it } from "vitest";
import {
  officesForScope,
  parseElectionConfig,
  parseSimplifiedResult,
  parseTseDateTime,
  parseTseNumber,
  pickGeneralElection,
  resultFileUrl,
  defaultElectionCodes,
  electionCodeFor,
  simulateSimplifiedResult,
  DEFAULT_TSE_ENDPOINT,
  TseParseError,
} from "../src";

const sample = {
  ele: "544",
  tpabr: "PAIS",
  cdabr: "BR",
  dg: "02/10/2022",
  hg: "20:58:01",
  tf: "n",
  s: "472075",
  st: "471000",
  pst: "99,77",
  e: "156454011",
  c: "123682372",
  pc: "79,05",
  a: "32770982",
  pa: "20,95",
  vv: "118229719",
  pvv: "95,59",
  vb: "1964779",
  pvb: "1,59",
  tvn: "3487874",
  ptvn: "2,82",
  cand: [
    { seq: "2", sqcand: "222", n: "22", nm: "SEGUNDO", cc: "PARTIDO B", nv: "VICE B", e: "n", st: "2º turno", dvt: "Válido", vap: "51072345", pvap: "43,20" },
    { seq: "1", sqcand: "111", n: "13", nm: "PRIMEIRO", cc: "PARTIDO A", nv: "VICE A", e: "n", st: "2º turno", dvt: "Válido", vap: "57259504", pvap: "48,43" },
    { seq: "3", sqcand: "333", n: "15", nm: "TERCEIRO", cc: "PARTIDO C", nv: "", e: "n", st: "Não eleito", dvt: "Válido", vap: "4915423", pvap: "4,16" },
  ],
};

describe("parseTseNumber", () => {
  it("lê inteiros, milhares e decimais com vírgula", () => {
    expect(parseTseNumber("57259504")).toBe(57259504);
    expect(parseTseNumber("57.259.504")).toBe(57259504);
    expect(parseTseNumber("48,43")).toBe(48.43);
    expect(parseTseNumber("1.234,5")).toBe(1234.5);
    expect(parseTseNumber("")).toBe(0);
    expect(parseTseNumber(undefined)).toBe(0);
    expect(parseTseNumber("abc")).toBe(0);
  });
});

describe("parseTseDateTime", () => {
  it("converte para ISO no horário de Brasília", () => {
    expect(parseTseDateTime("02/10/2022", "20:58:01")).toBe("2022-10-02T20:58:01-03:00");
    expect(parseTseDateTime("", "20:58:01")).toBeNull();
  });
});

describe("resultFileUrl", () => {
  it("monta a URL no padrão de 2026, com eleição federal e estadual", () => {
    const codes = defaultElectionCodes(1);
    expect(resultFileUrl(DEFAULT_TSE_ENDPOINT, electionCodeFor(codes, "governador"), "governador", "SP")).toBe(
      "https://resultados.tse.jus.br/oficial/ele2026/6259/dados/sp/sp-c0003-e006259-u.json",
    );
    expect(resultFileUrl(DEFAULT_TSE_ENDPOINT, electionCodeFor(codes, "presidente"), "presidente", "BR")).toBe(
      "https://resultados.tse.jus.br/oficial/ele2026/6257/dados/br/br-c0001-e006257-u.json",
    );
    expect(defaultElectionCodes(2)).toEqual({ federal: "6258", state: "6260" });
  });

  it("aceita o layout de 2022 por configuração", () => {
    const endpoint = { ...DEFAULT_TSE_ENDPOINT, cycle: "ele2022", dataPath: "dados-simplificados", fileSuffix: "r" };
    expect(resultFileUrl(endpoint, "544", "presidente", "br")).toBe(
      "https://resultados.tse.jus.br/oficial/ele2022/544/dados-simplificados/br/br-c0001-e000544-r.json",
    );
  });
});

describe("formato 2026 (carg → agr → par → cand)", () => {
  const file2026 = {
    ele: "6259",
    t: "1",
    tf: "n",
    dg: "04/10/2026",
    hg: "19:12:45",
    s: { ts: "100.000", st: "45.000", pst: "45,00" },
    e: { te: "34.000.000", est: "15.300.000" },
    v: { tv: "12.000.000", vv: "11.000.000", pvv: "91,67", vb: "400.000", pvb: "3,33", tvn: "600.000", ptvn: "5,00" },
    carg: [
      {
        cd: "5",
        agr: [
          {
            n: "1",
            nm: "Federação Exemplo",
            par: [
              {
                sg: "PX",
                cand: [
                  { seq: "1", sqcand: "1001", n: "101", nm: "NOME COMPLETO UM", nmu: "UM", e: "n", st: "", dvt: "Válido", vap: "3.000.000", pvap: "27,27", vs: [{ nm: "SUPLENTE A" }] },
                ],
              },
            ],
          },
          {
            n: "2",
            nm: "PY",
            par: [{ sg: "PY", cand: [{ seq: "2", sqcand: "1002", n: "202", nm: "NOME DOIS", nmu: "DOIS", e: "n", st: "", dvt: "Válido", vap: "4.500.000", pvap: "40,91" }] }],
          },
        ],
      },
    ],
  };

  it("achata coligações/partidos e lê os totais aninhados", () => {
    const r = parseSimplifiedResult(file2026, { office: "senador", scope: "SP", round: 1 });
    expect(r.sectionsTotalizedPct).toBe(45);
    expect(r.sections).toBe(100000);
    expect(r.sectionsTotalized).toBe(45000);
    expect(r.totals.electorate).toBe(34000000);
    expect(r.totals.valid).toBe(11000000);
    expect(r.totals.turnout).toBe(12000000);
    expect(r.totals.abstention).toBe(3300000);
    expect(r.candidates.map((c) => [c.name, c.party, c.coalition])).toEqual([
      ["DOIS", "PY", null],
      ["UM", "PX", "Federação Exemplo"],
    ]);
    expect(r.candidates[1]!.running).toBe("SUPLENTE A");
    expect(r.candidates[1]!.gapToPrevious).toBe(1500000);
  });
});

describe("parseSimplifiedResult", () => {
  it("normaliza totais e ordena candidatos por votos", () => {
    const r = parseSimplifiedResult(sample, { office: "presidente", scope: "BR", round: 1 });
    expect(r.scope).toBe("br");
    expect(r.status).toBe("APURACAO_EM_ANDAMENTO");
    expect(r.sectionsTotalizedPct).toBe(99.77);
    expect(r.officialTimestamp).toBe("2022-10-02T20:58:01-03:00");
    expect(r.totals.electorate).toBe(156454011);
    expect(r.candidates.map((c) => c.name)).toEqual(["PRIMEIRO", "SEGUNDO", "TERCEIRO"]);
    expect(r.candidates[0]).toMatchObject({ position: 1, gapToPrevious: null, positionChange: null });
    expect(r.candidates[1]!.gapToPrevious).toBe(57259504 - 51072345);
  });

  it("não marca o líder como eleito sem informação oficial", () => {
    const r = parseSimplifiedResult(sample, { office: "presidente", scope: "BR", round: 1 });
    expect(r.candidates.every((c) => !c.elected)).toBe(true);
    expect(r.candidates[0]!.secondRound).toBe(true);
    expect(r.candidates[2]!.secondRound).toBe(false);
  });

  it("usa a situação oficial para eleitos e para 'Não eleito'", () => {
    const final = {
      ...sample,
      tf: "s",
      cand: [
        { ...sample.cand[1], e: "s", st: "Eleito" },
        { ...sample.cand[0], e: "n", st: "Não eleito" },
      ],
    };
    const r = parseSimplifiedResult(final, { office: "presidente", scope: "BR", round: 2 });
    expect(r.status).toBe("TOTALIZACAO_FINALIZADA");
    expect(r.candidates[0]!.elected).toBe(true);
    expect(r.candidates[1]!.elected).toBe(false);
  });

  it("calcula variação de posição em relação ao ranking anterior", () => {
    const previous = new Map([
      ["111", 2],
      ["222", 1],
      ["333", 3],
    ]);
    const r = parseSimplifiedResult(sample, { office: "presidente", scope: "BR", round: 1, previousPositions: previous });
    expect(r.candidates[0]).toMatchObject({ id: "111", positionChange: 1, previousPosition: 2 });
    expect(r.candidates[1]).toMatchObject({ id: "222", positionChange: -1 });
    expect(r.candidates[2]).toMatchObject({ id: "333", positionChange: 0 });
  });

  it("rejeita arquivos inválidos", () => {
    expect(() => parseSimplifiedResult({}, { office: "presidente", scope: "BR", round: 1 })).toThrow(TseParseError);
    expect(() =>
      parseSimplifiedResult({ ...sample, pst: "120,00" }, { office: "presidente", scope: "BR", round: 1 }),
    ).toThrow(TseParseError);
  });
});

describe("configuração de eleições", () => {
  const config = {
    pl: [
      {
        cd: "999",
        dt: "04/10/2026",
        e: [
          { cd: "619", t: "1", nm: "Eleição Geral Federal 2026", dt: "04/10/2026" },
          { cd: "620", t: "2", nm: "Eleição Geral Federal 2026", dt: "25/10/2026" },
          { cd: "700", t: "1", nm: "Eleição Suplementar", dt: "04/10/2026" },
        ],
      },
    ],
  };

  it("encontra a eleição geral do turno", () => {
    const entries = parseElectionConfig(config);
    expect(entries).toHaveLength(3);
    expect(pickGeneralElection(entries, 2026, 1)?.code).toBe("619");
    expect(pickGeneralElection(entries, 2026, 2)?.code).toBe("620");
    expect(pickGeneralElection(entries, 2030, 1)).toBeUndefined();
  });

  it("tolera formato inesperado", () => {
    expect(parseElectionConfig(null)).toEqual([]);
    expect(parseElectionConfig({ pl: "x" })).toEqual([]);
  });
});

describe("officesForScope", () => {
  it("separa cargos por circunscrição e turno", () => {
    expect(officesForScope("BR", 1)).toEqual(["presidente"]);
    expect(officesForScope("SP", 1)).toContain("deputado-estadual");
    expect(officesForScope("SP", 1)).not.toContain("deputado-distrital");
    expect(officesForScope("DF", 1)).toContain("deputado-distrital");
    expect(officesForScope("SP", 2)).toEqual(["presidente", "governador"]);
  });
});

describe("simulação", () => {
  const now = new Date("2026-10-04T21:00:00Z");

  it("gera arquivos que passam pelo mesmo parser do TSE", () => {
    for (const progress of [0, 0.3, 1]) {
      const raw = simulateSimplifiedResult({ office: "senador", scope: "sp", round: 1, electionCode: "9999", progress, now });
      const r = parseSimplifiedResult(raw, { office: "senador", scope: "sp", round: 1 });
      expect(r.sectionsTotalizedPct).toBeCloseTo(progress * 100, 1);
      expect(r.officialTimestamp).toBe("2026-10-04T18:00:00-03:00");
    }
  });

  it("indica eleitos somente ao final, respeitando as vagas do Senado", () => {
    const partial = parseSimplifiedResult(
      simulateSimplifiedResult({ office: "senador", scope: "sp", round: 1, electionCode: "9999", progress: 0.9, now }),
      { office: "senador", scope: "sp", round: 1 },
    );
    expect(partial.candidates.filter((c) => c.elected)).toHaveLength(0);

    const final = parseSimplifiedResult(
      simulateSimplifiedResult({ office: "senador", scope: "sp", round: 1, electionCode: "9999", progress: 1, now }),
      { office: "senador", scope: "sp", round: 1 },
    );
    expect(final.status).toBe("TOTALIZACAO_FINALIZADA");
    expect(final.candidates.filter((c) => c.elected).map((c) => c.position)).toEqual([1, 2]);
  });
});
