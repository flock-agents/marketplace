/**
 * WhatsApp: what every function shares. Flock's browser on the WhatsApp sign-in (one persistent
 * session per run, always closed before the run answers), the screen WhatsApp Web shows (chats,
 * signed out, "Use here", still loading), and opening one existing chat by its exact name.
 */
import { FLOCK_API, emitResult } from "../../_shared/_helpers";
import { errorJson } from "../../_shared/_grocery_helpers";
import { LimitHit, takeSlot, addOpenTime } from "./_limits";
import {
  WHATSAPP_URL, SCREEN_PROBE_JS, MARK_SEARCH_JS, useHereActions, findRowScript, searchActions, searchResultsScript, openRowActions, parse,
  type ScreenProbe, type SearchRead,
} from "./_page";

export const PARAMS: Record<string, unknown> = parse(process.env.SKILL_PARAMS || "{}") ?? {};
const sessionName = process.env.BROWSER_SESSION || "";
const agentId = process.env.FLOCK_AGENT_ID || "";

/** How long WhatsApp Web may take to show the chats (it syncs first after a while away). */
const LOAD_WAIT_MS = 60_000;
const POLL_MS = 3000;
/** What a run needs after the chats show (finding a chat, reading, typing, closing). */
const AFTER_LOAD_MS = 20_000;
const MIN_LOAD_WAIT_MS = 5_000;

/** When this run started holding WhatsApp Web open (0: it never did). */
let startedAt = 0;

export const SIGN_IN_AGAIN = "Sign in again with the whatsapp skill's own Sign-in steps (instructions.md, Sign-in): the person links WhatsApp with a code on their phone. Do not retry before that.";

/** A refusal to report: thrown inside the run, so the session closes before the script exits. */
export class Fail extends Error { constructor(public code: string, msg: string) { super(msg); } }
export const fail = (code: string, msg: string): never => { throw new Fail(code, msg); };

const headers = () => ({ "Content-Type": "application/json", "Authorization": `Bearer ${process.env.FLOCK_AUTH_TOKEN || ""}` });

async function post(path: string, body: Record<string, unknown>): Promise<{ status: number; body: any }> {
  const resp = await fetch(`${FLOCK_API}${path}`, { method: "POST", headers: headers(), body: JSON.stringify(body) });
  const text = await resp.text();
  return { status: resp.status, body: parse(text) ?? { content: text } };
}

/** Flock refusing the fetch (never WhatsApp): its code is in `error` or `code`, so both are read. */
export function refusalOf(status: number, body: any): Fail | null {
  if (status < 400) return null;
  const codes = [String(body?.error ?? ""), String(body?.code ?? "")];
  const detail = String(body?.message ?? body?.error ?? "no message");
  if (codes.includes("session_not_ready")) return new Fail("SESSION_NOT_READY", `The WhatsApp sign-in (${sessionName}) is not ready. ${SIGN_IN_AGAIN}`);
  if (codes.includes("session_not_found")) return new Fail("SESSION_NOT_FOUND", `Flock has no WhatsApp sign-in named ${sessionName}. ${SIGN_IN_AGAIN}`);
  if (codes.includes("access_denied")) return new Fail("ACCESS_DENIED", `Flock refused this read and never opened WhatsApp: ${detail}`);
  if (codes.includes("session_handed_off") || codes.includes("site_handed_off")) return new Fail("HANDED_OFF", "The person has the WhatsApp window open right now. Try again once they are done.");
  if (codes.includes("prep_stop")) return new Fail("PREP_STOP", detail);
  if (status === 429) return new Fail("BUSY", `Flock's browser is busy (${detail}). Try again in a few minutes.`);
  return new Fail("BROWSER_ERROR", `Flock's browser could not open WhatsApp (status ${status}): ${detail}`);
}

async function browserFetch(body: Record<string, unknown>): Promise<any> {
  const r = await post("/api/internal/browser-fetch", { sessionName, agentId, ...body });
  const refusal = refusalOf(r.status, r.body);
  if (refusal) throw refusal;
  return r.body;
}

let opened = "";

/** One step on the open page: `actions`, then `script`'s answer. */
export async function step<T>(actions: any[], script: string): Promise<T | null> {
  const r = await browserFetch({ persistentSessionId: opened, pageActions: [...actions, { action: "evaluate", script }] });
  return parse<T>(r?.content);
}

async function markOutdated(): Promise<void> {
  await post(`/api/internal/browser-sessions/${encodeURIComponent(sessionName)}/mark-outdated`, {
    agentId, reason: "WhatsApp Web showed its log-in screen (QR code) instead of the chats",
  }).catch(() => {});
}

/** Opens WhatsApp Web and waits for the chats, after taking its slot (_limits.ts; `send` takes a send
 *  too). The wait is cut short when little of today's open time is left. Signed out: the sign-in is
 *  marked outdated and the run refuses. "Use here" (WhatsApp open in another window of this same
 *  browser): clicked once. */
export async function openWhatsApp(kind: "read" | "send" = "read"): Promise<void> {
  const left = takeSlot(kind);
  const loadWait = Math.max(MIN_LOAD_WAIT_MS, Math.min(LOAD_WAIT_MS, left - AFTER_LOAD_MS));
  startedAt = Date.now();
  const first = await browserFetch({ url: WHATSAPP_URL, createPersistentSession: true, pageActions: [{ action: "wait", delay: POLL_MS }, { action: "evaluate", script: SCREEN_PROBE_JS }] });
  opened = first?.persistentSessionId || "";
  if (!opened) fail("BROWSER_ERROR", "Flock's browser opened no window for WhatsApp.");
  let probe = parse<ScreenProbe>(first?.content);
  let usedHere = false;
  for (const started = Date.now(); Date.now() - started < loadWait;) {
    if (probe?.screen === "chats") return;
    if (probe?.screen === "logged_out") {
      await markOutdated();
      fail("SESSION_OUTDATED", `WhatsApp is signed out on Flock's browser (its log-in screen showed). ${SIGN_IN_AGAIN}`);
    }
    if (probe?.screen === "use_here" && !usedHere) {
      usedHere = true;
      probe = await step<ScreenProbe>(useHereActions(), SCREEN_PROBE_JS);
      continue;
    }
    probe = await step<ScreenProbe>([{ action: "wait", delay: POLL_MS }], SCREEN_PROBE_JS);
  }
  fail("NOT_LOADED", `WhatsApp Web did not show the chats in time (it showed: ${probe?.screen ?? "nothing readable"}${probe?.detail ? `, "${probe.detail}"` : ""}). Try again later.`);
}

/** Opens the existing chat named exactly `name`: from the chat list, else from the Chats section of
 *  WhatsApp's own search. A contact with no chat yet, or a new number, is never opened. Then `script`
 *  answers on the open chat. */
export async function openChat<T>(name: string, script: string): Promise<T | null> {
  const row = await step<{ found: boolean }>([], findRowScript(name));
  if (!row?.found) {
    const box = await step<{ found: boolean }>([], MARK_SEARCH_JS);
    if (!box?.found) fail("PAGE_CHANGED", "WhatsApp Web's search box was not found: its page may have changed.");
    const results = await step<SearchRead & { found?: boolean }>(searchActions(name), searchResultsScript(5, name));
    if (!results?.sections) fail("CHAT_NOT_FOUND", `Could not tell chats from other search results for "${name}", so nothing was opened. Check the exact name with list-chats.`);
    if (!results?.found) fail("CHAT_NOT_FOUND", `No chat named exactly "${name}" in the chat list. Only existing chats can be read or sent to: check the exact name with list-chats.`);
  }
  return step<T>(openRowActions(), script);
}

/** Runs `body` with WhatsApp Web open, closes the window it opened, then answers its result or its refusal. */
export async function main(body: () => Promise<Record<string, unknown>>): Promise<never> {
  if (!sessionName) errorJson("NO_AUTH", `WhatsApp is not linked to Flock yet. ${SIGN_IN_AGAIN}`);
  if (!agentId) errorJson("MISSING_AGENT", "FLOCK_AGENT_ID is not set; run it with the run_skill tool (skill whatsapp).");
  let result: Record<string, unknown> | null = null;
  let failure: Fail | null = null;
  try {
    result = await body();
  } catch (e: any) {
    if (e instanceof Fail) failure = e;
    else if (e instanceof LimitHit) failure = new Fail(e.code, e.message);
    else failure = new Fail("SCRIPT_ERROR", String(e?.message ?? e));
  } finally {
    if (opened) await post("/api/internal/browser-fetch", { sessionName, agentId, persistentSessionId: opened, closePersistentSession: true }).catch(() => {});
  }
  const minutesLeftToday = startedAt ? countOpenTime(Date.now() - startedAt) : null;
  if (failure) errorJson(failure.code, minutesLeftToday === null ? failure.message : `${failure.message} (${minutesLeftToday} minutes of WhatsApp time left today.)`);
  emitResult({ ...result, ...(minutesLeftToday === null ? {} : { minutesLeftToday }) });
  process.exit(0);
}

/** Adds the run's open time to today's total, even for a failed run; null when it cannot be kept. */
function countOpenTime(ms: number): number | null {
  try { return addOpenTime(ms); } catch { return null; }
}

/** A whole number param within [1, max], else `fallback`. */
export function count(value: unknown, fallback: number, max: number): number {
  const n = parseInt(String(value ?? ""), 10);
  return Number.isFinite(n) && n >= 1 ? Math.min(n, max) : fallback;
}

/** Whether two chat names are the same, case and spacing aside. */
export function sameName(a: string, b: string): boolean {
  const key = (s: string) => s.normalize("NFKC").replace(/\s+/g, " ").trim().toLowerCase();
  return key(a) === key(b);
}

/** A one-line text param, trimmed, or "". */
export function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
