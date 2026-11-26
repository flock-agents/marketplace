#!/usr/bin/env bun
/**
 * WhatsApp connector: a local MCP server Flock starts for each linked WhatsApp (one connection, one
 * person). Its data (the link, the stored chats, the limits) lives in MCP_DATA_DIR. Through Flock's
 * egress when HTTPS_PROXY is set, else direct.
 */
import * as lib from "./lib/baileys.bundle.js";
import { serveStdio } from "./_mcp";
import { whatsappTools } from "./_tools";
import { WhatsAppService, failureOf } from "./_whatsapp";
import { clearAuth, loadAuth, realSocketFactory, type BaileysLib } from "./_socket";
import { dataDirOf } from "./_limits";

const VERSION = "2.0.0";
const baileys = lib as unknown as BaileysLib;
const dataDir = dataDirOf();
const openSocket = realSocketFactory(baileys, process.env);

const service = new WhatsAppService({
  dataDir,
  openSocket,
  loadAuth: () => loadAuth(baileys, dataDir),
  clearAuth: () => clearAuth(dataDir),
  qrImage: (qr) => baileys.qrToDataURL(qr, { width: 384, margin: 2 }),
});

/** Closes an open WhatsApp session (and counts its time) before the process goes. */
const stop = (): never => {
  try { service.shutdown(); } catch (e) { console.error("[whatsapp] shutdown:", (e as Error)?.message ?? e); }
  process.exit(0);
};
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
process.on("unhandledRejection", (e) => { console.error("[whatsapp] unhandled:", (e as Error)?.message ?? e); });
await serveStdio(whatsappTools(service), { name: "whatsapp", version: VERSION }, failureOf);
stop();
