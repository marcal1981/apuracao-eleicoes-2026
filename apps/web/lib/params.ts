import { findState, isOfficeKey, raceKey, type OfficeKey } from "@apuracao/core";

export interface RaceParams {
  office: OfficeKey;
  scope: string;
  round: number;
  key: string;
}

/** Valida cargo/UF/turno vindos da URL. Retorna mensagem de erro em caso de entrada inválida. */
export function parseRaceParams(office: string | null, state: string | null, round: string | null): RaceParams | string {
  if (!office || !isOfficeKey(office)) return "Parâmetro 'office' inválido";
  const scope = (state ?? "BR").toUpperCase();
  if (scope !== "BR" && !findState(scope)) return "Parâmetro 'state' inválido";
  if (scope === "BR" && office !== "presidente") return "Este cargo exige o parâmetro 'state' (UF)";
  const r = round ? Number(round) : 1;
  if (r !== 1 && r !== 2) return "Parâmetro 'round' inválido";
  return { office, scope: scope.toLowerCase(), round: r, key: raceKey(r, office, scope) };
}
