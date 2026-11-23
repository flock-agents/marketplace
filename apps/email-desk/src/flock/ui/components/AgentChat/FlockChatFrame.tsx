import { useEffect, useMemo, useRef } from "react";
import { useMe } from "../../data/hooks";
import { refreshKitData } from "../../data/client";
import { CHAT_PARAM, flockSessionParam, FROM_PARAM, HOST_PARAM, SESSION_PARAM } from "../../data/flock-host";
import { fetchFlockChatPass, type VisitorPass } from "../../data/flock-chat-pass";
import { onEmbedMessage, postToEmbed, type ChatTabsMessage } from "../../data/flock-chat-bridge";

export interface FlockChatFrameProps {
  /** How the app shows the chat. The embed's address carries the first one; a later change keeps the same frame (no reload)
   *  and is posted to the embed as chat-mode. */
  mode: "side" | "sheet" | "full";
  starters: string[];
  onHide(): void;
  onExpand(): void;
  onShrink(): void;
  /** A live reply in the chat changed this app. The kit's own lists and records re-read their data first. */
  onAppChanged(): void;
  /** A card in the chat opened this app (the app has moved to the page it named): bring the app into view. */
  onShowApp?(): void;
  /** The phone's full page: the tab shown, the app's name on its App tab and its dot. The embed draws these tabs under its
   *  header (chat-tabs, posted in full mode on each change and after every chat-ready); its pick comes back as onPickTab. */
  tab?: "chat" | "app";
  appName?: string;
  dot?: boolean;
  onPickTab?(tab: "chat" | "app"): void;
  /** The light or dark the app shows: the chat wears it. The embed's address carries the first one (no flash); a change is
   *  posted as chat-theme (no reload), and the theme is posted again after every chat-ready. */
  theme?: "light" | "dark";
  /** The chat's first load is in view (the embed's chat-shown; an older Flock that never says so, SHOWN_AFTER_READY_MS
   *  after its chat-ready, or SHOWN_CAP_MS after the frame mounted). Called once. */
  onShown?(): void;
  /** Whether the app shows the chat now (default true). The embed's address carries the first one; a change is posted as
   *  chat-visible (no reload), and again after a chat-ready when it differs from the address. Hidden, the embed reports no
   *  presence. */
  visible?: boolean;
  /** The embed said Flock's chat can't be used here (the viewer is not signed in to Flock, or not let in). */
  onUnavailable?(): void;
  /** A visitor's pass (not the owner, on a public app): the init carries it, with the agent's name, and the frame posts the
   *  next one before it expires. Without it the chat is the owner's, on Flock's cookie. */
  visitor?: VisitorPass;
  /** A message the app asked for (useChat): posted to the embed once it has its init, once per `id`. */
  compose?: { id: number; text: string; send: boolean };
}

const ALLOW = "microphone; camera; clipboard-read; clipboard-write";

/** The full page's tabs as the embed is told them; none outside the full page, or for a host that takes no pick. */
function tabsOf(p: FlockChatFrameProps): ChatTabsMessage | null {
  if (p.mode !== "full" || !p.onPickTab) return null;
  return { type: "flock:chat-tabs", tab: p.tab ?? "chat", appName: p.appName ?? "", dot: !!p.dot };
}
/** A visitor's next pass is asked for this long before the one in use ends; a refusal is asked again after RETRY_MS. */
const REFRESH_BEFORE_MS = 5 * 60_000;
const RETRY_MS = 60_000;
/** An embed that never says chat-shown (an older Flock) has revealed its chat by this long after its chat-ready (its own
 *  reveal is capped at 3s); one that never even says ready, by SHOWN_CAP_MS after the frame mounted. */
const SHOWN_AFTER_READY_MS = 4000;
const SHOWN_CAP_MS = 10_000;

// The chat the frame shows, kept for the page (one page is one app, so this is per app): the one Flock opened the app from,
// then whichever the embed settled on, so the chat reopens where it was (the sheet closed and opened again, the embed reloaded).
let remembered: string | null | undefined;
const session = () => (remembered === undefined ? (remembered = flockSessionParam()) : remembered);

// After New chat, until the next chat settles: a (re)loaded embed is told not to continue the owner's last chat. Kept in
// sessionStorage per app so a full page reload holds it too; the module copy stands in where storage is unavailable.
let fresh = false;
const freshKey = (app: string) => `flock-chat-fresh:${app}`;
const isFresh = (app: string): boolean => {
  if (fresh) return true;
  try { return window.sessionStorage.getItem(freshKey(app)) === "1"; } catch { return false; }
};
function setFresh(app: string | null, on: boolean): void {
  fresh = on;
  if (!app) return;
  try { if (on) window.sessionStorage.setItem(freshKey(app), "1"); else window.sessionStorage.removeItem(freshKey(app)); } catch { /* module copy */ }
}

const tabKey = (t: ChatTabsMessage) => JSON.stringify([t.tab, t.appName, t.dot]);

/** The app's page the viewer is on, as Flock names it: the address after /a/<id>/, without Flock's own markers. */
function appPath(): string | null {
  const { pathname, search, hash } = window.location;
  const q = new URLSearchParams(search);
  q.delete(HOST_PARAM); q.delete(SESSION_PARAM); q.delete(FROM_PARAM); q.delete(CHAT_PARAM);
  const qs = q.toString();
  const path = `${pathname.replace(/^\/a\/[^/]+\//, "/")}${qs ? `?${qs}` : ""}${hash}`;
  return path === "/" ? null : path;
}

/** Takes flock_session out of the app's own address after New chat, its other params and hash kept. */
function forgetSession(): void {
  try {
    const u = new URL(window.location.href);
    if (!u.searchParams.has(SESSION_PARAM)) return;
    u.searchParams.delete(SESSION_PARAM);
    window.history.replaceState(window.history.state, "", `${u.pathname}${u.search}${u.hash}`);
  } catch { /* an address that can't be rewritten: the chat is still forgotten for this page */ }
}

/** Writes the chat the embed settled on into the app's own address (flock_session), its page and hash kept: Flock's viewer
 *  around the app reads it for Back to chat, and a reload carries the chat on. */
function nameSession(id: string): void {
  try {
    const u = new URL(window.location.href);
    if (u.searchParams.get(SESSION_PARAM) === id) return;
    u.searchParams.set(SESSION_PARAM, id);
    window.history.replaceState(window.history.state, "", `${u.pathname}${u.search}${u.hash}`);
  } catch { /* an address that can't be rewritten: the chat is still remembered for this page */ }
}

/** Moves the app to `path`, a page inside it as Flock names it (the address after /a/<id>/). A "/#…" path is a hash route
 *  (useHashRoute hears the hashchange); any other is pushed under the app's base and told to its router as a popstate.
 *  Anything that is not a plain in-app path is ignored (false). */
function moveApp(path: string): boolean {
  if (!path.startsWith("/") || path.startsWith("//") || path.includes("\\")) return false;
  if (path.split(/[?#]/)[0].split("/").some((seg) => seg === ".." || seg === "." || /%2e/i.test(seg))) return false;
  if (path.startsWith("/#")) { window.location.hash = path.slice(1); return true; }
  const base = /^\/a\/[^/]+\//.exec(window.location.pathname)?.[0] ?? "/";
  const hashBefore = window.location.hash;
  window.history.pushState(window.history.state, "", base + path.slice(1));
  window.dispatchEvent(new PopStateEvent("popstate", { state: window.history.state }));
  if (window.location.hash !== hashBefore) window.dispatchEvent(new HashChangeEvent("hashchange"));
  return true;
}

/** Flock's own chat (/embed/chat) for the signed-in owner, in an iframe on Flock's origin (the app is served at /a/<id>/ on it,
 *  so the owner's Flock cookie and the whole chat work as in Flock), or for a visitor with the pass the kit minted them.
 *  Answers the embed's chat-ready with the app, its agent, the chat to show and the starters, and turns the embed's requests
 *  into the callbacks. Draws nothing until /api/_me names
 *  the app and its agent. */
export function FlockChatFrame(props: FlockChatFrameProps) {
  const me = useMe();
  const appId = typeof me.appId === "string" && me.appId ? me.appId : null;
  const agentId = me.agent?.id ?? null;
  const frame = useRef<HTMLIFrameElement>(null);
  const latest = useRef(props);
  latest.current = props;
  const ids = useRef({ appId, agentId });
  ids.current = { appId, agentId };
  const firstMode = useRef(props.mode).current;
  const firstTheme = useRef(props.theme).current;
  const firstVisible = useRef(props.visible ?? true).current;
  // The agent as the kit names it, for a visitor's chat (which can't read Flock's agents).
  const named = me.agent as { name?: unknown; avatar?: unknown } | null;
  const text = (v: unknown) => (typeof v === "string" && v ? v : undefined);
  const latestAgent = useRef<{ name?: string; avatar?: string }>({});
  latestAgent.current = { name: text(named?.name), avatar: text(named?.avatar) };
  // The visitor's pass in use: the first one, then each refresh (an embed that reloads starts with the latest).
  const pass = useRef<VisitorPass | null>(props.visitor ?? null);
  // The tabs last told to the embed (their key), so a change is posted once.
  const toldTabs = useRef<string | null>(null);
  const visiting = !!props.visitor;
  // The first load in view, told once; the timer stands in for an embed that never says so.
  const shown = useRef(false);
  const shownTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const markShown = useRef(() => {
    if (shown.current) return;
    shown.current = true;
    clearTimeout(shownTimer.current);
    latest.current.onShown?.();
  }).current;
  const waitShown = useRef((ms: number) => {
    if (shown.current) return;
    clearTimeout(shownTimer.current);
    shownTimer.current = setTimeout(markShown, ms);
  }).current;

  // The app's message for the chat: told once per ask, and only to an embed that has had its init.
  const ready = useRef(false);
  const toldCompose = useRef(0);
  const tellCompose = useRef(() => {
    const c = latest.current.compose;
    if (!ready.current || !c || c.id <= toldCompose.current) return;
    toldCompose.current = c.id;
    postToEmbed(frame.current, { type: "flock:chat-compose", text: c.text, send: c.send });
  }).current;

  useEffect(() => onEmbedMessage(() => frame.current, (msg) => {
    const p = latest.current;
    switch (msg.type) {
      case "flock:chat-ready": {
        const { appId: app, agentId: agent } = ids.current;
        if (!app || !agent) return;
        waitShown(SHOWN_AFTER_READY_MS);
        const v = pass.current; const { name, avatar } = latestAgent.current;
        postToEmbed(frame.current, { type: "flock:chat-init", appId: app, agentId: agent, session: session(), starters: p.starters, path: appPath(),
          ...(!session() && isFresh(app) ? { fresh: true as const } : {}),
          ...(v ? { pass: v.pass, ...(name ? { agentName: name } : {}), ...(avatar ? { agentAvatar: avatar } : {}) } : {}) });
        // An embed (re)loaded after the mode changed reads the first mode from its address: tell it the one now.
        if (p.mode !== firstMode) postToEmbed(frame.current, { type: "flock:chat-mode", mode: p.mode });
        // And the full page's tabs, again after every ready (WebKit drops a message sent before the embed listens).
        const tabs = tabsOf(p);
        if (tabs) { postToEmbed(frame.current, tabs); toldTabs.current = tabKey(tabs); }
        // And the app's theme, which may have changed since the address was made.
        if (p.theme) postToEmbed(frame.current, { type: "flock:chat-theme", theme: p.theme });
        // And whether it is shown, when that is no longer what its address says.
        const visible = p.visible ?? true;
        if (visible !== firstVisible) postToEmbed(frame.current, { type: "flock:chat-visible", visible });
        ready.current = true;
        tellCompose();
        return;
      }
      case "flock:chat-shown": markShown(); return;
      case "flock:chat-new": remembered = null; setFresh(ids.current.appId, true); forgetSession(); return;
      case "flock:chat-session": remembered = msg.session; setFresh(ids.current.appId, false); nameSession(msg.session); return;
      case "flock:chat-hide": p.onHide(); return;
      case "flock:chat-unavailable": p.onUnavailable?.(); return;
      case "flock:chat-expand": p.onExpand(); return;
      case "flock:chat-shrink": p.onShrink(); return;
      case "flock:chat-app-changed": refreshKitData(); p.onAppChanged(); return;
      case "flock:chat-tab-pick": p.onPickTab?.(msg.tab); return;
      case "flock:chat-navigate":
        if (msg.path !== null && !moveApp(msg.path)) return;
        p.onShowApp?.(); return;
      case "flock:chat-pass-request": {
        // Flock refused the visitor's pass (expired early, or revoked): a new one now. None: the embed gives way by itself.
        if (!pass.current) return;
        void fetchFlockChatPass({ refused: pass.current.pass }).then((next) => {
          if (!next) return;
          pass.current = next;
          postToEmbed(frame.current, { type: "flock:chat-pass", pass: next.pass });
        });
        return;
      }
    }
  }), []);  // eslint-disable-line react-hooks/exhaustive-deps -- markShown and waitShown are stable

  useEffect(() => {
    waitShown(SHOWN_CAP_MS);
    return () => clearTimeout(shownTimer.current);
  }, []);  // eslint-disable-line react-hooks/exhaustive-deps -- waitShown is stable

  // A visitor's pass is replaced before it ends, without reloading the chat: the embed hears chat-pass.
  useEffect(() => {
    if (!visiting) return;
    let live = true; let timer: ReturnType<typeof setTimeout>;
    const plan = (ms: number) => { timer = setTimeout(refresh, Math.max(0, ms)); };
    const due = () => Date.parse(pass.current!.expiresAt) - REFRESH_BEFORE_MS - Date.now();
    async function refresh() {
      const next = await fetchFlockChatPass();
      if (!live) return;
      if (!next || next.pass === pass.current?.pass) { plan(RETRY_MS); return; }
      pass.current = next;
      postToEmbed(frame.current, { type: "flock:chat-pass", pass: next.pass });
      plan(due());
    }
    plan(due());
    return () => { live = false; clearTimeout(timer); };
  }, [visiting]);

  // Later modes reach the embed as a message: changing the address would reload the chat.
  const modeShown = useRef(props.mode);
  useEffect(() => {
    if (props.mode === modeShown.current) return;
    modeShown.current = props.mode;
    postToEmbed(frame.current, { type: "flock:chat-mode", mode: props.mode });
  }, [props.mode]);

  // The full page's tabs reach the embed whenever one of them changes (after the mode, so the embed is in full mode first).
  const tabs = tabsOf(props);
  const key = tabs ? tabKey(tabs) : null;
  useEffect(() => {
    if (key === toldTabs.current) return;
    toldTabs.current = key;
    if (tabs) postToEmbed(frame.current, tabs);
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps -- the key names every field of `tabs`

  // The app's theme too: the chat follows it, posted (the address would reload the chat).
  const toldTheme = useRef(firstTheme);
  useEffect(() => {
    if (!props.theme || props.theme === toldTheme.current) return;
    toldTheme.current = props.theme;
    postToEmbed(frame.current, { type: "flock:chat-theme", theme: props.theme });
  }, [props.theme]);

  // Shown or hidden: posted too (the address would reload the chat).
  const visible = props.visible ?? true;
  const toldVisible = useRef(firstVisible);
  useEffect(() => {
    if (visible === toldVisible.current) return;
    toldVisible.current = visible;
    postToEmbed(frame.current, { type: "flock:chat-visible", visible });
  }, [visible]);

  useEffect(tellCompose, [props.compose?.id, tellCompose]);

  const src = useMemo(() => (appId ? `/embed/chat?${new URLSearchParams({ app: appId, mode: firstMode, ...(firstTheme ? { theme: firstTheme } : {}),
    ...(firstVisible ? {} : { visible: "0" }) })}` : null),
    [appId, firstMode, firstTheme, firstVisible]);
  if (!src || !agentId) return null;
  return <iframe ref={frame} className="fl-chat-frame" src={src} title="Chat" allow={ALLOW} />;
}
