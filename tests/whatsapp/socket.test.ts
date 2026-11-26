// WhatsApp connector: how a connection is made (_socket.ts). Through Flock's egress only when Flock
// gives one, the low-data settings, the version with its fallback, and the saved link's folder.
//
// Run: bun test tests/whatsapp.
import { afterEach, describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import * as bundle from "../../skills/whatsapp/scripts/lib/baileys.bundle.js";
import { BROWSER, _resetVersionForTesting, authDirOf, clearAuth, historyFilter, isLinked, proxyOf, socketConfig, waVersion, type BaileysLib } from "../../skills/whatsapp/scripts/_socket";

const lib = bundle as unknown as BaileysLib;
const T = lib.proto.HistorySync.HistorySyncType;

class FakeAgent { constructor(public url: string) {} }
const fakeLib = { ...lib, HttpsProxyAgent: FakeAgent as any, makeCacheableSignalKeyStore: (k: any) => ({ cached: k }) } as BaileysLib;
const auth = { state: { creds: { me: null }, keys: { k: 1 } }, saveCreds: async () => {}, registered: () => true };
const config = (env: Record<string, string>) => socketConfig(fakeLib, { env, auth, version: [2, 3000, 1], logger: {} }) as any;

afterEach(() => _resetVersionForTesting());

describe("the egress proxy", () => {
  it("is used for the connection and for media/history fetches when Flock gives HTTPS_PROXY", () => {
    const c = config({ HTTPS_PROXY: "http://b1:pw@127.0.0.1:41234", HTTP_PROXY: "http://b1:pw@127.0.0.1:41234", NO_PROXY: "localhost,127.0.0.1" });
    expect(c.agent).toBeInstanceOf(FakeAgent);
    expect(c.agent.url).toBe("http://b1:pw@127.0.0.1:41234");
    expect(c.fetchAgent).toBe(c.agent);
  });

  it("is not set at all without HTTPS_PROXY: the connection goes direct, as the browser does off cloud", () => {
    const c = config({});
    expect("agent" in c).toBe(false);
    expect("fetchAgent" in c).toBe(false);
    expect(proxyOf({ https_proxy: "http://x:1" })).toBe("http://x:1");
    expect(proxyOf({ HTTP_PROXY: "http://only-http:1" })).toBe("");
  });

  it("the real proxy agent takes Flock's proxy URL", () => {
    const c = socketConfig(lib, { env: { HTTPS_PROXY: "http://b1:pw@127.0.0.1:41234" }, auth, version: [2, 3000, 1], logger: lib.pino({ level: "silent" }) }) as any;
    expect(c.agent).toBeInstanceOf(lib.HttpsProxyAgent);
    expect(String(c.agent.proxy)).toBe("http://b1:pw@127.0.0.1:41234/");
  });
});

describe("low data use", () => {
  it("never online, no link previews, no full history, status and channels ignored", () => {
    const c = config({});
    expect(c.markOnlineOnConnect).toBe(false);
    expect(c.generateHighQualityLinkPreview).toBe(false);
    expect(c.syncFullHistory).toBe(false);
    expect(c.shouldIgnoreJid("status@broadcast")).toBe(true);
    expect(c.shouldIgnoreJid("120363@newsletter")).toBe(true);
    expect(c.shouldIgnoreJid("919811111111@s.whatsapp.net")).toBe(false);
    expect(c.browser).toEqual(BROWSER);
    expect(c.auth.keys).toEqual({ cached: auth.state.keys });
  });

  it("history: only the chat list with a few recent messages, and contact names", () => {
    const keep = historyFilter(lib.proto);
    expect(keep({ syncType: T.INITIAL_BOOTSTRAP })).toBe(true);
    expect(keep({ syncType: T.PUSH_NAME })).toBe(true);
    for (const t of [T.RECENT, T.FULL, T.ON_DEMAND, T.INITIAL_STATUS_V3, T.NON_BLOCKING_DATA]) expect(keep({ syncType: t })).toBe(false);
  });
});

describe("WhatsApp Web's version", () => {
  it("is the current one when it can be had, kept for a while", async () => {
    let asked = 0;
    const l = { ...lib, fetchLatestWaWebVersion: async () => { asked++; return { version: [2, 3000, 99], isLatest: true }; } } as BaileysLib;
    expect(await waVersion(l, 1000)).toEqual([2, 3000, 99]);
    expect(await waVersion(l, 2000)).toEqual([2, 3000, 99]);
    expect(asked).toBe(1);
  });

  it("falls back to the bundled one", async () => {
    const l = { ...lib, fetchLatestWaWebVersion: async () => ({ version: [2, 3000, 1], isLatest: false }) } as BaileysLib;
    expect(await waVersion(l)).toEqual(lib.DEFAULT_CONNECTION_CONFIG.version);
    _resetVersionForTesting();
    const broken = { ...lib, fetchLatestWaWebVersion: async () => { throw new Error("offline"); } } as BaileysLib;
    expect(await waVersion(broken)).toEqual(lib.DEFAULT_CONNECTION_CONFIG.version);
    expect(lib.DEFAULT_CONNECTION_CONFIG.version).toEqual([2, 3000, 1043857760]);
  });
});

describe("the saved link", () => {
  it("is finished only once WhatsApp confirmed it, not when a code was only asked for", () => {
    expect(isLinked({ me: { id: "91@s.whatsapp.net", name: "~" }, pairingCode: "ABCD1234" })).toBe(false);
    expect(isLinked({ registered: true })).toBe(true);
    expect(isLinked({ account: { details: "x" } })).toBe(true);
  });

  it("lives in the data folder's auth/, and clearing deletes just its files", () => {
    const dir = mkdtempSync(join(tmpdir(), "wa-auth-"));
    try {
      const auth = authDirOf(dir);
      require("fs").mkdirSync(auth);
      writeFileSync(join(auth, "creds.json"), "{}");
      writeFileSync(join(dir, "store.json"), "{}");
      clearAuth(dir);
      expect(existsSync(auth)).toBe(false);
      expect(existsSync(join(dir, "store.json"))).toBe(true);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
