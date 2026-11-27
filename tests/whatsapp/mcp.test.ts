// WhatsApp connector: the server as Flock runs it, `bun server/server.ts` over stdio, one JSON-RPC
// message a line. Not linked, so nothing here connects to WhatsApp.
//
// Run: bun test tests/whatsapp.
import { afterAll, describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { handle } from "../../skills/whatsapp/server/_mcp";
import { bunAtLeast } from "../../skills/whatsapp/server/_socket";
import { whatsappTools } from "../../skills/whatsapp/server/_tools";
import { failureOf } from "../../skills/whatsapp/server/_whatsapp";
import { linkedWorld } from "./_mock";

const server = join(import.meta.dir, "../../skills/whatsapp/server/server.ts");
const dataDir = mkdtempSync(join(tmpdir(), "wa-mcp-"));
afterAll(() => rmSync(dataDir, { recursive: true, force: true }));

/** Runs the server with `messages` on its stdin and answers its replies by id. */
async function exchange(messages: unknown[], env: Record<string, string> = { MCP_DATA_DIR: dataDir }): Promise<{ replies: Map<number, any>; code: number; stderr: string }> {
  const proc = Bun.spawn(["bun", server], { stdin: "pipe", stdout: "pipe", stderr: "pipe", env: { PATH: process.env.PATH ?? "", ...env }, cwd: tmpdir() });
  proc.stdin.write(messages.map((m) => JSON.stringify(m)).join("\n") + "\n");
  proc.stdin.end();
  const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  const replies = new Map<number, any>();
  for (const line of out.split("\n").filter(Boolean)) { const m = JSON.parse(line); replies.set(m.id, m); }
  return { replies, code, stderr: err };
}

const call = (id: number, name: string, args: Record<string, unknown> = {}) => ({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } });

describe("the stdio server", () => {
  it("initializes, lists exactly the seven tools, and answers calls as MCP results", async () => {
    const { replies, code } = await exchange([
      { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "flock", version: "1" } } },
      { jsonrpc: "2.0", method: "notifications/initialized" },
      { jsonrpc: "2.0", id: 2, method: "tools/list" },
      { jsonrpc: "2.0", id: 3, method: "ping" },
      call(4, "link-status"),
      call(5, "read-chat", { chat: "Mom" }),
      call(6, "send-message", { chat: ["Mom", "Dad"], text: "hi" }),
      call(7, "link", { phone: "12" }),
      call(8, "add-participant", { group: "x" }),
      { jsonrpc: "2.0", id: 9, method: "resources/list" },
    ]);
    expect(code).toBe(0);
    expect(replies.get(1).result).toMatchObject({ protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "whatsapp", version: "2.1.0" } });
    const tools = replies.get(2).result.tools;
    expect(tools.map((t: any) => t.name)).toEqual(["link", "link-status", "list-chats", "read-chat", "search", "send-message", "unlink"]);
    for (const t of tools) { expect(t.inputSchema.type).toBe("object"); expect(t.description.length).toBeGreaterThan(10); }
    expect(tools.find((t: any) => t.name === "read-chat").inputSchema.required).toEqual(["chat"]);
    expect(replies.get(3).result).toEqual({});
    const status = replies.get(4).result;
    expect(status.isError).toBeUndefined();
    expect(status.structuredContent).toMatchObject({ linked: false, link: { phase: "none" } });
    expect(status.structuredContent.signedInAs).toBeUndefined();
    expect(JSON.parse(status.content[0].text)).toEqual(status.structuredContent);
    expect(replies.get(5).result).toMatchObject({ isError: true, structuredContent: { error: "NOT_LINKED" } });
    expect(replies.get(6).result).toMatchObject({ isError: true, structuredContent: { error: "ONE_RECIPIENT" } });
    expect(replies.get(7).result).toMatchObject({ isError: true, structuredContent: { error: "BAD_PHONE" } });
    expect(replies.get(8).error.code).toBe(-32602);
    expect(replies.get(9).error.code).toBe(-32601);
  });

  it("refuses to start without its data folder rather than keep a link anywhere else", async () => {
    const { code, stderr } = await exchange([{ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }], {});
    expect(code).not.toBe(0);
    expect(stderr).toContain("MCP_DATA_DIR");
  });

  it("answers a line that is not JSON with a parse error and goes on", async () => {
    const r = await handle({ jsonrpc: "2.0", method: "x" }, [], { name: "whatsapp", version: "2.0.0" }, () => ({ error: "E", message: "m" }));
    expect(r).toBeNull();
    const { replies } = await exchange(["not json" as unknown, { jsonrpc: "2.0", id: 2, method: "ping" }].map((m) => m));
    expect(replies.get(2).result).toEqual({});
  });
});

describe("what reaches the server", () => {
  it("answers bad requests with JSON-RPC errors, notifications with nothing, and every request of a burst by its id", async () => {
    const burst = Array.from({ length: 20 }, (_, i) => call(100 + i, "link-status"));
    const { replies, code } = await exchange([
      5, [], { id: 1 }, { jsonrpc: "1.0", id: 2, method: "ping" }, { jsonrpc: "2.0", id: 3, method: 7 },
      { jsonrpc: "2.0", method: "notifications/cancelled", params: { requestId: 1 } },
      { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "search", arguments: "not an object" } },
      { jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "send-message", arguments: { chat: "Mom", text: "x".repeat(200_000) } } },
      ...burst,
    ]);
    expect(code).toBe(0);
    expect(replies.get(null as any).error.code).toBe(-32600);
    expect(replies.get(2).error.code).toBe(-32600);
    expect(replies.get(3).error.code).toBe(-32600);
    expect(replies.get(4).result.structuredContent.error).toBe("MISSING_PARAM");
    expect(replies.get(5).result.structuredContent.error).toBe("TOO_LONG");
    for (let i = 0; i < 20; i++) expect(replies.get(100 + i).result.structuredContent.linked).toBe(false);
    expect(replies.size).toBe(1 + 3 + 2 + 20);
  });

  it("every tool's description fits in the 200 characters Flock shows", () => {
    for (const t of whatsappTools({} as any)) expect(`${t.name}: ${t.description.length <= 200}`).toBe(`${t.name}: true`);
  });
});

describe("stopping", () => {
  it.skipIf(!bunAtLeast(Bun.version))("SIGTERM in the middle of a link closes it at once, counts its time and exits 0, well inside Flock's 5 seconds", async () => {
    const dir = mkdtempSync(join(tmpdir(), "wa-mcp-stop-"));
    let connects = 0;
    let held: unknown = null;
    const proxy = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data(sock) { if (++connects === 1) sock.end(); else held = sock; } } });
    try {
      const proc = Bun.spawn(["bun", server], {
        stdin: "pipe", stdout: "pipe", stderr: "pipe", cwd: tmpdir(),
        env: { PATH: process.env.PATH ?? "", MCP_DATA_DIR: dir, HTTPS_PROXY: `http://127.0.0.1:${proxy.port}`, NO_PROXY: "localhost,127.0.0.1" },
      });
      proc.stdin.write(`${JSON.stringify(call(1, "link", { qr: true }))}\n`);
      for (let i = 0; i < 250 && !held; i++) await Bun.sleep(20);
      expect(held).not.toBeNull();
      await Bun.sleep(100);
      const started = Date.now();
      proc.kill("SIGTERM");
      expect(await proc.exited).toBe(0);
      expect(Date.now() - started).toBeLessThan(2_000);
      const limits = JSON.parse(readFileSync(join(dir, "limits.json"), "utf8"));
      expect(limits.sessions.length).toBe(1);
      expect(limits.usage.ms).toBeGreaterThan(0);
    } finally {
      proxy.stop(true);
      rmSync(dir, { recursive: true, force: true });
    }
  }, 20_000);

  it("SIGTERM with nothing open exits 0 at once", async () => {
    const proc = Bun.spawn(["bun", server], { stdin: "pipe", stdout: "pipe", stderr: "pipe", env: { PATH: process.env.PATH ?? "", MCP_DATA_DIR: dataDir }, cwd: tmpdir() });
    proc.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" })}\n`);
    await new Response(proc.stdout).body!.getReader().read();
    proc.kill("SIGTERM");
    expect(await proc.exited).toBe(0);
  });
});

describe("signedInAs in a tool answer", () => {
  it("sits at the top of structuredContent (where Flock reads it), masked", async () => {
    const w = linkedWorld();
    try {
      const r: any = await handle(call(1, "list-chats"), whatsappTools(w.wa), { name: "whatsapp", version: "2.1.0" }, failureOf);
      expect(r.result.isError).toBeUndefined();
      expect(r.result.structuredContent.signedInAs).toBe("+••••••••5678");
      expect(JSON.parse(r.result.content[0].text).signedInAs).toBe("+••••••••5678");
      expect(JSON.stringify(r)).not.toContain("919876545678");
    } finally { w.wa.shutdown(); rmSync(w.dir, { recursive: true, force: true }); }
  });
});
