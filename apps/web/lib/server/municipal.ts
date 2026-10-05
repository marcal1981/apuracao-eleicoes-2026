// Cadastro dos municípios de uma UF: nomes e códigos IBGE (do desenho em public/maps) associados aos
// códigos do TSE (lista oficial da eleição). Usado pela votação por cidade dos candidatos em destaque.
// Não faz consultas periódicas: a lista oficial é lida uma vez (e de novo só se ainda não tiver sido obtida).

import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  electionCodeFor,
  municipalityConfigUrl,
  normalizePlaceName,
  parseMunicipalityConfig,
} from "@apuracao/core";
import type { Ingestor } from "./ingestor";

interface Municipality {
  ibge: string;
  name: string;
  tseCode: string | null;
}

export class MunicipalityRegistry {
  private readonly entries = new Map<string, Municipality>();
  private readonly ready: Promise<void>;
  private matching: Promise<boolean> | null = null;
  private matched = false;

  constructor(
    private readonly ingestor: Ingestor,
    readonly uf: string,
  ) {
    this.ready = this.loadMap();
  }

  private async loadMap() {
    const file = path.join(/* turbopackIgnore: true */ process.cwd(), "public", "maps", `${this.uf}-municipios.json`);
    const map = JSON.parse(await readFile(file, "utf8")) as { municipalities: { ibge: string; name: string }[] };
    for (const m of map.municipalities) this.entries.set(m.ibge, { ibge: m.ibge, name: m.name, tseCode: null });
  }

  /** Garante que os códigos do TSE foram associados (uma leitura bem-sucedida basta). */
  async ensureTseCodes(): Promise<boolean> {
    await this.ready;
    if (this.matched || this.ingestor.config.source === "mock") return true;
    this.matching ??= this.matchTseMunicipalities().finally(() => (this.matching = null));
    this.matched = await this.matching;
    return this.matched;
  }

  private async matchTseMunicipalities(): Promise<boolean> {
    const code = electionCodeFor(this.ingestor.config.electionCodes, "governador");
    const url = municipalityConfigUrl(this.ingestor.config.endpoint, code);
    const res = await this.ingestor.httpGet(url).catch(() => null);
    if (res?.kind !== "new") return false;
    const list = parseMunicipalityConfig(JSON.parse(res.body), this.uf);
    const byName = new Map([...this.entries.values()].map((e) => [normalizePlaceName(e.name), e]));
    let matched = 0;
    const unmatched: string[] = [];
    for (const m of list) {
      const entry = (m.ibge && this.entries.get(m.ibge)) || byName.get(normalizePlaceName(m.name));
      if (entry) {
        entry.tseCode = m.tseCode;
        matched++;
      } else unmatched.push(m.name);
    }
    this.ingestor.log(
      unmatched.length ? "warn" : "info",
      `Municípios ${this.uf.toUpperCase()}: ${matched} de ${this.entries.size} associados à lista do TSE` +
        (unmatched.length ? ` (sem correspondência: ${unmatched.slice(0, 5).join(", ")})` : ""),
    );
    return matched > 0;
  }

  async whenReady() {
    await this.ready;
  }

  municipalities(): Municipality[] {
    return [...this.entries.values()];
  }
}

/** UFs com votação por cidade (precisam do desenho em public/maps/<uf>-municipios.json). */
export const MUNICIPAL_UFS = (process.env.MUNICIPAL_UFS ?? "sp")
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);
