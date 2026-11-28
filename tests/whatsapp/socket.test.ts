// WhatsApp connector: how a connection is made (_socket.ts). Through Flock's egress only when Flock
// gives one, the low-data settings, the version with its fallback, and the saved link's folder.
//
// Run: bun test tests/whatsapp.
import { afterEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import * as bundle from "../../skills/whatsapp/server/lib/baileys.bundle.js";
import { BROWSER, _resetVersionForTesting, deviceNameOf, authDirOf, bunAtLeast, clearAuth, egressOf, historyFilter, isLinked, loadAuth, proxyOf, realSocketFactory, socketConfig, waVersion, type BaileysLib } from "../../skills/whatsapp/server/_socket";

const lib = bundle as unknown as BaileysLib;
const T = lib.proto.HistorySync.HistorySyncType;

class FakeAgent { constructor(public url: string) {} }
const fakeLib = { ...lib, HttpsProxyAgent: FakeAgent as any, makeCacheableSignalKeyStore: (k: any) => ({ cached: k }) } as BaileysLib;
const auth = { state: { creds: { me: null }, keys: { k: 1 } }, saveCreds: async () => {}, registered: () => true };
/** A Bun whose WebSocket honours the proxy, so these check the wiring whatever Bun runs them. */
const PROXY_BUN = "1.3.13";
const config = (env: Record<string, string>) => socketConfig(fakeLib, { env, auth, version: [2, 3000, 1], logger: {}, bunVersion: PROXY_BUN }) as any;

afterEach(() => _resetVersionForTesting());

describe("the egress proxy", () => {
  it("is the WebSocket's agent when Flock gives HTTPS_PROXY (Bun's fetch reads HTTPS_PROXY itself, so no fetch agent)", () => {
    const c = config({ HTTPS_PROXY: "http://b1:pw@127.0.0.1:41234", HTTP_PROXY: "http://b1:pw@127.0.0.1:41234", NO_PROXY: "localhost,127.0.0.1" });
    expect(c.agent).toBeInstanceOf(FakeAgent);
    expect(c.agent.url).toBe("http://b1:pw@127.0.0.1:41234");
    expect("fetchAgent" in c).toBe(false);
  });

  it("refuses a NO_PROXY that would send WhatsApp around the egress", () => {
    const proxy = "http://127.0.0.1:41234";
    for (const noProxy of ["*", ".whatsapp.net", "whatsapp.com", "localhost,*.whatsapp.net", "web.whatsapp.com:443"]) {
      expect(() => egressOf({ HTTPS_PROXY: proxy, NO_PROXY: noProxy }, PROXY_BUN)).toThrow(/NO_PROXY/);
      expect(() => config({ HTTPS_PROXY: proxy, no_proxy: noProxy })).toThrow(/NO_PROXY/);
    }
    expect(egressOf({ HTTPS_PROXY: proxy, NO_PROXY: "localhost,127.0.0.1,notwhatsapp.com" }, PROXY_BUN)).toBe(proxy);
    expect(egressOf({ NO_PROXY: "*" })).toBe("");
  });

  it("refuses to connect on a Bun whose WebSocket would ignore the proxy, rather than go direct", () => {
    const proxy = "http://127.0.0.1:41234";
    for (const old of ["1.2.13", "1.2.99", "1.1.0", "0.9.0"]) expect(() => egressOf({ HTTPS_PROXY: proxy }, old)).toThrow(/around Flock's egress/);
    for (const ok of ["1.3.0", "1.3.12", "1.3.13", "1.4.0-canary.1", "2.0.0"]) expect(egressOf({ HTTPS_PROXY: proxy }, ok)).toBe(proxy);
    expect(egressOf({}, "1.2.13")).toBe("");
    expect(bunAtLeast("1.3.13")).toBe(true);
    expect(bunAtLeast("1.2.13")).toBe(false);
  });

  it("is not set at all without HTTPS_PROXY: the connection goes direct, as the browser does off cloud", () => {
    const c = config({});
    expect("agent" in c).toBe(false);
    expect("fetchAgent" in c).toBe(false);
    expect(proxyOf({ https_proxy: "http://x:1" })).toBe("http://x:1");
    expect(proxyOf({ HTTP_PROXY: "http://only-http:1" })).toBe("");
  });

  it("the real proxy agent takes Flock's proxy URL", () => {
    const c = socketConfig(lib, { env: { HTTPS_PROXY: "http://b1:pw@127.0.0.1:41234" }, auth, version: [2, 3000, 1], logger: lib.pino({ level: "silent" }), bunVersion: PROXY_BUN }) as any;
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
    expect(await waVersion(l, "", 1000)).toEqual([2, 3000, 99]);
    expect(await waVersion(l, "", 2000)).toEqual([2, 3000, 99]);
    expect(asked).toBe(1);
  });

  it("is asked through the egress proxy when there is one", async () => {
    const seen: any[] = [];
    const l = { ...lib, fetchLatestWaWebVersion: async (o: any) => { seen.push(o); return { version: [2, 3000, 99], isLatest: true }; } } as BaileysLib;
    await waVersion(l, "http://127.0.0.1:41234");
    expect(seen[0].proxy).toBe("http://127.0.0.1:41234");
    expect(seen[0].signal).toBeInstanceOf(AbortSignal);
    _resetVersionForTesting();
    await waVersion(l);
    expect("proxy" in seen[1]).toBe(false);
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

  it("its folder is the owner's only, even one made earlier with wider access", async () => {
    const dir = mkdtempSync(join(tmpdir(), "wa-auth-"));
    try {
      mkdirSync(authDirOf(dir), { mode: 0o755 });
      await loadAuth(lib, dir);
      expect(statSync(authDirOf(dir)).mode & 0o777).toBe(0o700);
    } finally { rmSync(dir, { recursive: true, force: true }); }
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

/** A pretend egress proxy on this machine: records each CONNECT it is asked for, then hangs up. Nothing reaches WhatsApp. */
function connectRecorder() {
  const asked: string[] = [];
  const server = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data(sock, d) { asked.push(d.toString().split("\r\n")[0]); sock.end(); } } });
  return { url: `http://127.0.0.1:${server.port}`, asked, stop: () => server.stop(true) };
}

describe.skipIf(!bunAtLeast(Bun.version))("the egress proxy, for real (a local stand-in proxy; nothing reaches WhatsApp)", () => {
  it("the real factory asks for the version and opens the WebSocket through the proxy", async () => {
    const proxy = connectRecorder();
    try {
      const creds = (bundle as any).initAuthCreds();
      const handle = { state: { creds, keys: { get: async () => ({}), set: async () => {} } }, saveCreds: async () => {}, registered: () => false };
      const sock = await realSocketFactory(lib, { HTTPS_PROXY: proxy.url })(handle);
      for (let i = 0; i < 100 && proxy.asked.length < 2; i++) await Bun.sleep(20);
      sock.end(undefined);
      expect(proxy.asked).toEqual(["CONNECT web.whatsapp.com:443 HTTP/1.1", "CONNECT web.whatsapp.com:443 HTTP/1.1"]);
    } finally { proxy.stop(); }
  });

  it("Bun's fetch, as Baileys' history and app-state downloads use it, goes through HTTPS_PROXY from the environment", async () => {
    const proxy = connectRecorder();
    try {
      const child = Bun.spawn(["bun", "-e", "await fetch('https://mmg.whatsapp.net/', { signal: AbortSignal.timeout(5000) }).catch(() => {})"], {
        env: { PATH: process.env.PATH ?? "", HTTPS_PROXY: proxy.url, NO_PROXY: "localhost,127.0.0.1" }, stdout: "ignore", stderr: "ignore",
      });
      await child.exited;
      expect(proxy.asked).toEqual(["CONNECT mmg.whatsapp.net:443 HTTP/1.1"]);
    } finally { proxy.stop(); }
  });
});

describe("who the connector says it is (the browser tuple)", () => {
  it("Chrome on Ubuntu for everyone, a real OS, never Flock", () => {
    expect(BROWSER).toEqual(["Ubuntu", "Chrome", "22.04.4"]);
    expect(BROWSER[0]).not.toMatch(/flock/i);
  });

  it("the name in Linked devices is what WhatsApp shows for a link code: <browser> (<OS>)", () => {
    expect(deviceNameOf(["Linux", "Chrome", "6.1.0"])).toBe("Chrome (Linux)");
    expect(deviceNameOf()).toBe("Chrome (Ubuntu)");
  });

  it("the link code's display is built the same way inside Baileys", () => {
    const bundleText = readFileSync(join(import.meta.dir, "../../skills/whatsapp/server/lib/baileys.bundle.js"), "utf8");
    expect(bundleText).toMatch(/companion_platform_display",attrs:\{\},content:`\$\{(\w+)\[1\]\} \(\$\{\1\[0\]\}\)`/);
  });
});
