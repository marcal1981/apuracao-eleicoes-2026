import { describe, expect, it } from "vitest";
import { DEFAULT_TSE_ENDPOINT, findPleitoCode, parseBuImage, parseSectionAux, parseUrnaConfig, sectionAuxUrl, urnaConfigUrl } from "../src";

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
    expect(aux).toEqual({ status: "Totalizada", hash: "abc", files: ["o00406-7057201270001.imgbu", "o00406-7057201270001.bu"] });
    expect(parseSectionAux({ st: "Não instalada", hashes: [] }).hash).toBeNull();
  });

  it("lê os números do boletim de urna", () => {
    const text = `BOLETIM DE URNA\nMunicípio            70572\nZona Eleitoral        0127\nSeção Eleitoral       0001\nLocal de Votação      1015\nEleitores aptos        349\nComparecimento         268\nEleitores faltosos      81\n`;
    expect(parseBuImage(text)).toEqual({ electorate: 349, turnout: 268, abstention: 81, place: "1015" });
    expect(parseBuImage("Eleitores aptos 10\nComparecimento 7")).toEqual({ electorate: 10, turnout: 7, abstention: 3, place: null });
    expect(parseBuImage("nada")).toBeNull();
  });
});
