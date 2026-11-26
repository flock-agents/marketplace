/**
 * A small MCP server over stdio: one JSON-RPC message per line, in on stdin, out on stdout. It answers
 * initialize, ping, tools/list and tools/call; logs go to stderr, never stdout.
 */
import { createInterface } from "readline";

export interface Tool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  run(args: Record<string, unknown>): Promise<Record<string, unknown>>;
}

export interface ServerInfo { name: string; version: string }

/** A tool's answer as MCP carries it: the JSON as text and as structured content, a QR code also as an image. */
export function toolResult(result: Record<string, unknown>): Record<string, unknown> {
  const content: Array<Record<string, unknown>> = [{ type: "text", text: JSON.stringify(result) }];
  const qr = (result.link as { qrImage?: string } | undefined)?.qrImage;
  const png = typeof qr === "string" && qr.startsWith("data:image/png;base64,") ? qr.slice("data:image/png;base64,".length) : "";
  if (png) content.push({ type: "image", data: png, mimeType: "image/png" });
  return { content, structuredContent: result };
}

export function toolError(error: { error: string; message: string }): Record<string, unknown> {
  return { content: [{ type: "text", text: JSON.stringify(error) }], structuredContent: error, isError: true };
}

/** Answers one JSON-RPC message; null for a notification. */
export async function handle(msg: any, tools: Tool[], info: ServerInfo, onError: (e: unknown) => { error: string; message: string }): Promise<Record<string, unknown> | null> {
  const id = msg?.id;
  const reply = (result: unknown) => ({ jsonrpc: "2.0", id, result });
  const error = (code: number, message: string) => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });
  if (!msg || msg.jsonrpc !== "2.0" || typeof msg.method !== "string") return error(-32600, "Invalid request");
  if (id === undefined) return null;
  switch (msg.method) {
    case "initialize":
      return reply({
        protocolVersion: typeof msg.params?.protocolVersion === "string" ? msg.params.protocolVersion : "2025-06-18",
        capabilities: { tools: {} },
        serverInfo: info,
      });
    case "ping":
      return reply({});
    case "tools/list":
      return reply({ tools: tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) });
    case "tools/call": {
      const tool = tools.find((t) => t.name === msg.params?.name);
      if (!tool) return error(-32602, `Unknown tool: ${String(msg.params?.name)}`);
      const args = msg.params?.arguments && typeof msg.params.arguments === "object" ? msg.params.arguments : {};
      try { return reply(toolResult(await tool.run(args))); } catch (e) { return reply(toolError(onError(e))); }
    }
    default:
      return error(-32601, `Method not found: ${msg.method}`);
  }
}

/** Serves `tools` on stdin/stdout until stdin ends. Calls run side by side; each answer is one line. */
export function serveStdio(tools: Tool[], info: ServerInfo, onError: (e: unknown) => { error: string; message: string },
  io: { input: NodeJS.ReadableStream; output: { write(s: string): unknown } } = { input: process.stdin, output: process.stdout }): Promise<void> {
  const lines = createInterface({ input: io.input, crlfDelay: Infinity });
  const pending = new Set<Promise<void>>();
  lines.on("line", (line) => {
    if (!line.trim()) return;
    let msg: unknown;
    try { msg = JSON.parse(line); } catch { io.output.write(`${JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } })}\n`); return; }
    const p = handle(msg, tools, info, onError).then((out) => { if (out) io.output.write(`${JSON.stringify(out)}\n`); });
    pending.add(p);
    p.finally(() => pending.delete(p));
  });
  return new Promise((resolve) => lines.on("close", () => { Promise.allSettled([...pending]).then(() => resolve()); }));
}
