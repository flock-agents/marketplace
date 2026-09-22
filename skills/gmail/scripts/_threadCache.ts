// CONNECTOR-OWNED GMAIL THREAD-READ CACHE (2026-09-21).
//
// WHY IT LIVES IN THE CONNECTOR. A thread read is a 10-30s browser scrape queued on the mailbox's
// one session, and the same thread gets read many times over: the dispatcher opens a thread to
// judge it, wakes the agent with it, the agent opens it again through its tool, the harvest opens
// it once more. A cache means the second and later reads of an unchanged thread cost nothing. This
// USED to sit in the Flock server process (server/src/thread-read-cache.ts); it belongs with the
// connector that owns the read, so it moved here and the platform copy is being deleted.
//
// WHY A FILE STORE, not an in-memory Map. Each skill call is a fresh `bun` subprocess (see
// skill-sandbox.sh), so a process-lifetime Map would never survive to a second call — the exact
// thing a cache exists for. The store is a directory of tiny JSON files under the sandbox cwd,
// PER MAILBOX (keyed on the browser session / account), so two mailboxes never read each other's
// threads.
//
// EVERYTHING FAILS SOFT. On some Linux deployments the script runs as a restricted UID that cannot
// write the sandbox dir; a caller that cannot cache must still return the thread it read. So every
// fs operation is wrapped: on failure the cache degrades to "no cache" — returns null/false/0,
// never throws, and emits at most ONE stderr line for the whole process. stdout is the JSON result
// and is never touched here.
//
// FRESHNESS. The default is to serve a cached copy up to the TTL. A caller decides otherwise:
// `forceRefresh` (alias `bypassCache`) skips the cache entirely; `freshAfter` (epoch ms) serves a
// copy only if it was read at or after that instant — for a caller that knows a message landed at
// time T. Any gmail WRITE on a thread invalidates its entry (the write scripts call in here).
//
// A LEAF MODULE, no entrypoint: it is imported for its exports only and must have no side effect at
// import (no SKILL_PARAMS gate needed — it reads no params and touches no browser).

import {
  readFileSync,
  writeFileSync,
  renameSync,
  unlinkSync,
  readdirSync,
  mkdirSync,
} from "fs";
import { join } from "path";

/** Serve a cached copy for up to 20 minutes; past that a thread nothing observed is re-read live. */
export const THREAD_CACHE_TTL_MS = 20 * 60_000;

/** Opportunistic prune fires once a mailbox's dir grows past this many files. */
const PRUNE_TRIGGER_FILES = 200;
/** Hard ceiling on entries per mailbox; the oldest by `cachedAt` are evicted down to it. */
const MAX_ENTRIES = 2_000;

const THREAD_PREFIX = "t-";
const DRAFT_PREFIX = "d-";
const FILE_SUFFIX = ".json";

interface StoredThread {
  cachedAt: number;
  messageIds: string[];
  result: Record<string, unknown>;
}

/** A cached read handed back to a caller: the stored result plus its provenance. */
export type CachedThread = Record<string, unknown> & { fromCache: true; cachedAt: number };

// --- Soft-failure plumbing -------------------------------------------------

// The store may be unwritable (restricted UID). Say so ONCE, then stay quiet: a cache that spams a
// line per call on every read of a read-only mailbox is worse than no cache.
let disabledLogged = false;
function logDisabled(err: unknown): void {
  if (disabledLogged) return;
  disabledLogged = true;
  console.error(`[gmail-cache] disabled: ${(err as Error)?.message || err}`);
}

/** A missing file is an ordinary miss; any other fs error means the store is unusable — log once. */
function isMissing(err: unknown): boolean {
  return (err as { code?: string })?.code === "ENOENT";
}

function safeUnlink(file: string): void {
  try {
    unlinkSync(file);
  } catch (err) {
    if (!isMissing(err)) logDisabled(err);
  }
}

// --- Location --------------------------------------------------------------

/** Keep the mailbox segment to filesystem-safe characters; everything else becomes `_`. */
function safe(segment: string): string {
  return segment.replace(/[^A-Za-z0-9._@-]/g, "_");
}

/**
 * The per-mailbox store directory. `GMAIL_THREAD_CACHE_DIR` overrides it wholesale (tests). Resolved
 * at CALL time, never memoised, so a test can point it somewhere else between cases and the sandbox
 * cwd is whatever the executor set. The mailbox comes from the browser session (or the account
 * email), so one mailbox never serves another's threads.
 */
export function threadCacheDir(): string {
  const override = process.env.GMAIL_THREAD_CACHE_DIR;
  if (override) return override;
  const mailbox = safe(process.env.BROWSER_SESSION || process.env.SKILL_ACCOUNT_EMAIL || "default");
  return join(process.cwd(), ".thread-cache", mailbox);
}

function threadFile(dir: string, threadId: string): string {
  return join(dir, `${THREAD_PREFIX}${safe(threadId)}${FILE_SUFFIX}`);
}

function draftFile(dir: string, draftId: string): string {
  return join(dir, `${DRAFT_PREFIX}${safe(draftId)}${FILE_SUFFIX}`);
}

// --- Low-level read / write ------------------------------------------------

/** Read + parse one JSON file. A missing file is a silent miss; a corrupt one is deleted and missed. */
function readJson<T>(file: string): T | null {
  let raw: string;
  try {
    raw = readFileSync(file, "utf8");
  } catch (err) {
    if (!isMissing(err)) logDisabled(err);
    return null;
  }
  try {
    return JSON.parse(raw) as T;
  } catch {
    safeUnlink(file);
    return null;
  }
}

/** Write one JSON file atomically: a partially written file is never observed as a valid entry. */
function writeJsonAtomic(dir: string, file: string, value: unknown): boolean {
  const tmp = `${file}.tmp-${process.pid}`;
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(tmp, JSON.stringify(value));
    renameSync(tmp, file);
    return true;
  } catch (err) {
    logDisabled(err);
    safeUnlink(tmp);
    return false;
  }
}

/** Every `t-*.json` name in the store, or [] when the dir is absent/unreadable. */
function listThreadFiles(dir: string): string[] {
  try {
    return readdirSync(dir).filter((name) => name.startsWith(THREAD_PREFIX) && name.endsWith(FILE_SUFFIX));
  } catch (err) {
    if (!isMissing(err)) logDisabled(err);
    return [];
  }
}

// --- Result hygiene --------------------------------------------------------

/** A read is worth serving twice only when it is COMPLETE; a hollow or partial scrape is retried live. */
function isCompleteRead(result: unknown): result is Record<string, unknown> {
  if (!result || typeof result !== "object") return false;
  const r = result as { incomplete?: unknown; messages?: unknown; threadId?: unknown };
  return (
    r.incomplete !== true &&
    Array.isArray(r.messages) &&
    r.messages.length > 0 &&
    typeof r.threadId === "string" &&
    r.threadId.length > 0
  );
}

// Provenance fields are stamped onto a SERVED copy; they must never be written back into the store,
// or a re-store of a served result would persist a stale `cachedAt` and a lying `fromCache`.
const PROVENANCE_FIELDS = ["fromCache", "cachedAt", "nav"] as const;

function stripProvenance(result: Record<string, unknown>): Record<string, unknown> {
  const clean: Record<string, unknown> = { ...result };
  for (const field of PROVENANCE_FIELDS) delete clean[field];
  return clean;
}

/**
 * The ids of the messages in a thread, for message-based invalidation. NOTE (2026-09-21): the live
 * Gmail scrape returns per-message `{ from, to, cc, date, body, ... }` with NO id field, so this is
 * empty for every thread read today — message-based invalidation therefore leans on the direct
 * thread-file fallback in invalidateCachedThreadForMessage. The extraction is kept (and reads
 * whatever id field a message may one day carry) so the store is ready the moment the scrape does.
 */
function messageIdsOf(result: Record<string, unknown>): string[] {
  const messages = Array.isArray(result.messages) ? result.messages : [];
  const ids: string[] = [];
  for (const m of messages) {
    const candidate = (m as { id?: unknown; messageId?: unknown })?.id ?? (m as { messageId?: unknown })?.messageId;
    if (typeof candidate === "string" && candidate) ids.push(candidate);
  }
  return ids;
}

// --- Public API: read ------------------------------------------------------

/**
 * The cached copy for `threadId`, or null to read live. `params.forceRefresh` / `params.bypassCache`
 * skip the cache; `params.freshAfter` (epoch ms) refuses a copy read before that instant. An expired
 * entry is removed and missed. A hit is the stored result with `fromCache: true` and `cachedAt` added.
 */
export function readCachedThread(
  threadId: string,
  params: { forceRefresh?: boolean; bypassCache?: boolean; freshAfter?: number } | undefined,
  now: number = Date.now(),
): CachedThread | null {
  if (!threadId) return null;
  if (params?.forceRefresh === true || params?.bypassCache === true) {
    console.error(`[gmail-cache] BYPASS thread=${threadId} (forceRefresh)`);
    return null;
  }

  const dir = threadCacheDir();
  const file = threadFile(dir, threadId);
  const stored = readJson<StoredThread>(file);
  if (!stored || typeof stored.cachedAt !== "number") return null;

  if (now - stored.cachedAt > THREAD_CACHE_TTL_MS) {
    safeUnlink(file);
    return null;
  }

  const freshAfter = params?.freshAfter;
  if (typeof freshAfter === "number" && Number.isFinite(freshAfter) && stored.cachedAt < freshAfter) {
    console.error(`[gmail-cache] BYPASS thread=${threadId} (freshAfter)`);
    return null;
  }

  console.error(`[gmail-cache] HIT thread=${threadId} age=${Math.round((now - stored.cachedAt) / 1000)}s`);
  return { ...stored.result, fromCache: true, cachedAt: stored.cachedAt };
}

// --- Public API: write -----------------------------------------------------

/**
 * Store a COMPLETE thread read. Incomplete or empty results are refused (returns false). Provenance
 * fields from a served copy are stripped before storing. Opportunistically prunes once the mailbox's
 * dir grows past the trigger. Never throws — a cache write must not affect the caller's result.
 */
export function writeCachedThread(
  threadId: string,
  result: unknown,
  now: number = Date.now(),
): boolean {
  if (!threadId || !isCompleteRead(result)) return false;

  const clean = stripProvenance(result);
  const entry: StoredThread = { cachedAt: now, messageIds: messageIdsOf(clean), result: clean };

  const dir = threadCacheDir();
  if (!writeJsonAtomic(dir, threadFile(dir, threadId), entry)) return false;

  console.error(`[gmail-cache] STORE thread=${threadId}`);
  if (listThreadFiles(dir).length > PRUNE_TRIGGER_FILES) pruneExpiredThreadCache(now);
  return true;
}

// --- Public API: invalidation ----------------------------------------------

/** Drop one thread's cached copy. Returns whether an entry was actually removed. */
export function invalidateCachedThread(threadId: string, why: string): boolean {
  if (!threadId) return false;
  const file = threadFile(threadCacheDir(), threadId);
  if (readJson<StoredThread>(file) === null) return false;
  safeUnlink(file);
  console.error(`[gmail-cache] INVALIDATE thread=${threadId} (${why})`);
  return true;
}

/**
 * Drop every cached thread that CONTAINS `messageId`. Scans the store for entries whose stored
 * messageIds include it, and — because the write scripts address a thread by its message/thread id
 * in the URL, and today's scrape stores no per-message ids — also drops a direct `t-<messageId>`
 * entry. Returns how many entries were removed.
 */
export function invalidateCachedThreadForMessage(messageId: string, why: string): number {
  if (!messageId) return 0;
  const dir = threadCacheDir();
  let removed = 0;

  for (const name of listThreadFiles(dir)) {
    const file = join(dir, name);
    const stored = readJson<StoredThread>(file);
    if (stored && Array.isArray(stored.messageIds) && stored.messageIds.includes(messageId)) {
      safeUnlink(file);
      removed++;
    }
  }

  // The write script's `messageId` is the thread locator (`#inbox/<messageId>`); drop that thread too.
  if (invalidateCachedThread(messageId, why)) removed++;
  if (removed > 0) console.error(`[gmail-cache] INVALIDATE message=${messageId} removed=${removed} (${why})`);
  return removed;
}

/** Remember which thread a draft belongs to, so a later draft-only write can invalidate the thread. */
export function rememberDraftThread(draftId: string, threadId: string): boolean {
  if (!draftId || !threadId) return false;
  const dir = threadCacheDir();
  return writeJsonAtomic(dir, draftFile(dir, draftId), { threadId, at: Date.now() });
}

/** Drop the thread a draft belongs to (looked up via rememberDraftThread), and forget the mapping. */
export function invalidateCachedThreadForDraft(draftId: string, why: string): boolean {
  if (!draftId) return false;
  const dir = threadCacheDir();
  const file = draftFile(dir, draftId);
  const mapping = readJson<{ threadId?: string }>(file);
  if (!mapping?.threadId) return false;
  const invalidated = invalidateCachedThread(mapping.threadId, why);
  safeUnlink(file);
  return invalidated;
}

// --- Maintenance -----------------------------------------------------------

/**
 * Remove expired entries, then hard-cap the mailbox at `maxEntries` (evicting the oldest by
 * `cachedAt`). Opportunistic and best-effort: called from writeCachedThread once the dir is large,
 * never on the hot read path. `maxEntries` is a parameter only so a test can drive eviction without
 * writing thousands of files; production always uses the default.
 */
export function pruneExpiredThreadCache(now: number, maxEntries: number = MAX_ENTRIES): void {
  const dir = threadCacheDir();
  const live: Array<{ file: string; cachedAt: number }> = [];

  for (const name of listThreadFiles(dir)) {
    const file = join(dir, name);
    const stored = readJson<StoredThread>(file);
    const cachedAt = stored?.cachedAt;
    if (typeof cachedAt !== "number" || now - cachedAt > THREAD_CACHE_TTL_MS) {
      safeUnlink(file);
      continue;
    }
    live.push({ file, cachedAt });
  }

  if (live.length <= maxEntries) return;
  live.sort((a, b) => a.cachedAt - b.cachedAt); // oldest first
  for (const { file } of live.slice(0, live.length - maxEntries)) safeUnlink(file);
}
