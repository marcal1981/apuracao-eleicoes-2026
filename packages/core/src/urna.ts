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

/** Soma da quantidade de votos (2º campo) de uma lista de votáveis; null se não for uma lista desse tipo. */
function voteSum(list: DerNode | undefined): number | null {
  if (!list?.constructed || !list.children?.length) return null;
  let sum = 0;
  for (const v of list.children) {
    const q = v.constructed && (v.children?.length ?? 0) >= 2 && !v.children![1]!.constructed ? derInt(v.children![1]) : null;
    if (q === null || q < 0) return null;
    sum += q;
  }
  return sum;
}

/**
 * Um ResultadoVotacao (resultado de um tipo de cargo): (tipoCargo, qtdComparecimento, totaisVotosCargo), em que
 * totaisVotosCargo lista os cargos (codigoCargo, ordemImpressao, votosVotaveis). Só é aceito se a soma dos votos
 * de algum cargo for exatamente o comparecimento — cada eleitor deixa um voto (nominal, legenda, branco ou nulo)
 * em cada cargo de vaga única. Isso evita confundir o comparecimento com outros números do boletim.
 */
function turnoutOf(n: DerNode): number | null {
  const [tipo, comp, cargos] = n.children ?? [];
  const turnout = derInt(comp);
  if (!n.constructed || derInt(tipo) === null || comp?.constructed || turnout === null || turnout <= 0) return null;
  if (!cargos?.constructed || !cargos.children?.length) return null;
  for (const cargo of cargos.children) {
    if (cargo.constructed && voteSum(cargo.children?.[2]) === turnout) return turnout;
  }
  return null;
}

interface ElectionNumbers {
  electorate: number;
  turnout: number;
}

/**
 * Procura, em qualquer nível, uma eleição: estrutura com números e uma lista de ResultadoVotacao. Os eleitores
 * aptos são o número da eleição que fica entre o comparecimento e um limite de seção (o código da eleição,
 * que vem primeiro, é maior que isso).
 */
function findElections(nodes: DerNode[], depth = 0, out: ElectionNumbers[] = []): ElectionNumbers[] {
  for (const n of nodes) {
    if (n.constructed && n.children?.length) {
      let turnout: number | null = null;
      let list: DerNode | null = null;
      for (const c of n.children) {
        if (!c.constructed || !c.children?.length) continue;
        const values = c.children.map(turnoutOf);
        if (values.every((v) => v !== null)) {
          turnout = Math.max(...(values as number[]));
          list = c;
          break;
        }
      }
      if (turnout !== null && list) {
        const ints = n.children.filter((c) => c !== list && !c.constructed).map(derInt);
        const electorate = ints.find((v) => v !== null && v >= turnout! && v <= 5_000);
        if (electorate !== undefined && electorate !== null) out.push({ electorate, turnout });
        continue;
      }
      findElections(n.children, depth + 1, out);
    } else if (!n.constructed && n.value.length > 16 && depth < 6) {
      // OCTET STRING com outra estrutura dentro (o conteúdo do envelope).
      const inner = readDer(n.value, 0);
      if (inner) findElections(inner, depth + 1, out);
    }
  }
  return out;
}

/** Lê eleitores aptos e comparecimento do boletim de urna binário (-bu.dat). */
export function parseBuDer(bytes: Uint8Array): BuSummary | null {
  const root = readDer(bytes);
  if (!root) return null;
  const elections = findElections(root);
  if (elections.length === 0) return null;
  // Uma entrada por eleição (federal e estadual); os eleitores da urna são os mesmos.
  const electorate = Math.max(...elections.map((e) => e.electorate));
  const turnout = Math.max(...elections.map((e) => e.turnout));
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

/**
 * Votos nominais de candidatos (pelo número) no boletim de urna binário. Cada votável é
 * (tipoVoto, quantidadeVotos, identificacaoVotavel (partido, código), assinatura); o número do
 * candidato é o código. Os números têm tamanhos diferentes por cargo (2 a 5 dígitos), então não se misturam.
 */
export function parseBuCandidateVotes(bytes: Uint8Array, numbers: string[]): Map<string, number> | null {
  const root = readDer(bytes);
  if (!root) return null;
  const wanted = new Map(numbers.map((n) => [Number(n), n]));
  const out = new Map<string, number>(numbers.map((n) => [n, 0]));
  const visit = (nodes: DerNode[], depth: number) => {
    for (const n of nodes) {
      if (n.constructed && n.children?.length) {
        const [tipo, qtd, ident] = n.children;
        const votes = tipo && !tipo.constructed ? derInt(qtd) : null;
        if (votes !== null && ident?.constructed && ident.children?.length && ident.children.every((c) => !c.constructed)) {
          const code = derInt(ident.children[ident.children.length - 1]);
          const key = code !== null ? wanted.get(code) : undefined;
          if (key !== undefined && derInt(tipo) !== null) out.set(key, out.get(key)! + votes);
          continue;
        }
        visit(n.children, depth + 1);
      } else if (!n.constructed && n.value.length > 16 && depth < 6) {
        const inner = readDer(n.value, 0);
        if (inner) visit(inner, depth + 1);
      }
    }
  };
  visit(root, 0);
  return out;
}

/**
 * Votos de um cargo no boletim de urna (ex.: 1 = Presidente): número do candidato → votos, mais
 * "branco" e "nulo". Só olha a lista de votáveis daquele cargo, então números iguais em cargos
 * diferentes (ex.: 13 para Presidente e para Governador) não se misturam. null se o cargo não estiver no boletim.
 */
export function parseBuCargoVotes(bytes: Uint8Array, cargoCode: number): Record<string, number> | null {
  const root = readDer(bytes);
  if (!root) return null;
  let out: Record<string, number> | null = null;
  const add = (key: string, v: number) => {
    out ??= {};
    out[key] = (out[key] ?? 0) + v;
  };
  const visit = (nodes: DerNode[], depth: number) => {
    for (const n of nodes) {
      if (n.constructed && n.children?.length) {
        // Um resultado por tipo de cargo (validado pela soma dos votos): (tipoCargo, comparecimento, cargos).
        if (turnoutOf(n) !== null) {
          for (const cargo of n.children[2]!.children ?? []) {
            if (!cargo.constructed || derInt(cargo.children?.[0]) !== cargoCode) continue;
            for (const v of cargo.children?.[2]?.children ?? []) {
              const [tipo, qtd, ident] = v.children ?? [];
              const votes = derInt(qtd);
              if (votes === null) continue;
              const kind = derInt(tipo);
              if (ident?.constructed && ident.children?.length && kind === 1) {
                add(String(derInt(ident.children[ident.children.length - 1])), votes);
              } else if (kind === 2) add("branco", votes);
              else if (kind === 3) add("nulo", votes);
              else add("outros", votes);
            }
            if (!out) out = {};
          }
          continue;
        }
        visit(n.children, depth + 1);
      } else if (!n.constructed && n.value.length > 16 && depth < 6) {
        const inner = readDer(n.value, 0);
        if (inner) visit(inner, depth + 1);
      }
    }
  };
  visit(root, 0);
  return out;
}
