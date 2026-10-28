import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/**
 * Senhas de acesso ao site. Ficam em <DATA_DIR>/acesso.json (só o hash, nunca a senha).
 * Sem nenhuma senha cadastrada (e sem SITE_PASSWORD no ambiente), o site fica aberto.
 * SITE_PASSWORD, se definida, vale como senha de administrador extra (útil para não perder o acesso).
 */

export type Role = "admin" | "viewer";
export interface AccessUser {
  id: string;
  name: string;
  role: Role;
  salt: string;
  hash: string;
  createdAt: string;
}
interface Store {
  secret: string;
  users: AccessUser[];
}
export interface Session {
  id: string;
  name: string;
  role: Role;
}

export const COOKIE = "acesso";
export const COOKIE_MAX_AGE = 60 * 60 * 24 * 30;
const ENV_ID = "env";

function dataDir(): string {
  const raw = (process.env.DATA_DIR ?? "").trim();
  return path.resolve(/* turbopackIgnore: true */ process.cwd(), raw && !/^[\s.]+$/.test(raw) ? raw : "data");
}
const file = () => path.join(dataDir(), "acesso.json");

let cache: { mtime: number; store: Store } | null = null;

function load(): Store {
  const f = file();
  let mtime = -1;
  try {
    mtime = fs.statSync(f).mtimeMs;
  } catch {}
  if (cache && cache.mtime === mtime) return cache.store;
  let store: Store;
  try {
    store = JSON.parse(fs.readFileSync(f, "utf8")) as Store;
  } catch {
    store = { secret: randomBytes(32).toString("hex"), users: [] };
  }
  cache = { mtime, store };
  return store;
}

function save(store: Store) {
  fs.mkdirSync(dataDir(), { recursive: true });
  const f = file();
  fs.writeFileSync(`${f}.tmp`, JSON.stringify(store, null, 2), { mode: 0o600 });
  fs.renameSync(`${f}.tmp`, f);
  cache = null;
}

const envPassword = () => {
  const v = (process.env.SITE_PASSWORD ?? "").trim();
  return v && !/^[\s.]+$/.test(v) ? v : null;
};

/** O site exige senha? */
export function protectionEnabled(): boolean {
  return !!envPassword() || load().users.length > 0;
}

const hashOf = (password: string, salt: string) => scryptSync(password, salt, 32).toString("hex");
const sign = (secret: string, id: string) => createHmac("sha256", secret).update(id).digest("hex");

/** Confere a senha digitada; devolve quem entrou. */
export function checkPassword(password: string): Session | null {
  const store = load();
  const env = envPassword();
  if (env && safeEqual(password, env)) return { id: ENV_ID, name: "Administrador (SITE_PASSWORD)", role: "admin" };
  for (const u of store.users) {
    if (safeEqual(hashOf(password, u.salt), u.hash)) return { id: u.id, name: u.name, role: u.role };
  }
  return null;
}

function safeEqual(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Valor do cookie para uma sessão. A secret garante que não dá para forjar. */
export function cookieFor(session: Session): string {
  const store = load();
  if (!store.users.length && session.id !== ENV_ID) return "";
  // A secret precisa existir no disco para o cookie continuar válido depois de reiniciar.
  if (!fs.existsSync(file())) save(store);
  return `${session.id}.${sign(store.secret, session.id)}`;
}

/** Lê o cookie: só vale se a assinatura confere e a senha ainda existe. */
export function sessionFrom(cookie: string | undefined): Session | null {
  if (!cookie) return null;
  const [id, sig] = cookie.split(".");
  if (!id || !sig) return null;
  const store = load();
  if (!safeEqual(sig, sign(store.secret, id))) return null;
  if (id === ENV_ID) return envPassword() ? { id, name: "Administrador (SITE_PASSWORD)", role: "admin" } : null;
  const u = store.users.find((x) => x.id === id);
  return u ? { id: u.id, name: u.name, role: u.role } : null;
}

export function listUsers(): Omit<AccessUser, "salt" | "hash">[] {
  return load().users.map(({ id, name, role, createdAt }) => ({ id, name, role, createdAt }));
}

export function addUser(name: string, password: string, role: Role): Session {
  const store = load();
  const salt = randomBytes(16).toString("hex");
  const user: AccessUser = { id: randomBytes(8).toString("hex"), name, role, salt, hash: hashOf(password, salt), createdAt: new Date().toISOString() };
  // Primeira senha: é sempre de administrador (senão ninguém conseguiria gerenciar).
  if (!store.users.length && !envPassword()) user.role = "admin";
  save({ ...store, users: [...store.users, user] });
  return { id: user.id, name: user.name, role: user.role };
}

/** Remove uma senha. Não deixa apagar o último administrador (o site ficaria sem dono). */
export function removeUser(id: string): string | null {
  const store = load();
  const target = store.users.find((u) => u.id === id);
  if (!target) return "Senha não encontrada.";
  const admins = store.users.filter((u) => u.role === "admin");
  if (target.role === "admin" && admins.length === 1 && !envPassword()) return "Não dá para remover o único administrador.";
  save({ ...store, users: store.users.filter((u) => u.id !== id) });
  return null;
}
