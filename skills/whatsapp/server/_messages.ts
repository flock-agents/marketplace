/**
 * WhatsApp: a message as the connector keeps it. Text as written; a photo, video, voice message,
 * document or sticker as a short placeholder with what WhatsApp says about it (kind, caption, file
 * name, size). Media is never downloaded: nothing here reads a message's url or media key.
 */

export type MediaKind = "photo" | "video" | "voice" | "audio" | "document" | "sticker" | "location" | "contact" | "poll";

/** What a media message is, never its content. */
export interface MediaNote { kind: MediaKind; caption?: string; fileName?: string; size?: number }

/** One message as stored. `at` is ms since the epoch. */
export interface StoredMessage { id: string; at: number; fromJid: string; from: string; mine: boolean; text: string; media?: MediaNote }

/** The jids that are never a chat of the person's: status updates, broadcast lists, channels. */
export function isIgnoredJid(jid: string | null | undefined): boolean {
  if (!jid) return true;
  return jid === "status@broadcast" || jid.endsWith("@broadcast") || jid.endsWith("@newsletter");
}

export const isGroupJid = (jid: string): boolean => jid.endsWith("@g.us");

/** The wrappers WhatsApp puts around a message (disappearing, view once, edited, captioned document). */
function unwrap(m: any): any {
  for (let i = 0; i < 5 && m; i++) {
    const inner = m.ephemeralMessage?.message ?? m.viewOnceMessage?.message ?? m.viewOnceMessageV2?.message
      ?? m.viewOnceMessageV2Extension?.message ?? m.documentWithCaptionMessage?.message ?? m.editedMessage?.message;
    if (!inner) return m;
    m = inner;
  }
  return m;
}

/** A protobuf Long, a number or a numeric string as a number; undefined otherwise. */
export function toNumber(v: unknown): number | undefined {
  if (typeof v === "number") return Number.isFinite(v) ? v : undefined;
  if (typeof v === "string" && v.trim() && Number.isFinite(Number(v))) return Number(v);
  if (v && typeof v === "object" && typeof (v as any).toNumber === "function") return (v as any).toNumber();
  if (v && typeof v === "object" && typeof (v as any).low === "number") return ((v as any).high >>> 0) * 2 ** 32 + ((v as any).low >>> 0);
  return undefined;
}

const clean = (s: unknown): string | undefined => (typeof s === "string" && s.trim() ? s.trim() : undefined);

const MEDIA: Array<[string, MediaKind]> = [
  ["imageMessage", "photo"], ["videoMessage", "video"], ["documentMessage", "document"], ["stickerMessage", "sticker"],
  ["locationMessage", "location"], ["liveLocationMessage", "location"], ["contactMessage", "contact"], ["contactsArrayMessage", "contact"],
  ["pollCreationMessage", "poll"], ["pollCreationMessageV2", "poll"], ["pollCreationMessageV3", "poll"],
];

/** The placeholder of a media message, from what WhatsApp says about it only. */
export function mediaOf(content: any): MediaNote | undefined {
  if (content?.audioMessage) {
    const a = content.audioMessage;
    return { kind: a.ptt ? "voice" : "audio", ...(toNumber(a.fileLength) ? { size: toNumber(a.fileLength) } : {}) };
  }
  for (const [field, kind] of MEDIA) {
    const m = content?.[field];
    if (!m) continue;
    const note: MediaNote = { kind };
    const caption = clean(m.caption) ?? (kind === "poll" ? clean(m.name) : undefined) ?? (kind === "location" ? clean(m.name) : undefined);
    if (caption) note.caption = caption.slice(0, 500);
    const fileName = clean(m.fileName) ?? (kind === "contact" ? clean(m.displayName) : undefined);
    if (fileName) note.fileName = fileName.slice(0, 200);
    const size = toNumber(m.fileLength);
    if (size) note.size = size;
    return note;
  }
  return undefined;
}

/** What WhatsApp uses for housekeeping, never shown as a message. */
function isHousekeeping(content: any): boolean {
  if (!content) return true;
  if (content.protocolMessage || content.reactionMessage || content.pollUpdateMessage || content.keepInChatMessage) return true;
  if (content.senderKeyDistributionMessage && Object.keys(content).length === 1) return true;
  return false;
}

const MAX_TEXT = 4000;

/** The text a message shows: its words, else a placeholder such as `[photo]` with the caption. */
export function textOf(content: any, media?: MediaNote): string {
  const words = clean(content?.conversation) ?? clean(content?.extendedTextMessage?.text);
  if (words) return words.length > MAX_TEXT ? `${words.slice(0, MAX_TEXT)} [message cut, ${words.length} characters]` : words;
  if (media) return `[${media.kind}]${media.caption ? ` ${media.caption}` : ""}`;
  return "[message]";
}

/** The chat a message belongs to: the phone number jid when WhatsApp gives one beside a private id. */
export function chatJidOf(key: any): string {
  const jid = String(key?.remoteJid ?? "");
  const alt = String(key?.remoteJidAlt ?? "");
  return jid.endsWith("@lid") && alt.endsWith("@s.whatsapp.net") ? alt : jid;
}

/** Who sent it: the participant in a group, the chat itself in a private chat. */
export function senderJidOf(key: any, chatJid: string): string {
  if (!isGroupJid(chatJid)) return chatJid;
  const p = String(key?.participant ?? "");
  const alt = String(key?.participantAlt ?? "");
  return p.endsWith("@lid") && alt.endsWith("@s.whatsapp.net") ? alt : p;
}

/** A WhatsApp message as stored, or null for one that is never shown (housekeeping, status). */
export function toStored(msg: any, nameOf: (jid: string) => string): StoredMessage | null {
  const chat = chatJidOf(msg?.key);
  if (isIgnoredJid(chat)) return null;
  const content = unwrap(msg?.message);
  if (isHousekeeping(content)) return null;
  const mine = !!msg.key?.fromMe;
  const fromJid = mine ? "me" : senderJidOf(msg.key, chat);
  const media = mediaOf(content);
  const seconds = toNumber(msg.messageTimestamp) ?? 0;
  const from = mine ? "me" : clean(msg.pushName) ?? nameOf(fromJid);
  return {
    id: String(msg.key?.id ?? ""),
    at: seconds * 1000,
    fromJid,
    from,
    mine,
    text: textOf(content, media),
    ...(media ? { media } : {}),
  };
}

/** A jid's phone number as a person reads it ("+919812345678"), or the jid's own id. */
export function numberOf(jid: string): string {
  const id = jid.split("@")[0].split(":")[0];
  return jid.endsWith("@s.whatsapp.net") ? `+${id}` : id;
}
