// trashMessage.ts — move threads to Gmail's Trash. `{ threadIds: string[] }` (1-50) ->
// `{ trashed: string[], failed: [{ threadId, reason }] }`.
//
// WHY THIS EXISTS (irreversible-action guard, owner 2026-10-25). An agent acting on its own never
// completes an irreversible step without the owner's OK, and deleting mail is offered as THIS function
// rather than as browser clicks: its manifest effect is "destructive", so skill-approval-gate.ts runs it
// in the owner's own turn and turns it into an approval card anywhere else (Approve runs exactly this
// call once). Nothing here checks who is asking; the gate does that before the script starts.
//
// WHAT IT DOES, AND NEVER DOES. For each thread: open it on ONE held, signed-in Gmail page (one session
// for the batch, like getThreads), press the toolbar's plain "Delete" — Gmail's move-to-Trash, which the
// owner can undo from Trash for 30 days — and count the thread only once Gmail confirms it ("Conversation
// moved to Trash", or the thread view closing with no Delete left). It NEVER presses "Delete forever" and
// NEVER "Empty Trash": the control must be labelled exactly "Delete", anything naming forever / permanent
// / empty is excluded, and a thread already in Trash or Spam (where Gmail offers only "Delete forever") is
// reported failed and left alone.
//
// GMAIL IGNORES .click() on its toolbar divs (memory "Gmail toolbar needs mouse events", live 2026-09-24):
// the press is mousedown, mouseup, click on the VISIBLE control — pressGmailButton, inlined.
//
// IMAP (app-password connections, no browser session): gmail-imap.py cmd_trash copies each message to the
// Trash folder FIRST and only then removes it from INBOX, mirroring cmd_archive's copy-first safety. A .ts
// script always wins over the .sh twin in skill-executor's lookup, so this script hands IMAP off itself.

import {
  errorJson,
  emitResult,
  requireBrowserSession,
  persistentCreate,
  persistentInteractRaw,
  persistentClose,
} from "../../_shared/_google_helpers";
import { gmailViewUrl } from "./_gmailNav";
import { isOnScreen, pressGmailButton, findGmailNotice } from "./_gmailPress";
import { invalidateCachedThreadForMessage } from "./_threadCache";

export const MAX_TRASH_THREADS = 50;

export type TrashFailure = { threadId: string; reason: string };
export type TrashResult = { trashed: string[]; failed: TrashFailure[] };

/** Same id alphabet as validateId (`_google_helpers.ts`): ids go into a Gmail URL fragment. */
const ID_RE = /^[A-Za-z0-9_-]+$/;

/**
 * Validate and dedupe the caller's ids. The ids are the ones listInbox / searchEmails / getThreads
 * return (Gmail's legacy thread id; numeric message ids on an IMAP connection); a `#thread-f:` prefix is
 * stripped exactly as getThreads strips it. ONE malformed id refuses the whole call: a destructive batch
 * is never half-run on input the caller got wrong.
 */
export function normalizeThreadIds(raw: unknown):
  | { ok: true; ids: string[] }
  | { ok: false; code: "MISSING_PARAM" | "TOO_MANY_IDS" | "INVALID_ID"; message: string } {
  if (!Array.isArray(raw) || raw.length === 0) {
    return { ok: false, code: "MISSING_PARAM", message: `threadIds is required: an array of 1-${MAX_TRASH_THREADS} thread ids` };
  }
  const ids: string[] = [];
  for (const v of raw) {
    if (typeof v !== "string") return { ok: false, code: "INVALID_ID", message: "every threadId must be a string" };
    let id = v.trim();
    if (id.startsWith("#thread-f:")) id = id.slice("#thread-f:".length);
    else if (id.startsWith("thread-f:")) id = id.slice("thread-f:".length);
    if (!id || !ID_RE.test(id)) return { ok: false, code: "INVALID_ID", message: `threadId ${JSON.stringify(v).slice(0, 40)} is not a Gmail thread id` };
    if (!ids.includes(id)) ids.push(id);
  }
  if (ids.length > MAX_TRASH_THREADS) {
    return { ok: false, code: "TOO_MANY_IDS", message: `at most ${MAX_TRASH_THREADS} threadIds per call (got ${ids.length}); split the batch` };
  }
  return { ok: true, ids };
}

export interface TrashScriptTiming {
  /** How long to wait for THIS thread's view and its toolbar to render (a cold Gmail takes ~20s). */
  readyMs: number;
  /** How long to wait for Gmail to confirm after the press. */
  confirmMs: number;
  /** Fixed wait after the confirmation, so Gmail's request is not aborted by the next navigation
   *  (the same async-apply trap MARK_UNREAD_SCRIPT documents for Mark as unread). */
  flushMs: number;
}

const LIVE_TIMING: TrashScriptTiming = { readyMs: 20_000, confirmMs: 8_000, flushMs: 1_500 };

/**
 * In-page, on `#all/<threadId>`: wait for that thread, press its plain Delete, wait for Gmail's word.
 * Returns a JSON string `{ result, confirm?, notice?, n }`:
 *   result "trashed"          — pressed, and Gmail confirmed (confirm "toast" | "nav")
 *          "unconfirmed"      — pressed, Gmail said nothing within confirmMs: NOT counted as trashed
 *          "in-trash-or-spam" — only "Delete forever" offered: nothing pressed
 *          "no-control"       — no eligible Delete on screen: nothing pressed
 *          "not-open"         — the asked thread never showed (another thread, or no thread): nothing pressed
 *
 * CANDIDATES follow MARK_UNREAD_SCRIPT's structural rules (_unreadState.ts): aria-label, data-tooltip or
 * title; a button (`role=button`, or inside one or the thread toolbar `[gh="mtb"]`); not an `<a>`; not in
 * a message body or list item — so mail that carries its own "Delete" button cannot steer the press.
 * The label must be EXACTLY "Delete" (case-insensitive, bidi marks trimmed): "Delete forever", "Delete
 * this message", "Empty Trash now" never match, and any label naming forever/permanent/empty disqualifies
 * the element outright. The first visible one in the thread toolbar wins, else the last visible one.
 */
export function trashThreadScript(threadId: string, timing: TrashScriptTiming = LIVE_TIMING): string {
  return `(async () => {
  var want = ${JSON.stringify(threadId)};
  var DELETE_RE = /^[\\s\\u200e\\u200f\\u202a-\\u202e]*delete[\\s\\u200e\\u200f\\u202a-\\u202e]*$/i;
  var FOREVER_RE = /delete forever/i;
  var NEVER_RE = /forever|permanent|empty/i;
  var TOAST_RE = /moved to (?:the )?(?:trash|bin)/i;
  var BODY_SEL = '.a3s, .ii, .adn, [role="listitem"], .gs';
  var TOOLBAR_SEL = '[gh="mtb"]';
  var onScreen = ${isOnScreen.toString()};
  var press = ${pressGmailButton.toString()};
  var notice = ${findGmailNotice.toString()};
  var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
  function labels(el) {
    return [el.getAttribute('aria-label') || '', el.getAttribute('data-tooltip') || '', el.getAttribute('title') || ''];
  }
  function eligible(el) {
    if (String(el.tagName || '').toUpperCase() === 'A') return false;
    if (el.closest(BODY_SEL)) return false;
    return el.getAttribute('role') === 'button' || !!el.closest('[role="button"], ' + TOOLBAR_SEL);
  }
  function controls(re) {
    return Array.from(document.querySelectorAll('[aria-label], [data-tooltip], [title]')).filter(function (el) {
      return labels(el).some(function (l) { return re.test(l); }) && eligible(el) && onScreen(el);
    });
  }
  function deleteControls() {
    return controls(DELETE_RE).filter(function (el) { return !labels(el).some(function (l) { return NEVER_RE.test(l); }); });
  }
  function threadShown() {
    var h = document.querySelector('h2.hP');
    if (!h) return false;
    var shown = h.getAttribute('data-legacy-thread-id') || '';
    // The heading names its thread: it must be the one asked for. Only a heading that names none falls
    // back to the URL; a different id on screen is never this thread.
    return shown ? shown === want : location.hash.indexOf(want) >= 0;
  }
  var readyDeadline = Date.now() + ${Math.max(0, Math.floor(timing.readyMs))};
  while (Date.now() < readyDeadline) {
    if (threadShown() && (deleteControls().length > 0 || controls(FOREVER_RE).length > 0)) break;
    await sleep(100);
  }
  var n = controls(DELETE_RE).length;
  if (!threadShown()) return JSON.stringify({ result: 'not-open', n: n });
  var pool = deleteControls();
  if (pool.length === 0) {
    return JSON.stringify({ result: controls(FOREVER_RE).length > 0 ? 'in-trash-or-spam' : 'no-control', n: n });
  }
  var b = pool.filter(function (el) { return !!el.closest(TOOLBAR_SEL); })[0] || pool[pool.length - 1];
  if (!press(b)) return JSON.stringify({ result: 'no-control', n: n });
  var confirm = '';
  var seen = '';
  var deadline = Date.now() + ${Math.max(0, Math.floor(timing.confirmMs))};
  while (Date.now() < deadline) {
    seen = notice(document, TOAST_RE);
    if (seen) { confirm = 'toast'; break; }
    if (location.hash.indexOf(want) < 0 && !threadShown() && deleteControls().length === 0) { confirm = 'nav'; break; }
    await sleep(100);
  }
  if (!confirm) return JSON.stringify({ result: 'unconfirmed', n: n });
  await sleep(${Math.max(0, Math.floor(timing.flushMs))});
  return JSON.stringify({ result: 'trashed', confirm: confirm, notice: seen, n: n });
})()`;
}

export type TrashOutcome = { result: "trashed" | "unconfirmed" | "in-trash-or-spam" | "no-control" | "not-open" | "error"; confirm?: string };

/** Read the script's answer; it may arrive JSON-string-wrapped once more. Anything unreadable is "error",
 *  never "trashed". */
export function parseTrashOutcome(content: unknown): TrashOutcome {
  let value: unknown = content;
  for (let i = 0; i < 2 && typeof value === "string"; i++) {
    try { value = JSON.parse(value); } catch { break; }
  }
  const known = ["trashed", "unconfirmed", "in-trash-or-spam", "no-control", "not-open"];
  if (value && typeof value === "object" && known.includes((value as any).result)) {
    const v = value as { result: TrashOutcome["result"]; confirm?: unknown };
    return typeof v.confirm === "string" && v.confirm ? { result: v.result, confirm: v.confirm } : { result: v.result };
  }
  return { result: "error" };
}

const REASONS: Record<Exclude<TrashOutcome["result"], "trashed">, string> = {
  "unconfirmed": "not_confirmed: Delete was pressed but Gmail did not confirm the move to Trash; check Trash before trying again",
  "in-trash-or-spam": "already_in_trash_or_spam: Gmail offers only Delete forever for this thread, so nothing was done",
  "no-control": "no_delete_control: the thread opened but Gmail showed no Delete button; nothing was done",
  "not-open": "not_open: this thread did not open (check the id); nothing was done",
  "error": "browser_error: the page gave no readable answer; check Trash before trying again",
};

/** The browser as trashThreads needs it — a seam so the loop is testable without one. */
export interface TrashIo {
  /** Open `threadId` on the held page and run its trash script; the script's content. Throws on a
   *  failed step; an error with `fatal: true` (Flock refused the session) stops the batch. */
  open(threadId: string): Promise<unknown>;
  close(): Promise<void>;
  invalidate(threadId: string): void;
  sleep(ms: number): Promise<void>;
  now(): number;
}

/**
 * Trash each id in turn on one held page. ONE THREAD'S FAILURE IS ONE THREAD'S FAILURE (getThreads'
 * rule): it is recorded with its reason and the loop moves on — except a refused session, after which
 * nothing else can run either. Ids the budget does not reach come back `not_attempted`, so the caller
 * can call again with exactly those. Every thread a press may have changed has its cached copy dropped.
 * Never throws; always closes the page.
 */
export async function trashThreads(
  ids: string[],
  io: TrashIo,
  opts: { budgetMs: number; paceMinMs: number; paceMaxMs: number },
): Promise<TrashResult> {
  const trashed: string[] = [];
  const failed: TrashFailure[] = [];
  const started = io.now();
  let stop = "";
  try {
    for (let i = 0; i < ids.length; i++) {
      const id = ids[i];
      if (stop) { failed.push({ threadId: id, reason: `not_attempted: ${stop}` }); continue; }
      if (io.now() - started >= opts.budgetMs) {
        stop = "this call ran out of time; call trashMessage again with this id";
        failed.push({ threadId: id, reason: `not_attempted: ${stop}` });
        continue;
      }
      try {
        const outcome = parseTrashOutcome(await io.open(id));
        if (outcome.result === "trashed") trashed.push(id);
        else failed.push({ threadId: id, reason: REASONS[outcome.result] });
        // Pressed (confirmed or not) or unreadable: the thread may have changed, so no cached copy survives.
        if (outcome.result === "trashed" || outcome.result === "unconfirmed" || outcome.result === "error") io.invalidate(id);
      } catch (e: any) {
        failed.push({ threadId: id, reason: `browser_error: ${String(e?.message || e).slice(0, 160)}; check Trash before trying again` });
        io.invalidate(id);
        if (e?.fatal) stop = "Flock refused the Gmail browser session; reconnect it, then call again";
      }
      if (i < ids.length - 1 && !stop && opts.paceMaxMs > 0) {
        const spread = Math.max(0, opts.paceMaxMs - opts.paceMinMs);
        await io.sleep(opts.paceMinMs + Math.round(spread * (((i * 2654435761) % 1000) / 1000)));
      }
    }
  } finally {
    await io.close().catch(() => {});
  }
  return { trashed, failed };
}

// Whole-call wall clock the loop is budgeted against: under the manifest's timeoutMs (330s) with room for
// the shell load and the close. A thread is ~10-25s (cold load, press, confirmation, flush) plus pacing.
const BUDGET_MS = 280_000;
const HOLD_GRACE_MS = 30_000;
const PACE_MIN_MS = 1_000;
const PACE_MAX_MS = 3_000;

/** IMAP connection (no browser session): run gmail-imap.py's cmd_trash with the validated ids. */
function runImap(ids: string[]): void {
  const { join } = require("path") as typeof import("path");
  const py = Bun.which("python3") ? ["python3"] : Bun.which("python") ? ["python"] : Bun.which("py") ? ["py", "-3"] : null;
  if (!py) errorJson("PYTHON_NOT_FOUND", "This function needs Python 3 and none was found on PATH (tried python3, python, py -3). Install Python 3, or use a browser session instead.");
  const proc = Bun.spawnSync([...py, join(import.meta.dir, "gmail-imap.py")], {
    env: { ...process.env, SKILL_FUNCTION: "trashMessage", SKILL_PARAMS: JSON.stringify({ threadIds: ids }) },
    stdout: "pipe",
    stderr: "pipe",
  });
  const out = proc.stdout.toString().trim();
  const err = proc.stderr.toString().trim();
  if (proc.exitCode !== 0 || !out) {
    let message = err || out || `gmail-imap.py exited ${proc.exitCode}`;
    try { message = JSON.parse(err).error || message; } catch { /* plain text */ }
    errorJson("IMAP_ERROR", String(message).slice(0, 300));
  }
  let parsed: unknown;
  try { parsed = JSON.parse(out); } catch { errorJson("IMAP_ERROR", "gmail-imap.py returned no readable result; check Trash before trying again"); }
  emitResult(parsed);
}

if (process.env.SKILL_PARAMS !== undefined) {
  runScript();
}

function runScript(): void {
  let params: any = {};
  try { params = JSON.parse(process.env.SKILL_PARAMS || "{}"); } catch { params = {}; }
  const norm = normalizeThreadIds(params?.threadIds);
  if (!norm.ok) errorJson(norm.code, norm.message);
  const ids = norm.ids;

  if (!process.env.BROWSER_SESSION && process.env.SECRET_IMAP_CREDENTIALS) {
    runImap(ids);
    return;
  }
  requireBrowserSession();

  let psId = "";
  const io: TrashIo = {
    async open(threadId) {
      if (!psId) {
        // Establish on the inbox with no actions: a failure here exits before anything was pressed.
        const res = await persistentCreate(gmailViewUrl("#inbox"), undefined, { holdLock: true, holdMaxMs: BUDGET_MS + HOLD_GRACE_MS });
        psId = res?.persistentSessionId || "";
        if (!psId) throw Object.assign(new Error("Failed to create a persistent Gmail session"), { fatal: true });
      }
      // A cross-document load per thread (gmailViewUrl's nonce): a same-document hash hop could leave the
      // previous thread on screen, and the script's identity check would then refuse it anyway.
      const { httpCode, body } = await persistentInteractRaw(psId, [{ action: "evaluate", script: trashThreadScript(threadId) }], false, undefined, gmailViewUrl(`#all/${threadId}`));
      if (httpCode >= 400) {
        throw Object.assign(new Error(`HTTP ${httpCode}: ${body?.error || body?.message || "(unknown)"}`), { fatal: httpCode === 403 });
      }
      return body?.content;
    },
    async close() {
      if (psId) await persistentClose(psId);
    },
    invalidate(threadId) {
      invalidateCachedThreadForMessage(threadId, "trashMessage");
    },
    sleep: (ms) => new Promise<void>((r) => setTimeout(r, Math.max(0, ms))),
    now: () => Date.now(),
  };

  trashThreads(ids, io, { budgetMs: BUDGET_MS, paceMinMs: PACE_MIN_MS, paceMaxMs: PACE_MAX_MS })
    .then((result) => emitResult(result))
    .catch((e: any) => errorJson("BROWSER_ERROR", `trashMessage aborted: ${e?.message || e}; check Trash before trying again`));
}
