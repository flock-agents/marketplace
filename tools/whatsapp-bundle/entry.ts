// What the WhatsApp connector's server takes from its libraries. `bun run build` bundles this into
// skills/whatsapp/scripts/lib/baileys.bundle.js, the one file the package ships.
export {
  default as makeWASocket, makeCacheableSignalKeyStore, initAuthCreds, BufferJSON, proto, DisconnectReason,
  fetchLatestWaWebVersion, DEFAULT_CONNECTION_CONFIG, useMultiFileAuthState, jidNormalizedUser,
} from "@whiskeysockets/baileys";
export { HttpsProxyAgent } from "https-proxy-agent";
export { default as pino } from "pino";
export { toDataURL as qrToDataURL } from "qrcode";
