/**
 * WhatsApp: the chats the connector has seen, kept in store.json in the connection's own data folder.
 * Filled from what WhatsApp sends a linked device: the chat list and a few recent messages when it is
 * linked, then the new messages each time it connects. Capped: the newest chats, and the last messages
 * of each. Reads answer from here.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "fs";
import { join } from "path";
import { isGroupJid, isIgnoredJid, numberOf, toNumber, toStored, chatJidOf, type StoredMessage } from "./_messages";

export const MAX_CHATS = 300;
export const MESSAGES_PER_CHAT = 60;
const STORE_FILE = "store.json";

export interface StoredChat { jid: string; name: string; kind: "group" | "person"; lastAt: number; unread: number; messages: StoredMessage[] }
export interface StoreData { chats: Record<string, StoredChat>; names: Record<string, string>; syncedAt: number }

/** A chat as list-chats shows it. */
export interface ChatRow { name: string; kind: "group" | "person"; unread: number; lastMessageAt: string | null; preview: string }

const empty = (): StoreData => ({ chats: {}, names: {}, syncedAt: 0 });
const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const isStoredChat = (jid: string, c: any): boolean => isRecord(c) && c.jid === jid && typeof c.name === "string" && (c.kind === "group" || c.kind === "person")
  && typeof c.lastAt === "number" && typeof c.unread === "number" && Array.isArray(c.messages);
const isStoredMessage = (m: any): m is StoredMessage => isRecord(m) && typeof m.id === "string" && typeof m.at === "number" && typeof m.from === "string"
  && typeof m.text === "string" && typeof m.mine === "boolean";

/** Two names are the same, case, spacing and emoji style aside: as Flock's WhatsApp gate compares them (chatKey). */
export function sameName(a: string, b: string): boolean {
  const key = (s: string) => s.normalize("NFKC").replace(/\uFE0F/g, "").replace(/\s+/g, " ").trim().toLowerCase();
  return key(a) === key(b);
}

const fold = (s: string) => s.normalize("NFKC").toLowerCase();
const iso = (at: number): string | null => (at > 0 ? new Date(at).toISOString() : null);

export class Store {
  private data: StoreData;
  private readonly file: string;

  constructor(private readonly dir: string) {
    this.file = join(dir, STORE_FILE);
    this.data = Store.read(this.file);
  }

  /** The saved store; a broken file, or a broken chat or name in it, is dropped rather than failing every read. */
  private static read(file: string): StoreData {
    let v: any;
    try { v = JSON.parse(readFileSync(file, "utf8")); } catch { return empty(); }
    if (!isRecord(v?.chats) || !isRecord(v?.names)) return empty();
    const chats = Object.fromEntries(Object.entries(v.chats).filter(([jid, c]) => isStoredChat(jid, c)).map(([jid, c]) => [jid, { ...(c as StoredChat), messages: (c as StoredChat).messages.filter(isStoredMessage) }]));
    const names = Object.fromEntries(Object.entries(v.names).filter(([, n]) => typeof n === "string"));
    return { chats: chats as Record<string, StoredChat>, names: names as Record<string, string>, syncedAt: Number(v.syncedAt) || 0 };
  }

  /** Saves it, dropping what is past the caps. */
  save(): void {
    this.trim();
    mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    writeFileSync(`${this.file}.tmp`, JSON.stringify(this.data), { mode: 0o600 });
    renameSync(`${this.file}.tmp`, this.file);
  }

  /** Forgets everything (unlink). */
  clear(): void {
    this.data = empty();
    if (existsSync(this.file)) unlinkSync(this.file);
  }

  get syncedAt(): number { return this.data.syncedAt; }
  markSynced(at: number): void { this.data.syncedAt = at; }
  get chatCount(): number { return Object.keys(this.data.chats).length; }

  /** The name a person or group goes by: what the person saved, else what WhatsApp knows, else the number. */
  nameOf = (jid: string): string => this.data.names[jid] ?? this.data.chats[jid]?.name ?? numberOf(jid);

  private chat(jid: string): StoredChat {
    const found = this.data.chats[jid];
    if (found) return found;
    const made: StoredChat = { jid, name: this.data.names[jid] ?? numberOf(jid), kind: isGroupJid(jid) ? "group" : "person", lastAt: 0, unread: 0, messages: [] };
    this.data.chats[jid] = made;
    return made;
  }

  /** A name for a jid; a saved contact name is never replaced by a push name. */
  setName(jid: string, name: unknown, saved = false): void {
    if (isIgnoredJid(jid) || typeof name !== "string" || !name.trim()) return;
    if (!saved && this.data.names[jid] && this.data.names[jid] !== numberOf(jid)) return;
    this.data.names[jid] = name.trim();
    const chat = this.data.chats[jid];
    if (chat) chat.name = name.trim();
  }

  /** Contacts from WhatsApp: the saved name first, then the name they gave themselves. */
  applyContacts(contacts: any[]): void {
    for (const c of contacts ?? []) {
      const jid = String(c?.id ?? "");
      if (c?.name) this.setName(jid, c.name, true);
      else this.setName(jid, c?.notify ?? c?.verifiedName);
    }
  }

  /** Chats from WhatsApp (the chat list on linking, and changes later). */
  applyChats(chats: any[]): void {
    for (const c of chats ?? []) {
      const jid = String(c?.id ?? "");
      if (isIgnoredJid(jid) || jid.endsWith("@lid") && c?.pnJid) continue;
      const chat = this.chat(jid);
      const name = c?.name ?? c?.subject ?? c?.displayName;
      if (typeof name === "string" && name.trim()) this.setName(jid, name, isGroupJid(jid) || !!c?.name);
      const unread = toNumber(c?.unreadCount);
      if (unread !== undefined) chat.unread = Math.max(0, unread);
      const at = (toNumber(c?.conversationTimestamp) ?? 0) * 1000;
      if (at > chat.lastAt) chat.lastAt = at;
    }
  }

  /** Group names, as WhatsApp gives them for the groups the person is in. */
  applyGroups(groups: Record<string, { subject?: string }> | any[]): void {
    const list = Array.isArray(groups) ? groups : Object.values(groups ?? {});
    for (const g of list) if (g?.id && g?.subject) { this.chat(String(g.id)); this.setName(String(g.id), g.subject, true); }
  }

  /** Messages, from the history on linking or as they arrive. `live`: new ones, counted as unread. */
  addMessages(messages: any[], live = false): number {
    let added = 0;
    for (const m of messages ?? []) {
      const jid = chatJidOf(m?.key);
      if (isIgnoredJid(jid)) continue;
      if (!m?.key?.fromMe) this.setName(String(m?.key?.participantAlt ?? m?.key?.participant ?? jid), m?.pushName);
      const stored = toStored(m, this.nameOf);
      if (!stored) continue;
      const chat = this.chat(jid);
      if (chat.messages.some((x) => x.id === stored.id)) continue;
      chat.messages.push(stored);
      chat.messages.sort((a, b) => a.at - b.at);
      if (stored.at > chat.lastAt) chat.lastAt = stored.at;
      if (live && !stored.mine) chat.unread += 1;
      added++;
    }
    return added;
  }

  private trim(): void {
    const chats = Object.values(this.data.chats).sort((a, b) => b.lastAt - a.lastAt);
    const kept = chats.slice(0, MAX_CHATS);
    for (const c of kept) if (c.messages.length > MESSAGES_PER_CHAT) c.messages = c.messages.slice(-MESSAGES_PER_CHAT);
    this.data.chats = Object.fromEntries(kept.map((c) => [c.jid, c]));
  }

  private row(c: StoredChat): ChatRow {
    const last = c.messages[c.messages.length - 1];
    return { name: c.name, kind: c.kind, unread: c.unread, lastMessageAt: iso(c.lastAt), preview: last ? `${last.mine ? "You: " : c.kind === "group" ? `${last.from}: ` : ""}${last.text}`.slice(0, 120) : "" };
  }

  /** The newest chats first. */
  listChats(max: number): ChatRow[] {
    return Object.values(this.data.chats).filter((c) => c.lastAt > 0 || c.messages.length).sort((a, b) => b.lastAt - a.lastAt).slice(0, max).map((c) => this.row(c));
  }

  /** Every chat named exactly `name` (case and spacing aside). */
  findChats(name: string): StoredChat[] {
    return Object.values(this.data.chats).filter((c) => sameName(c.name, name));
  }

  /** Chats whose name holds `query`, and messages whose text does, newest first. */
  search(query: string, max: number): { chats: ChatRow[]; messages: Array<{ chat: string; from: string; text: string; time: string | null }> } {
    const q = fold(query.trim());
    const all = Object.values(this.data.chats).sort((a, b) => b.lastAt - a.lastAt);
    const chats = all.filter((c) => fold(c.name).includes(q)).slice(0, max).map((c) => this.row(c));
    const messages = all.flatMap((c) => c.messages.filter((m) => fold(m.text).includes(q)).map((m) => ({ chat: c.name, from: m.from, text: m.text, time: iso(m.at), at: m.at })))
      .sort((a, b) => b.at - a.at).slice(0, max).map(({ at: _at, ...m }) => m);
    return { chats, messages };
  }
}
