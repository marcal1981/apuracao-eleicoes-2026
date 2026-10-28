// Perfil de quem compareceu e de quem faltou (arquivo de dados abertos do TSE), por UF, turno e grupo
// (gênero, faixa etária, escolaridade, estado civil, cor/raça) e por município.
//
// O arquivo é grande (≈ 230 MB compactado, vários GB de CSV): é baixado uma vez para data/downloads,
// lido em fluxo, e só o resumo fica guardado em data/cities/perfil-abstencao-<ano>.json. A cada 6 horas o
// sistema confere se o TSE publicou versão nova (o 2º turno entra no mesmo arquivo, semanas depois).

import { createWriteStream, promises as fs } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { USER_AGENT, type Ingestor } from "./ingestor";
import { listZip, openZipEntry } from "./zip";

/** [aptos, comparecimento, abstenção] */
export type Counts = [number, number, number];

export const PROFILE_DIMENSIONS = {
  genero: "Gênero",
  faixa: "Faixa etária",
  instrucao: "Escolaridade",
  estadoCivil: "Estado civil",
  corRaca: "Cor/raça",
} as const;
export type ProfileDimension = keyof typeof PROFILE_DIMENSIONS;

export interface TurnProfile {
  total: Counts;
  /** grupo → código → [rótulo, aptos, comparecimento, abstenção] (o código ordena faixas e escolaridade) */
  dims: Record<ProfileDimension, Record<string, [string, number, number, number]>>;
  /** voto obrigatório × facultativo (16–17 anos, 70+ e analfabetos) e eleitores com deficiência: [comparecimento, abstenção] */
  obrigatorio: [number, number];
  facultativo: [number, number];
  deficiencia: [number, number];
  /** código do município → [nome, aptos, comparecimento, abstenção] */
  cities: Record<string, [string, number, number, number]>;
}

interface Store {
  version: number;
  source: string;
  lastModified: string | null;
  generatedAt: string | null;
  /** UF → turno → perfil */
  ufs: Record<string, Record<string, TurnProfile>>;
}

export interface ProfileStatus {
  status: "idle" | "checking" | "downloading" | "reading" | "ready" | "error";
  message: string | null;
  downloadedMb: number;
  totalMb: number | null;
  readingUf: string | null;
  ufsRead: number;
  ufsTotal: number;
  lastModified: string | null;
  turns: number[];
}

const VERSION = 1;
const RECHECK_MS = 6 * 3600_000;
const KEY = Symbol.for("apuracao.abstention-profile");

const emptyTurn = (): TurnProfile => ({
  total: [0, 0, 0],
  dims: { genero: {}, faixa: {}, instrucao: {}, estadoCivil: {}, corRaca: {} },
  obrigatorio: [0, 0],
  facultativo: [0, 0],
  deficiencia: [0, 0],
  cities: {},
});

class AbstentionProfile {
  private store: Store | null = null;
  private state: ProfileStatus = {
    status: "idle",
    message: null,
    downloadedMb: 0,
    totalMb: null,
    readingUf: null,
    ufsRead: 0,
    ufsTotal: 0,
    lastModified: null,
    turns: [],
  };
  private running: Promise<void> | null = null;
  private lastCheck = 0;
  private readonly source: string;
  private readonly cacheFile: string;
  private readonly zipFile: string;

  constructor(private readonly ingestor: Ingestor) {
    const year = ingestor.config.year;
    this.source =
      process.env.PERFIL_ABSTENCAO_URL ||
      `https://cdn.tse.jus.br/estatistica/sead/odsele/perfil_comparecimento_abstencao/perfil_comparecimento_abstencao_${year}.zip`;
    this.cacheFile = path.join(ingestor.config.dataDir, "cities", `perfil-abstencao-${year}.json`);
    this.zipFile = path.join(ingestor.config.dataDir, "downloads", path.basename(new URL(this.source).pathname));
  }

  /** Começa (ou confere a atualização) na primeira consulta; não bloqueia a página. */
  ensure() {
    if (this.running) return;
    if (this.store && Date.now() - this.lastCheck < RECHECK_MS) return;
    this.running = this.run()
      .catch((err: unknown) => {
        this.state = { ...this.state, status: this.store ? "ready" : "error", message: `Perfil de abstenção: ${err instanceof Error ? err.message : String(err)}` };
        this.ingestor.log("warn", this.state.message!);
      })
      .finally(() => {
        this.running = null;
        this.lastCheck = Date.now();
      });
  }

  private turnsOf(store: Store | null) {
    const set = new Set<number>();
    for (const t of Object.values(store?.ufs ?? {})) for (const k of Object.keys(t)) set.add(Number(k));
    return [...set].sort();
  }

  private async run() {
    if (!this.store) {
      try {
        const saved = JSON.parse(await fs.readFile(this.cacheFile, "utf8")) as Store;
        if (saved.version === VERSION && saved.source === this.source) {
          this.store = saved;
          this.state = { ...this.state, status: "ready", lastModified: saved.lastModified, turns: this.turnsOf(saved) };
        }
      } catch {
        // sem resumo guardado
      }
    }
    // Versão publicada pelo TSE (o 2º turno chega como uma nova versão do mesmo arquivo).
    if (!this.store) this.state = { ...this.state, status: "checking", message: null };
    const head = await fetch(this.source, { method: "HEAD", headers: { "user-agent": USER_AGENT }, signal: AbortSignal.timeout(30_000) });
    if (!head.ok) throw new Error(`arquivo não disponível no TSE (HTTP ${head.status}): ${this.source}`);
    const lastModified = head.headers.get("last-modified");
    const totalMb = Number(head.headers.get("content-length")) / 1e6 || null;
    if (this.store && this.store.lastModified === lastModified) return;

    const local = await fs.stat(this.zipFile).catch(() => null);
    const localIsCurrent = local && lastModified && local.mtime.getTime() >= Date.parse(lastModified);
    if (!localIsCurrent) await this.download(totalMb);
    await this.read(lastModified);
  }

  private async download(totalMb: number | null) {
    const tmp = `${this.zipFile}.${Date.now()}.part`;
    await fs.mkdir(path.dirname(this.zipFile), { recursive: true });
    try {
      this.state = { ...this.state, status: this.store ? "ready" : "downloading", message: null, downloadedMb: 0, totalMb };
      const res = await fetch(this.source, { headers: { "user-agent": USER_AGENT }, signal: AbortSignal.timeout(60 * 60_000) });
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status} ao baixar ${this.source}`);
      let bytes = 0;
      const body = Readable.fromWeb(res.body as import("node:stream/web").ReadableStream);
      body.on("data", (chunk: Buffer) => {
        bytes += chunk.length;
        this.state.downloadedMb = Math.round(bytes / 1e5) / 10;
      });
      await pipeline(body, createWriteStream(tmp));
      await fs.rename(tmp, this.zipFile);
    } finally {
      await fs.rm(tmp, { force: true });
    }
  }

  private async read(lastModified: string | null) {
    const entries = (await listZip(this.zipFile))
      .filter((e) => /_([A-Z]{2})\.csv$/i.test(e.name) && !/_BRASIL\.csv$/i.test(e.name))
      .sort((a, b) => a.size - b.size);
    if (entries.length === 0) throw new Error("nenhum arquivo por UF dentro do .zip do TSE");
    const ufs: Store["ufs"] = {};
    this.state = { ...this.state, status: this.store ? "ready" : "reading", ufsRead: 0, ufsTotal: entries.length };
    for (const entry of entries) {
      const uf = /_([A-Z]{2})\.csv$/i.exec(entry.name)![1]!.toUpperCase();
      this.state.readingUf = uf;
      ufs[uf] = await this.readUf(await openZipEntry(this.zipFile, entry));
      this.state.ufsRead++;
    }
    const store: Store = { version: VERSION, source: this.source, lastModified, generatedAt: new Date().toISOString(), ufs };
    await fs.mkdir(path.dirname(this.cacheFile), { recursive: true });
    await fs.writeFile(`${this.cacheFile}.tmp`, JSON.stringify(store), "utf8");
    await fs.rename(`${this.cacheFile}.tmp`, this.cacheFile);
    this.store = store;
    this.state = { ...this.state, status: "ready", message: null, readingUf: null, lastModified, turns: this.turnsOf(store) };
    // O .zip só é necessário para reler; o resumo basta para a página.
  }

  private async readUf(stream: Readable): Promise<Record<string, TurnProfile>> {
    const out: Record<string, TurnProfile> = {};
    const decoder = new TextDecoder("latin1");
    let col: Record<string, number> | null = null;
    let rest = "";
    const unq = (s: string | undefined) => (s ?? "").replace(/^"|"$/g, "").trim();
    const num = (s: string | undefined) => Number(unq(s)) || 0;
    const handle = (line: string) => {
      if (!line) return;
      const f = line.split(";");
      if (!col) {
        col = Object.fromEntries(f.map((h, i) => [unq(h).toUpperCase(), i]));
        return;
      }
      const c = col;
      const g = (name: string) => f[c[name] ?? -1];
      const turn = unq(g("NR_TURNO")) || "1";
      const t = (out[turn] ??= emptyTurn());
      const aptos = num(g("QT_APTOS"));
      const comp = num(g("QT_COMPARECIMENTO"));
      const abst = num(g("QT_ABSTENCAO"));
      t.total[0] += aptos;
      t.total[1] += comp;
      t.total[2] += abst;
      const addDim = (dim: ProfileDimension, code: string, label: string) => {
        const d = (t.dims[dim][code] ??= [label, 0, 0, 0]);
        d[1] += aptos;
        d[2] += comp;
        d[3] += abst;
      };
      addDim("genero", unq(g("CD_GENERO")), unq(g("DS_GENERO")));
      addDim("faixa", unq(g("CD_FAIXA_ETARIA")), unq(g("DS_FAIXA_ETARIA")));
      addDim("instrucao", unq(g("CD_GRAU_INSTRUCAO")), unq(g("DS_GRAU_INSTRUCAO")));
      addDim("estadoCivil", unq(g("CD_ESTADO_CIVIL")), unq(g("DS_ESTADO_CIVIL")));
      addDim("corRaca", unq(g("CD_COR_RACA")), unq(g("DS_COR_RACA")));
      t.obrigatorio[0] += num(g("QT_COMPAREC_OBRIGATORIO"));
      t.obrigatorio[1] += num(g("QT_ABST_OBRIGATORIO"));
      t.facultativo[0] += num(g("QT_COMPAREC_FACULTATIVO"));
      t.facultativo[1] += num(g("QT_ABST_FACULTATIVO"));
      t.deficiencia[0] += num(g("QT_COMPARECIMENTO_DEFICIENCIA"));
      t.deficiencia[1] += num(g("QT_ABSTENCAO_DEFICIENCIA"));
      const city = (t.cities[unq(g("CD_MUNICIPIO"))] ??= [unq(g("NM_MUNICIPIO")), 0, 0, 0]);
      city[1] += aptos;
      city[2] += comp;
      city[3] += abst;
    };
    let n = 0;
    for await (const chunk of stream) {
      const text = rest + decoder.decode(chunk as Buffer, { stream: true });
      const lines = text.split("\n");
      rest = lines.pop() ?? "";
      for (const line of lines) handle(line.replace(/\r$/, ""));
      // Devolve a vez ao servidor de tempos em tempos (as páginas continuam respondendo).
      if (++n % 50 === 0) await new Promise((r) => setImmediate(r));
    }
    handle(rest.replace(/\r$/, ""));
    return out;
  }

  get status(): ProfileStatus {
    return { ...this.state };
  }

  /** Perfil de uma UF (ou "BR" = todas as UFs, sem o exterior). */
  profile(uf: string): Record<string, TurnProfile> | null {
    if (!this.store) return null;
    if (uf !== "BR") return this.store.ufs[uf] ?? null;
    const out: Record<string, TurnProfile> = {};
    for (const [code, turns] of Object.entries(this.store.ufs)) {
      if (code === "ZZ") continue;
      for (const [turn, p] of Object.entries(turns)) {
        const t = (out[turn] ??= emptyTurn());
        for (let i = 0; i < 3; i++) t.total[i]! += p.total[i]!;
        for (const dim of Object.keys(p.dims) as ProfileDimension[])
          for (const [k, v] of Object.entries(p.dims[dim])) {
            const d = (t.dims[dim][k] ??= [v[0], 0, 0, 0]);
            d[1] += v[1];
            d[2] += v[2];
            d[3] += v[3];
          }
        for (const k of ["obrigatorio", "facultativo", "deficiencia"] as const) {
          t[k][0] += p[k][0];
          t[k][1] += p[k][1];
        }
      }
    }
    return out;
  }
}

export function getAbstentionProfile(ingestor: Ingestor): AbstentionProfile {
  const g = globalThis as unknown as Record<symbol, AbstentionProfile | undefined>;
  return (g[KEY] ??= new AbstentionProfile(ingestor));
}
