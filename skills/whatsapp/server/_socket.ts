/**
 * WhatsApp: how a connection to WhatsApp is made (Baileys, the linked-device protocol, from the bundled
 * lib/baileys.bundle.js). Everything that keeps the data used low is set here:
 *  - through Flock's egress when Flock gives one (HTTPS_PROXY on a cloud Flock), else direct. Two ways,
 *    both needed: the WebSocket only takes the proxy as `agent` (Bun's ws ignores the environment), and
 *    every HTTPS fetch Baileys makes (the version, the history and app-state downloads) only through
 *    HTTPS_PROXY in the environment (Bun's fetch ignores an agent). A NO_PROXY that would let WhatsApp
 *    skip the egress is refused;
 *  - history: only the chat list with a few recent messages and contact names (no recent or full history);
 *  - never online (markOnlineOnConnect false), no link previews, no status updates, broadcasts or channels.
 * Media is never downloaded and profile pictures and presence are never asked for: no code here or in
 * the server calls them.
 */
import { spawnSync } from "child_process";
import { chmodSync, mkdirSync, readdirSync, rmdirSync, unlinkSync } from "fs";
import { platform, release } from "os";
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

/** The machine the connector runs on: the same one Flock's browser runs on. */
export interface Host { platform: string; release: string; macVersion(): string }

/** Baileys' names for an OS (its `Browsers`: "Mac OS", "Windows"); a Linux host says just "Linux". */
const OS_NAMES: Record<string, string> = { linux: "Linux", darwin: "Mac OS", win32: "Windows", freebsd: "FreeBSD", openbsd: "OpenBSD", aix: "AIX", sunos: "Solaris" };

/** macOS's own version (15.4), or "" when it cannot be read. */
const macProductVersion = (): string => {
  try { return spawnSync("sw_vers", ["-productVersion"], { encoding: "utf8", timeout: 2_000 }).stdout?.trim() ?? ""; } catch { return ""; }
};

const thisHost: Host = { platform: platform(), release: release(), macVersion: macProductVersion };

/**
 * Who the connector says it is, as Baileys' [OS, browser, OS version]: Chrome on the machine's real OS,
 * as Flock's browser is (Linux on a cloud Flock, macOS on a Mac), never a made-up one. macOS gives its
 * own version (the kernel's means nothing to a person), any other OS its kernel release.
 */
export function browserOf(host: Host = thisHost): [string, string, string] {
  const os = OS_NAMES[host.platform] ?? host.platform;
  const version = host.platform === "darwin" ? host.macVersion() || host.release : host.release;
  return [os, "Chrome", version];
}

/** This machine's tuple, worked out once. */
export const BROWSER = browserOf();

/** The device name the person sees in Linked devices: WhatsApp shows a link code's device as
 *  "<browser> (<OS>)", such as "Chrome (Linux)". */
export const deviceNameOf = (browser: readonly string[] = BROWSER): string => `${browser[1]} (${browser[0]})`;

/** The egress proxy Flock gives this server, or "" for direct. */
export const proxyOf = (env: Record<string, string | undefined>): string => env.HTTPS_PROXY || env.https_proxy || "";

const WHATSAPP_HOSTS = ["web.whatsapp.com", "mmg.whatsapp.net", "media.whatsapp.net"];

/** Whether a NO_PROXY entry sends `host` direct: "*", the host itself, or a domain it is in. */
function bypasses(entry: string, host: string): boolean {
  const e = entry.trim().toLowerCase().replace(/:\d+$/, "").replace(/^\*?\./, "");
  return e === "*" || host === e || host.endsWith(`.${e}`);
}

/** The oldest Bun whose WebSocket honours a proxy `agent`: Bun 1.2.13 ignores it and would go direct. */
export const MIN_PROXY_BUN = [1, 3, 0];

/** Whether Bun `version` (such as "1.3.13") is at least `min`. */
export function bunAtLeast(version: string, min: number[] = MIN_PROXY_BUN): boolean {
  const parts = version.split(/[.-]/).slice(0, 3).map((p) => parseInt(p, 10) || 0);
  for (let i = 0; i < min.length; i++) if ((parts[i] ?? 0) !== min[i]) return (parts[i] ?? 0) > min[i];
  return true;
}

/**
 * The egress proxy, after checking nothing would go around it: NO_PROXY leaves none of WhatsApp's hosts
 * direct, and this Bun's WebSocket honours the proxy (an older one would quietly connect direct).
 */
export function egressOf(env: Record<string, string | undefined>, bunVersion: string = Bun.version): string {
  const proxy = proxyOf(env);
  if (!proxy) return "";
  const noProxy = `${env.NO_PROXY ?? ""},${env.no_proxy ?? ""}`.split(",").filter((e) => e.trim());
  if (WHATSAPP_HOSTS.some((h) => noProxy.some((e) => bypasses(e, h)))) {
    throw new Error("NO_PROXY would send WhatsApp around Flock's egress, so nothing connects.");
  }
  if (!bunAtLeast(bunVersion)) {
    throw new Error(`Bun ${bunVersion} would connect to WhatsApp around Flock's egress (its WebSocket ignores the proxy), so nothing connects. Bun ${MIN_PROXY_BUN.join(".")} or newer is needed.`);
  }
  return proxy;
}

/** Only the chat list with a few recent messages, and contact names: nothing older is fetched. */
export function historyFilter(proto: any): (n: { syncType?: number }) => boolean {
  const T = proto.HistorySync.HistorySyncType;
  return ({ syncType }) => syncType === T.INITIAL_BOOTSTRAP || syncType === T.PUSH_NAME;
}

/** Baileys' settings for one connection. */
export function socketConfig(lib: BaileysLib, opts: { env: Record<string, string | undefined>; auth: AuthHandle; version: number[]; logger: any; bunVersion?: string }): Record<string, unknown> {
  const proxy = egressOf(opts.env, opts.bunVersion);
  const agent = proxy ? new lib.HttpsProxyAgent(proxy) : undefined;
  return {
    version: opts.version,
    auth: { creds: opts.auth.state.creds, keys: lib.makeCacheableSignalKeyStore(opts.auth.state.keys, opts.logger) },
    logger: opts.logger,
    browser: BROWSER,
    ...(agent ? { agent } : {}),
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

/** WhatsApp Web's current version (from web.whatsapp.com, through `proxy` when given), kept for 12
 *  hours; the bundled one when it cannot be had. */
export async function waVersion(lib: BaileysLib, proxy = "", now = Date.now()): Promise<number[]> {
  if (cachedVersion && now - cachedVersion.at < VERSION_TTL_MS) return cachedVersion.version;
  let version = lib.DEFAULT_CONNECTION_CONFIG.version;
  try {
    const latest = await lib.fetchLatestWaWebVersion({ signal: AbortSignal.timeout(10_000), ...(proxy ? { proxy } : {}) });
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
  chmodSync(dir, 0o700);
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
    const version = await waVersion(lib, egressOf(env));
    return lib.makeWASocket(socketConfig(lib, { env, auth, version, logger }));
  };
}

/** Whether saved credentials are a finished link: WhatsApp confirmed the pairing (a link code sets
 *  `registered`; any finished pairing leaves the signed `account`). A link code only asked for is not one. */
export const isLinked = (creds: any): boolean => !!(creds?.registered || creds?.account);
