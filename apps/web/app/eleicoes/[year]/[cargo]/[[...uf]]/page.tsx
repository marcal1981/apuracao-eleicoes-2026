import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { OFFICES, findState, isOfficeKey } from "@apuracao/core";
import { RacePage } from "@/lib/server/race-page";
import { getIngestor } from "@/lib/server/ingestor";
import { StateGrid } from "@/components/state-grid";
import { TotalizationMap } from "@/components/totalization-map";
import { MunicipalMap } from "@/components/municipal-map";
import { MUNICIPAL_UFS } from "@/lib/server/municipal";

export const dynamic = "force-dynamic";

interface Params {
  year: string;
  cargo: string;
  uf?: string[];
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { cargo, uf } = await params;
  if (!isOfficeKey(cargo)) return {};
  const state = uf?.[0] ? findState(uf[0]) : undefined;
  const title = `Resultado ${OFFICES[cargo].name}${state ? ` ${state.uf}` : ""} — Eleições 2026`;
  return { title, description: `${title}: votos, percentuais e evolução da apuração em tempo real com dados oficiais do TSE.` };
}

export default async function CargoPage({ params }: { params: Promise<Params> }) {
  const { year, cargo, uf } = await params;
  if (year !== "2026" || !isOfficeKey(cargo) || (uf && uf.length > 1)) notFound();
  const office = OFFICES[cargo];
  const ufParam = uf?.[0];

  if (!ufParam) {
    if (office.scope === "BR")
      return (
        <div className="space-y-6">
          <RacePage office={cargo} scope="br" />
          <TotalizationMap initialOffice={cargo} />
        </div>
      );
    const summaries = getIngestor().listRaces({ office: cargo });
    const extra = cargo === "deputado-estadual" ? getIngestor().listRaces({ office: "deputado-distrital" }) : [];
    return (
      <section className="space-y-4">
        <h1 className="text-2xl font-bold tracking-tight">{office.name} — escolha o estado</h1>
        <TotalizationMap initialOffice={cargo === "deputado-distrital" ? "deputado-estadual" : cargo} />
        <StateGrid cargo={cargo} summaries={[...summaries, ...extra]} />
      </section>
    );
  }

  const state = findState(ufParam);
  if (!state) notFound();
  if (ufParam !== state.uf.toLowerCase()) redirect(`/eleicoes/2026/${cargo}/${state.uf.toLowerCase()}`);
  if (cargo === "deputado-estadual" && state.uf === "DF") redirect("/eleicoes/2026/deputado-distrital/df");
  if (cargo === "deputado-distrital" && state.uf !== "DF") redirect(`/eleicoes/2026/deputado-estadual/${ufParam}`);

  return (
    <div className="space-y-6">
      <RacePage office={cargo} scope={state.uf} />
      {cargo !== "presidente" && MUNICIPAL_UFS.includes(state.uf.toLowerCase()) && (
        <MunicipalMap uf={state.uf.toLowerCase()} />
      )}
      {cargo === "presidente" && (
        <p className="text-sm text-muted">Votação para Presidente apurada em {state.name}.</p>
      )}
    </div>
  );
}
