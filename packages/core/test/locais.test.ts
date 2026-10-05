import { describe, expect, it } from "vitest";
import { PollingPlaceCsvFilter, splitCsvLine } from "../src";

describe("locais de votação", () => {
  it("divide linhas com aspas", () => {
    expect(splitCsvLine('"a";"b;c";"d ""x"""')).toEqual(["a", "b;c", 'd "x"']);
  });

  it("filtra as seções do município", () => {
    const f = new PollingPlaceCsvFilter("70572", "SP");
    f.push('"DT_GERACAO";"SG_UF";"CD_MUNICIPIO";"NM_MUNICIPIO";"NR_ZONA";"NR_SECAO";"NR_LOCAL_VOTACAO";"NM_LOCAL_VOTACAO";"DS_ENDERECO";"NM_BAIRRO";"NR_LATITUDE";"NR_LONGITUDE"');
    f.push('"01/09/2026";"SP";"70572";"SÃO JOSÉ DOS CAMPOS";"127";"1";"1015";"EE JOÃO";"RUA A, 10";"CENTRO";"-23.1857";"-45.8869"');
    f.push('"01/09/2026";"SP";"70572";"SÃO JOSÉ DOS CAMPOS";"127";"1";"1015";"EE JOÃO";"RUA A, 10";"CENTRO";"-23.1857";"-45.8869"');
    f.push('"01/09/2026";"SP";"70572";"SÃO JOSÉ DOS CAMPOS";"0273";"0002";"1023";"EMEF X";"RUA B";"SANTANA";"-1";"-1"');
    f.push('"01/09/2026";"SP";"71072";"SÃO PAULO";"1";"1";"1015";"Y";"";"";"-23.5";"-46.6"');
    expect(f.rows).toEqual([
      { zone: "127", section: "1", code: "1015", name: "EE JOÃO", address: "RUA A, 10", bairro: "CENTRO", lat: -23.1857, lon: -45.8869 },
      { zone: "273", section: "2", code: "1023", name: "EMEF X", address: "RUA B", bairro: "SANTANA", lat: null, lon: null },
    ]);
  });
});
