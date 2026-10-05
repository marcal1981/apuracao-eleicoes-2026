import type { NextRequest } from "next/server";
import {
  electionCodeFor,
  isOfficeKey,
  matchesCandidate,
  municipalResultUrl,
  municipalityConfigUrl,
  parseMunicipalityConfig,
  parseSimplifiedResult,
  raceKey,
} from "@apuracao/core";
import { USER_AGENT, getCandidateCitiesTracker, getIngestor } from "@/lib/server/ingestor";
import { json } from "@/lib/http";

export const dynamic = "force-dynamic";

interface Probe {
  url: string;
  status: number | null;
  ms: number;
  bytes: number;
  error: string | null;
  body: string | null;
}

async function probe(url: string): Promise<Probe> {
  const started = Date.now();
  try {
    const res = await fetch(url, {
      headers: { "user-agent": USER_AGENT, accept: "application/json" },
      signal: AbortSignal.timeout(90_000),
      cache: "no-store",
    });
    const body = await res.text();
    return { url, status: res.status, ms: Date.now() - started, bytes: body.length, error: null, body: res.ok ? body : null };
  } catch (err) {
    return { url, status: null, ms: Date.now() - started, bytes: 0, error: err instanceof Error ? err.message : String(err), body: null };
  }
}

const strip = ({ body: _b, ...rest }: Probe) => rest;

/**
 * Diagnóstico da votação por cidade: testa no TSE a lista de municípios e o arquivo da capital,
 * e mostra se os candidatos em destaque aparecem nele. GET /api/v1/diagnostico/cidades?office=deputado-federal
 */
export async function GET(req: NextRequest) {
  const office = req.nextUrl.searchParams.get("office") ?? "deputado-federal";
  const uf = (req.nextUrl.searchParams.get("uf") ?? "sp").toLowerCase();
  if (!isOfficeKey(office)) return json({ error: "office inválido" }, { status: 400, maxAge: 0 });
  const ingestor = getIngestor();
  const { endpoint, electionCodes, round } = ingestor.config;
  const tracker = getCandidateCitiesTracker(office, uf);
  const queries = tracker?.featuredQueries ?? ingestor.featuredQueries(office, uf);

  // 1. Lista de municípios
  const listProbe = await probe(municipalityConfigUrl(endpoint, electionCodeFor(electionCodes, "governador")));
  let list: ReturnType<typeof parseMunicipalityConfig> = [];
  let listError: string | null = null;
  if (listProbe.body) {
    try {
      list = parseMunicipalityConfig(JSON.parse(listProbe.body), uf);
    } catch (err) {
      listError = String(err);
    }
  }
  const capital = list.find((m) => m.ibge === "3550308") ?? list.find((m) => /^S[ÃA]O PAULO$/i.test(m.name)) ?? list[0];

  // 2. Arquivo da capital (ou do primeiro município da lista)
  let cityProbe: Probe | null = null;
  let city: Record<string, unknown> | null = null;
  if (capital) {
    cityProbe = await probe(municipalResultUrl(endpoint, electionCodeFor(electionCodes, office), office, uf, capital.tseCode));
    if (cityProbe.body) {
      try {
        const raw = JSON.parse(cityProbe.body) as Record<string, unknown>;
        const r = parseSimplifiedResult(raw, { office, scope: uf, round, skipProjection: true });
        city = {
          topLevelKeys: Object.keys(raw),
          candidates: r.candidates.length,
          sectionsTotalizedPct: r.sectionsTotalizedPct,
          validVotes: r.totals.valid,
          featuredFound: r.candidates
            .filter((c) => queries.some((q) => matchesCandidate(c, q)))
            .map((c) => ({ name: c.name, number: c.number, id: c.id, votes: c.votes })),
          sampleCandidate: r.candidates[0] ? { name: r.candidates[0].name, number: r.candidates[0].number, id: r.candidates[0].id } : null,
        };
      } catch (err) {
        city = { parseError: err instanceof Error ? err.message : String(err), start: cityProbe.body.slice(0, 300) };
      }
    }
  }

  // 3. Destaques no arquivo estadual (para comparar identificadores)
  const race = ingestor.getRace(raceKey(round, office, uf));
  const stateFeatured =
    race?.candidates
      .filter((c) => queries.some((q) => matchesCandidate(c, q)))
      .map((c) => ({ name: c.name, number: c.number, id: c.id, votes: c.votes })) ?? [];

  return json(
    {
      office,
      uf,
      queries,
      municipalityList: {
        ...strip(listProbe),
        parsedForUf: list.length,
        parseError: listError,
        sample: list.slice(0, 2),
        start: listProbe.body && list.length === 0 ? listProbe.body.slice(0, 300) : undefined,
      },
      registry: tracker
        ? {
            associated: tracker.registry.municipalities().filter((m) => m.tseCode).length,
            total: tracker.registry.municipalities().length,
            lastError: tracker.registry.lastError,
          }
        : null,
      capitalFile: cityProbe ? { municipality: capital, ...strip(cityProbe), ...city } : null,
      stateFeatured,
      tracker: tracker ? tracker.getSnapshot().progress : null,
    },
    { maxAge: 0 },
  );
}
