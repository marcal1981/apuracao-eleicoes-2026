// Parcial do exterior publicado pelo g1 (soma dos boletins de urna afixados nos locais de votação).
// Não é dado oficial do TSE: serve só de referência enquanto o TSE não divulga o exterior.
// A reportagem traz, por país, parágrafos como "2º turno: Lula, 6.017 votos (63,46%)2º turno: Flávio, 3.465 votos ...".

import { envText } from "./config";
import { USER_AGENT } from "./ingestor";

export const G1_EXTERIOR_URL =
  envText("G1_EXTERIOR_URL") ||
  "https://g1.globo.com/mundo/noticia/2026/10/25/votacao-no-exterior-confira-os-resultados-do-2o-turno-entre-lula-e-flavio-bolsonaro.ghtml";

export interface G1Country {
  country: string;
  region: string;
  /** Votos de cada finalista; null quando o g1 diz "ainda não há dados". */
  r1: { lula: number; flavio: number } | null;
  r2: { lula: number; flavio: number } | null;
}

const decode = (s: string) =>
  s
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&[a-z]+;/g, " ")
    .trim();

/** Votos de um turno no parágrafo do país ("Lula, 6.017 votos", "Flávio, 1.276"). */
function votesOf(text: string, round: 1 | 2): { lula: number; flavio: number } | null {
  const re = new RegExp(`${round}º turno:\\s*([A-Za-zÀ-ÿ ]+?),\\s*([\\d.]+)`, "g");
  let lula: number | null = null;
  let flavio: number | null = null;
  for (const m of text.matchAll(re)) {
    const votes = Number(m[2]!.replace(/\./g, ""));
    if (/lula/i.test(m[1]!)) lula = votes;
    else if (/fl[aá]vio/i.test(m[1]!)) flavio = votes;
  }
  return lula === null && flavio === null ? null : { lula: lula ?? 0, flavio: flavio ?? 0 };
}

export function parseG1Exterior(html: string): G1Country[] {
  const paragraphs = [...html.matchAll(/<p class="content-text__container[^"]*"[^>]*>([\s\S]*?)<\/p>/g)].map((m) => decode(m[1]!));
  const out: G1Country[] = [];
  let region = "";
  for (let i = 0; i < paragraphs.length; i++) {
    const p = paragraphs[i]!;
    if (/^(OCEANIA E ÁSIA|EUROPA|AMÉRICA|ÁFRICA)$/.test(p)) {
      region = p;
      continue;
    }
    const next = paragraphs[i + 1] ?? "";
    // Um país é um parágrafo curto seguido do parágrafo com os votos.
    if (p.length <= 40 && !/turno/.test(p) && /1º turno:/.test(next)) {
      out.push({ country: p, region, r1: votesOf(next, 1), r2: votesOf(next, 2) });
      i++;
    }
  }
  return out;
}

const CACHE_MS = 5 * 60_000;
let cache: { at: number; countries: G1Country[]; error: string | null } | null = null;
let pending: Promise<void> | null = null;

/** Lê a reportagem (no máximo a cada 5 minutos); mantém a última leitura boa se a nova falhar. */
export async function getG1Exterior() {
  if (!cache || Date.now() - cache.at > CACHE_MS) {
    pending ??= (async () => {
      try {
        const res = await fetch(G1_EXTERIOR_URL, { headers: { "user-agent": USER_AGENT }, signal: AbortSignal.timeout(20_000), cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const countries = parseG1Exterior(await res.text());
        if (countries.length === 0) throw new Error("a reportagem não trouxe a lista de países no formato esperado");
        cache = { at: Date.now(), countries, error: null };
      } catch (err) {
        const error = `Não foi possível ler o g1: ${err instanceof Error ? err.message : String(err)}`;
        cache = { at: Date.now(), countries: cache?.countries ?? [], error };
      }
    })().finally(() => (pending = null));
    await pending;
  }
  return { url: G1_EXTERIOR_URL, readAt: new Date(cache!.at).toISOString(), countries: cache!.countries, error: cache!.error };
}
