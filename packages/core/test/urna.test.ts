import { describe, expect, it } from "vitest";
import { DEFAULT_TSE_ENDPOINT, describeDer, findPleitoCode, parseBuCandidateVotes, parseBuCargoVotes, parseBuDer, parseBuImage, parseSectionAux, parseUrnaConfig, sectionAuxUrl, urnaConfigUrl } from "../src";

describe("arquivos de urna", () => {
  it("acha o pleito da eleição", () => {
    const raw = { pl: [{ cd: "900", e: [{ cd: "6257" }, { cd: "6259" }] }, { cd: "901", e: [{ cd: "6258" }] }] };
    expect(findPleitoCode(raw, "6259")).toBe("900");
    expect(findPleitoCode(raw, "1")).toBeNull();
  });

  it("monta as URLs", () => {
    const e = { ...DEFAULT_TSE_ENDPOINT, cycle: "ele2022" };
    expect(urnaConfigUrl(e, "406", "SP")).toBe("https://resultados.tse.jus.br/oficial/ele2022/arquivo-urna/406/config/sp/sp-p000406-cs.json");
    expect(sectionAuxUrl(e, "406", "sp", "70572", { zone: "0127", section: "0001" })).toBe(
      "https://resultados.tse.jus.br/oficial/ele2022/arquivo-urna/406/dados/sp/70572/0127/0001/p000406-sp-m70572-z0127-s0001-aux.json",
    );
  });

  it("lê zonas e seções do município", () => {
    const raw = { abr: [{ cd: "SP", mu: [
      { cd: "71072", nm: "SÃO PAULO", zon: [{ cd: "0001", sec: [{ ns: "0001" }] }] },
      { cd: "70572", nm: "SÃO JOSÉ DOS CAMPOS", zon: [{ cd: "0127", sec: [{ ns: "0001" }, { ns: "0002" }] }, { cd: "0273", sec: [{ ns: "0010" }] }] },
    ] }] };
    expect(parseUrnaConfig(raw, "70572")).toEqual([
      { zone: "0127", section: "0001" },
      { zone: "0127", section: "0002" },
      { zone: "0273", section: "0010" },
    ]);
  });

  it("lê o arquivo auxiliar da seção", () => {
    const aux = parseSectionAux({ st: "Totalizada", hashes: [{ hash: "abc", st: "Totalizado", nmarq: ["o00406-7057201270001.imgbu", "o00406-7057201270001.bu"] }] });
    expect(aux).toEqual({
      status: "Totalizada",
      hash: "abc",
      files: ["o00406-7057201270001.imgbu", "o00406-7057201270001.bu"],
      buFile: "o00406-7057201270001.bu",
      buKind: "der",
    });
    expect(parseSectionAux({ st: "Não instalada", hashes: [] }).hash).toBeNull();
  });

  it("lê os números do boletim de urna", () => {
    const text = `BOLETIM DE URNA\nMunicípio            70572\nZona Eleitoral        0127\nSeção Eleitoral       0001\nLocal de Votação      1015\nEleitores aptos        349\nComparecimento         268\nEleitores faltosos      81\n`;
    expect(parseBuImage(text)).toEqual({ electorate: 349, turnout: 268, abstention: 81, place: "1015" });
    expect(parseBuImage("Eleitores aptos 10\nComparecimento 7")).toEqual({ electorate: 10, turnout: 7, abstention: 3, place: null });
    expect(parseBuImage("nada")).toBeNull();
  });

  it("lê o arquivo auxiliar de 2026 (arq com nm e tp)", () => {
    const aux = parseSectionAux({
      st: "Totalizada",
      hashes: [{ hash: "326c", st: "Totalizado", arq: [
        { nm: "o03220sp7099804120505-bu.dat", tp: "bu" },
        { nm: "o03220sp7099804120505-vota.vsc", tp: "vota" },
        { nm: "o03220sp7099804120505-rdv.dat", tp: "rdv" },
      ] }],
    });
    expect(aux.hash).toBe("326c");
    expect(aux.buFile).toBe("o03220sp7099804120505-bu.dat");
    expect(aux.buKind).toBe("der");
  });

  // Codificador DER mínimo para montar boletins de teste no formato do TSE.
  const tlv = (tag: number, body: number[]) => {
    const len = body.length < 128 ? [body.length] : [0x82, body.length >> 8, body.length & 255];
    return [tag, ...len, ...body];
  };
  const int = (n: number) => {
    const bytes: number[] = [];
    for (let v = n; ; v = Math.floor(v / 256)) {
      bytes.unshift(v % 256);
      if (v < 256) break;
    }
    if (bytes[0]! & 0x80) bytes.unshift(0);
    return tlv(0x02, bytes);
  };
  const en = (n: number) => tlv(0x0a, [n]);
  const seq = (...items: number[][]) => tlv(0x30, items.flat());
  const text = (t: string) => tlv(0x1b, [...t].map((c) => c.charCodeAt(0)));
  const sig = tlv(0x04, [9, 9]);
  const nominal = (votes: number, num: number) => seq(en(1), int(votes), seq(int(10), int(num)), sig);
  const branco = (votes: number) => seq(en(2), int(votes), sig);
  const nulo = (votes: number) => seq(en(3), int(votes), sig);
  // Cargo: (codigoCargo, ordemImpressao, votosVotaveis).
  const cargo = (code: number, ordem: number, ...votaveis: number[][]) => seq(tlv(0x81, [code]), int(ordem), seq(...votaveis));
  // Tipo de cargo: (tipoCargo, qtdComparecimento, cargos).
  const tipo = (t: number, comp: number, ...cargos: number[][]) => seq(en(t), int(comp), seq(...cargos));
  const eleicao = (id: number, aptos: number, ...tipos: number[][]) => seq(int(id), int(aptos), seq(...tipos));
  const boletim = (...eleicoes: number[][]) =>
    seq(
      seq(text("20261004T191404"), tlv(0x82, [0x0c, 0x94])),
      en(2),
      tlv(0xa0, [...seq(int(70998), int(412)), ...int(1643), ...int(504)]),
      seq(...eleicoes),
    );
  const envelope = (bu: number[]) => Uint8Array.from(seq(seq(text("20261004T191404"), tlv(0x82, [0x0c, 0x94])), en(2), tlv(0x04, bu)));

  it("lê aptos e comparecimento do boletim de urna (formato do TSE)", () => {
    // 280 aptos, 230 compareceram. Governador soma 230; Senador (2 votos por eleitor) soma 460;
    // deputados somam 230. A ordem de impressão (1..4) e o comparecimento não podem ser confundidos.
    const estadual = eleicao(
      6259,
      280,
      tipo(1, 230,
        cargo(3, 1, nominal(120, 10), nominal(80, 45), branco(18), nulo(12)),
        cargo(5, 2, nominal(250, 101), nominal(200, 111), branco(10)),
      ),
      tipo(2, 230,
        cargo(6, 3, nominal(100, 1010), nominal(90, 4545), branco(25), nulo(15)),
        cargo(7, 4, nominal(150, 10100), nominal(60, 45000), branco(20)),
      ),
    );
    const federal = eleicao(6257, 280, tipo(1, 230, cargo(1, 1, nominal(130, 13), nominal(90, 22), branco(5), nulo(5))));
    expect(parseBuDer(envelope(boletim(federal, estadual)))).toEqual({ electorate: 280, turnout: 230, abstention: 50, place: null });
  });

  it("não aceita comparecimento que não bate com a soma dos votos", () => {
    const errado = eleicao(6259, 280, tipo(1, 5, cargo(3, 1, nominal(120, 10), nominal(80, 45))));
    expect(parseBuDer(envelope(boletim(errado)))).toBeNull();
    expect(parseBuDer(Uint8Array.from([1, 2, 3]))).toBeNull();
    expect(describeDer(envelope(boletim(errado)))).toContain("u2 70998");
  });

  it("lê os votos de um candidato no boletim", () => {
    const estadual = eleicao(
      6259,
      280,
      tipo(1, 230, cargo(3, 1, nominal(120, 10), nominal(80, 45), branco(18), nulo(12))),
      tipo(2, 230,
        cargo(6, 3, nominal(37, 2533), nominal(150, 4545), branco(28), nulo(15)),
        cargo(7, 4, nominal(150, 25333), nominal(60, 45000), branco(20)),
      ),
    );
    const votes = parseBuCandidateVotes(envelope(boletim(estadual)), ["2533", "45000", "9999"]);
    expect(votes && Object.fromEntries(votes)).toEqual({ "2533": 37, "45000": 60, "9999": 0 });
  });

  it("lê os votos de Presidente sem misturar com Governador", () => {
    const federal = eleicao(6257, 280, tipo(1, 230, cargo(1, 1, nominal(130, 13), nominal(80, 22), branco(12), nulo(8))));
    const estadual = eleicao(6259, 280, tipo(1, 230, cargo(3, 1, nominal(150, 13), nominal(60, 45), branco(12), nulo(8))));
    expect(parseBuCargoVotes(envelope(boletim(federal, estadual)), 1)).toEqual({ "13": 130, "22": 80, branco: 12, nulo: 8 });
    expect(parseBuCargoVotes(envelope(boletim(federal, estadual)), 3)).toEqual({ "13": 150, "45": 60, branco: 12, nulo: 8 });
    expect(parseBuCargoVotes(envelope(boletim(estadual)), 1)).toBeNull();
  });
});
