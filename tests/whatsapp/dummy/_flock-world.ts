/**
 * A Flock in this process for the dummy WhatsApp runs: Flock's REAL server app (its routes, auth,
 * browser tool, agent windows and profiles, skill executor and /api/internal/browser-fetch) from a
 * crafo-claw checkout, with a real Chromium. Only these are stood in:
 * - the browser launch: every request of every context is answered by the dummy WhatsApp Web for
 *   its host and ABORTED for any other host, so nothing leaves this machine;
 * - the owner's turn: always running (as when the owner asked in their own chat), and the person's
 *   yes to linking WhatsApp given (sign-in-yes.ts);
 * - waking a chat: recorded, as no chat process runs here.
 *
 * FLOCK_SERVER_DIR=<crafo-claw>/flock-app/server, run with that checkout's test preload and the
 * env its .env.test sets: see run-flock.sh. Import it first, before anything of Flock's.
 */
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type { WhatsAppDummy } from "./site";

export const SERVER = process.env.FLOCK_SERVER_DIR ?? "";
export const enabled = !!SERVER;
const SKILL_SRC = join(import.meta.dir, "..", "..", "..", "skills", "whatsapp");

if (enabled && !(process.env.FLOCK_HOME ?? "").includes("flock-test-")) {
  throw new Error(`REFUSING TO RUN: FLOCK_HOME (${process.env.FLOCK_HOME}) is not an isolated temp dir: run with run-flock.sh`);
}

const dummies = new Map<string, WhatsAppDummy>();
/** `dummy` answers every request to `host` in Flock's browsers. */
export function serveDummy(host: string, dummy: WhatsAppDummy): void { dummies.set(host, dummy); }

/** Requests that reached no dummy (and were aborted): a test checks there are none to an unexpected host. */
export const aborted: string[] = [];
export const wakes: string[] = [];

async function answerFromDummy(route: any): Promise<void> {
  const request = route.request();
  const url = new URL(request.url());
  const dummy = dummies.get(url.host);
  if (!dummy) { aborted.push(url.href); await route.abort(); return; }
  const body = request.postData();
  const res = await dummy.handle(new Request(url.href, { method: request.method(), headers: request.headers(), ...(body ? { body } : {}) }));
  await route.fulfill({ status: res.status, headers: Object.fromEntries(res.headers), body: await res.text() });
}

async function serving<C extends { route: (url: string, handler: (route: any) => unknown) => Promise<unknown> }>(context: C): Promise<C> {
  await context.route("**/*", answerFromDummy);
  return context;
}

/** The stand-ins (see the header). Await it at the test file's top level: a mock made inside a hook
 *  is undone when that hook ends (tests/helpers/mock-module.ts). */
export async function standIns(): Promise<void> {
  const { mockerKeepingRealExports } = await import(`${SERVER}/tests/helpers/mock-module`);
  const mock = mockerKeepingRealExports(join(SERVER, "tests"));
  const realBrowserUtils = { ...(await import(`${SERVER}/src/browser/browser-utils`)) };
  await mock("../src/browser/browser-utils", () => ({
    ...realBrowserUtils,
    getPlaywright: async () => {
      const playwright = await realBrowserUtils.getPlaywright();
      return {
        chromium: {
          ...playwright.chromium,
          executablePath: () => playwright.chromium.executablePath(),
          launch: async (options: any) => {
            const browser = await playwright.chromium.launch(options);
            const newContext = browser.newContext.bind(browser);
            browser.newContext = async (o?: any) => serving(await newContext(o));
            return browser;
          },
          launchPersistentContext: async (dir: string, options: any) => serving(await playwright.chromium.launchPersistentContext(dir, { ...options, serviceWorkers: "block" })),
        },
      };
    },
  }));
  await mock("../src/owner-turn", () => ({ isOwnerTurnRunning: () => true, isOutsiderTurnRunning: () => false }));
  await mock("../src/sign-in-yes", () => ({ personSaidYesToSignIn: () => true }));
  await mock("../src/runner", () => ({ sendMessage: (_s: string, text: string) => { wakes.push(text); return { ok: true }; } }));
}

export async function startFlock() {

  const { DATA_DIR, upsertAgent } = await import(`${SERVER}/src/config`);
  for (const dir of ["secrets", "sessions", "db", "security", join("secrets", "browser-sessions")]) mkdirSync(join(DATA_DIR, dir), { recursive: true, mode: 0o700 });
  const AUTH = JSON.stringify({ username: "admin", passwordHash: "$2b$12$x", passwordStrong: true });
  writeFileSync(join(DATA_DIR, "auth.json"), AUTH);
  writeFileSync(join(DATA_DIR, "secrets", "auth.json"), AUTH);
  writeFileSync(join(DATA_DIR, "setup.json"), JSON.stringify({ complete: true, volumes: [] }));
  const { initSessionsDb } = await import(`${SERVER}/src/sessions-db`);
  initSessionsDb();
  const { initializeVaultKey, isVaultUnlocked, ensureServerSecret } = await import(`${SERVER}/src/vault-key`);
  if (!isVaultUnlocked()) initializeVaultKey("Test-Password-12345!");
  ensureServerSecret();

  const { app } = await import(`${SERVER}/src/server`);
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: app.fetch, idleTimeout: 255 });
  process.env.PORT = String(server.port);

  const { generateAgentToken } = await import(`${SERVER}/src/token-store`);
  const { installSkill } = await import(`${SERVER}/src/marketplace/installer`);
  const { browser } = await import(`${SERVER}/src/model-runtime/flock-tools/browser`);
  const { createSession } = await import(`${SERVER}/src/sessions`);
  const { issueSessionKey, SESSION_KEY_HEADER } = await import(`${SERVER}/src/session-key`);

  /** Installs this repo's whatsapp package (with `loginUrl` when given) the way the marketplace installs it. */
  async function installWhatsApp(loginUrl?: string): Promise<void> {
    const dir = mkdtempSync(join(tmpdir(), "flock-test-wa-pkg-"));
    cpSync(SKILL_SRC, dir, { recursive: true });
    if (loginUrl) {
      const manifest = JSON.parse(readFileSync(join(dir, "flock.skill.json"), "utf8"));
      manifest.requires[0].loginUrl = loginUrl;
      writeFileSync(join(dir, "flock.skill.json"), JSON.stringify(manifest, null, 2));
    }
    const result = await installSkill("whatsapp", dir);
    if (!result?.success && result?.success !== undefined) throw new Error(`install failed: ${JSON.stringify(result)}`);
  }

  let seq = 0;
  /** An agent with the whatsapp skill on, and notes holding the owner's number, and a caller for its browser tool. */
  function agent(notes = "") {
    const id = `wa-agent-${++seq}`;
    const dataPath = join(DATA_DIR, "agents", id);
    mkdirSync(join(dataPath, "memory"), { recursive: true });
    if (notes) writeFileSync(join(dataPath, "memory", "owner.md"), notes);
    upsertAgent({ id, name: id, nickname: id, role: "worker", model: "test", dataPath, executor: null, remote: null, telegram: null, skills: [{ skillId: "whatsapp", enabled: true }] } as never);
    /** A new chat with this agent, and its browser tool. */
    const chat = () => {
      const sessionId: string = createSession(id, id, true, false, true).id;
      const caller = { agentId: id, sessionId, headers: { Authorization: `Bearer ${generateAgentToken(id)}`, "X-Flock-Session-Id": sessionId, [SESSION_KEY_HEADER]: issueSessionKey(sessionId) } };
      /** One browser tool call. Flock allows 30 window requests a minute per agent (routes/agent-browser.ts),
       *  and a test makes them faster than a model does: a 429 waits the minute out and goes again. */
      const tool = async (args: Record<string, unknown>): Promise<{ text: string; isError: boolean }> => {
        for (let tries = 0; ; tries++) {
          const result = await browser.run(caller as never, args);
          if (!/\(429\)/.test(result.text) || tries >= 2) return result;
          await Bun.sleep(30_000);
        }
      };
      return { id, sessionId, caller, tool };
    };
    return { ...chat(), chat };
  }

  return { server, DATA_DIR, installWhatsApp, agent, import: (path: string) => import(`${SERVER}/src/${path}`) };
}

export type FlockWorld = Awaited<ReturnType<typeof startFlock>>;
