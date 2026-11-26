/**
 * WhatsApp: the safety limits, kept in limits.json in the connection's own data folder (MCP_DATA_DIR) so
 * they hold across calls and restarts. Owner 2026-11-26: roomy enough to work with the agent all
 * evening, tight on what WhatsApp treats as abuse (many new people, the same text to many chats,
 * machine-speed sends, reconnect churn, a device that never goes offline).
 *
 * - Sessions: one connection is reused while calls keep coming and closes after a few idle minutes. At
 *   most 6 sessions in a rolling hour and 40 in a rolling day; a reconnect inside a session is not a new one.
 * - Time: connected at most 2 hours a calendar day, in the Flock's timezone (FLOCK_TIMEZONE, else UTC).
 * - Calls: no count limit on reads, only a runaway guard of 120 tool calls in a rolling hour.
 * - Sends: at most 20 in a rolling hour and 100 in a rolling day, at least 5 seconds apart (the call
 *   waits); at most 10 different chats in a rolling hour and 30 in a rolling day; the same text (case
 *   and spacing aside) to at most 3 chats a day, kept as a hash only.
 * - Paused: WhatsApp logged the device out, refused the account, or refused 3 connections in a row.
 *   Every tool refuses until the person links again (after a logout) or unlinks.
 * A limit hit is a refusal naming when it frees up, never a silent queue.
 */
import { createHash } from "crypto";
import { closeSync, mkdirSync, openSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "fs";
import { join } from "path";

const SECOND = 1_000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export const LIMITS = {
  sessionsPerHour: 6,
  sessionsPerDay: 40,
  connectedMsPerDay: 2 * HOUR,
  callsPerHour: 120,
  sendsPerHour: 20,
  sendsPerDay: 100,
  sendGapMs: 5 * SECOND,
  chatsPerHour: 10,
  chatsPerDay: 30,
  sameTextChatsPerDay: 3,
  failedConnectsToPause: 3,
} as const;

export type PauseKind = "logged_out" | "refused";
export interface Pause { kind: PauseKind; reason: string; at: number }
export interface SentRecord { at: number; chat: string; text: string }
export interface LimitState {
  sessions: number[];
  calls: number[];
  sends: SentRecord[];
  usage: { day: string; ms: number };
  paused: Pause | null;
  failedConnects: number;
}

/** A limit that refuses this call, with when it frees up (0: not by time). */
export class LimitHit extends Error {
  constructor(public code: string, message: string, public freesAt: number) { super(message); }
}

export interface LimitOpts { dir?: string; now?: number; timeZone?: string }

const LIMITS_FILE = "limits.json";

/** The Flock's timezone when one is given, else UTC. */
export function timeZoneOf(opts: LimitOpts = {}): string {
  const tz = opts.timeZone ?? process.env.FLOCK_TIMEZONE ?? "UTC";
  try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); return tz; } catch { return "UTC"; }
}

/** The calendar day `at` falls on in `tz`, as YYYY-MM-DD. */
export const dayOf = (at: number, tz: string): string =>
  new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);

/** How far `tz` is ahead of UTC at `at`, in ms. */
function offsetAt(at: number, tz: string): number {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric" })
    .formatToParts(at).filter((x) => x.type !== "literal").map((x) => [x.type, Number(x.value)]));
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(at / 1000) * 1000;
}

/** The next midnight in `tz` after `at`. */
export function nextMidnight(at: number, tz: string): number {
  const [y, m, d] = dayOf(at, tz).split("-").map(Number);
  const guess = Date.UTC(y, m - 1, d + 1);
  return guess - offsetAt(guess - offsetAt(guess, tz), tz);
}

/** The connection's own data folder: never the home folder or the working folder. */
export function dataDirOf(dir?: string): string {
  const found = dir ?? process.env.MCP_DATA_DIR ?? "";
  if (!found) throw new LimitHit("NO_DATA_DIR", "This WhatsApp server has no data folder (MCP_DATA_DIR): Flock starts it with one.", 0);
  return found;
}

/** The same text as WhatsApp's abuse checks would see it: case, spacing and line breaks aside. Only its hash is kept. */
export function textHash(text: string): string {
  return createHash("sha256").update(text.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim()).digest("hex").slice(0, 32);
}

const numbers = (v: unknown): number[] => (Array.isArray(v) ? v.filter((t): t is number => typeof t === "number") : []);
const sentRecords = (v: unknown): SentRecord[] => (Array.isArray(v)
  ? v.filter((s): s is SentRecord => !!s && typeof s.at === "number" && typeof s.chat === "string" && typeof s.text === "string")
  : []);
const pauseOf = (v: any): Pause | null => (v && (v.kind === "logged_out" || v.kind === "refused") && typeof v.reason === "string" && typeof v.at === "number"
  ? { kind: v.kind, reason: v.reason, at: v.at } : null);

/** The saved state; a broken file starts fresh rather than failing every call (a pause is kept when readable). */
function load(file: string): LimitState {
  let v: any = null;
  try { v = JSON.parse(readFileSync(file, "utf8")); } catch { /* missing or broken: fresh */ }
  const usage = v?.usage && typeof v.usage.day === "string" && typeof v.usage.ms === "number" ? v.usage : { day: "", ms: 0 };
  return {
    sessions: numbers(v?.sessions),
    calls: numbers(v?.calls),
    sends: sentRecords(v?.sends),
    usage,
    paused: pauseOf(v?.paused),
    failedConnects: typeof v?.failedConnects === "number" ? v.failedConnects : 0,
  };
}

const LOCK_STALE_MS = 30_000;

/** One change at a time: two calls at once must not both take the last slot. */
function withLock<T>(file: string, fn: () => T): T {
  const lock = `${file}.lock`;
  for (let tries = 0; ; tries++) {
    try { closeSync(openSync(lock, "wx")); break; } catch {
      try { if (Date.now() - statSync(lock).mtimeMs > LOCK_STALE_MS) { unlinkSync(lock); continue; } } catch { continue; }
      if (tries > 100) throw new LimitHit("BUSY", "Another WhatsApp call is busy. Try again in a minute.", Date.now() + MINUTE);
      Bun.sleepSync(50);
    }
  }
  try { return fn(); } finally { try { unlinkSync(lock); } catch { /* already gone */ } }
}

/** Reads, changes and saves the state under the lock, dropping what no limit looks at any more. */
function update<T>(opts: LimitOpts, fn: (s: LimitState, now: number) => T): T {
  const dir = dataDirOf(opts.dir);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, LIMITS_FILE);
  return withLock(file, () => {
    const now = opts.now ?? Date.now();
    const today = dayOf(now, timeZoneOf(opts));
    const loaded = load(file);
    const state: LimitState = {
      ...loaded,
      sessions: loaded.sessions.filter((t) => now - t < DAY),
      calls: loaded.calls.filter((t) => now - t < HOUR),
      sends: loaded.sends.filter((s) => now - s.at < DAY),
      usage: loaded.usage.day === today ? loaded.usage : { day: today, ms: 0 },
    };
    const out = fn(state, now);
    writeFileSync(`${file}.tmp`, JSON.stringify(state));
    renameSync(`${file}.tmp`, file);
    return out;
  });
}

const inWords = (ms: number) => {
  const min = Math.max(1, Math.ceil(ms / MINUTE));
  return min < 60 ? `${min} minute${min === 1 ? "" : "s"}` : `${Math.ceil(min / 60)} hour${Math.ceil(min / 60) === 1 ? "" : "s"}`;
};

function refuse(code: string, what: string, freesAt: number, now: number): never {
  throw new LimitHit(code, `${what} It frees up in about ${inWords(freesAt - now)} (${new Date(freesAt).toISOString()}).`, freesAt);
}

/** Null when one more fits under `max` in `windowMs`, else when the oldest counted one ages out. */
function windowHit(times: number[], max: number, windowMs: number, now: number): number | null {
  const inWindow = times.filter((t) => now - t < windowMs).sort((a, b) => a - b);
  return inWindow.length < max ? null : inWindow[inWindow.length - max] + windowMs;
}

/** When the `max`-th different chat in `windowMs` ages out, if a new chat would be one too many; else null. */
function newChatHit(sends: SentRecord[], chat: string, max: number, windowMs: number, now: number): number | null {
  const recent = sends.filter((s) => now - s.at < windowMs);
  if (recent.some((s) => s.chat === chat)) return null;
  const lastSentTo = new Map<string, number>();
  for (const s of recent) lastSentTo.set(s.chat, Math.max(s.at, lastSentTo.get(s.chat) ?? 0));
  if (lastSentTo.size < max) return null;
  const sorted = [...lastSentTo.values()].sort((a, b) => a - b);
  return sorted[sorted.length - max] + windowMs;
}

/** The tools that still run while paused: the status, an unlink, and a new link after a logout. */
function pausedRefusal(p: Pause, tool: string): LimitHit | null {
  if (tool === "link-status" || tool === "unlink") return null;
  if (tool === "link" && p.kind === "logged_out") return null;
  return p.kind === "logged_out"
    ? new LimitHit("PAUSED_LOGGED_OUT", `WhatsApp is paused: ${p.reason} It needs linking again with \`link\`.`, 0)
    : new LimitHit("PAUSED_REFUSED", `WhatsApp is paused: ${p.reason} Tell the person and stop; never retry. Only \`unlink\` clears this.`, 0);
}

/** One tool call: refused while paused (except the status, unlink, and link after a logout), and at most 120 an hour. */
export function takeCall(tool: string, opts: LimitOpts = {}): void {
  update(opts, (s, now) => {
    const paused = s.paused && pausedRefusal(s.paused, tool);
    if (paused) throw paused;
    const hour = windowHit(s.calls, LIMITS.callsPerHour, HOUR, now);
    if (hour) refuse("CALL_LIMIT_HOUR", `${LIMITS.callsPerHour} WhatsApp calls were made in the last hour, more than anyone working by hand would. Something may be looping.`, hour, now);
    s.calls.push(now);
  });
}

/** Starts a session (one connection reused while calls keep coming), or refuses. Answers the ms of today's connected time left. */
export function takeSession(opts: LimitOpts = {}): number {
  return update(opts, (s, now) => {
    const left = LIMITS.connectedMsPerDay - s.usage.ms;
    if (left <= 0) {
      const tz = timeZoneOf(opts);
      refuse("TIME_LIMIT_DAY", `WhatsApp was connected for ${LIMITS.connectedMsPerDay / HOUR} hours today (${tz} day), the most allowed.`, nextMidnight(now, tz), now);
    }
    const hour = windowHit(s.sessions, LIMITS.sessionsPerHour, HOUR, now);
    if (hour) refuse("SESSION_LIMIT_HOUR", `WhatsApp was connected ${LIMITS.sessionsPerHour} separate times in the last hour, the most allowed.`, hour, now);
    const day = windowHit(s.sessions, LIMITS.sessionsPerDay, DAY, now);
    if (day) refuse("SESSION_LIMIT_DAY", `WhatsApp was connected ${LIMITS.sessionsPerDay} separate times in the last 24 hours, the most allowed.`, day, now);
    s.sessions.push(now);
    return left;
  });
}

/**
 * Takes one send to `chat` (its WhatsApp id) of `text`, or refuses. Answers how long to wait before
 * sending so sends stay at least `gapMs` apart; the send is counted at that time.
 */
export function reserveSend(chat: string, text: string, opts: LimitOpts & { gapMs?: number } = {}): number {
  return update(opts, (s, now) => {
    const times = s.sends.map((x) => x.at);
    const hour = windowHit(times, LIMITS.sendsPerHour, HOUR, now);
    if (hour) refuse("SEND_LIMIT_HOUR", `${LIMITS.sendsPerHour} messages went out in the last hour, the most allowed.`, hour, now);
    const day = windowHit(times, LIMITS.sendsPerDay, DAY, now);
    if (day) refuse("SEND_LIMIT_DAY", `${LIMITS.sendsPerDay} messages went out in the last 24 hours, the most allowed.`, day, now);
    const chatsHour = newChatHit(s.sends, chat, LIMITS.chatsPerHour, HOUR, now);
    if (chatsHour) refuse("CHAT_LIMIT_HOUR", `Messages went to ${LIMITS.chatsPerHour} different chats in the last hour, the most allowed. Chats already messaged this hour still work.`, chatsHour, now);
    const chatsDay = newChatHit(s.sends, chat, LIMITS.chatsPerDay, DAY, now);
    if (chatsDay) refuse("CHAT_LIMIT_DAY", `Messages went to ${LIMITS.chatsPerDay} different chats in the last 24 hours, the most allowed. Chats already messaged today still work.`, chatsDay, now);
    const hash = textHash(text);
    const sameText = new Set(s.sends.filter((x) => x.text === hash && x.chat !== chat).map((x) => x.chat));
    if (sameText.size >= LIMITS.sameTextChatsPerDay) {
      const oldest = Math.min(...s.sends.filter((x) => x.text === hash).map((x) => x.at));
      refuse("SAME_TEXT_LIMIT", `This same message already went to ${LIMITS.sameTextChatsPerDay} other chats today. Sending one text to many chats looks like spam to WhatsApp.`, oldest + DAY, now);
    }
    const last = times.length ? Math.max(...times) : 0;
    const at = Math.max(now, last + (opts.gapMs ?? LIMITS.sendGapMs));
    s.sends.push({ at, chat, text: hash });
    return at - now;
  });
}

/** Adds connected time to today's total; answers the whole minutes left today. */
export function addConnectedTime(ms: number, opts: LimitOpts = {}): number {
  return update(opts, (s) => {
    s.usage.ms += Math.max(0, Math.round(ms));
    return Math.max(0, Math.floor((LIMITS.connectedMsPerDay - s.usage.ms) / MINUTE));
  });
}

/** The ms of connected time left today, without taking anything. */
export function connectedMsLeft(opts: LimitOpts = {}): number {
  return update(opts, (s) => Math.max(0, LIMITS.connectedMsPerDay - s.usage.ms));
}

/** The whole minutes of connected time left today, without taking anything. */
export function minutesLeftToday(opts: LimitOpts = {}): number {
  return Math.floor(connectedMsLeft(opts) / MINUTE);
}

/** Pauses every tool (but the status, unlink, and a link after a logout) until cleared. */
export function pause(kind: PauseKind, reason: string, opts: LimitOpts = {}): void {
  update(opts, (s, now) => { s.paused = { kind, reason, at: now }; s.failedConnects = 0; });
}

/** Clears a pause: a finished link after a logout, or an unlink. */
export function clearPause(opts: LimitOpts = {}): void {
  update(opts, (s) => { s.paused = null; s.failedConnects = 0; });
}

/** The pause in force, if any. */
export function pausedState(opts: LimitOpts = {}): Pause | null {
  return update(opts, (s) => s.paused);
}

/** Notes how a connection went. The 3rd failure in a row pauses (WhatsApp keeps refusing); answers whether it did. */
export function noteConnect(ok: boolean, reason: string, opts: LimitOpts = {}): boolean {
  return update(opts, (s, now) => {
    if (ok) { s.failedConnects = 0; return false; }
    s.failedConnects++;
    if (s.failedConnects < LIMITS.failedConnectsToPause) return false;
    s.paused = { kind: "refused", reason: `WhatsApp refused ${LIMITS.failedConnectsToPause} connections in a row (last: ${reason}).`, at: now };
    s.failedConnects = 0;
    return true;
  });
}
