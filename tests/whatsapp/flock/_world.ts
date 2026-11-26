/**
 * A Flock in this process for the WhatsApp 2.x connector runs: Flock's REAL server code from a crafo-claw checkout
 * (FLOCK_SERVER_DIR=<crafo-claw>/flock-app/server), on a temp DATA_DIR. Its own marketplace installer installs this repo's
 * package, its own one-tap connect route connects it, its own MCP manager starts the stdio server, and agents call it
 * through the route they use (/api/mcp/skills/:skillId/call, callSkillMcpTool). No WhatsApp account and no model.
 *
 * Only two things are stood in:
 *  - `bun`, as Flock starts the server by name: a shim first on PATH records each start (argv, env, cwd, pid) and runs
 *    the real bun under macOS sandbox-exec with every outbound connection refused except to this machine, so the
 *    server can reach Flock's egress proxy but never WhatsApp directly;
 *  - on the cloud runs, the egress lease (FWS) and the paid gateway behind it: a lease pointing at a fake upstream
 *    proxy (Flock's own tests/helpers/fake-upstream-proxy.ts) that records every CONNECT and refuses it.
 *
 * Run with run-flock.sh (Flock's test preload and an isolated FLOCK_HOME). Import it before anything of Flock's.
 */
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

export const SERVER = process.env.FLOCK_SERVER_DIR ?? "";
export const enabled = !!SERVER && process.platform === "darwin";
export const PACKAGE_SRC = join(import.meta.dir, "..", "..", "..", "skills", "whatsapp");
export const CATALOG = join(import.meta.dir, "..", "..", "..", "catalog.json");
export const SKILL = "whatsapp";
export const PA = "personal-assistant";
export const BUTLER = "butler";

if (enabled && !(process.env.FLOCK_HOME ?? "").includes("flock-test-")) {
  throw new Error(`REFUSING TO RUN: FLOCK_HOME (${process.env.FLOCK_HOME}) is not an isolated temp dir: run with run-flock.sh`);
}

/** Every outbound connection refused, except to this machine (Flock's egress proxy) and local sockets. */
const SANDBOX_PROFILE = [
  "(version 1)",
  "(allow default)",
  "(deny network-outbound)",
  '(allow network-outbound (remote ip "localhost:*"))',
  "(allow network-outbound (remote unix-socket))",
].join("");

export interface Start { pid: number; argv: string[]; env: Record<string, string>; cwd: string }

const shimDir = enabled ? mkdtempSync(join(tmpdir(), "flock-test-wa-shim-")) : "";
const startsDir = enabled ? join(shimDir, "starts") : "";
/** The temp folders this file made (each one by mkdtemp here), removed after the run. */
const madeHere: string[] = enabled ? [shimDir] : [];

export function removeTempFolders(): void {
  for (const dir of madeHere.splice(0)) rmSync(dir, { recursive: true, force: true });
}

/** Puts the `bun` shim first on PATH (see the header). Flock copies PATH into the server's env. */
function installBunShim(): void {
  mkdirSync(startsDir, { recursive: true });
  const shim = join(shimDir, "bun");
  writeFileSync(shim, [
    "#!/bin/sh",
    `d="${startsDir}/$$"`,
    'mkdir -p "$d"',
    'pwd > "$d/cwd"',
    'env -0 > "$d/env"',
    'for a in "$@"; do printf "%s\\0" "$a" >> "$d/argv"; done',
    'touch "$d/argv"',
    `exec /usr/bin/sandbox-exec -p '${SANDBOX_PROFILE}' "${process.execPath}" "$@"`,
    "",
  ].join("\n"));
  chmodSync(shim, 0o755);
  process.env.PATH = `${shimDir}:${process.env.PATH ?? ""}`;
}

/** Every start of a `bun` child Flock made so far, oldest first. */
export function starts(): Start[] {
  if (!existsSync(startsDir)) return [];
  const split0 = (s: string) => s.split("\0").filter((x, i, all) => x !== "" || i < all.length - 1);
  return readdirSync(startsDir).map(Number).sort((a, b) => a - b).map((pid) => {
    const d = join(startsDir, String(pid));
    const env = Object.fromEntries(split0(readFileSync(join(d, "env"), "utf8")).map((kv) => [kv.slice(0, kv.indexOf("=")), kv.slice(kv.indexOf("=") + 1)]));
    const argv = existsSync(join(d, "argv")) ? split0(readFileSync(join(d, "argv"), "utf8")) : [];
    return { pid, argv, env, cwd: readFileSync(join(d, "cwd"), "utf8").trim() };
  });
}

/** The starts of the connection's own server (Flock's test connection runs from a test-<id> folder). */
export const serverStarts = (connectionId: string): Start[] => starts().filter((s) => s.cwd.endsWith(`/${connectionId}`));

export const flockImport = (path: string) => import(`${SERVER}/src/${path}`);

export async function startFlock() {
  installBunShim();
  if (!/^\d+$/.test(process.env.PORT || "")) process.env.PORT = "39998";

  const { DATA_DIR, upsertAgent, resetConfigCache } = await flockImport("config");
  for (const dir of ["secrets", "sessions", "db", "security", "mcp", "skills"]) mkdirSync(join(DATA_DIR, dir), { recursive: true, mode: 0o700 });
  const AUTH = JSON.stringify({ username: "admin", passwordHash: "$2b$12$x", passwordStrong: true });
  writeFileSync(join(DATA_DIR, "auth.json"), AUTH);
  writeFileSync(join(DATA_DIR, "secrets", "auth.json"), AUTH);
  writeFileSync(join(DATA_DIR, "setup.json"), JSON.stringify({ complete: true, volumes: [] }));
  writeFileSync(join(DATA_DIR, "platform.json"), JSON.stringify({ github: { accounts: [] }, agents: [], projects: [], accounts: [] }));
  writeFileSync(join(DATA_DIR, "skills", "skills.json"), JSON.stringify({ version: 1, skills: [] }));
  resetConfigCache();

  const { initSessionsDb } = await flockImport("sessions-db");
  initSessionsDb();
  const { initializeVaultKey, isVaultUnlocked } = await flockImport("vault-key");
  if (!isVaultUnlocked()) initializeVaultKey("Test-WhatsApp-E2E-Vault-1!");

  const agent = (id: string, extra: Record<string, unknown> = {}) => {
    const dataPath = join(DATA_DIR, "agents", id);
    mkdirSync(join(dataPath, "memory"), { recursive: true });
    upsertAgent({ id, name: id, nickname: id, role: "main", model: "test", dataPath, executor: null, remote: null, telegram: null, skills: [], ...extra } as never);
  };
  agent(PA);
  agent(BUTLER, { useCaseTemplateId: "family-butler" });

  const { Hono } = await import(Bun.resolveSync("hono", SERVER));
  const { authenticate, authorizeRequest, csrfForCookieAuth } = await flockImport("api-auth");
  const { createSession: createAuthSession, sessionCookieName } = await flockImport("auth");
  const mcpRoutes = (await flockImport("routes/mcp")).default;
  const { skillConnectionRoutes } = await flockImport("routes/skill-connections");
  const app = new Hono();
  app.use("*", authenticate);
  app.use("/api/*", authorizeRequest);
  app.use("/api/*", csrfForCookieAuth);
  app.route("/api", mcpRoutes);
  app.route("/api", skillConnectionRoutes);
  app.post("/__login", (c: any) => { createAuthSession(c, "admin"); return c.json({ ok: true }); });
  const login = await app.request("/__login", { method: "POST" });
  const cookie = (login.headers.getSetCookie().find((ck: string) => ck.startsWith(`${sessionCookieName()}=`)) || "").split(";")[0];
  if (!cookie) throw new Error("no owner session cookie");

  const ownerHeaders = { Cookie: cookie, "sec-fetch-site": "same-origin", "Content-Type": "application/json" };
  /** One owner request to Flock's API, as the dashboard makes it. */
  async function owner(method: string, path: string, body?: unknown): Promise<{ status: number; body: any }> {
    const res = await app.request(path, { method, headers: ownerHeaders, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const text = await res.text();
    let parsed: any = text;
    try { parsed = JSON.parse(text); } catch { /* not JSON */ }
    return { status: res.status, body: parsed };
  }

  const { createSession } = await flockImport("sessions");
  const { generateToken } = await flockImport("token-store");
  /** What Flock logged (console.warn / console.log) during each tool call, for the tests to read. */
  const callLogs: string[] = [];
  /** One tool call as an agent makes it: POST /api/mcp/skills/whatsapp/call with its own token, in a chat of its own. */
  async function call(agentId: string, tool: string, args: Record<string, unknown> = {}): Promise<{ status: number; body: any; answer: any }> {
    const session = createSession(`wa-e2e-${agentId}-${Math.random().toString(36).slice(2)}`, agentId);
    const { warn, log } = console;
    const record = (orig: (...a: unknown[]) => void) => (...a: unknown[]) => { callLogs.push(a.map(String).join(" ")); orig(...a); };
    callLogs.push(`[e2e] call ${agentId} ${tool}`);
    console.warn = record(warn);
    console.log = record(log);
    const res = await app.request(`/api/mcp/skills/${SKILL}/call`, {
      method: "POST",
      headers: { Authorization: `Bearer ${generateToken(agentId, session.id)}`, "X-Session-Id": session.id, "Content-Type": "application/json" },
      body: JSON.stringify({ tool, arguments: args }),
    });
    const body: any = await res.json().finally(() => { console.warn = warn; console.log = log; });
    let answer: any = null;
    const text = body?.result?.content?.find?.((c: any) => c?.type === "text")?.text;
    if (typeof text === "string") { try { answer = JSON.parse(text); } catch { answer = text; } }
    if (process.env.WA_DEBUG) console.log(`[${agentId} ${tool}]`, res.status, JSON.stringify(body).slice(0, 600));
    return { status: res.status, body, answer };
  }

  /** Installs this repo's package the way the marketplace installs it: Flock's installer, from the package's files. */
  async function installWhatsApp(): Promise<any> {
    const dir = mkdtempSync(join(tmpdir(), "flock-test-wa-pkg-"));
    madeHere.push(dir);
    cpSync(PACKAGE_SRC, dir, { recursive: true });
    const catalog = JSON.parse(readFileSync(CATALOG, "utf8"));
    const item = catalog.items.find((i: any) => i.slug === SKILL);
    const { installSkill } = await flockImport("marketplace/installer");
    return installSkill(SKILL, dir, item);
  }

  return { DATA_DIR, owner, call, callLogs, installWhatsApp };
}

export type FlockWorld = Awaited<ReturnType<typeof startFlock>>;

export async function waitFor(check: () => boolean | Promise<boolean>, ms = 15_000, stepMs = 50): Promise<boolean> {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (await check()) return true;
    await Bun.sleep(stepMs);
  }
  return !!(await check());
}

export const alive = (pid: number): boolean => { try { process.kill(pid, 0); return true; } catch { return false; } };

/** What a child started through the shim gets when it connects to a public address and to this machine. */
export async function shimNetworkCheck(): Promise<{ publicIp: string; loopback: string }> {
  const local = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("here") });
  const probe = (host: string, port: number) =>
    `const s = require("net").connect(${port}, "${host}"); const done = (w) => { console.log(w); process.exit(0); }; s.on("connect", () => done("connected")); s.on("error", (e) => done(e.code)); setTimeout(() => done("timeout"), 5000);`;
  const run = async (code: string) => {
    const p = Bun.spawn([join(shimDir, "bun"), "-e", code], { stdout: "pipe", stderr: "ignore", env: process.env });
    return (await new Response(p.stdout).text()).trim();
  };
  try {
    return { publicIp: await run(probe("1.1.1.1", 443)), loopback: await run(probe("127.0.0.1", local.port)) };
  } finally {
    local.stop(true);
  }
}
