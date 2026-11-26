// WhatsApp connector: the server as Flock runs it, `bun scripts/server.ts` over stdio, one JSON-RPC
// message a line. Not linked, so nothing here connects to WhatsApp.
//
// Run: bun test tests/whatsapp.
import { afterAll, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { handle } from "../../skills/whatsapp/scripts/_mcp";

const server = join(import.meta.dir, "../../skills/whatsapp/scripts/server.ts");
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
    expect(replies.get(1).result).toMatchObject({ protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "whatsapp", version: "2.0.0" } });
    const tools = replies.get(2).result.tools;
    expect(tools.map((t: any) => t.name)).toEqual(["link", "link-status", "list-chats", "read-chat", "search", "send-message", "unlink"]);
    for (const t of tools) { expect(t.inputSchema.type).toBe("object"); expect(t.description.length).toBeGreaterThan(10); }
    expect(tools.find((t: any) => t.name === "read-chat").inputSchema.required).toEqual(["chat"]);
    expect(replies.get(3).result).toEqual({});
    const status = replies.get(4).result;
    expect(status.isError).toBeUndefined();
    expect(status.structuredContent).toMatchObject({ linked: false, link: { phase: "none" } });
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
