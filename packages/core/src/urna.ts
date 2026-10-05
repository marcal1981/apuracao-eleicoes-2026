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
  /** Arquivo do boletim de urna: binário (-bu.dat / .bu) ou, em anos anteriores, a imagem em texto (.imgbu). */
  buFile: string | null;
  buKind: "der" | "text" | null;
}

/** Lê o arquivo auxiliar de uma seção e escolhe o hash mais recente que tenha arquivos. */
export function parseSectionAux(raw: unknown): SectionAux {
  const o = obj(raw) ?? {};
  const hashes = (Array.isArray(o.hashes) ? o.hashes : []).map(obj).filter((h): h is Record<string, unknown> => !!h);
  // Arquivos: "nmarq" (lista de nomes, até 2024) ou "arq" (lista de { nm, tp }, 2026).
  const filesOf = (h: Record<string, unknown>) => {
    const list = Array.isArray(h.nmarq) ? h.nmarq : Array.isArray(h.arq) ? h.arq : [];
    return list
      .map((f) => (typeof f === "string" ? { nm: f, tp: "" } : { nm: str(obj(f)?.nm), tp: str(obj(f)?.tp).toLowerCase() }))
      .filter((f) => f.nm);
  };
  const usable = hashes.filter((h) => str(h.hash) && filesOf(h).length > 0);
  const last = usable[usable.length - 1];
  const files = last ? filesOf(last) : [];
  const der = files.find((f) => f.tp === "bu" || /(-bu\.dat|\.bu)$/i.test(f.nm));
  const text = files.find((f) => f.tp === "imgbu" || /\.imgbu$/i.test(f.nm));
  return {
    status: str(o.st) || str(last?.st) || str(hashes[hashes.length - 1]?.st),
    hash: last ? str(last.hash) : null,
    files: files.map((f) => f.nm),
    buFile: der?.nm ?? text?.nm ?? null,
    buKind: der ? "der" : text ? "text" : null,
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

// ---------------------------------------------------------------------------
// Boletim de urna binário (ASN.1 DER, especificação "bu.asn1" do TSE)
//
// EntidadeEnvelopeGenerico → conteudo (OCTET STRING) = EntidadeBoletimUrna, que traz
// resultadosVotacaoPorEleicao: SEQUENCE OF { idEleicao, qtdEleitoresAptos,
//   resultadosVotacao SEQUENCE OF { tipoCargo, qtdComparecimento, totaisVotosCargo } }.
// A leitura procura esse formato na árvore em vez de depender da posição exata de cada campo.

interface DerNode {
  cls: number; // 0 universal, 2 contexto
  tag: number;
  constructed: boolean;
  value: Uint8Array;
  children: DerNode[] | null;
}

function readDer(buf: Uint8Array, depth = 0): DerNode[] | null {
  const out: DerNode[] = [];
  let p = 0;
  while (p < buf.length) {
    if (depth === 0 && out.length > 0 && buf[p] === 0) break; // preenchimento no fim do arquivo
    const first = buf[p++]!;
    let tag = first & 0x1f;
    if (tag === 0x1f) {
      tag = 0;
      let b: number;
      do {
        if (p >= buf.length) return null;
        b = buf[p++]!;
        tag = tag * 128 + (b & 0x7f);
      } while (b & 0x80);
    }
    if (p >= buf.length) return null;
    let len = buf[p++]!;
    if (len & 0x80) {
      const n = len & 0x7f;
      if (n === 0 || n > 4 || p + n > buf.length) return null;
      len = 0;
      for (let i = 0; i < n; i++) len = len * 256 + buf[p++]!;
    }
    if (p + len > buf.length) return null;
    const value = buf.subarray(p, p + len);
    p += len;
    const constructed = (first & 0x20) !== 0;
    let children: DerNode[] | null = null;
    if (constructed) {
      if (depth > 40) return null;
      children = readDer(value, depth + 1);
      if (!children) return null;
    }
    out.push({ cls: first >> 6, tag, constructed, value, children });
  }
  return out;
}

function derInt(node: DerNode | undefined): number | null {
  if (!node) return null;
  if (node.constructed) return node.children?.length === 1 ? derInt(node.children[0]) : null;
  if (node.value.length === 0 || node.value.length > 6) return null;
  let n = node.value[0]! & 0x80 ? -1 : 0;
  for (const b of node.value) n = n * 256 + b;
  return n;
}

/**
 * Um ResultadoVotacaoPorEleicao: (idEleicao, qtdEleitoresAptos, resultadosVotacao), e cada resultado por cargo
 * (tipoCargo, qtdComparecimento, totaisVotosCargo). Os campos são lidos pela posição, então serve tanto para
 * o arquivo do TSE (tipos explícitos) quanto para a codificação com etiquetas de contexto.
 */
function asElectionResult(n: DerNode): { electorate: number; turnout: number } | null {
  const [id, aptos, list] = n.children ?? [];
  const electorate = derInt(aptos);
  if (!n.constructed || derInt(id) === null || electorate === null || !list?.constructed || !list.children?.length) return null;
  let field = 0;
  for (const item of list.children) {
    const [tipo, comp, totals] = item.children ?? [];
    const t = derInt(comp);
    if (!item.constructed || derInt(tipo) === null || t === null || !totals?.constructed) return null;
    if (t <= electorate) field = Math.max(field, t);
  }
  if (electorate > 10_000) return null;
  // Comparecimento: cada eleitor deixa um voto (nominal, legenda, branco ou nulo) em cada cargo, então a soma
  // dos votos de um cargo de vaga única é o comparecimento. Usa a maior soma que não passa do eleitorado
  // (Senador com duas vagas soma o dobro e fica de fora). O campo qtdComparecimento serve de alternativa.
  const votes = maxVoteSum(list, electorate);
  return { electorate, turnout: Math.max(votes, field) };
}

/** Maior soma de votos (2º campo de cada item) entre as listas de votáveis dentro do nó, limitada ao eleitorado. */
function maxVoteSum(node: DerNode, limit: number): number {
  let best = 0;
  const visit = (n: DerNode) => {
    if (!n.children?.length) return;
    // Uma lista de votáveis: todos os itens são estruturas cujo 2º campo é um número (a quantidade de votos).
    if (n.children.every((c) => c.constructed && (c.children?.length ?? 0) >= 2 && derInt(c.children![1]) !== null && !c.children![1]!.constructed)) {
      const sum = n.children.reduce((a, c) => a + derInt(c.children![1])!, 0);
      if (sum <= limit) best = Math.max(best, sum);
    }
    for (const c of n.children) if (c.constructed) visit(c);
  };
  visit(node);
  return best;
}

function findElectionResults(nodes: DerNode[], depth = 0): { electorate: number; turnout: number }[] {
  for (const n of nodes) {
    if (n.constructed && n.children?.length) {
      const results = n.children.map(asElectionResult);
      if (results.every((r) => r !== null)) return results as { electorate: number; turnout: number }[];
      const inner = findElectionResults(n.children, depth + 1);
      if (inner.length) return inner;
    } else if (!n.constructed && n.value.length > 16 && depth < 6) {
      // OCTET STRING com outra estrutura dentro (o conteúdo do envelope).
      const inner = readDer(n.value, 0);
      if (inner) {
        const found = findElectionResults(inner, depth + 1);
        if (found.length) return found;
      }
    }
  }
  return [];
}

/** Lê eleitores aptos e comparecimento do boletim de urna binário (-bu.dat). */
export function parseBuDer(bytes: Uint8Array): BuSummary | null {
  const root = readDer(bytes);
  if (!root) return null;
  const results = findElectionResults(root);
  if (results.length === 0) return null;
  // Uma entrada por eleição (federal e estadual); os eleitores da urna são os mesmos.
  const electorate = Math.max(...results.map((r) => r.electorate));
  const turnout = Math.max(...results.map((r) => r.turnout));
  return { electorate, turnout, abstention: electorate - turnout, place: null };
}

/** Resumo da estrutura do arquivo (para diagnóstico quando a leitura falha). */
export function describeDer(bytes: Uint8Array, maxLines = 150): string {
  const lines: string[] = [];
  const walk = (nodes: DerNode[], indent: string) => {
    for (const n of nodes) {
      if (lines.length >= maxLines) return;
      const label = `${indent}${n.cls === 2 ? `[${n.tag}]` : `u${n.tag}`} ${n.constructed ? "{" : derInt(n) ?? `${n.value.length} bytes`}`;
      lines.push(label);
      if (n.children) walk(n.children, indent + "  ");
      else if (n.value.length > 8 && n.value[0] === 0x30) {
        const inner = readDer(n.value, 0);
        if (inner) walk(inner, indent + "  » ");
      }
    }
  };
  const root = readDer(bytes);
  if (!root) return `não é ASN.1 válido; início: ${[...bytes.subarray(0, 32)].map((b) => b.toString(16).padStart(2, "0")).join(" ")}`;
  walk(root, "");
  return lines.join("\n");
}
