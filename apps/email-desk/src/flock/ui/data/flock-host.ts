import { useEffect, useState } from "react";

/** What Flock tells an app's page about where it is shown. Flock puts its markers in the frame's location.search (ahead of
 *  any #hash, so the app's own hash routing keeps them): `flock_host=chat` when the app is open beside a Flock chat (or that
 *  chat's full screen), `flock_host=viewer` on Flock's app page, and `flock_session=<id>` for the chat it was opened from. */
export const HOST_PARAM = "flock_host";
export const HOST_CHAT = "chat";
/** `flock_host=viewer`: the app is on Flock's app page (/apps/view), under Flock's bar that already names it. */
export const HOST_VIEWER = "viewer";
export const SESSION_PARAM = "flock_session";
/** Only Flock adds `flock_from=chat`, to an app it opens from a chat (beside it, a chat card, a chat's full screen). Never
 *  written by the kit: its own chat names its session in flock_session, which an app opened on its own carries too. */
export const FROM_PARAM = "flock_from";
export const FROM_CHAT = "chat";

function param(name: string): string | null {
  try { return new URLSearchParams(window.location.search).get(name) || null; } catch { return null; }
}

/** True when the app is open beside a Flock chat: that chat is the app's, so the app shows none of its own. */
export function hostedBesideFlockChat(): boolean { return param(HOST_PARAM) === HOST_CHAT; }

const framedKey = (): string | null => {
  const id = /^\/a\/([^/]+)\//.exec(window.location.pathname)?.[1];
  return id ? `flock-framed:${id}` : null;
};

/** True when Flock draws the app's name above it (beside a Flock chat, its full screen, or Flock's app page): the app then
 *  drops its own title row. Only inside a frame, so a marked address opened on its own keeps the title. Remembered for the
 *  tab (sessionStorage, per app), so a path-routed app that dropped the query and then reloads in the same frame keeps it;
 *  only Flock frames an app, always with a marker, so the memory is only ever read inside one of Flock's frames. */
export function framedByFlock(): boolean {
  let framed: boolean;
  try { framed = window.parent !== window; } catch { framed = true; }
  if (!framed) return false;
  const host = param(HOST_PARAM);
  const marked = host === HOST_CHAT || host === HOST_VIEWER;
  try {
    const key = framedKey();
    if (key && marked) window.sessionStorage.setItem(key, "1");
    else if (key && !marked) return window.sessionStorage.getItem(key) === "1";
  } catch { /* no storage: the marker alone */ }
  return marked;
}

/** Flock asks the app to open its chat at load (`flock_chat=open`): a notification for a chat the owner was writing in
 *  inside this app opens the app with that chat in view (owner 2026-11-04). */
export const CHAT_PARAM = "flock_chat";
export function flockAsksChatOpen(): boolean { return param(CHAT_PARAM) === "open"; }

/** The Flock chat this app was opened from, which the owner's chat in the app carries on. */
export function flockSessionParam(): string | null { return param(SESSION_PARAM); }

/** Opened from a Flock chat: beside it, or from a chat card or a chat's full screen (Flock's from-chat marker). The app's
 *  theme is then Flock's. */
export function openedFromFlockChat(): boolean { return hostedBesideFlockChat() || param(FROM_PARAM) === FROM_CHAT; }

export type ResolvedTheme = "light" | "dark";
const asTheme = (v: unknown): ResolvedTheme | null => (v === "light" || v === "dark" ? v : null);
const DARK = "(prefers-color-scheme: dark)";
const systemTheme = (): ResolvedTheme => (typeof matchMedia === "function" && matchMedia(DARK).matches ? "dark" : "light");

/** The Flock page around the app, when it is on our origin and says its theme (Flock's pages set <html data-theme>). */
function flockRoot(): HTMLElement | null {
  try {
    if (window.parent === window) return null;
    const root = window.parent.document.documentElement;
    return asTheme(root.getAttribute("data-theme")) ? root : null;
  } catch { return null; }   // another origin's page: not Flock's
}
function cookieTheme(): ResolvedTheme | null {
  try { return asTheme(/(?:^|;\s*)flock-theme-resolved=([^;]*)/.exec(document.cookie)?.[1]); } catch { return null; }
}

/** The light or dark Flock is showing: the Flock page around the app, else Flock's `flock-theme-resolved` cookie, else the
 *  system's. */
export function flockTheme(): ResolvedTheme {
  return asTheme(flockRoot()?.getAttribute("data-theme")) ?? cookieTheme() ?? systemTheme();
}

/** Calls `cb` with Flock's theme whenever it may have changed: the Flock page around the app switching, Flock switching in
 *  another tab (its stored choice, then the cookie), or the system's scheme. Returns the unsubscribe. */
export function onFlockTheme(cb: (t: ResolvedTheme) => void): () => void {
  const on = () => cb(flockTheme());
  const root = flockRoot();
  const observer = root && typeof MutationObserver === "function" ? new MutationObserver(on) : null;
  if (root) observer?.observe(root, { attributes: true, attributeFilter: ["data-theme"] });
  const onStorage = (e: StorageEvent) => { if (e.key === "flock-theme") on(); };
  window.addEventListener("storage", onStorage);
  const mq = typeof matchMedia === "function" ? matchMedia(DARK) : null;
  mq?.addEventListener?.("change", on);
  return () => { observer?.disconnect(); window.removeEventListener("storage", onStorage); mq?.removeEventListener?.("change", on); };
}

// One question per page. The app is served at /a/<id>/ on Flock's own origin, so Flock's cookie goes with a root-relative
// call. Only a real answer is kept: the auth check's 200, or a 401. A Flock that errs or can't be reached answers "not the
// owner" now and is asked again on the next mount.
let ownerPromise: Promise<boolean> | null = null;
async function checkOwner(): Promise<boolean> {
  const res = await fetch("/api/auth/check", { credentials: "include" });
  if (res.status === 401) return false;
  const b = res.ok ? await res.json() as { authenticated?: unknown; isOwner?: unknown } | null : null;
  if (!b || typeof b.authenticated !== "boolean") throw new Error(`auth check: HTTP ${res.status}`);
  return b.authenticated && b.isOwner === true;
}
function askOwner(): Promise<boolean> {
  ownerPromise ??= checkOwner().catch(() => { ownerPromise = null; return false; });
  return ownerPromise;
}

/** Whether the viewer is signed in to this Flock as its owner (GET /api/auth/check). `loading` until Flock answers. */
export function useFlockOwner(): { owner: boolean; loading: boolean } {
  const [owner, setOwner] = useState<boolean | null>(null);
  useEffect(() => {
    let live = true;
    void askOwner().then((o) => { if (live) setOwner(o); });
    return () => { live = false; };
  }, []);
  return { owner: owner === true, loading: owner === null };
}
