// The WhatsApp 2.x connector (a local stdio MCP server) inside Flock's REAL server code: installed by Flock's marketplace
// installer, connected by its one-tap connect route, started by its MCP manager, and called through the route agents use.
// No WhatsApp account, no model: the server never links, and every outbound connection it makes is refused except to
// this machine (_world.ts), so it reaches WhatsApp only through Flock's egress proxy, whose upstream is a fake that
// refuses every tunnel. The tests run in order and share one Flock.
// Last, with the connection deleted and the package installed again: an agent's first call in an owner turn connects it
// by itself (Flock's mcp-auto-connect.ts), with no tap and no hand-off.
// Run: tests/whatsapp/flock/run-flock.sh (skipped without FLOCK_SERVER_DIR).
import { describe, it, expect, beforeAll, afterAll, setDefaultTimeout } from "bun:test";
import { existsSync, readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { BUTLER, PA, PACKAGE_SRC, SKILL, alive, enabled, flockImport, removeTempFolders, serverStarts, shimNetworkCheck, startFlock, waitFor, type FlockWorld, type Start } from "./_world";

setDefaultTimeout(120_000);
const TOOLS = ["link", "link-status", "list-chats", "read-chat", "search", "send-message", "unlink"];
const FAMILY_CHAT = "Family";

let flock: FlockWorld;
let mgr: any;
let connectionId = "";
let accountId = "";
let pkgDir = "";
let dataDir = "";
/** Tool calls that reached the server, which counts each one in limits.json. */
let reached = 0;
let upstream: any;

const conn = () => mgr.getConnection(connectionId);
const latestStart = (): Start => { const all = serverStarts(connectionId); return all[all.length - 1]; };
const limits = () => JSON.parse(readFileSync(join(dataDir, "limits.json"), "utf8"));
const bindingOf = (s: Start) => new URL(s.env.HTTPS_PROXY).username;

async function pa(tool: string, args: Record<string, unknown> = {}) {
  const r = await flock.call(PA, tool, args);
  if (r.status === 200) reached++;
  return r;
}

describe.skipIf(!enabled)("the WhatsApp connector 2.x in Flock", () => {
  beforeAll(async () => {
    flock = await startFlock();
    mgr = (await flockImport("mcp-manager")).getMCPManager();
  });
  afterAll(async () => {
    await upstream?.close();
    const egress = await flockImport("browser/egress");
    egress.__setEgressLeaseSourceForTesting(null);
    delete process.env.FLOCK_HOST_KEY;
    await (await flockImport("browser/egress-proxy")).stopEgressProxy();
    await (await flockImport("mcp-manager")).shutdownMCPManager();
    removeTempFolders();
  });

  it("the stand-in: a server Flock starts can reach this machine only, never the internet directly", async () => {
    expect(await shimNetworkCheck()).toEqual({ publicIp: "ECONNREFUSED", loopback: "connected" });
  });

  describe("install", () => {
    it("Flock's marketplace installer installs the package from this branch's files, checksums matching", async () => {
      const result = await flock.installWhatsApp();
      expect(result).toMatchObject({ success: true, item: { slug: SKILL, type: "connector", version: "2.1.0" } });
      const { SKILLS_DIR } = await flockImport("skills-registry");
      pkgDir = join(SKILLS_DIR, SKILL);
      const { readChecksumManifest, computeChecksums, detectModifications } = await flockImport("marketplace/checksum");
      const shipped = JSON.parse(readFileSync(join(PACKAGE_SRC, ".flock-checksums.json"), "utf8")).files;
      expect(computeChecksums(PACKAGE_SRC)).toEqual(shipped);
      expect(readChecksumManifest(pkgDir).files).toEqual(shipped);
      expect(detectModifications(pkgDir)).toMatchObject({ modified: false, changes: { added: [], changed: [], deleted: [] } });
    });

    it("one-tap connect (no form, no envVars) makes a connection that runs the package's own server", async () => {
      const { getSkillRequirements } = await flockImport("skills-registry");
      const req = (getSkillRequirements(SKILL) ?? []).find((r: any) => r.type === "mcp_server");
      const { buildMcpRequirement } = await flockImport("installable-skills-bootstrap");
      expect(buildMcpRequirement(req.mcp).autoConnect).toBe(true);
      expect(req?.mcp).toMatchObject({ transport: "stdio", command: "bun", args: ["{packageDir}/server/server.ts"], egress: true, envVars: [] });

      const started = await flock.owner("POST", `/api/skills/${SKILL}/mcp-connect`, { agentId: PA });
      expect(started.status).toBe(202);
      connectionId = started.body.connectionId;
      let job: any = null;
      await waitFor(async () => {
        job = (await flock.owner("GET", `/api/skills/${SKILL}/mcp-connect/jobs/${started.body.jobId}`)).body.job;
        return job?.phase === "ready" || job?.phase === "error";
      }, 60_000, 200);
      expect(job).toMatchObject({ phase: "ready" });
      expect(conn()).toMatchObject({ transport: "stdio", serverCommand: "bun", serverArgs: ["{packageDir}/server/server.ts"], packageSkillId: SKILL, skillId: SKILL, enabled: true });
      accountId = (await flockImport("mcp-accounts")).mcpAccountOf(connectionId).accountId;
      expect(accountId).toBeTruthy();
    });
  });

  describe("start", () => {
    it("the server starts with {packageDir} filled in, and its own 0700 MCP_DATA_DIR", async () => {
      const r = await pa("link-status");
      expect(r.status).toBe(200);
      const start = latestStart();
      expect(start.argv).toEqual([join(pkgDir, "server", "server.ts")]);
      expect(start.env.MCP_PACKAGE_DIR).toBe(pkgDir);
      dataDir = join(flock.DATA_DIR, "mcp", "data", connectionId);
      expect(start.env.MCP_DATA_DIR).toBe(dataDir);
      expect(statSync(dataDir).mode & 0o777).toBe(0o700);
      expect(start.env.HTTPS_PROXY).toBeUndefined();
      const { getTimezone } = await flockImport("config");
      expect(start.env.FLOCK_TIMEZONE).toBe(getTimezone());
      expect(alive(start.pid)).toBe(true);
      expect(conn().pid).toBe(start.pid);
      mgr.flushToDiskSync();
      expect(readFileSync(join(flock.DATA_DIR, "mcp", "connections.json"), "utf8")).not.toContain(pkgDir);
    });

    it("tool discovery lists exactly the 7 tools", async () => {
      expect(conn().capabilities.tools.map((t: any) => t.name).sort()).toEqual([...TOOLS].sort());
      const listed = await mgr.sendJsonRpc(connectionId, "tools/list", {}, 15_000);
      expect(listed.tools.map((t: any) => t.name).sort()).toEqual([...TOOLS].sort());
    });

    it("generateSkill rewrote scripts/ and instructions.md, left server/ intact, and the server still restarts", async () => {
      const instructions = readFileSync(join(pkgDir, "instructions.md"), "utf8");
      expect(instructions).not.toBe(readFileSync(join(PACKAGE_SRC, "instructions.md"), "utf8"));
      expect(readdirSync(join(pkgDir, "scripts"))).toEqual(["mcp-call.sh"]);
      const { computeChecksums } = await flockImport("marketplace/checksum");
      const shipped = JSON.parse(readFileSync(join(PACKAGE_SRC, ".flock-checksums.json"), "utf8")).files;
      const now = computeChecksums(pkgDir);
      for (const [file, sum] of Object.entries(shipped)) if (file.startsWith("server/")) expect(now[file]).toBe(sum);

      const before = latestStart().pid;
      await mgr.restartServer(connectionId);
      const after = latestStart();
      expect(after.pid).not.toBe(before);
      expect(alive(before)).toBe(false);
      expect(after.argv).toEqual([join(pkgDir, "server", "server.ts")]);
      expect(conn().status).toBe("connected");
      const r = await pa("link-status");
      expect(r.status).toBe(200);
      expect(r.answer.linked).toBe(false);
    });
  });

  describe("calls through the agents' route", () => {
    it("link-status answers linked: false", async () => {
      const r = await pa("link-status");
      expect(r.status).toBe(200);
      expect(r.body.error).toBeUndefined();
      expect(r.answer).toMatchObject({ linked: false, chats: 0 });
    });

    it("list-chats answers NOT_LINKED, without opening any connection", async () => {
      const r = await pa("list-chats");
      expect(r.status).toBe(200);
      expect(r.answer).toMatchObject({ error: "NOT_LINKED" });
      expect(r.body.error.message).toContain("NOT_LINKED");
    });

    it("no tool call re-heals the registry (no \"healed requires\" log)", () => {
      expect(flock.callLogs.filter((l) => l.startsWith("[e2e] call ")).length).toBe(reached);
      expect(flock.callLogs.filter((l) => l.includes("healed requires"))).toEqual([]);
    });

    it("limits.json is kept in MCP_DATA_DIR, every call counted", () => {
      const state = limits();
      expect(state.calls).toHaveLength(reached);
      expect(state.sessions).toEqual([]);
      expect(state.paused).toBeNull();
    });
  });

  describe("the WhatsApp gate on MCP calls", () => {
    beforeAll(async () => {
      const { ownerPersonId } = await flockImport("access-list");
      const setup = await flockImport("family/whatsapp-setup");
      // Connected is not linked: with no code typed (link-status says linked: false), no family list can be saved.
      expect(setup.whatsappLinked(ownerPersonId())).toBe(false);
      expect(await setup.finishWhatsAppSetup(ownerPersonId(), { family: [FAMILY_CHAT] })).toMatchObject({ ok: false });
      // No WhatsApp account here: the connector's "linked: true" answer is stood in, through the gate's own hook.
      const gate = await flockImport("whatsapp-connector/gate");
      gate.afterWhatsAppCall({ skillId: SKILL, functionName: "link-status", agentId: PA, params: {}, preferredAccountId: accountId },
        { success: true, result: { linked: true, link: { phase: "linked" }, chats: 0 }, duration_ms: 0 });
      expect(setup.whatsappLinked(ownerPersonId())).toBe(true);
      const done = await setup.finishWhatsAppSetup(ownerPersonId(), { family: [FAMILY_CHAT] });
      expect(done).toEqual({ ok: true, family: [FAMILY_CHAT] });
      await setup._settledForTesting();
      const { readAgentConnection } = await flockImport("agent-connections");
      expect(readAgentConnection(SKILL, BUTLER)?.accounts).toContain(accountId);
      const choices = await flockImport("whatsapp-connector/choices");
      expect(choices.shareOf(BUTLER, accountId)).toBe(ownerPersonId());
    });

    it("Butler, holding the shared account, is refused send-message before the server is asked", async () => {
      const before = limits().calls.length;
      const r = await flock.call(BUTLER, "send-message", { chat: FAMILY_CHAT, text: "hello" });
      expect(r.status).toBe(403);
      expect(r.body.error_code).toBe("whatsapp_not_allowed");
      expect(r.body.error).toContain("can't send");
      expect(limits().calls.length).toBe(before);
    });

    it("Butler is refused read-chat of a chat not shared with it", async () => {
      const before = limits().calls.length;
      const r = await flock.call(BUTLER, "read-chat", { chat: "Mom" });
      expect(r.status).toBe(403);
      expect(r.body.error_code).toBe("whatsapp_not_allowed");
      expect(r.body.error).toContain("not a chat you may read");
      expect(limits().calls.length).toBe(before);
    });

    it("Butler's read-chat of the shared chat passes the gate and reaches the server", async () => {
      const r = await flock.call(BUTLER, "read-chat", { chat: FAMILY_CHAT });
      reached++;
      expect(r.status).toBe(200);
      expect(r.answer).toMatchObject({ error: "NOT_LINKED" });
      expect(limits().calls).toHaveLength(reached);
    });

    it("the person's own assistant calls link-status on its own account", async () => {
      const r = await pa("link-status");
      expect(r.status).toBe(200);
      expect(r.answer.linked).toBe(false);
      expect(limits().calls).toHaveLength(reached);
    });
  });

  describe("restart", () => {
    let killed: Start;
    let callsBeforeKill = 0;

    it("a killed server reads disconnected, with its MCP_DATA_DIR and limits left in place", async () => {
      killed = latestStart();
      callsBeforeKill = limits().calls.length;
      process.kill(killed.pid, "SIGKILL");
      expect(await waitFor(() => !alive(killed.pid) && conn().pid === null)).toBe(true);
      expect(conn().status).toBe("disconnected");
      expect(existsSync(dataDir)).toBe(true);
      expect(limits().calls.length).toBe(callsBeforeKill);
    });

    it("the next call starts it again, on the same MCP_DATA_DIR, its limits kept", async () => {
      const r = await pa("link-status");
      expect(r.status).toBe(200);
      expect(r.answer.linked).toBe(false);
      const now = latestStart();
      expect(now.pid).not.toBe(killed.pid);
      expect(alive(now.pid)).toBe(true);
      expect(now.env.MCP_DATA_DIR).toBe(dataDir);
      expect(conn().status).toBe("connected");
      expect(limits().calls.length).toBe(callsBeforeKill + 1);
    });
  });

  describe("egress", () => {
    it("not on cloud: no proxy in the server's env, and link tries WhatsApp directly (refused here), never a proxy", async () => {
      const { startFakeUpstream } = await import(`${process.env.FLOCK_SERVER_DIR}/tests/helpers/fake-upstream-proxy`);
      upstream = await startFakeUpstream();
      upstream.answerFor = () => 403;
      const start = latestStart();
      for (const k of ["HTTPS_PROXY", "HTTP_PROXY", "https_proxy", "http_proxy", "NO_PROXY"]) expect(start.env[k]).toBeUndefined();

      const t0 = Date.now();
      const r = await pa("link", { qr: true });
      expect(r.status).toBe(200);
      expect(r.answer).toMatchObject({ error: "CONNECT_FAILED" });
      expect(r.answer.message).toContain("wss://web.whatsapp.com/ws/chat' failed: Failed to connect");
      expect(r.answer.message).not.toContain("Proxy");
      expect(Date.now() - t0).toBeLessThan(40_000);
      expect(upstream.connects).toEqual([]);
      expect(alive(start.pid)).toBe(true);
    });

    it("on cloud with a lease: link's WhatsApp traffic goes through Flock's egress proxy to the lease's gateway", async () => {
      process.env.FLOCK_HOST_KEY = "test-host-key";
      const egress = await flockImport("browser/egress");
      const lease = {
        leaseId: "0123456789abcdef01234567", provider: "manual",
        proxy: { scheme: "http", host: "127.0.0.1", port: upstream.port, username: "zone-user", password: "zone-pass" },
        ip: "1.2.3.4", country: "IN", timezone: "Asia/Kolkata", locale: "en-IN",
      };
      egress.__setEgressLeaseSourceForTesting({
        fetchLease: async () => ({ kind: "lease", lease }),
        store: { load: () => null, save: () => {}, clear: () => {} },
        homeCountry: () => "IN",
      });
      await mgr.restartServer(connectionId);
      const start = latestStart();
      expect(start.env.HTTPS_PROXY).toMatch(/^http:\/\/[^:]+:[^@]+@127\.0\.0\.1:\d+\/$/);
      expect(start.env.HTTP_PROXY).toBe(start.env.HTTPS_PROXY);
      expect(start.env.NO_PROXY.split(",")).toEqual(expect.arrayContaining(["localhost", "127.0.0.1"]));
      expect(start.env.NO_PROXY.split(",").every((h: string) => ["localhost", "127.0.0.1", "::1"].includes(h))).toBe(true);
      const { isEgressBindingRegistered } = await flockImport("browser/egress-proxy");
      expect(await isEgressBindingRegistered(bindingOf(start))).toBe(true);

      const r = await pa("link", { qr: true });
      expect(r.status).toBe(200);
      expect(r.answer).toMatchObject({ error: "CONNECT_FAILED" });
      expect(r.answer.message).toContain("wss://web.whatsapp.com/ws/chat' failed: Proxy connection failed");
      const heads: string[] = upstream.connects;
      expect(heads.filter((h) => /^CONNECT web\.whatsapp\.com:443 HTTP\/1\.1/.test(h)).length).toBeGreaterThanOrEqual(2);
      const credential = `Basic ${Buffer.from("zone-user:zone-pass").toString("base64")}`;
      for (const h of heads) {
        expect(h).toMatch(/^CONNECT [a-z0-9.-]+\.whatsapp\.(com|net):443 HTTP\/1\.1/);
        expect(h).toContain(`Proxy-Authorization: ${credential}`);
      }
      expect(alive(start.pid)).toBe(true);
      expect(await isEgressBindingRegistered(bindingOf(start))).toBe(true);
    });

    it("on cloud, list-chats still answers NOT_LINKED without a single tunnel", async () => {
      const before = upstream.connects.length;
      const r = await pa("list-chats");
      expect(r.answer).toMatchObject({ error: "NOT_LINKED" });
      expect(upstream.connects.length).toBe(before);
    });

    it("the server stopped: its egress binding is released", async () => {
      const start = latestStart();
      const { isEgressBindingRegistered } = await flockImport("browser/egress-proxy");
      await mgr.stopServer(connectionId);
      expect(await waitFor(() => !alive(start.pid))).toBe(true);
      expect(await isEgressBindingRegistered(bindingOf(start))).toBe(false);
      const r = await pa("link-status");
      expect(r.status).toBe(200);
      expect(latestStart().pid).not.toBe(start.pid);
      expect(await isEgressBindingRegistered(bindingOf(latestStart()))).toBe(true);
    });
  });

  it("across every tool call of the run, the registry was never re-healed", () => {
    expect(flock.callLogs.filter((l) => l.includes("healed requires"))).toEqual([]);
  });

  describe("delete", () => {
    it("deleting the connection stops the server, deletes MCP_DATA_DIR and releases the egress binding", async () => {
      const start = latestStart();
      const { isEgressBindingRegistered } = await flockImport("browser/egress-proxy");
      expect(existsSync(dataDir)).toBe(true);
      const r = await flock.owner("DELETE", `/api/mcp/connections/${connectionId}`);
      expect(r.status).toBe(200);
      expect(await waitFor(() => !alive(start.pid))).toBe(true);
      expect(existsSync(dataDir)).toBe(false);
      expect(await isEgressBindingRegistered(bindingOf(start))).toBe(false);
      expect(mgr.getConnection(connectionId)).toBeFalsy();
    });
  });

  describe("first use, with nothing connected", () => {
    it("in an owner turn, the agent's first run_skill whatsapp link-status connects it on the spot and answers linked: false, with no hand-off", async () => {
      // Installed again by Flock's marketplace installer, and put on the PA as Flock's WhatsApp setup puts it
      // (family/whatsapp-setup.ts ensureConnector): nothing connected, nothing tapped.
      expect(await flock.installWhatsApp()).toMatchObject({ success: true });
      expect((await flockImport("skill-install")).installSkillOnAgent(PA, SKILL).ok).toBe(true);
      const { getSkill } = await flockImport("skills-registry");
      expect(getSkill(SKILL)?.mcpConnectionId).toBeFalsy();
      const ofSkill = () => mgr.listConnections().filter((c: any) => c.skillId === SKILL || c.packageSkillId === SKILL);
      expect(ofSkill()).toEqual([]);

      const { createSession } = await flockImport("sessions");
      const session = createSession(`wa-e2e-first-use-${Date.now()}`, PA);
      (await flockImport("owner-turn"))._testing.startOwnerWrittenTurn(session.id);
      const { _testInternals: handoffs } = await flockImport("agent-browser-handoff");
      const { listHandoffRequests } = await flockImport("handoff-requests");
      const before = { handoffs: handoffs.handoffIds().length, requests: listHandoffRequests().length };

      const { executeSkillFunction } = await flockImport("skill-executor");
      const r = await executeSkillFunction({ skillId: SKILL, functionName: "link-status", agentId: PA, sessionId: session.id, callerSessionId: session.id, params: {} });
      expect(r.error).toBeUndefined();
      expect(r.success).toBe(true);
      expect(JSON.parse(r.result.content[0].text)).toMatchObject({ linked: false });

      const conns = ofSkill();
      expect(conns).toHaveLength(1);
      expect(conns[0]).toMatchObject({ transport: "stdio", serverCommand: "bun", serverArgs: ["{packageDir}/server/server.ts"], packageSkillId: SKILL, skillId: SKILL, enabled: true });
      const start = serverStarts(conns[0].id).at(-1)!;
      expect(start.argv).toEqual([join(pkgDir, "server", "server.ts")]);
      expect(start.env.MCP_DATA_DIR).toBe(join(flock.DATA_DIR, "mcp", "data", conns[0].id));
      const { isAgentConnected } = await flockImport("connector-connect");
      expect(isAgentConnected(SKILL, PA)).toBe(true);
      expect({ handoffs: handoffs.handoffIds().length, requests: listHandoffRequests().length }).toEqual(before);
    });
  });
});
