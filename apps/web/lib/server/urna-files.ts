// Acesso aos arquivos de urna do TSE, compartilhado pela abstenção por seção e pelos votos por distrito.

import {
  electionCodeFor,
  electionConfigUrl,
  findPleitoCode,
  normalizePlaceName,
  parseSectionAux,
  sectionAuxUrl,
  sectionFileUrl,
  urnaConfigUrl,
  parseUrnaConfig,
  type SectionAux,
  type SectionRef,
} from "@apuracao/core";
import { USER_AGENT, type Ingestor } from "./ingestor";
import type { MunicipalityRegistry } from "./municipal";

let pleitoCache: string | null = process.env.TSE_PLEITO || null;

/** Código do pleito (turno) no TSE, lido do ele-c.json (ou TSE_PLEITO no .env). */
export async function resolvePleito(ingestor: Ingestor): Promise<string> {
  if (pleitoCache) return pleitoCache;
  const url = electionConfigUrl(ingestor.config.endpoint);
  const res = await ingestor.httpGet(url, undefined, 30_000);
  if (res.kind !== "new") throw new Error(`configuração de eleições não disponível no TSE (${url})`);
  const election = electionCodeFor(ingestor.config.electionCodes, "governador");
  const pleito = findPleitoCode(JSON.parse(res.body), election);
  if (!pleito) throw new Error(`pleito da eleição ${election} não encontrado em ${url} (defina TSE_PLEITO no .env)`);
  return (pleitoCache = pleito);
}

/** Código TSE do município pelo nome. */
export function tseCodeOf(registry: MunicipalityRegistry, city: string): string | null {
  const wanted = normalizePlaceName(city);
  return registry.municipalities().find((m) => normalizePlaceName(m.name) === wanted)?.tseCode ?? null;
}

/** Zonas e seções de um município, do arquivo de configuração de urnas. */
export async function loadSectionRefs(ingestor: Ingestor, pleito: string, uf: string, tseCode: string): Promise<SectionRef[]> {
  const url = urnaConfigUrl(ingestor.config.endpoint, pleito, uf);
  const res = await ingestor.httpGet(url, undefined, 60_000);
  if (res.kind !== "new") throw new Error(`lista de seções não disponível no TSE (${url})`);
  return parseUrnaConfig(JSON.parse(res.body), tseCode);
}

/** Baixa um arquivo binário da urna; null se ainda não publicado. */
export async function fetchBytes(url: string): Promise<Uint8Array | null> {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(url, { headers: { "user-agent": USER_AGENT }, signal: AbortSignal.timeout(20_000), cache: "no-store" });
      if (res.status === 404 || res.status === 403) return null;
      if (!res.ok) throw new Error(`HTTP ${res.status} em ${url}`);
      return new Uint8Array(await res.arrayBuffer());
    } catch (err) {
      if (attempt >= 2) throw err;
      await new Promise((resolve) => setTimeout(resolve, 1_000 * (attempt + 1)));
    }
  }
}

export type SectionBu =
  | { kind: "missing"; status: string; url: string }
  | { kind: "bu"; aux: SectionAux; bytes: Uint8Array; url: string };

/** Arquivo auxiliar + boletim de urna de uma seção. */
export async function fetchSectionBu(ingestor: Ingestor, pleito: string, uf: string, tseCode: string, ref: SectionRef): Promise<SectionBu> {
  const endpoint = ingestor.config.endpoint;
  const auxUrl = sectionAuxUrl(endpoint, pleito, uf, tseCode, ref);
  const auxRes = await ingestor.httpGet(auxUrl, undefined, 20_000);
  if (auxRes.kind !== "new") return { kind: "missing", status: `Sem arquivo da urna`, url: auxUrl };
  const aux = parseSectionAux(JSON.parse(auxRes.body));
  if (!aux.hash || !aux.buFile) return { kind: "missing", status: aux.status || "Sem boletim de urna", url: auxUrl };
  const buUrl = sectionFileUrl(endpoint, pleito, uf, tseCode, ref, aux.hash, aux.buFile);
  const bytes = await fetchBytes(buUrl);
  if (!bytes) return { kind: "missing", status: aux.status || "Boletim ainda não publicado", url: buUrl };
  return { kind: "bu", aux, bytes, url: buUrl };
}
