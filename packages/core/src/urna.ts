// Arquivos de urna do TSE (boletins de urna por seção eleitoral).
//
// Layout (o mesmo usado desde 2022):
//   {base}/{ciclo}/arquivo-urna/{pleito}/config/{uf}/{uf}-p{pleito6}-cs.json      → zonas e seções de cada município
//   {base}/{ciclo}/arquivo-urna/{pleito}/dados/{uf}/{mun}/{zona}/{secao}/p{pleito6}-{uf}-m{mun}-z{zona}-s{secao}-aux.json
//                                                                                → situação da seção e arquivos da urna
//   …/{secao}/{hash}/{arquivo}                                                    → arquivo da urna (ex.: .imgbu, texto do BU)
// O pleito (ex.: 406 em 2022) é diferente do código da eleição; ele está em comum/config/ele-c.json.

import type { TseEndpointConfig } from "./tse";

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "";
}
function obj(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

/** Código do pleito (turno) que contém a eleição informada, lido do ele-c.json. */
export function findPleitoCode(raw: unknown, electionCode: string): string | null {
  const pleitos = obj(raw)?.pl;
  if (!Array.isArray(pleitos)) return null;
  for (const pl of pleitos) {
    const p = obj(pl);
    const elections = Array.isArray(p?.e) ? (p!.e as unknown[]) : [];
    if (elections.some((e) => str(obj(e)?.cd) === electionCode)) return str(p!.cd) || null;
  }
  return null;
}

function urnaBase(endpoint: TseEndpointConfig, pleito: string) {
  return `${endpoint.baseUrl}/${endpoint.cycle}/arquivo-urna/${pleito}`;
}

export function urnaConfigUrl(endpoint: TseEndpointConfig, pleito: string, uf: string): string {
  const abr = uf.toLowerCase();
  return `${urnaBase(endpoint, pleito)}/config/${abr}/${abr}-p${pleito.padStart(6, "0")}-cs.json`;
}

export interface SectionRef {
  zone: string;
  section: string;
}

function sectionDir(endpoint: TseEndpointConfig, pleito: string, uf: string, tseCode: string, s: SectionRef) {
  return `${urnaBase(endpoint, pleito)}/dados/${uf.toLowerCase()}/${tseCode}/${s.zone}/${s.section}`;
}

export function sectionAuxUrl(endpoint: TseEndpointConfig, pleito: string, uf: string, tseCode: string, s: SectionRef): string {
  const abr = uf.toLowerCase();
  return `${sectionDir(endpoint, pleito, uf, tseCode, s)}/p${pleito.padStart(6, "0")}-${abr}-m${tseCode}-z${s.zone}-s${s.section}-aux.json`;
}

export function sectionFileUrl(
  endpoint: TseEndpointConfig,
  pleito: string,
  uf: string,
  tseCode: string,
  s: SectionRef,
  hash: string,
  file: string,
): string {
  return `${sectionDir(endpoint, pleito, uf, tseCode, s)}/${hash}/${file}`;
}

/** Zonas e seções de um município no arquivo de configuração de urnas (leitura tolerante). */
export function parseUrnaConfig(raw: unknown, tseCode: string): SectionRef[] {
  const wanted = tseCode.replace(/^0+/, "");
  let found: Record<string, unknown> | null = null;
  const visit = (node: unknown) => {
    if (found) return;
    if (Array.isArray(node)) return node.forEach(visit);
    const o = obj(node);
    if (!o) return;
    if (str(o.cd).replace(/^0+/, "") === wanted && Array.isArray(o.zon)) {
      found = o;
      return;
    }
    for (const v of Object.values(o)) if (typeof v === "object") visit(v);
  };
  visit(raw);
  const out: SectionRef[] = [];
  for (const z of ((found as Record<string, unknown> | null)?.zon as unknown[]) ?? []) {
    const zo = obj(z);
    const zone = str(zo?.cd);
    if (!zone || !Array.isArray(zo?.sec)) continue;
    for (const s of zo!.sec as unknown[]) {
      const section = str(obj(s)?.ns);
      if (section) out.push({ zone, section });
    }
  }
  return out;
}

export interface SectionAux {
  /** Situação da seção informada pelo TSE (ex.: "Totalizada", "Não instalada"). */
  status: string;
  hash: string | null;
  /** Arquivos disponíveis para o hash mais recente. */
  files: string[];
}

/** Lê o arquivo auxiliar de uma seção e escolhe o hash mais recente que tenha arquivos. */
export function parseSectionAux(raw: unknown): SectionAux {
  const o = obj(raw) ?? {};
  const hashes = (Array.isArray(o.hashes) ? o.hashes : []).map(obj).filter((h): h is Record<string, unknown> => !!h);
  const usable = hashes.filter((h) => str(h.hash) && Array.isArray(h.nmarq) && h.nmarq.length > 0);
  const last = usable[usable.length - 1];
  return {
    status: str(o.st) || str(last?.st) || str(hashes[hashes.length - 1]?.st),
    hash: last ? str(last.hash) : null,
    files: last ? (last.nmarq as unknown[]).map(str).filter(Boolean) : [],
  };
}

export interface BuSummary {
  electorate: number;
  turnout: number;
  abstention: number;
  /** Código do local de votação, quando aparece no boletim. */
  place: string | null;
}

/**
 * Lê a imagem em texto do boletim de urna (.imgbu): eleitores aptos, comparecimento e faltosos.
 * Retorna null se os números não forem encontrados.
 */
export function parseBuImage(text: string): BuSummary | null {
  const num = (re: RegExp) => {
    const m = re.exec(text);
    return m ? Number(m[1]!.replace(/\./g, "")) : null;
  };
  const electorate = num(/Eleitores\s+aptos\s*:?\s+(\d[\d.]*)/i);
  const turnout = num(/Comparecimento\s*:?\s+(\d[\d.]*)/i);
  let abstention = num(/(?:Eleitores\s+)?faltosos\s*:?\s+(\d[\d.]*)/i);
  if (electorate === null || turnout === null) return null;
  if (abstention === null) abstention = Math.max(0, electorate - turnout);
  const place = /Local\s+de\s+vota\S*\s*:?\s+(\d+)/i.exec(text)?.[1] ?? null;
  return { electorate, turnout, abstention, place };
}
