/**
 * WhatsApp: how often and how long the skill may use WhatsApp Web, and how many messages it may send,
 * kept in a small JSON file in the skill's data dir so the limits hold across runs and agents (one
 * Flock). Owner 2026-11-25: frequent reading is bad, frequent or mass sending is extremely bad.
 *
 * - Opens: every function loads WhatsApp Web once; at most 10 in a rolling hour and 60 in a rolling
 *   day. The slot is taken before the page loads, so a failed run counts too.
 * - Time: WhatsApp Web open at most 30 minutes a calendar day, in the Flock's timezone
 *   (FLOCK_TIMEZONE, else UTC). Each run adds the time it held the page, failed or not.
 * - Sends: at most 5 in a rolling hour and 20 in a rolling day.
 * A limit hit is a refusal naming when it frees up, never a silent queue.
 */
import { closeSync, mkdirSync, openSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "fs";
import { join } from "path";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export const LIMITS = {
  opensPerHour: 10,
  opensPerDay: 60,
  openMsPerDay: 30 * MINUTE,
  sendsPerHour: 5,
  sendsPerDay: 20,
} as const;

export interface LimitState { opens: number[]; sends: number[]; usage: { day: string; ms: number } }

/** A limit that refuses this run, with when it frees up. */
export class LimitHit extends Error {
  constructor(public code: string, message: string, public freesAt: number) { super(message); }
}

export interface LimitOpts { dir?: string; now?: number; timeZone?: string }

const fileIn = (dir: string) => join(dir, "whatsapp", "limits.json");

/** The Flock's timezone when the run is given one, else UTC. */
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

function dirOf(opts: LimitOpts): string {
  const dir = opts.dir ?? process.env.SKILL_DATA_DIR ?? "";
  if (!dir) throw new LimitHit("NO_DATA_DIR", "This run has no data folder to keep its limits in (SKILL_DATA_DIR). Run it with the run_skill tool.", 0);
  return dir;
}

const numbers = (v: unknown): number[] => (Array.isArray(v) ? v.filter((t): t is number => typeof t === "number") : []);

/** The saved state; a broken file starts fresh rather than failing every run. */
function load(file: string): LimitState {
  try {
    const v = JSON.parse(readFileSync(file, "utf8"));
    const usage = v?.usage && typeof v.usage.day === "string" && typeof v.usage.ms === "number" ? v.usage : { day: "", ms: 0 };
    return { opens: numbers(v?.opens), sends: numbers(v?.sends), usage };
  } catch { return { opens: [], sends: [], usage: { day: "", ms: 0 } }; }
}

const LOCK_STALE_MS = 30_000;

/** One run at a time changes the file: two runs at once must not both take the last slot. */
function withLock<T>(file: string, fn: () => T): T {
  const lock = `${file}.lock`;
  for (let tries = 0; ; tries++) {
    try { closeSync(openSync(lock, "wx")); break; } catch {
      try { if (Date.now() - statSync(lock).mtimeMs > LOCK_STALE_MS) { unlinkSync(lock); continue; } } catch { continue; }
      if (tries > 100) throw new LimitHit("BUSY", "Another WhatsApp run is busy. Try again in a minute.", Date.now() + MINUTE);
      Bun.sleepSync(50);
    }
  }
  try { return fn(); } finally { try { unlinkSync(lock); } catch { /* already gone */ } }
}

/** Reads, changes and saves the state under the lock, dropping what no limit looks at any more. */
function update<T>(opts: LimitOpts, fn: (s: LimitState, now: number) => T): T {
  const dir = dirOf(opts);
  const file = fileIn(dir);
  mkdirSync(join(dir, "whatsapp"), { recursive: true });
  return withLock(file, () => {
    const now = opts.now ?? Date.now();
    const today = dayOf(now, timeZoneOf(opts));
    const loaded = load(file);
    const state: LimitState = {
      opens: loaded.opens.filter((t) => now - t < DAY),
      sends: loaded.sends.filter((t) => now - t < DAY),
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

/**
 * Takes one open of WhatsApp Web (and, for a send, one send), or refuses with when it frees up.
 * Answers the ms of today's open time left: the run caps its own waits to it.
 */
export function takeSlot(kind: "read" | "send", opts: LimitOpts = {}): number {
  return update(opts, (s, now) => {
    if (kind === "send") {
      const hour = windowHit(s.sends, LIMITS.sendsPerHour, HOUR, now);
      if (hour) refuse("SEND_LIMIT_HOUR", `${LIMITS.sendsPerHour} messages went out in the last hour, the most allowed.`, hour, now);
      const day = windowHit(s.sends, LIMITS.sendsPerDay, DAY, now);
      if (day) refuse("SEND_LIMIT_DAY", `${LIMITS.sendsPerDay} messages went out in the last 24 hours, the most allowed.`, day, now);
    }
    const left = LIMITS.openMsPerDay - s.usage.ms;
    if (left <= 0) {
      const tz = timeZoneOf(opts);
      refuse("TIME_LIMIT_DAY", `WhatsApp was open for ${LIMITS.openMsPerDay / MINUTE} minutes today (${tz} day), the most allowed.`, nextMidnight(now, tz), now);
    }
    const hour = windowHit(s.opens, LIMITS.opensPerHour, HOUR, now);
    if (hour) refuse("OPEN_LIMIT_HOUR", `WhatsApp was opened ${LIMITS.opensPerHour} times in the last hour, the most allowed.`, hour, now);
    const day = windowHit(s.opens, LIMITS.opensPerDay, DAY, now);
    if (day) refuse("OPEN_LIMIT_DAY", `WhatsApp was opened ${LIMITS.opensPerDay} times in the last 24 hours, the most allowed.`, day, now);
    s.opens.push(now);
    if (kind === "send") s.sends.push(now);
    return left;
  });
}

/** Adds a run's open time to today's total; answers the whole minutes left today. */
export function addOpenTime(ms: number, opts: LimitOpts = {}): number {
  return update(opts, (s) => {
    s.usage.ms += Math.max(0, Math.round(ms));
    return Math.max(0, Math.floor((LIMITS.openMsPerDay - s.usage.ms) / MINUTE));
  });
}
