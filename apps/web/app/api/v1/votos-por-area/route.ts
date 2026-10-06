import { promises as fs } from "node:fs";
import path from "node:path";
import type { NextRequest } from "next/server";
import { normalizePlaceName } from "@apuracao/core";
import { getCandidateCitiesTracker, getIngestor, getMunicipalityRegistry } from "@/lib/server/ingestor";
import { AreaVotesQuery, type AreaSpec } from "@/lib/server/area-votes";
import { PollingPlaces } from "@/lib/server/locais";
import { json } from "@/lib/http";
import { slug } from "@/lib/csv";

export const dynamic = "force-dynamic";

interface District {
  name: string;
  subprefeitura: string;
  polygons: number[][][][];
}

const QUERIES = Symbol.for("apuracao.area-votes");
const PLACES = Symbol.for("apuracao.area-places");
const g = globalThis as unknown as Record<symbol, Map<string, unknown> | undefined>;
const queries = (g[QUERIES] ??= new Map()) as Map<string, AreaVotesQuery>;
const placesByCity = (g[PLACES] ??= new Map()) as Map<string, PollingPlaces>;

let districts: District[] | null = null;
async function loadDistricts(): Promise<District[]> {
  if (!districts) {
    const file = path.resolve(/* turbopackIgnore: true */ process.cwd(), "public/maps/sao-paulo-distritos.json");
    districts = (JSON.parse(await fs.readFile(file, "utf8")) as { districts: District[] }).districts;
  }
  return districts;
}

/** Candidatos em destaque (nome e número) das disputas proporcionais. */
function featuredCandidates(uf: string) {
  return ["deputado-federal", "deputado-estadual"].flatMap((office) => {
    const tracker = getCandidateCitiesTracker(office, uf);
    return tracker ? tracker.getSnapshot().candidates.map((c) => ({ office, name: c.name, number: c.number })) : [];
  });
}

/**
 * Votos de um candidato numa área da cidade:
 * /api/v1/votos-por-area?uf=sp&cidade=São Paulo&distrito=CIDADE TIRADENTES&numero=2533
 * /api/v1/votos-por-area?uf=sp&cidade=São José dos Campos&bairro=Santana&numero=2533
 * Sem parâmetros: lista os candidatos em destaque e os distritos de São Paulo.
 */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const uf = (sp.get("uf") ?? "sp").toLowerCase();
  const numero = sp.get("numero");
  const cidade = (sp.get("cidade") ?? "").trim();
  const distrito = (sp.get("distrito") ?? "").trim();
  const bairro = (sp.get("bairro") ?? "").trim();
  try {
    if (!numero || !cidade || (!distrito && !bairro)) {
      return json({ candidates: featuredCandidates(uf), districts: (await loadDistricts()).map((d) => ({ name: d.name, subprefeitura: d.subprefeitura })) }, { maxAge: 30 });
    }
    const candidate = featuredCandidates(uf).find((c) => c.number === numero) ?? { name: `Candidato ${numero}`, number: numero };
    const registry = getMunicipalityRegistry(uf);
    if (!registry) return json({ error: "UF sem lista de municípios" }, { status: 404, maxAge: 60 });

    let area: AreaSpec;
    if (distrito) {
      if (normalizePlaceName(cidade) !== normalizePlaceName("São Paulo")) {
        return json({ error: "Distritos só estão disponíveis para a cidade de São Paulo; para outras cidades, busque pelo bairro." }, { status: 400, maxAge: 0 });
      }
      const d = (await loadDistricts()).find((x) => normalizePlaceName(x.name) === normalizePlaceName(distrito));
      if (!d) return json({ error: `Distrito "${distrito}" não encontrado` }, { status: 404, maxAge: 60 });
      area = { kind: "district", name: d.name, polygons: d.polygons };
    } else {
      area = { kind: "text", text: bairro };
    }

    const key = [uf, normalizePlaceName(cidade), area.kind, normalizePlaceName(distrito || bairro), numero].join("|");
    let query = queries.get(key);
    if (!query) {
      const cityKey = `${uf}|${normalizePlaceName(cidade)}`;
      let places = placesByCity.get(cityKey);
      if (!places) placesByCity.set(cityKey, (places = new PollingPlaces(getIngestor(), uf, slug(cidade))));
      query = new AreaVotesQuery(getIngestor(), registry, places, uf, cidade, area, { number: candidate.number, name: candidate.name });
      queries.set(key, query);
    }
    query.ensureRunning();
    return json(query.getSnapshot(), { maxAge: 0 });
  } catch (err) {
    return json({ error: `Falha na consulta: ${err instanceof Error ? err.message : String(err)}` }, { status: 500, maxAge: 0 });
  }
}
