// Locais de votação de uma cidade (nome, endereço, bairro e coordenadas), do Portal de Dados Abertos do TSE.
//
// O arquivo do TSE é nacional e grande: é baixado uma única vez (fica em data/downloads, para servir a
// outras cidades) e filtrado para a cidade, que fica em data/cities/locais-<cidade>.json.
// Sem internet para o TSE, dá para colocar o .zip (ou o .csv) manualmente em data/locais/.

import { createReadStream, createWriteStream, promises as fs } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { PollingPlaceCsvFilter, type PollingPlaceRow } from "@apuracao/core";
import { USER_AGENT, type Ingestor } from "./ingestor";
import { listZip, openZipEntry } from "./zip";

const CACHE_VERSION = 1;
const BASE_URL = "https://cdn.tse.jus.br/estatistica/sead/odsele/eleitorado_locais_votacao";

export interface PollingPlacesState {
  status: "idle" | "downloading" | "reading" | "ready" | "error";
  /** De onde vieram os dados (URL ou arquivo). */
  source: string | null;
  message: string | null;
  downloadedMb: number;
  rows: PollingPlaceRow[];
}

export class PollingPlaces {
  private state: PollingPlacesState = { status: "idle", source: null, message: null, downloadedMb: 0, rows: [] };
  private loading: Promise<void> | null = null;
  private failedAt = 0;
  private readonly cacheFile: string;
  private readonly manualDir: string;

  constructor(
    private readonly ingestor: Ingestor,
    readonly uf: string,
    readonly slug: string,
  ) {
    this.cacheFile = path.join(ingestor.config.dataDir, "cities", `locais-${slug}.json`);
    this.manualDir = path.join(ingestor.config.dataDir, "locais");
  }

  get snapshot(): Omit<PollingPlacesState, "rows"> & { count: number } {
    const { rows, ...rest } = this.state;
    return { ...rest, count: rows.length };
  }

  get rows() {
    return this.state.rows;
  }

  /** Espera a carga em andamento (se houver) terminar. */
  async whenSettled() {
    await this.loading;
  }

  /** Carrega do cache, ou baixa do TSE (uma vez). Pode ser chamado várias vezes. */
  ensure(tseCode: string) {
    if (this.state.status === "ready" || this.loading) return;
    // Depois de uma falha, espera 30 min antes de tentar baixar de novo (o arquivo é grande).
    if (this.state.status === "error" && Date.now() - this.failedAt < 30 * 60_000) return;
    this.loading = this.load(tseCode)
      .catch((err) => {
        this.failedAt = Date.now();
        this.state = { ...this.state, status: "error", message: err instanceof Error ? err.message : String(err) };
        this.ingestor.log("warn", `Locais de votação ${this.slug}: ${this.state.message}`);
      })
      .finally(() => (this.loading = null));
  }

  private async load(tseCode: string) {
    try {
      const saved = JSON.parse(await fs.readFile(this.cacheFile, "utf8")) as { version: number; source: string; rows: PollingPlaceRow[] };
      if (saved.version === CACHE_VERSION && saved.rows.length > 0) {
        this.state = { status: "ready", source: saved.source, message: null, downloadedMb: 0, rows: saved.rows };
        return;
      }
    } catch {
      // Sem cache ainda.
    }

    const errors: string[] = [];
    for (const source of await this.sources()) {
      try {
        const rows = await this.readSource(source, tseCode);
        if (rows.length === 0) {
          errors.push(`${source}: nenhuma seção da cidade encontrada`);
          continue;
        }
        this.state = { status: "ready", source, message: null, downloadedMb: 0, rows };
        await fs.mkdir(path.dirname(this.cacheFile), { recursive: true });
        await fs.writeFile(this.cacheFile, JSON.stringify({ version: CACHE_VERSION, source, rows }), "utf8");
        this.ingestor.log("info", `Locais de votação ${this.slug}: ${rows.length} seções lidas de ${source}`);
        return;
      } catch (err) {
        errors.push(`${source}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    throw new Error(
      `não foi possível obter os locais de votação. ${errors.join(" | ")}. ` +
        `Alternativa: baixe eleitorado_local_votacao_${this.ingestor.config.year}.zip do Portal de Dados Abertos do TSE e coloque em ${this.manualDir}`,
    );
  }

  /** Arquivos colocados à mão em data/locais primeiro; depois o TSE (ano da eleição e, na falta, o anterior). */
  private async sources(): Promise<string[]> {
    const manual = await fs.readdir(this.manualDir).catch(() => [] as string[]);
    const local = manual.filter((f) => /\.(zip|csv)$/i.test(f)).map((f) => path.join(this.manualDir, f));
    const custom = process.env.LOCAIS_VOTACAO_URL;
    const year = this.ingestor.config.year;
    const remote = custom ? [custom] : [year, year - 2].map((y) => `${BASE_URL}/eleitorado_local_votacao_${y}.zip`);
    return [...local, ...remote];
  }

  private async readSource(source: string, tseCode: string): Promise<PollingPlaceRow[]> {
    if (!/^https?:/.test(source)) return this.readFile(source, tseCode);
    // O arquivo nacional fica guardado em data/downloads para servir a outras cidades sem baixar de novo.
    const file = path.join(this.ingestor.config.dataDir, "downloads", path.basename(new URL(source).pathname) || "locais.zip");
    const cached = await fs.stat(file).then((st) => st.size > 0).catch(() => false);
    if (!cached) await this.download(source, file);
    try {
      return await this.readFile(file, tseCode);
    } catch (err) {
      await fs.rm(file, { force: true }); // arquivo corrompido: baixa de novo na próxima tentativa
      throw err;
    }
  }

  private async download(source: string, file: string) {
    const tmp = `${file}.${Date.now()}.part`;
    await fs.mkdir(path.dirname(file), { recursive: true });
    try {
      this.state = { ...this.state, status: "downloading", source, message: null, downloadedMb: 0 };
      const res = await fetch(source, { headers: { "user-agent": USER_AGENT }, signal: AbortSignal.timeout(20 * 60_000) });
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
      let bytes = 0;
      const body = Readable.fromWeb(res.body as import("node:stream/web").ReadableStream);
      body.on("data", (chunk: Buffer) => {
        bytes += chunk.length;
        this.state.downloadedMb = Math.round(bytes / 1e5) / 10;
      });
      await pipeline(body, createWriteStream(tmp));
      await fs.rename(tmp, file);
    } finally {
      await fs.rm(tmp, { force: true });
    }
  }

  private async readFile(file: string, tseCode: string): Promise<PollingPlaceRow[]> {
    this.state = { ...this.state, status: "reading" };
    let stream: Readable;
    if (/\.zip$/i.test(file)) {
      const entries = (await listZip(file)).filter((e) => /\.csv$/i.test(e.name));
      if (entries.length === 0) throw new Error("nenhum .csv dentro do .zip");
      // Arquivo por UF, se houver; senão o maior (nacional).
      const entry =
        entries.find((e) => new RegExp(`_${this.uf}\\.csv$`, "i").test(e.name)) ??
        entries.sort((a, b) => b.size - a.size)[0]!;
      stream = await openZipEntry(file, entry);
    } else {
      stream = createReadStream(file);
    }
    const filter = new PollingPlaceCsvFilter(tseCode, this.uf);
    const decoder = new TextDecoder("latin1");
    let rest = "";
    for await (const chunk of stream) {
      const text = rest + decoder.decode(chunk as Buffer, { stream: true });
      const lines = text.split("\n");
      rest = lines.pop() ?? "";
      for (const line of lines) filter.push(line.replace(/\r$/, ""));
    }
    if (rest) filter.push(rest);
    if (!filter.headerFound) throw new Error("cabeçalho do CSV não reconhecido");
    return filter.rows;
  }
}
