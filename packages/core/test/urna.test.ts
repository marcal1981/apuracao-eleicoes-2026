import { describe, expect, it } from "vitest";
import { DEFAULT_TSE_ENDPOINT, describeDer, findPleitoCode, parseBuDer, parseBuImage, parseSectionAux, parseUrnaConfig, sectionAuxUrl, urnaConfigUrl } from "../src";

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

  it("lê aptos e comparecimento do boletim binário", () => {
    // Codificador DER mínimo para montar um boletim de teste.
    const tlv = (tag: number, body: number[]) => {
      const len = body.length < 128 ? [body.length] : [0x82, body.length >> 8, body.length & 255];
      return [tag, ...len, ...body];
    };
    const int = (tag: number, n: number) => tlv(tag, n < 128 ? [n] : n < 32768 ? [n >> 8, n & 255] : [0, n >> 8, n & 255]);
    const seq = (...items: number[][]) => tlv(0x30, items.flat());
    const cargo = (tipo: number, comp: number) => seq(int(0x80, tipo), int(0x81, comp), tlv(0xa2, seq(int(0x80, 1), int(0x81, 50))));
    const eleicao = (id: number, aptos: number, comp: number) =>
      seq(int(0x80, id), int(0x81, aptos), tlv(0xa2, [...cargo(1, comp), ...cargo(2, comp)]));
    const bu = seq(
      tlv(0xa0, int(0x80, 5)), // cabeçalho
      tlv(0xa3, [...int(0x80, 70998), ...int(0x81, 412)]), // identificação
      int(0x86, 12), // qtdEleitoresLibCodigo
      tlv(0xa8, [...eleicao(6257, 349, 268), ...eleicao(6259, 349, 268)]),
    );
    const envelope = seq(tlv(0xa0, int(0x80, 1)), int(0x81, 3), tlv(0x85, bu));
    expect(parseBuDer(Uint8Array.from(envelope))).toEqual({ electorate: 349, turnout: 268, abstention: 81, place: null });
    expect(parseBuDer(Uint8Array.from([1, 2, 3]))).toBeNull();
    expect(describeDer(Uint8Array.from(envelope))).toContain("[1] 3");
  });

  it("lê o boletim no formato do TSE (tipos explícitos, conteúdo em OCTET STRING)", () => {
    const tlv = (tag: number, body: number[]) => {
      const len = body.length < 128 ? [body.length] : [0x82, body.length >> 8, body.length & 255];
      return [tag, ...len, ...body];
    };
    const int = (n: number) => tlv(0x02, n < 128 ? [n] : n < 32768 ? [n >> 8, n & 255] : [0, n >> 8, n & 255]);
    const en = (n: number) => tlv(0x0a, [n]);
    const seq = (...items: number[][]) => tlv(0x30, items.flat());
    const str = (t: string) => tlv(0x1b, [...t].map((c) => c.charCodeAt(0)));
    // Voto em branco: sem identificação do votável (só a assinatura).
    const votavel = seq(en(2), int(7), tlv(0x04, [1, 2, 3]));
    const cargo = (tipo: number, comp: number) => seq(en(tipo), int(comp), seq(seq(tlv(0x81, [1]), int(1), seq(votavel))));
    const eleicao = (id: number) => seq(int(id), int(412), seq(cargo(1, 330), cargo(2, 330)));
    const bu = seq(
      seq(str("20261004T191404"), tlv(0x82, [0x0c, 0x94])),
      en(2),
      tlv(0xa0, [...seq(int(70998), int(412)), ...int(1643), ...int(504)]),
      seq(eleicao(6257), eleicao(6259)),
    );
    const envelope = seq(seq(str("20261004T191404"), tlv(0x82, [0x0c, 0x94])), en(2), tlv(0x04, bu));
    expect(parseBuDer(Uint8Array.from(envelope))).toEqual({ electorate: 412, turnout: 330, abstention: 82, place: null });
  });

  it("usa a soma dos votos quando o campo de comparecimento não é o número de eleitores", () => {
    const tlv = (tag: number, body: number[]) => {
      const len = body.length < 128 ? [body.length] : [0x82, body.length >> 8, body.length & 255];
      return [tag, ...len, ...body];
    };
    const int = (n: number) => tlv(0x02, n < 128 ? [n] : [n >> 8, n & 255]);
    const en = (n: number) => tlv(0x0a, [n]);
    const seq = (...items: number[][]) => tlv(0x30, items.flat());
    const sig = tlv(0x04, [9, 9]);
    const nominal = (votes: number, num: number) => seq(en(1), int(votes), seq(int(10), int(num)), sig);
    const branco = (votes: number) => seq(en(2), int(votes), sig);
    // Governador: 120 + 80 + 18 brancos + 12 nulos = 230 eleitores; Senador (2 votos por eleitor) soma 460.
    const governador = seq(tlv(0x81, [3]), int(1), seq(nominal(120, 10), nominal(80, 45), branco(18), seq(en(3), int(12), sig)));
    const senador = seq(tlv(0x81, [5]), int(2), seq(nominal(250, 101), nominal(200, 111), branco(10)));
    const eleicao = seq(int(6259), int(280), seq(seq(en(1), int(5), seq(governador, senador))));
    const bu = seq(seq(int(1)), en(2), seq(eleicao));
    expect(parseBuDer(Uint8Array.from(seq(en(2), tlv(0x04, bu))))).toEqual({ electorate: 280, turnout: 230, abstention: 50, place: null });
  });
});
