// Cadastro de locais de votação do TSE (Portal de Dados Abertos):
//   https://cdn.tse.jus.br/estatistica/sead/odsele/eleitorado_locais_votacao/eleitorado_local_votacao_{ano}.zip
// CSV com ";" e aspas, em latin1. Uma linha por seção, com o local de votação, endereço, bairro e coordenadas.

export interface PollingPlace {
  zone: string;
  /** Número do local de votação (dentro da zona). */
  code: string;
  name: string;
  address: string;
  bairro: string;
  lat: number | null;
  lon: number | null;
}

export interface PollingPlaceRow extends PollingPlace {
  section: string;
}

/** Divide uma linha de CSV com ";" e aspas duplas. */
export function splitCsvLine(line: string, sep = ";"): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else quoted = false;
      } else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === sep) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

const coord = (v: string | undefined, min: number, max: number) => {
  const n = Number((v ?? "").replace(",", "."));
  return Number.isFinite(n) && n >= min && n <= max && n !== 0 ? n : null;
};
// O TSE usa -1 quando o local não tem coordenada: só aceita o par completo dentro do Brasil.
const coords = (lat: number | null, lon: number | null) => (lat !== null && lon !== null ? { lat, lon } : { lat: null, lon: null });
const num = (v: string | undefined) => String(Number(v ?? "") || "");

/**
 * Filtra as linhas de um município no CSV de locais de votação.
 * Recebe as linhas uma a uma (o arquivo nacional é grande) e usa o cabeçalho para achar as colunas.
 */
export class PollingPlaceCsvFilter {
  private cols: Record<string, number> | null = null;
  readonly rows: PollingPlaceRow[] = [];
  private readonly seen = new Set<string>();

  constructor(
    private readonly tseCode: string,
    private readonly uf: string,
  ) {}

  push(line: string) {
    if (!this.cols) {
      if (!/NR_ZONA/i.test(line)) return;
      this.cols = Object.fromEntries(splitCsvLine(line).map((h, i) => [h.toUpperCase(), i]));
      return;
    }
    // Filtro rápido antes de dividir a linha: o código do município precisa aparecer nela.
    if (!line.includes(this.tseCode)) return;
    const f = splitCsvLine(line);
    const get = (name: string) => {
      const i = this.cols![name];
      return i === undefined ? undefined : f[i];
    };
    if (num(get("CD_MUNICIPIO")) !== num(this.tseCode)) return;
    const uf = get("SG_UF");
    if (uf && uf.toUpperCase() !== this.uf.toUpperCase()) return;
    const zone = num(get("NR_ZONA"));
    const section = num(get("NR_SECAO"));
    const code = num(get("NR_LOCAL_VOTACAO"));
    if (!zone || !section || !code) return;
    const key = `${zone}-${section}`;
    if (this.seen.has(key)) return; // o arquivo pode repetir a seção (1º e 2º turnos)
    this.seen.add(key);
    this.rows.push({
      zone,
      section,
      code,
      name: get("NM_LOCAL_VOTACAO") ?? "",
      address: get("DS_ENDERECO") ?? get("DS_ENDERECO_LOCVT") ?? "",
      bairro: get("NM_BAIRRO") ?? "",
      ...coords(coord(get("NR_LATITUDE"), -34, 6), coord(get("NR_LONGITUDE"), -75, -28)),
    });
  }

  get headerFound() {
    return this.cols !== null;
  }
}
