/**
 * WhatsApp: how often the skill may load WhatsApp Web and send, kept in a small JSON file in the
 * skill's data dir so the limits hold across runs (owner 2026-11-25: frequent reading is bad,
 * frequent or mass sending is extremely bad).
 *
 * A slot is taken BEFORE WhatsApp Web is loaded or a message is typed: a run that fails still
 * counts, so a failing loop cannot get round the limits. A limit hit is a refusal naming when it
 * frees up, never a silent queue. Recent reads are kept for 10 minutes so the same chat is not
 * loaded again (their text never outlives that), sends only as a hash of their text for 24 hours.
 */
import { closeSync, mkdirSync, openSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "fs";
import { createHash } from "crypto";
import { join } from "path";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export const LIMITS = {
  readsPerHour: 20,
  readsPerDay: 100,
  rereadAfterMs: 10 * MINUTE,
  sendsPerHour: 5,
  sendsPerDay: 20,
  sendGapMs: MINUTE,
  sameTextWindowMs: DAY,
} as const;

interface CachedRead { at: number; result: unknown }
interface SentRecord { at: number; chat: string; textHash: string }
export interface LimitState { reads: number[]; sends: SentRecord[]; cache: Record<string, CachedRead> }

/** A limit that refuses this run, with when it frees up. */
export class LimitHit extends Error {
  constructor(public code: string, message: string, public freesAt: number) { super(message); }
}

export interface LimitOpts { dir?: string; now?: number }

const fileIn = (dir: string) => join(dir, "whatsapp", "limits.json");
const empty = (): LimitState => ({ reads: [], sends: [], cache: {} });

export const chatKey = (name: string): string => name.normalize("NFKC").replace(/\s+/g, " ").trim().toLowerCase();
export const textHash = (text: string): string => createHash("sha256").update(text.normalize("NFKC").replace(/\s+/g, " ").trim().toLowerCase()).digest("hex");

function dirOf(opts: LimitOpts): string {
  const dir = opts.dir ?? process.env.SKILL_DATA_DIR ?? "";
  if (!dir) throw new LimitHit("NO_DATA_DIR", "This run has no data folder to keep its limits in (SKILL_DATA_DIR). Run it with the run_skill tool.", 0);
  return dir;
}

function load(file: string): LimitState {
  try {
    const v = JSON.parse(readFileSync(file, "utf8"));
    return { reads: Array.isArray(v?.reads) ? v.reads : [], sends: Array.isArray(v?.sends) ? v.sends : [], cache: v?.cache && typeof v.cache === "object" ? v.cache : {} };
  } catch { return empty(); }
}

/** Drops what no limit looks at any more, and cached reads older than the re-read gap. */
function prune(s: LimitState, now: number): LimitState {
  const cache = Object.fromEntries(Object.entries(s.cache).filter(([, c]) => now - c.at < LIMITS.rereadAfterMs));
  return { reads: s.reads.filter((t) => now - t < DAY), sends: s.sends.filter((r) => now - r.at < DAY), cache };
}

const LOCK_STALE_MS = 30_000;
const sleep = (ms: number) => Bun.sleepSync(ms);

/** One run at a time changes the file: two runs at once must not both take the last slot. */
function withLock<T>(file: string, fn: () => T): T {
  const lock = `${file}.lock`;
  for (let tries = 0; ; tries++) {
    try { closeSync(openSync(lock, "wx")); break; } catch {
      try { if (Date.now() - statSync(lock).mtimeMs > LOCK_STALE_MS) { unlinkSync(lock); continue; } } catch { continue; }
      if (tries > 100) throw new LimitHit("BUSY", "Another WhatsApp run is busy. Try again in a minute.", Date.now() + MINUTE);
      sleep(50);
    }
  }
  try { return fn(); } finally { try { unlinkSync(lock); } catch { /* already gone */ } }
}

/** Reads, changes and saves the state under the lock. */
function update<T>(opts: LimitOpts, fn: (s: LimitState, now: number) => T): T {
  const dir = dirOf(opts);
  const file = fileIn(dir);
  mkdirSync(join(dir, "whatsapp"), { recursive: true });
  return withLock(file, () => {
    const now = opts.now ?? Date.now();
    const state = prune(load(file), now);
    const out = fn(state, now);
    writeFileSync(`${file}.tmp`, JSON.stringify(state));
    renameSync(`${file}.tmp`, file);
    return out;
  });
}

const at = (ms: number) => new Date(ms).toISOString();
const inWords = (ms: number) => {
  const min = Math.max(1, Math.ceil(ms / MINUTE));
  return min < 60 ? `${min} minute${min === 1 ? "" : "s"}` : `${Math.ceil(min / 60)} hour${Math.ceil(min / 60) === 1 ? "" : "s"}`;
};

/** The first of `times` (ascending) that must age out of `windowMs` before one more fits under `max`. */
function windowHit(times: number[], max: number, windowMs: number, now: number): number | null {
  const inWindow = times.filter((t) => now - t < windowMs).sort((a, b) => a - b);
  return inWindow.length < max ? null : inWindow[inWindow.length - max] + windowMs;
}

function refuse(code: string, what: string, freesAt: number, now: number): never {
  throw new LimitHit(code, `${what} It frees up in about ${inWords(freesAt - now)} (${at(freesAt)}).`, freesAt);
}

function checkReads(s: LimitState, now: number): void {
  const hour = windowHit(s.reads, LIMITS.readsPerHour, HOUR, now);
  if (hour) refuse("READ_LIMIT_HOUR", `WhatsApp was read ${LIMITS.readsPerHour} times in the last hour, the most allowed.`, hour, now);
  const day = windowHit(s.reads, LIMITS.readsPerDay, DAY, now);
  if (day) refuse("READ_LIMIT_DAY", `WhatsApp was read ${LIMITS.readsPerDay} times in the last 24 hours, the most allowed.`, day, now);
}

export interface Cached { result: unknown; ageSeconds: number }

/** A read of `key` from the last 10 minutes, or null. */
export function cachedRead(key: string, opts: LimitOpts = {}): Cached | null {
  return update(opts, (s, now) => {
    const c = s.cache[key];
    return c ? { result: c.result, ageSeconds: Math.round((now - c.at) / 1000) } : null;
  });
}

/** Takes one read slot, or refuses with when the next one frees up. */
export function takeReadSlot(opts: LimitOpts = {}): void {
  update(opts, (s, now) => { checkReads(s, now); s.reads.push(now); });
}

/** Keeps a read's result for 10 minutes. */
export function keepRead(key: string, result: unknown, opts: LimitOpts = {}): void {
  update(opts, (s, now) => { s.cache[key] = { at: now, result }; });
}

/** Forgets every kept read: after a send, the chat it went to reads fresh. */
export function forgetRead(key: string, opts: LimitOpts = {}): void {
  update(opts, (s) => { delete s.cache[key]; });
}

/** Takes one send slot for `text` to `chat` (and the read slot loading WhatsApp Web needs), or refuses. */
export function takeSendSlot(chat: string, text: string, opts: LimitOpts = {}): void {
  update(opts, (s, now) => {
    const times = s.sends.map((r) => r.at);
    const last = Math.max(0, ...times);
    if (now - last < LIMITS.sendGapMs) refuse("SEND_TOO_SOON", "A message went out less than a minute ago.", last + LIMITS.sendGapMs, now);
    const hour = windowHit(times, LIMITS.sendsPerHour, HOUR, now);
    if (hour) refuse("SEND_LIMIT_HOUR", `${LIMITS.sendsPerHour} messages went out in the last hour, the most allowed.`, hour, now);
    const day = windowHit(times, LIMITS.sendsPerDay, DAY, now);
    if (day) refuse("SEND_LIMIT_DAY", `${LIMITS.sendsPerDay} messages went out in the last 24 hours, the most allowed.`, day, now);
    const hash = textHash(text);
    const key = chatKey(chat);
    const same = s.sends.find((r) => r.textHash === hash && r.chat !== key && now - r.at < LIMITS.sameTextWindowMs);
    if (same) refuse("SAME_TEXT_OTHER_CHAT", "This same message already went to another chat in the last 24 hours. The same text is never sent to a second chat that soon.", same.at + LIMITS.sameTextWindowMs, now);
    checkReads(s, now);
    s.reads.push(now);
    s.sends.push({ at: now, chat: key, textHash: hash });
  });
}
