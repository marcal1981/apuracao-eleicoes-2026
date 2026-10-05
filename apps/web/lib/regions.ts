/** Regiões de municípios usadas nas páginas de abstenção. */
export interface Region {
  slug: string;
  name: string;
  uf: string;
  /** Sub-região → municípios (nomes como no IBGE). */
  subregions: { name: string; cities: string[] }[];
}

/** Região Metropolitana do Vale do Paraíba e Litoral Norte (RMVale): 39 municípios em 5 sub-regiões. */
export const VALE_DO_PARAIBA: Region = {
  slug: "vale-do-paraiba",
  name: "Vale do Paraíba e Litoral Norte",
  uf: "sp",
  subregions: [
    {
      name: "São José dos Campos",
      cities: ["Caçapava", "Igaratá", "Jacareí", "Jambeiro", "Monteiro Lobato", "Paraibuna", "Santa Branca", "São José dos Campos"],
    },
    {
      name: "Taubaté",
      cities: [
        "Campos do Jordão",
        "Lagoinha",
        "Natividade da Serra",
        "Pindamonhangaba",
        "Redenção da Serra",
        "Santo Antônio do Pinhal",
        "São Bento do Sapucaí",
        "São Luís do Paraitinga",
        "Taubaté",
        "Tremembé",
      ],
    },
    {
      name: "Guaratinguetá",
      cities: ["Aparecida", "Cachoeira Paulista", "Canas", "Cunha", "Guaratinguetá", "Lorena", "Piquete", "Potim", "Roseira"],
    },
    {
      name: "Cruzeiro",
      cities: ["Arapeí", "Areias", "Bananal", "Cruzeiro", "Lavrinhas", "Queluz", "São José do Barreiro", "Silveiras"],
    },
    { name: "Litoral Norte", cities: ["Caraguatatuba", "Ilhabela", "São Sebastião", "Ubatuba"] },
  ],
};

export const REGIONS: Record<string, Region> = { [VALE_DO_PARAIBA.slug]: VALE_DO_PARAIBA };

const norm = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");

/** Sub-região de um município na região (ou null se não pertence). */
export function subregionOf(region: Region, cityName: string): string | null {
  const n = norm(cityName);
  for (const s of region.subregions) if (s.cities.some((c) => norm(c) === n)) return s.name;
  return null;
}
