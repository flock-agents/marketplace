/** Client for the app kit's uniform routes (`./api/_data/*`, `./api/_me`, `./api/_agent/*`). */

/** A failed kit call. `status` 0 = the app could not be reached. The kit's 400 is `{error, field, message}`. */
export class KitError extends Error {
  status: number; body: any;
  constructor(status: number, body: any) {
    super(body?.message ?? body?.error ?? `HTTP ${status}`);
    this.name = "KitError"; this.status = status; this.body = body;
  }
  get field(): string | undefined { return typeof this.body?.field === "string" ? this.body.field : undefined; }
}

const VIEWER_KEY = "flock.kit.viewer";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** crypto.getRandomValues works on plain-http origins (randomUUID does not), so it is the fallback. */
function uuid(): string {
  const b = new Uint8Array(16); globalThis.crypto.getRandomValues(b);
  b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
let memoryViewer: string | null = null;
/** The anonymous viewer id (public apps send no X-Flock-User). Kept in localStorage; every access is guarded. */
export function viewerId(): string {
  if (memoryViewer) return memoryViewer;
  try { const s = localStorage.getItem(VIEWER_KEY); if (s && UUID.test(s)) return (memoryViewer = s); } catch { /* storage unavailable */ }
  memoryViewer = uuid();
  try { localStorage.setItem(VIEWER_KEY, memoryViewer); } catch { /* keep the in-memory id */ }
  return memoryViewer;
}

/** Guarded localStorage: a blocked or full store reads as empty and writes are dropped. */
export const store = {
  get(k: string): string | null { try { return localStorage.getItem(k); } catch { return null; } },
  set(k: string, v: string): void { try { localStorage.setItem(k, v); } catch { /* keep going without it */ } },
  remove(k: string): void { try { localStorage.removeItem(k); } catch { /* */ } },
};

export async function kitFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  headers.set("X-Kit-Viewer", viewerId());
  let res: Response;
  try { res = await fetch(`./api/${path.replace(/^\/+/, "")}`, { ...init, headers }); }
  catch { throw new KitError(0, { error: "offline", message: "Couldn't reach the app" }); }
  const body = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) throw new KitError(res.status, body);
  // A write through the kit (create, edit, delete, undo, Clear samples) refreshes every list on the page, whichever hook made it.
  if (/^_data\//.test(path.replace(/^\/+/, "")) && (init.method ?? "GET").toUpperCase() !== "GET") refreshKitData();
  return body as T;
}

/** Every list and record on the page reloads, as after the change feed reconnects: something changed that no event named
 *  (a write through the kit, or Flock's chat beside the app saying the agent changed it). */
export function refreshKitData(): void { subs.forEach((x) => x.re?.()); }

export interface KitEvent { table: string; op: "insert" | "update" | "delete"; id: string; by: string; at: string }
export interface ConnectOptions {
  url?: string; onReconnect?: () => void; ES?: typeof EventSource; baseDelayMs?: number; maxDelayMs?: number;
  /** Handlers for extra named events (e.g. the agent stream's state/text/done/failed). */
  on?: Record<string, (data: string) => void>;
  /** Also call onReconnect on the very first `ready` (covers writes between the page's first GET and the stream opening). */
  refetchOnFirstReady?: boolean;
  /** Called each time the connection drops (before the retry is scheduled). */
  onError?: () => void;
  /** Close the stream while the page is hidden or in the back/forward cache, reopen when shown. */
  pauseWhenHidden?: boolean;
}

/** Opens an EventSource and keeps it open: after any drop it reconnects with doubling backoff; a `ready` after the
 *  first one calls `onReconnect` (so the caller refetches what it missed). Returns a stop function.
 *  With `pauseWhenHidden` the stream is held only while the page is seen: it closes when the page is hidden or put
 *  in the back/forward cache and reopens when it is shown, its first `ready` then calling `onReconnect`. */
export function connectEvents(onEvent: (e: KitEvent) => void, o: ConnectOptions = {}): () => void {
  const ES = o.ES ?? EventSource; const base = o.baseDelayMs ?? 500; const max = o.maxDelayMs ?? 15_000;
  const raw = o.url ?? "./api/_data/_events";
  const url = `${raw}${raw.includes("?") ? "&" : "?"}viewer=${encodeURIComponent(viewerId())}`;
  let es: EventSource | null = null, delay = base, closed = false, everReady = false, dropped = false, paused = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const open = () => {
    timer = undefined;
    if (closed || paused) return;
    const cur = new ES(url); es = cur;
    cur.addEventListener("ready", () => { if (everReady || dropped || o.refetchOnFirstReady) o.onReconnect?.(); everReady = true; dropped = false; delay = base; });
    cur.addEventListener("change", (m: MessageEvent) => { try { onEvent(JSON.parse(m.data)); } catch { /* ignore malformed */ } });
    for (const [name, fn] of Object.entries(o.on ?? {})) cur.addEventListener(name, (m: MessageEvent) => fn(m.data));
    cur.onerror = () => {
      dropped = true; cur.close(); if (es === cur) es = null;
      if (closed || paused) return; o.onError?.(); if (closed || paused) return;
      timer = setTimeout(open, delay); delay = Math.min(delay * 2, max);
    };
  };
  // Hidden or bfcached: give the socket back (an app shares the Flock host's six with Flock's own tabs).
  const pause = () => {
    if (closed || paused) return;
    paused = true; clearTimeout(timer); timer = undefined;
    if (es) { es.close(); es = null; dropped = true; }
  };
  const resume = () => {
    if (closed || !paused) return; // idempotent: a bfcache restore fires both pageshow and visibilitychange
    paused = false; dropped = true; delay = base; open();   // what happened while paused was missed: the ready refetches
  };
  const seen = () => typeof document === "undefined" || document.visibilityState !== "hidden";
  const onVisibility = () => { if (seen()) resume(); else pause(); };
  // A page receiving input is in use, whatever visibilityState says (a tab driven from behind, a window that never reports visible).
  const onInput = () => resume();
  const onPageShow = (e: Event) => { if ((e as PageTransitionEvent).persisted && seen()) resume(); };
  const watch = !!o.pauseWhenHidden && typeof window !== "undefined" && typeof document !== "undefined";
  if (watch) {
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", pause);
    window.addEventListener("pageshow", onPageShow);
    window.addEventListener("focus", onInput);
    document.addEventListener("pointerdown", onInput, true);
    document.addEventListener("keydown", onInput, true);
    if (!seen()) paused = true;
  }
  open();
  return () => {
    closed = true; clearTimeout(timer); es?.close(); es = null;
    if (watch) {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", pause);
      window.removeEventListener("pageshow", onPageShow);
      window.removeEventListener("focus", onInput);
      document.removeEventListener("pointerdown", onInput, true);
      document.removeEventListener("keydown", onInput, true);
    }
  };
}

/** An owner's change to the app (a new column, a page) is a redeploy: the process restarts and the page's code and schema are
 *  stale. The page's own response carries X-App-Deploy-Id. The id is recorded when the page loads; a later check that sees another
 *  reloads the page, but never over unsaved work: while something is being typed or edited it raises `stale` instead (the shell shows
 *  "App updated · Reload"), and the reload happens when the edit ends or the user asks. Any number of redeploys make one reload. */
let deploySeen: string | null = null;
let stale = false, reloading = false, watching = false;
const staleSubs = new Set<() => void>();
export const resetDeployWatch = () => { deploySeen = null; stale = false; reloading = false; watching = false; staleSubs.forEach((f) => f()); };
export const isStale = () => stale;
export function onStale(fn: () => void): () => void { staleSubs.add(fn); return () => { staleSubs.delete(fn); }; }
/** True while the viewer has something unsent: text in a field, or a dialog open. */
export function isEditing(): boolean {
  if (typeof document === "undefined") return false;
  if (document.querySelector('dialog[open], [role="dialog"], [aria-modal="true"]')) return true;
  return Array.from(document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("textarea, input"))
    .some((el) => !/^(checkbox|radio|button|submit|range|color|hidden)$/.test((el as HTMLInputElement).type ?? "") && el.value.trim() !== "");
}
function settle(reload: () => void) {
  if (reloading) return;
  if (!isEditing()) { reloading = true; reload(); return; }
  if (!stale) { stale = true; staleSubs.forEach((f) => f()); }
  if (watching || typeof document === "undefined") return;
  watching = true;
  const again = () => setTimeout(() => { if (!reloading && !isEditing()) { reloading = true; reload(); } }, 800);
  document.addEventListener("focusout", again, true); document.addEventListener("submit", again, true); document.addEventListener("click", again, true);
}
export function reloadNow() { if (!reloading) { reloading = true; location.reload(); } }
export async function checkDeploy(reload: () => void = () => location.reload()): Promise<void> {
  try {
    const res = await fetch("./", { cache: "no-store" });
    const id = res.headers.get("X-App-Deploy-Id"); if (!id) return;
    if (deploySeen === null) deploySeen = id; else if (id !== deploySeen) settle(reload);
  } catch { /* offline: the next reconnect checks again */ }
}
// The baseline is the deploy this page was loaded from, taken now rather than at the first stream connect.
if (typeof window !== "undefined" && typeof document !== "undefined") {
  void checkDeploy();
  // A page coming back into view checks too: a hidden tab's stream is shut (pauseWhenHidden), so a redeploy made while it was
  // away has no reconnect of its own to be noticed by until the stream reopens (T13: a new column needed a manual reload).
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") void checkDeploy(); });
  window.addEventListener("focus", () => void checkDeploy());
}

// One EventSource per page, shared by every hook AND the open agent chat, held only while the page is seen
// (pauseWhenHidden); on its return the first `ready` refetches what the hooks missed (live run 40b, 2026-10-09: the socket
// pool filled). The browser gives the Flock host six sockets for all its tabs and app pages together, so a page holds one,
// not one for data plus one for chat (T22c): a followed conversation rides it as ?conversationId=, its events naming it.
const subs = new Set<{ fn: (e: KitEvent) => void; re?: () => void }>();
/** What a followed conversation hears: the agent events (raw data, as the server sent it), each `ready` (reload what was
 *  missed), each drop, and `gone` when the conversation is not (or no longer) the viewer's. */
export interface ConversationHandlers {
  ready?: () => void; error?: () => void; gone?: () => void;
  state?: (data: string) => void; text?: (data: string) => void; done?: (data: string) => void; failed?: (data: string) => void;
}
const convs = new Map<string, Set<ConversationHandlers>>();
const CHAT_EVENTS = ["state", "text", "done", "failed", "gone"] as const;
let stopShared: (() => void) | null = null;
let sharedUrl = "";
let restartQueued = false;

function wantedUrl(): string {
  const ids = [...convs.keys()].sort();
  return ids.length ? `./api/_data/_events?${ids.map((id) => `conversationId=${encodeURIComponent(id)}`).join("&")}` : "./api/_data/_events";
}
function everyConv(fn: (h: ConversationHandlers) => void) { for (const set of convs.values()) for (const h of [...set]) fn(h); }
function chatEvent(name: (typeof CHAT_EVENTS)[number], data: string) {
  let id: unknown; try { id = JSON.parse(data)?.conversationId; } catch { /* */ }
  const targets = typeof id === "string" ? [...(convs.get(id) ?? [])] : [...convs.values()].flatMap((s) => [...s]);
  for (const h of targets) { if (name === "gone") h.gone?.(); else h[name]?.(data); }
}
/** Opens, reopens (the followed set changed) or closes the page's one stream. */
function syncShared() {   // idempotent: a queued run after a direct one finds nothing to change
  restartQueued = false;
  const want = subs.size + convs.size > 0;
  const url = wantedUrl();
  if (stopShared && (!want || url !== sharedUrl)) { stopShared(); stopShared = null; }
  if (!want || stopShared || typeof EventSource === "undefined") return;
  sharedUrl = url;
  stopShared = connectEvents((e) => subs.forEach((x) => x.fn(e)), {
    url, pauseWhenHidden: true, refetchOnFirstReady: true,
    onReconnect: () => { void checkDeploy(); subs.forEach((x) => x.re?.()); everyConv((h) => h.ready?.()); },
    onError: () => everyConv((h) => h.error?.()),
    on: Object.fromEntries(CHAT_EVENTS.map((n) => [n, (d: string) => chatEvent(n, d)])),
  });
}
/** Coalesces a switch (unfollow + follow in one commit) into one reopen. */
function queueSync() { if (restartQueued) return; restartQueued = true; queueMicrotask(syncShared); }

export function subscribeEvents(fn: (e: KitEvent) => void, onReconnect?: () => void): () => void {
  const s = { fn, re: onReconnect }; subs.add(s); syncShared();
  return () => { subs.delete(s); syncShared(); };
}

/** Follows a conversation's agent events on the page's one stream. Returns the unfollow. */
export function followConversation(id: string, handlers: ConversationHandlers): () => void {
  let set = convs.get(id); if (!set) convs.set(id, (set = new Set()));
  set.add(handlers); queueSync();
  return () => {
    const cur = convs.get(id); if (!cur) return;
    cur.delete(handlers); if (!cur.size) convs.delete(id);
    queueSync();
  };
}
