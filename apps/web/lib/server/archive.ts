// Persistência em disco: arquivos originais do TSE (imutáveis, com hash),
// série histórica de snapshots e trilha de auditoria.
// A interface é pequena de propósito, para ser trocada por PostgreSQL/Object Storage depois.

import { promises as fs } from "node:fs";
import path from "node:path";
import type { RaceResult, Snapshot } from "@apuracao/core";

const safe = (key: string) => key.replace(/[^a-z0-9_-]/gi, "_");

export class Archive {
  constructor(private readonly dir: string) {}

  private async append(file: string, line: unknown) {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.appendFile(file, JSON.stringify(line) + "\n", "utf8");
  }

  /** Guarda o arquivo original recebido, nomeado pelo horário de recebimento e hash. Nunca sobrescreve. */
  async saveRaw(electionCode: string, fileName: string, receivedAt: string, hash: string, body: string) {
    const dir = path.join(this.dir, "raw", safe(electionCode), safe(fileName.replace(/\.json$/, "")));
    await fs.mkdir(dir, { recursive: true });
    const file = path.join(dir, `${receivedAt.replace(/[:.]/g, "-")}-${hash.slice(0, 16)}.json`);
    await fs.writeFile(file, body, { encoding: "utf8", flag: "wx" }).catch((err: NodeJS.ErrnoException) => {
      if (err.code !== "EEXIST") throw err;
    });
  }

  async appendSnapshot(raceKey: string, snapshot: Snapshot) {
    await this.append(path.join(this.dir, "snapshots", `${safe(raceKey)}.ndjson`), snapshot);
  }

  async saveLatest(raceKey: string, data: unknown) {
    const file = path.join(this.dir, "latest", `${safe(raceKey)}.json`);
    await fs.mkdir(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(data), "utf8");
    await fs.rename(tmp, file);
  }

  async appendAudit(event: unknown) {
    await this.append(path.join(this.dir, "audit.ndjson"), event);
  }

  async loadLatest<T = RaceResult>(raceKey: string): Promise<T | null> {
    try {
      return JSON.parse(await fs.readFile(path.join(this.dir, "latest", `${safe(raceKey)}.json`), "utf8")) as T;
    } catch {
      return null;
    }
  }

  async loadSnapshots(raceKey: string, limit: number): Promise<Snapshot[]> {
    try {
      const text = await fs.readFile(path.join(this.dir, "snapshots", `${safe(raceKey)}.ndjson`), "utf8");
      return text
        .split("\n")
        .filter(Boolean)
        .slice(-limit)
        .map((l) => JSON.parse(l) as Snapshot);
    } catch {
      return [];
    }
  }

  /** Lista os arquivos originais guardados: um grupo por arquivo do TSE, com todas as versões recebidas. */
  async listRaw(): Promise<RawFileGroup[]> {
    const root = path.join(this.dir, "raw");
    const groups: RawFileGroup[] = [];
    const elections = await fs.readdir(root).catch(() => [] as string[]);
    for (const election of elections) {
      const files = await fs.readdir(path.join(root, election)).catch(() => [] as string[]);
      for (const file of files) {
        const versions = await fs.readdir(path.join(root, election, file)).catch(() => [] as string[]);
        const items = await Promise.all(
          versions
            .filter((v) => v.endsWith(".json"))
            .map(async (v) => {
              const stat = await fs.stat(path.join(root, election, file, v));
              const m = /^(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2})-\d+Z-([0-9a-f]+)\.json$/.exec(v);
              return {
                path: `${election}/${file}/${v}`,
                receivedAt: m ? m[1]!.replace(/T(\d{2})-(\d{2})-(\d{2})/, "T$1:$2:$3") + "Z" : stat.mtime.toISOString(),
                hash: m?.[2] ?? "",
                size: stat.size,
              };
            }),
        );
        items.sort((a, b) => b.path.localeCompare(a.path));
        if (items.length) groups.push({ election, file, versions: items });
      }
    }
    return groups.sort((a, b) => a.file.localeCompare(b.file));
  }

  /** Lê um arquivo original pelo caminho relativo devolvido em listRaw (sem permitir sair da pasta). */
  async readRaw(relative: string): Promise<string | null> {
    if (!/^[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\/[A-Za-z0-9_.-]+\.json$/.test(relative)) return null;
    const root = path.join(this.dir, "raw");
    const file = path.resolve(root, relative);
    if (!file.startsWith(root + path.sep)) return null;
    return fs.readFile(file, "utf8").catch(() => null);
  }

  async readAudit(): Promise<string> {
    return fs.readFile(path.join(this.dir, "audit.ndjson"), "utf8").catch(() => "");
  }
}

export interface RawFileGroup {
  election: string;
  file: string;
  versions: { path: string; receivedAt: string; hash: string; size: number }[];
}
