// WhatsApp connector, the one live check: the real server connects to WhatsApp with a throwaway link
// folder and gets as far as the first QR code. No number is ever given, so nobody's phone is asked
// anything. Off unless WHATSAPP_LIVE=1 (it reaches web.whatsapp.com); WHATSAPP_LIVE_PROXY routes it
// through a proxy as Flock's egress would.
//
// Run: WHATSAPP_LIVE=1 bun test tests/whatsapp/live.test.ts
import { afterAll, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const live = process.env.WHATSAPP_LIVE === "1";
const dataDir = mkdtempSync(join(tmpdir(), "wa-live-"));
afterAll(() => rmSync(dataDir, { recursive: true, force: true }));

it.skipIf(!live)("connects to WhatsApp and gets a QR code picture, through the proxy when given one", async () => {
  const proxy = process.env.WHATSAPP_LIVE_PROXY;
  const env: Record<string, string> = { PATH: process.env.PATH ?? "", MCP_DATA_DIR: dataDir, ...(proxy ? { HTTPS_PROXY: proxy, HTTP_PROXY: proxy, NO_PROXY: "localhost,127.0.0.1" } : {}) };
  const proc = Bun.spawn(["bun", join(import.meta.dir, "../../skills/whatsapp/server/server.ts")], { stdin: "pipe", stdout: "pipe", stderr: "pipe", env });
  proc.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} })}\n${JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "link", arguments: { qr: true } } })}\n`);
  proc.stdin.end();
  const out = await new Response(proc.stdout).text();
  await proc.exited;
  const reply = out.split("\n").filter(Boolean).map((l) => JSON.parse(l)).find((m) => m.id === 2);
  const result = reply.result.structuredContent;
  expect(reply.result.isError).toBeUndefined();
  expect(result.link).toMatchObject({ phase: "waiting", mode: "qr" });
  expect(result.link.qrImage).toStartWith("data:image/png;base64,");
  expect(reply.result.content.map((c: any) => c.type)).toEqual(["text", "image"]);
}, 60_000);
