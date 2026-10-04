// Definições genéricas de cargos e unidades da federação.
// Os códigos de cargo seguem a numeração usada pelo TSE nos arquivos de divulgação.

export type OfficeKey =
  | "presidente"
  | "governador"
  | "senador"
  | "deputado-federal"
  | "deputado-estadual"
  | "deputado-distrital";

export type ElectoralSystem = "majoritario" | "proporcional";

export interface OfficeDef {
  key: OfficeKey;
  name: string;
  /** Código do cargo no TSE, com 4 dígitos (ex.: "0001"). */
  tseCode: string;
  /** "BR" = apuração nacional disponível; "UF" = apenas por estado. */
  scope: "BR" | "UF";
  system: ElectoralSystem;
  /** Vagas em disputa por circunscrição (apenas majoritários; proporcionais seguem o resultado oficial). */
  seats?: number;
  hasSecondRound: boolean;
}

export const OFFICES: Record<OfficeKey, OfficeDef> = {
  presidente: {
    key: "presidente",
    name: "Presidente",
    tseCode: "0001",
    scope: "BR",
    system: "majoritario",
    seats: 1,
    hasSecondRound: true,
  },
  governador: {
    key: "governador",
    name: "Governador",
    tseCode: "0003",
    scope: "UF",
    system: "majoritario",
    seats: 1,
    hasSecondRound: true,
  },
  senador: {
    key: "senador",
    name: "Senador",
    tseCode: "0005",
    scope: "UF",
    system: "majoritario",
    // Em 2026 são renovados 2/3 do Senado: duas vagas por UF.
    seats: 2,
    hasSecondRound: false,
  },
  "deputado-federal": {
    key: "deputado-federal",
    name: "Deputado Federal",
    tseCode: "0006",
    scope: "UF",
    system: "proporcional",
    hasSecondRound: false,
  },
  "deputado-estadual": {
    key: "deputado-estadual",
    name: "Deputado Estadual",
    tseCode: "0007",
    scope: "UF",
    system: "proporcional",
    hasSecondRound: false,
  },
  "deputado-distrital": {
    key: "deputado-distrital",
    name: "Deputado Distrital",
    tseCode: "0008",
    scope: "UF",
    system: "proporcional",
    hasSecondRound: false,
  },
};

export const OFFICE_KEYS = Object.keys(OFFICES) as OfficeKey[];

export function isOfficeKey(value: string): value is OfficeKey {
  return value in OFFICES;
}

export interface StateDef {
  uf: string;
  name: string;
  ibge: string;
}

export const STATES: StateDef[] = [
  { uf: "AC", name: "Acre", ibge: "12" },
  { uf: "AL", name: "Alagoas", ibge: "27" },
  { uf: "AP", name: "Amapá", ibge: "16" },
  { uf: "AM", name: "Amazonas", ibge: "13" },
  { uf: "BA", name: "Bahia", ibge: "29" },
  { uf: "CE", name: "Ceará", ibge: "23" },
  { uf: "DF", name: "Distrito Federal", ibge: "53" },
  { uf: "ES", name: "Espírito Santo", ibge: "32" },
  { uf: "GO", name: "Goiás", ibge: "52" },
  { uf: "MA", name: "Maranhão", ibge: "21" },
  { uf: "MT", name: "Mato Grosso", ibge: "51" },
  { uf: "MS", name: "Mato Grosso do Sul", ibge: "50" },
  { uf: "MG", name: "Minas Gerais", ibge: "31" },
  { uf: "PA", name: "Pará", ibge: "15" },
  { uf: "PB", name: "Paraíba", ibge: "25" },
  { uf: "PR", name: "Paraná", ibge: "41" },
  { uf: "PE", name: "Pernambuco", ibge: "26" },
  { uf: "PI", name: "Piauí", ibge: "22" },
  { uf: "RJ", name: "Rio de Janeiro", ibge: "33" },
  { uf: "RN", name: "Rio Grande do Norte", ibge: "24" },
  { uf: "RS", name: "Rio Grande do Sul", ibge: "43" },
  { uf: "RO", name: "Rondônia", ibge: "11" },
  { uf: "RR", name: "Roraima", ibge: "14" },
  { uf: "SC", name: "Santa Catarina", ibge: "42" },
  { uf: "SP", name: "São Paulo", ibge: "35" },
  { uf: "SE", name: "Sergipe", ibge: "28" },
  { uf: "TO", name: "Tocantins", ibge: "17" },
];

export function findState(uf: string): StateDef | undefined {
  const upper = uf.toUpperCase();
  return STATES.find((s) => s.uf === upper);
}

/** Cargos disputados numa circunscrição. O DF elege deputados distritais em vez de estaduais. */
export function officesForScope(scope: string, round: number): OfficeKey[] {
  const isBR = scope.toUpperCase() === "BR";
  const isDF = scope.toUpperCase() === "DF";
  return OFFICE_KEYS.filter((key) => {
    const office = OFFICES[key];
    if (round === 2 && !office.hasSecondRound) return false;
    if (isBR) return office.scope === "BR";
    if (key === "deputado-estadual") return !isDF;
    if (key === "deputado-distrital") return isDF;
    return true;
  });
}

export function raceKey(round: number, office: OfficeKey, scope: string): string {
  return `r${round}:${office}:${scope.toLowerCase()}`;
}
