/**
 * WhatsApp: how a connection to WhatsApp is made (Baileys, the linked-device protocol, from the bundled
 * lib/baileys.bundle.js). Everything that keeps the data used low is set here:
 *  - through Flock's egress when Flock gives one (HTTPS_PROXY on a cloud Flock), else direct;
 *  - history: only the chat list with a few recent messages and contact names (no recent or full history);
 *  - never online (markOnlineOnConnect false), no link previews, no status updates, broadcasts or channels.
 * Media is never downloaded and profile pictures and presence are never asked for: no code here or in
 * the server calls them.
 */
import { mkdirSync, readdirSync, rmdirSync, unlinkSync } from "fs";
import { join } from "path";
import { isIgnoredJid } from "./_messages";

/** The parts of a Baileys socket the server uses. */
export interface WASocketLike {
  ev: { on(event: string, fn: (arg: any) => void): void; off?(event: string, fn: (arg: any) => void): void };
  user?: { id?: string; name?: string } | null;
  requestPairingCode(phone: string): Promise<string>;
  sendMessage(jid: string, content: Record<string, unknown>): Promise<any>;
  logout(msg?: string): Promise<void>;
  end(error?: Error): void;
  groupFetchAllParticipating?(): Promise<Record<string, { id?: string; subject?: string }>>;
}

/** A connection's saved link: Baileys' credentials and keys in the data folder's auth/. */
export interface AuthHandle { state: { creds: any; keys: any }; saveCreds(): Promise<void>; registered(): boolean }

/** The bundled library, as far as the server uses it. */
export interface BaileysLib {
  default?: unknown;
  makeWASocket: (config: any) => WASocketLike;
  makeCacheableSignalKeyStore: (keys: any, logger: any) => any;
  useMultiFileAuthState: (dir: string) => Promise<{ state: { creds: any; keys: any }; saveCreds: () => Promise<void> }>;
  fetchLatestWaWebVersion: (opts?: any) => Promise<{ version: number[]; isLatest: boolean }>;
  DEFAULT_CONNECTION_CONFIG: { version: number[] };
  proto: any;
  HttpsProxyAgent: new (url: string) => unknown;
  pino: (opts: any) => any;
  qrToDataURL: (text: string, opts?: any) => Promise<string>;
}

/** The device name the person sees in Linked devices: "Chrome (Flock)". */
export const BROWSER: [string, string, string] = ["Flock", "Chrome", "2.0.0"];

/** The egress proxy Flock gives this server, or "" for direct. */
export const proxyOf = (env: Record<string, string | undefined>): string => env.HTTPS_PROXY || env.https_proxy || "";

/** Only the chat list with a few recent messages, and contact names: nothing older is fetched. */
export function historyFilter(proto: any): (n: { syncType?: number }) => boolean {
  const T = proto.HistorySync.HistorySyncType;
  return ({ syncType }) => syncType === T.INITIAL_BOOTSTRAP || syncType === T.PUSH_NAME;
}

/** Baileys' settings for one connection. */
export function socketConfig(lib: BaileysLib, opts: { env: Record<string, string | undefined>; auth: AuthHandle; version: number[]; logger: any }): Record<string, unknown> {
  const proxy = proxyOf(opts.env);
  const agent = proxy ? new lib.HttpsProxyAgent(proxy) : undefined;
  return {
    version: opts.version,
    auth: { creds: opts.auth.state.creds, keys: lib.makeCacheableSignalKeyStore(opts.auth.state.keys, opts.logger) },
    logger: opts.logger,
    browser: BROWSER,
    ...(agent ? { agent, fetchAgent: agent } : {}),
    connectTimeoutMs: 20_000,
    markOnlineOnConnect: false,
    syncFullHistory: false,
    shouldSyncHistoryMessage: historyFilter(lib.proto),
    generateHighQualityLinkPreview: false,
    shouldIgnoreJid: (jid: string) => isIgnoredJid(jid),
    getMessage: async () => undefined,
  };
}

const VERSION_TTL_MS = 12 * 60 * 60_000;
let cachedVersion: { version: number[]; at: number } | null = null;

/** WhatsApp Web's current version (from web.whatsapp.com, through the proxy as Bun's fetch reads
 *  HTTPS_PROXY), kept for 12 hours; the bundled one when it cannot be had. */
export async function waVersion(lib: BaileysLib, now = Date.now()): Promise<number[]> {
  if (cachedVersion && now - cachedVersion.at < VERSION_TTL_MS) return cachedVersion.version;
  let version = lib.DEFAULT_CONNECTION_CONFIG.version;
  try {
    const latest = await lib.fetchLatestWaWebVersion({ signal: AbortSignal.timeout(10_000) });
    if (latest?.isLatest && Array.isArray(latest.version) && latest.version.length === 3) version = latest.version;
  } catch { /* the bundled one */ }
  cachedVersion = { version, at: now };
  return version;
}

export function _resetVersionForTesting(): void { cachedVersion = null; }

/** The auth folder of a data folder. */
export const authDirOf = (dataDir: string) => join(dataDir, "auth");

/** Loads (or starts) the saved link in `dataDir`/auth. */
export async function loadAuth(lib: BaileysLib, dataDir: string): Promise<AuthHandle> {
  const dir = authDirOf(dataDir);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const { state, saveCreds } = await lib.useMultiFileAuthState(dir);
  return { state, saveCreds, registered: () => isLinked(state.creds) };
}

/** Deletes the saved link: each file of the auth folder, then the folder. */
export function clearAuth(dataDir: string): void {
  const dir = authDirOf(dataDir);
  let names: string[] = [];
  try { names = readdirSync(dir); } catch { return; }
  for (const name of names) { try { unlinkSync(join(dir, name)); } catch { /* gone */ } }
  try { rmdirSync(dir); } catch { /* not empty or gone */ }
}

/** The real factory: a Baileys socket on the saved link. */
export function realSocketFactory(lib: BaileysLib, env: Record<string, string | undefined>) {
  const logger = lib.pino({ level: env.WHATSAPP_LOG_LEVEL || "silent" });
  return async (auth: AuthHandle): Promise<WASocketLike> => {
    const version = await waVersion(lib);
    return lib.makeWASocket(socketConfig(lib, { env, auth, version, logger }));
  };
}

/** Whether saved credentials are a finished link: WhatsApp confirmed the pairing (a link code sets
 *  `registered`; any finished pairing leaves the signed `account`). A link code only asked for is not one. */
export const isLinked = (creds: any): boolean => !!(creds?.registered || creds?.account);
