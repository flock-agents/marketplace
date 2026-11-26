/**
 * WhatsApp: how often and how long the connector may connect to WhatsApp, and how many messages it may
 * send, kept in limits.json in the connection's own data folder (MCP_DATA_DIR) so they hold across
 * calls and restarts. Owner 2026-11-25: frequent reading is bad, frequent or mass sending is extremely bad.
 *
 * - Connections: every connection to WhatsApp (a read, a send, a link, each reconnect) counts; at most
 *   10 in a rolling hour and 60 in a rolling day. The slot is taken before connecting, so a failed one
 *   counts too.
 * - Time: connected at most 30 minutes a calendar day, in the Flock's timezone (FLOCK_TIMEZONE, else
 *   UTC). Each connection adds the time it was held, failed or not.
 * - Sends: at most 5 in a rolling hour and 20 in a rolling day.
 * A limit hit is a refusal naming when it frees up, never a silent queue.
 */
import { closeSync, mkdirSync, openSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "fs";
import { join } from "path";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export const LIMITS = {
  connectionsPerHour: 10,
  connectionsPerDay: 60,
  connectedMsPerDay: 30 * MINUTE,
  sendsPerHour: 5,
  sendsPerDay: 20,
} as const;

export interface LimitState { connections: number[]; sends: number[]; usage: { day: string; ms: number } }

/** A limit that refuses this call, with when it frees up. */
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

const numbers = (v: unknown): number[] => (Array.isArray(v) ? v.filter((t): t is number => typeof t === "number") : []);

/** The saved state; a broken file starts fresh rather than failing every call. */
function load(file: string): LimitState {
  try {
    const v = JSON.parse(readFileSync(file, "utf8"));
    const usage = v?.usage && typeof v.usage.day === "string" && typeof v.usage.ms === "number" ? v.usage : { day: "", ms: 0 };
    return { connections: numbers(v?.connections), sends: numbers(v?.sends), usage };
  } catch { return { connections: [], sends: [], usage: { day: "", ms: 0 } }; }
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
      connections: loaded.connections.filter((t) => now - t < DAY),
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
 * Takes one connection to WhatsApp (and, for a send, one send), or refuses with when it frees up.
 * Answers the ms of today's connected time left: the call caps its own waits to it.
 */
export function takeSlot(kind: "connect" | "send", opts: LimitOpts = {}): number {
  return update(opts, (s, now) => {
    if (kind === "send") {
      const hour = windowHit(s.sends, LIMITS.sendsPerHour, HOUR, now);
      if (hour) refuse("SEND_LIMIT_HOUR", `${LIMITS.sendsPerHour} messages went out in the last hour, the most allowed.`, hour, now);
      const day = windowHit(s.sends, LIMITS.sendsPerDay, DAY, now);
      if (day) refuse("SEND_LIMIT_DAY", `${LIMITS.sendsPerDay} messages went out in the last 24 hours, the most allowed.`, day, now);
    }
    const left = LIMITS.connectedMsPerDay - s.usage.ms;
    if (left <= 0) {
      const tz = timeZoneOf(opts);
      refuse("TIME_LIMIT_DAY", `WhatsApp was connected for ${LIMITS.connectedMsPerDay / MINUTE} minutes today (${tz} day), the most allowed.`, nextMidnight(now, tz), now);
    }
    const hour = windowHit(s.connections, LIMITS.connectionsPerHour, HOUR, now);
    if (hour) refuse("CONNECT_LIMIT_HOUR", `WhatsApp was connected ${LIMITS.connectionsPerHour} times in the last hour, the most allowed.`, hour, now);
    const day = windowHit(s.connections, LIMITS.connectionsPerDay, DAY, now);
    if (day) refuse("CONNECT_LIMIT_DAY", `WhatsApp was connected ${LIMITS.connectionsPerDay} times in the last 24 hours, the most allowed.`, day, now);
    s.connections.push(now);
    if (kind === "send") s.sends.push(now);
    return left;
  });
}

/** Adds a connection's time to today's total; answers the whole minutes left today. */
export function addConnectedTime(ms: number, opts: LimitOpts = {}): number {
  return update(opts, (s) => {
    s.usage.ms += Math.max(0, Math.round(ms));
    return Math.max(0, Math.floor((LIMITS.connectedMsPerDay - s.usage.ms) / MINUTE));
  });
}

/** The whole minutes of connected time left today, without taking anything. */
export function minutesLeftToday(opts: LimitOpts = {}): number {
  return update(opts, (s) => Math.max(0, Math.floor((LIMITS.connectedMsPerDay - s.usage.ms) / MINUTE)));
}
