import { OFFICES, findState, raceKey, type OfficeKey } from "@apuracao/core";
import { RaceView } from "@/components/race-view";
import { getIngestor } from "./ingestor";

/** Renderiza no servidor o estado atual de uma disputa; o cliente segue atualizando via SSE. */
export function RacePage({ office, scope }: { office: OfficeKey; scope: string }) {
  const ingestor = getIngestor();
  const round = ingestor.config.round;
  const key = raceKey(round, office, scope);
  const place = scope.toLowerCase() === "br" ? "Brasil" : (findState(scope)?.name ?? scope.toUpperCase());
  return (
    <RaceView
      office={office}
      scope={scope.toLowerCase()}
      round={round}
      raceKey={key}
      title={`${OFFICES[office].name} — ${place}`}
      initial={ingestor.getRace(key)}
      initialHistory={ingestor.getHistory(key)}
      featuredQueries={ingestor.featuredQueries(office, scope)}
    />
  );
}
