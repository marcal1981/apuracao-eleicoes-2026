// Leitura mínima de arquivos .zip (sem dependências): lista as entradas e abre uma delas como fluxo.
// Suporta "stored" e "deflate", inclusive ZIP64 (arquivos grandes do TSE).

import { open } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { createInflateRaw } from "node:zlib";
import type { Readable } from "node:stream";

export interface ZipEntry {
  name: string;
  method: number;
  compressedSize: number;
  size: number;
  localHeaderOffset: number;
}

const MAX32 = 0xffffffff;

export async function listZip(file: string): Promise<ZipEntry[]> {
  const fh = await open(file, "r");
  try {
    const { size } = await fh.stat();
    const tailLen = Math.min(size, 65_557 + 20);
    const tail = Buffer.alloc(tailLen);
    await fh.read(tail, 0, tailLen, size - tailLen);
    let eocd = -1;
    for (let i = tailLen - 22; i >= 0; i--) {
      if (tail.readUInt32LE(i) === 0x06054b50) {
        eocd = i;
        break;
      }
    }
    if (eocd < 0) throw new Error("arquivo .zip inválido (fim do diretório não encontrado)");
    let count = tail.readUInt16LE(eocd + 10);
    let cdSize = tail.readUInt32LE(eocd + 12);
    let cdOffset = tail.readUInt32LE(eocd + 16);
    if (cdOffset === MAX32 || cdSize === MAX32 || count === 0xffff) {
      const loc = eocd - 20;
      if (loc < 0 || tail.readUInt32LE(loc) !== 0x07064b50) throw new Error("arquivo .zip64 sem localizador");
      const z64Offset = Number(tail.readBigUInt64LE(loc + 8));
      const z64 = Buffer.alloc(56);
      await fh.read(z64, 0, 56, z64Offset);
      if (z64.readUInt32LE(0) !== 0x06064b50) throw new Error("arquivo .zip64 inválido");
      count = Number(z64.readBigUInt64LE(32));
      cdSize = Number(z64.readBigUInt64LE(40));
      cdOffset = Number(z64.readBigUInt64LE(48));
    }
    const cd = Buffer.alloc(cdSize);
    await fh.read(cd, 0, cdSize, cdOffset);
    const entries: ZipEntry[] = [];
    let p = 0;
    for (let n = 0; n < count && p + 46 <= cd.length; n++) {
      if (cd.readUInt32LE(p) !== 0x02014b50) break;
      const method = cd.readUInt16LE(p + 10);
      let compressedSize = cd.readUInt32LE(p + 20);
      let entrySize = cd.readUInt32LE(p + 24);
      const nameLen = cd.readUInt16LE(p + 28);
      const extraLen = cd.readUInt16LE(p + 30);
      const commentLen = cd.readUInt16LE(p + 32);
      let localHeaderOffset = cd.readUInt32LE(p + 42);
      const name = cd.toString("utf8", p + 46, p + 46 + nameLen);
      // Campo extra ZIP64: traz, nesta ordem, os valores que ficaram em 0xFFFFFFFF.
      let e = p + 46 + nameLen;
      const extraEnd = e + extraLen;
      while (e + 4 <= extraEnd) {
        const id = cd.readUInt16LE(e);
        const len = cd.readUInt16LE(e + 2);
        if (id === 0x0001) {
          let q = e + 4;
          if (entrySize === MAX32) (entrySize = Number(cd.readBigUInt64LE(q))), (q += 8);
          if (compressedSize === MAX32) (compressedSize = Number(cd.readBigUInt64LE(q))), (q += 8);
          if (localHeaderOffset === MAX32) localHeaderOffset = Number(cd.readBigUInt64LE(q));
        }
        e += 4 + len;
      }
      entries.push({ name, method, compressedSize, size: entrySize, localHeaderOffset });
      p = extraEnd + commentLen;
    }
    return entries;
  } finally {
    await fh.close();
  }
}

/** Abre uma entrada do .zip como fluxo de bytes descompactados. */
export async function openZipEntry(file: string, entry: ZipEntry): Promise<Readable> {
  const fh = await open(file, "r");
  const header = Buffer.alloc(30);
  try {
    await fh.read(header, 0, 30, entry.localHeaderOffset);
  } finally {
    await fh.close();
  }
  if (header.readUInt32LE(0) !== 0x04034b50) throw new Error(`entrada ${entry.name} inválida no .zip`);
  const start = entry.localHeaderOffset + 30 + header.readUInt16LE(26) + header.readUInt16LE(28);
  const raw = createReadStream(file, { start, end: start + entry.compressedSize - 1 });
  if (entry.method === 0) return raw;
  if (entry.method !== 8) throw new Error(`compressão ${entry.method} não suportada em ${entry.name}`);
  return raw.pipe(createInflateRaw());
}
