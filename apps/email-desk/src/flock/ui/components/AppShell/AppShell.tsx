import "./app-shell.css";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { ObjectIcon } from "../ObjectIcon/ObjectIcon";
import { ensureGloss } from "../ObjectIcon/gloss";
import { AvatarStack } from "../AvatarStack/AvatarStack";
import { ToastProvider } from "../Toast/Toast";
import { Icon } from "../Icon/Icon";
import { Tabs } from "../Tabs/Tabs";
import { useApp, useMe, useSamples, useOwnerRemovals } from "../../data/hooks";
import { isStale, onStale, reloadNow } from "../../data/client";
import { Button } from "../Button/Button";
import { useModal } from "../../useModal";
import { ChatModeContext, type ChatMode } from "../AgentChat/chat-mode";
import { ShellChatContext, type ChatRequest, type OpenChatOptions, type ShellChat } from "./shell-chat";
import { flockAsksChatOpen, flockTheme, framedByFlock, hostedBesideFlockChat, onFlockTheme, openedFromFlockChat, useFlockOwner, type ResolvedTheme } from "../../data/flock-host";
import { FlockSettingsFrame } from "./FlockSettingsFrame";
import { onViewerMessage, tellViewer } from "../../data/flock-viewer";

export interface ShellPage { id: string; label: string; icon?: string }
export interface AppShellProps {
  name: string; subtitle?: string; object?: string;
  nav?: "auto" | "none" | "top" | "side";
  pages?: ShellPage[]; current?: string; onNavigate?: (id: string) => void;
  people?: { name: string }[];
  accent?: AccentName;
  chat?: { placement: "side" | "page"; render: () => ReactNode };
  /** The owner's Settings & routines page (the last page, "Settings", shown only to the signed-in Flock owner). Default:
   *  Flock's own page for this app (FlockSettingsFrame). */
  settings?: { render: () => ReactNode };
  theme?: "system" | "light" | "dark";
  children: ReactNode;
}

export function resolveNav(nav: AppShellProps["nav"], pageCount: number, chatIsPage: boolean): "none" | "top" | "side" {
  if (nav === "none" || nav === "top" || nav === "side") return nav;
  if (chatIsPage) return "side";
  if (pageCount <= 1) return "none";
  return pageCount <= 4 ? "top" : "side";
}

const readHash = (fallback: string, valid?: string[]) => {
  const m = /^#\/([^?]*)/.exec(typeof location === "undefined" ? "" : location.hash);
  let id = m?.[1] ?? "";
  try { id = decodeURIComponent(id); } catch { /* malformed escape: use the raw segment */ }
  if (!id || (valid && !valid.includes(id))) return fallback;
  return id;
};
/** `#/<page>` routing with no router dependency. Pass the valid page ids so an unknown hash falls back to the default. */
export function useHashRoute(defaultPage: string, validPages?: string[]): [string, (id: string) => void] {
  const validKey = validPages?.join("\u0000");
  const valid = useRef(validPages); valid.current = validPages;
  const [page, setPage] = useState(() => readHash(defaultPage, validPages));
  useEffect(() => {
    const on = () => setPage(readHash(defaultPage, valid.current));
    on();
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, [defaultPage, validKey]);
  const go = useCallback((id: string) => { location.hash = "#/" + encodeURIComponent(id); setPage(id); }, []);
  return [page, go];
}

const NARROW = "(max-width: 720px)";
function useNarrow(): boolean {
  const mq = () => (typeof matchMedia === "function" ? matchMedia(NARROW) : null);
  const [narrow, setNarrow] = useState(() => mq()?.matches ?? false);
  useEffect(() => {
    const m = mq(); if (!m) return;
    const on = () => setNarrow(m.matches);
    on(); m.addEventListener?.("change", on);
    return () => m.removeEventListener?.("change", on);
  }, []);
  return narrow;
}

/** Phones: have the keyboard shrink the page instead of scrolling it (Android Chrome; iOS Safari ignores this), so the
 *  chat's title bar stays put above the composer. Added once to the page's viewport meta, which is created if missing. */
export function ensureResizesContent(): void {
  if (typeof document === "undefined") return;
  let meta = document.querySelector<HTMLMetaElement>('meta[name="viewport"]');
  if (!meta) { meta = document.createElement("meta"); meta.name = "viewport"; meta.content = "width=device-width, initial-scale=1"; document.head.appendChild(meta); }
  const c = meta.getAttribute("content") ?? "";
  if (/interactive-widget\s*=/.test(c)) return;
  meta.setAttribute("content", (c.trim().replace(/,\s*$/, "") + ", interactive-widget=resizes-content").replace(/^,\s*/, ""));
}

/** While `active`, size the layer to the visual viewport (height and top), so the keyboard leaves the layer's top in view and
 *  the composer on the keyboard. Inline styles are cleared when inactive or unmounted. No-op without visualViewport. */
function useVisualViewportBox(active: boolean, ref: { current: HTMLElement | null }) {
  useEffect(() => {
    const vv = typeof window === "undefined" ? undefined : window.visualViewport;
    if (!active || !vv) return;
    let raf = 0;
    const apply = () => {
      raf = 0;
      const el = ref.current; if (!el) return;
      el.style.height = `${vv.height}px`; el.style.top = `${vv.offsetTop}px`; el.style.bottom = "auto";
    };
    const on = () => { if (!raf) raf = requestAnimationFrame(apply); };
    vv.addEventListener("resize", on); vv.addEventListener("scroll", on);
    apply();
    return () => {
      vv.removeEventListener("resize", on); vv.removeEventListener("scroll", on);
      if (raf) cancelAnimationFrame(raf);
      const el = ref.current; if (el) { el.style.height = ""; el.style.top = ""; el.style.bottom = ""; }
    };
  }, [active, ref]);
}

/** The longest the preload waits for an idle moment after load (a busy app would otherwise put it off indefinitely), and its
 *  wait where the browser has no idle callback (Safari). The chat it mounts still has a page and several reads to load, so
 *  it starts soon: the first tap usually comes within seconds of opening the app. */
const PRELOAD_IDLE_TIMEOUT_MS = 500;
const PRELOAD_NO_IDLE_MS = 250;

/** True once the app has settled (its load event, then an idle moment, at most PRELOAD_IDLE_TIMEOUT_MS; PRELOAD_NO_IDLE_MS
 *  after load where the browser has no idle callback), while `active`. The side chat is mounted then, hidden, so the first
 *  tap on Ask only shows it. */
function usePreload(active: boolean): boolean {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (!active || ready) return;
    let idle: number | undefined; let timer: ReturnType<typeof setTimeout> | undefined;
    const settle = () => {
      if (typeof window.requestIdleCallback === "function") idle = window.requestIdleCallback(() => setReady(true), { timeout: PRELOAD_IDLE_TIMEOUT_MS });
      else timer = setTimeout(() => setReady(true), PRELOAD_NO_IDLE_MS);
    };
    if (document.readyState === "complete") settle(); else window.addEventListener("load", settle, { once: true });
    return () => {
      window.removeEventListener("load", settle);
      if (idle !== undefined) window.cancelIdleCallback?.(idle);
      clearTimeout(timer);
    };
  }, [active, ready]);
  return ready;
}

// The app's own theme choice, per app. Never Flock's "flock-theme": the two share an origin, and the app's toggle must not
// change Flock's theme.
const KEY = "flock-app-theme:";
type Choice = "system" | "light" | "dark";
const NEXT: Record<Choice, Choice> = { light: "dark", dark: "system", system: "light" };
const asChoice = (v: string | null): Choice | null => (v === "light" || v === "dark" || v === "system" ? v : null);
function stored(keys: string[]): Choice | null {
  try { for (const k of keys) { const v = asChoice(localStorage.getItem(k)); if (v) return v; } } catch { /* storage blocked */ }
  return null;
}
const pathAppId = () => /^\/a\/([^/]+)\//.exec(typeof location === "undefined" ? "" : location.pathname)?.[1] ?? null;
function useSystemDark(): boolean {
  const mq = () => (typeof matchMedia === "function" ? matchMedia("(prefers-color-scheme: dark)") : null);
  const [dark, setDark] = useState(() => mq()?.matches ?? false);
  useEffect(() => {
    const m = mq(); if (!m) return;
    const on = () => setDark(m.matches);
    on(); m.addEventListener?.("change", on);
    return () => m.removeEventListener?.("change", on);
  }, []);
  return dark;
}
/** One theme for the app and the chat inside it. Opened from a Flock chat (beside it, or carrying it), the app follows the
 *  light or dark Flock shows, live, and has no choice of its own. Opened on its own, the app's choice: its stored one (per
 *  app: the kit's app id, and the address's /a/<id>/ so the first paint has it before the kit answers), else the prop. */
function useTheme(prop: Choice, appId: string | null): { choice: Choice; resolved: ResolvedTheme; follow: boolean; toggle(): void } {
  const [follow] = useState(openedFromFlockChat);
  const ids = [...new Set([appId, pathAppId()].filter((id): id is string => !!id))];
  const keyStr = ids.map((id) => KEY + id).join("\n");
  const keys = useMemo(() => (keyStr ? keyStr.split("\n") : []), [keyStr]);
  const [choice, setChoice] = useState<Choice>(() => stored(keys) ?? prop);
  const first = useRef(true);
  useEffect(() => { if (first.current) { first.current = false; return; } setChoice(stored(keys) ?? prop); }, [prop, keys]);
  const [flock, setFlock] = useState<ResolvedTheme>(() => (follow ? flockTheme() : "light"));
  useEffect(() => { if (!follow) return; setFlock(flockTheme()); return onFlockTheme(setFlock); }, [follow]);
  const systemDark = useSystemDark();
  const resolved: ResolvedTheme = follow ? flock : choice === "system" ? (systemDark ? "dark" : "light") : choice;
  useLayoutEffect(() => {
    const root = document.documentElement;
    if (follow) root.setAttribute("data-theme", flock);
    else if (choice === "system") root.removeAttribute("data-theme"); else root.setAttribute("data-theme", choice);
  }, [follow, flock, choice]);
  const toggle = () => {
    if (follow) return;
    const next = NEXT[choice];
    setChoice(next);
    try { for (const k of keys) localStorage.setItem(k, next); } catch { /* storage blocked: the choice still applies for this visit */ }
  };
  return { choice, resolved, follow, toggle };
}

/** Shown when the app was redeployed under a page that has unsent work: the reload waits for the owner (or for the edit to end). */
function UpdateBanner() {
  const [stale, setStale] = useState(isStale());
  useEffect(() => onStale(() => setStale(isStale())), []);
  if (!stale) return null;
  return (
    <section className="fl-shell-samples" role="region" aria-label="App updated">
      <span className="fl-shell-samples-ic" aria-hidden><Icon name="sparkles" size={15} /></span>
      <p>App updated. Reload to see the change; what you are typing is kept until you do.</p>
      <Button variant="soft" size="sm" onClick={reloadNow}>Reload</Button>
    </section>
  );
}

/** One line while the kit still holds sample rows (spec §3.5): what they are, and Clear samples for a signed-in viewer
 *  (the kit refuses an anonymous one). Inside the ToastProvider, so Clear's toast and its Undo show. */
function SampleBanner() {
  const { total, clear } = useSamples();
  const me = useMe();
  const [busy, setBusy] = useState(false);
  if (!total) return null;
  const go = async () => { setBusy(true); try { await clear(); } finally { setBusy(false); } };
  return (
    <section className="fl-shell-samples" role="region" aria-label="Sample rows">
      <span className="fl-shell-samples-ic" aria-hidden><Icon name="sparkles" size={15} /></span>
      <p>These are sample rows to show how the app works.</p>
      {me.anonymous ? null : <Button variant="soft" size="sm" loading={busy} onClick={() => void go()}>Clear samples</Button>}
    </section>
  );
}

/** "<agent> removed N of your rows · Undo": an agent deleted rows the owner wrote (the kit keeps them in one undo group). Shown
 *  until it is undone or dismissed. */
function OwnerRemovalBanner() {
  const { removals, undo, dismiss } = useOwnerRemovals();
  const [busy, setBusy] = useState<string | null>(null);
  if (!removals.length) return null;
  const who = (by: string) => by.replace(/^agent:/, "").split(/[-_\s]+/).filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join(" ") || "An agent";
  return (
    <>
      {removals.map((r) => (
        <section key={r.groupId} className="fl-shell-samples fl-shell-removed" role="region" aria-label="Rows removed by an agent">
          <span className="fl-shell-samples-ic" aria-hidden><Icon name="circle-alert" size={15} /></span>
          <p>{who(r.by)} removed {r.count} of your {r.count === 1 ? "row" : "rows"}.</p>
          <Button variant="soft" size="sm" loading={busy === r.groupId} onClick={() => { setBusy(r.groupId); void undo(r.groupId).finally(() => setBusy(null)); }}>Undo</Button>
          <Button variant="ghost" size="sm" onClick={() => dismiss(r.groupId)}>Dismiss</Button>
        </section>
      ))}
    </>
  );
}

/** Flock's app viewer hides its own add-to-home banner while the chat has the phone's full page; it shows here instead, at
 *  the top of the page under the full page's top, on the App tab only. Add and its dismiss are the viewer's to act on. */
function HomeOfferBanner({ appName }: { appName: string }) {
  return (
    <div className="fl-shell-home" role="status">
      <span>Add {appName} to your home screen</span>
      <button type="button" className="fl-shell-home-add" onClick={() => tellViewer({ type: "flock:viewer-home-add" })}>Add</button>
      <button type="button" className="fl-shell-home-x" aria-label="Dismiss home screen offer" onClick={() => tellViewer({ type: "flock:viewer-home-dismiss" })}>
        <Icon name="x" size={12} />
      </button>
    </div>
  );
}

/** The agent's own avatar on the launcher: an emoji, or an image (a path or URL). A Flock picture (`?look=picture`, as
 *  Flock serves it) is drawn whole with the picture finish, never cropped to the disc. None known, or an image that won't
 *  load (a visitor on a public app can't read Flock's avatar route): the chat icon. */
function AgentMark({ avatar }: { avatar?: string }) {
  const [failed, setFailed] = useState(false);
  const image = !!avatar && /^(\/|https?:|data:image\/)/.test(avatar);
  const picture = image && /[?&]look=picture(&|$)/.test(avatar!);
  useEffect(() => { if (picture) ensureGloss(); }, [picture]);
  if (!avatar || (image && failed)) return <Icon name="message-circle" size={16} />;
  return (
    <span className={`fl-shell-launch-av${picture ? " fl-shell-launch-pic" : ""}`} aria-hidden="true">
      {picture ? <img src={avatar} alt="" className="fl-obj" data-size="24" onError={() => setFailed(true)} />
        : image ? <img src={avatar} alt="" onError={() => setFailed(true)} /> : <span>{avatar}</span>}
    </span>
  );
}

const CHAT_ID = "_chat";
/** The owner's Settings & routines page, added last inside Flock. */
export const SETTINGS_PAGE: ShellPage = { id: "flock-settings", label: "Settings", icon: "settings-2" };
/** An app with no pages of its own, given the Settings page: its one page, named after the app. */
const APP_PAGE_ID = "_app";
/** The app's own accent, by name. Each maps to a theme token (--ua-<name>) with light and dark values. */
export const ACCENT_NAMES = ["coral", "teal", "blue", "green", "violet", "amber"] as const;
export type AccentName = (typeof ACCENT_NAMES)[number];

export function AppShell({ name, subtitle, object, nav, pages = [], current, onNavigate, people, accent, chat: chatProp, settings, theme = "system", children }: AppShellProps) {
  const me = useMe();
  // The owner's own icon (set in Flock) wins over the object in the header, as it does in every Flock list.
  const { ownerIcon } = useApp();
  const narrow = useNarrow();
  const { choice, resolved: resolvedTheme, follow: followsFlock, toggle: toggleTheme } = useTheme(theme, typeof me.appId === "string" && me.appId ? me.appId : null);
  // Open beside a Flock chat, that chat is the app's: the app shows none of its own (no panel, no launcher, no Chat page).
  const [hosted] = useState(hostedBesideFlockChat);
  // A viewer with no agent in this app (the kit's /_me says chat: false) gets none either: no panel, no launcher, no Chat page.
  const chat = hosted || me.chat === false ? undefined : chatProp;
  // Where Flock already names the app above it (beside its chat, that chat's full screen, its app page), the app drops its
  // own title row and starts with its tabs. Decided once, at mount.
  const [framed] = useState(framedByFlock);
  // Wide: the side chat is a panel on the left until hidden. Narrow: closed, a sheet, or the full page with Chat | App tabs.
  const [hidden, setHidden] = useState(true);
  const [sheet, setSheet] = useState<"closed" | "sheet" | "full">("closed");
  const [tab, setTab] = useState<"chat" | "app">("chat");
  const [dot, setDot] = useState(false);
  const sheetRef = useRef<HTMLDivElement>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  useEffect(ensureResizesContent, []);
  // The card slides up only on opening from closed: marked then, cleared when it has (or on closing / expanding).
  const [slide, setSlide] = useState(false);
  const closeSheet = useCallback(() => { setSheet("closed"); setTab("chat"); setDot(false); setSlide(false); }, []);
  const chatIsPage = chat?.placement === "page";
  // The owner's Settings page: only for the signed-in Flock owner once the kit names the app, and gone for good when Flock's
  // page says it is not available here (FlockSettingsFrame's onUnavailable). A visitor never sees it.
  const { owner } = useFlockOwner();
  const [settingsGone, setSettingsGone] = useState(false);
  const [onSettings, setOnSettings] = useState(false);
  const withSettings = owner && !settingsGone && typeof me.appId === "string" && !!me.appId;
  const showSettings = withSettings && onSettings;
  const own: ShellPage[] = chatIsPage ? [...pages, { id: CHAT_ID, label: "Chat", icon: "message-circle" }] : pages;
  const items: ShellPage[] = withSettings ? [...(own.length ? own : [{ id: APP_PAGE_ID, label: name }]), SETTINGS_PAGE] : own;
  // The nav follows the app's own pages: the owner's Settings page never turns a 4-page app's top tabs into a side rail.
  // Its one rule: "none" would leave the owner no way to Settings, so with it on the app's page and Settings are top tabs.
  const ownMode = resolveNav(nav, own.length, chatIsPage);
  const mode = withSettings && ownMode === "none" ? "top" : ownMode;
  const appActive = own.some((p) => p.id === current) ? current : own[0]?.id ?? (withSettings ? APP_PAGE_ID : undefined);
  const active = showSettings ? SETTINGS_PAGE.id : appActive;
  // The Settings page is the shell's own: the app never hears of it (its router keeps the page it was on).
  const go = (id: string) => {
    if (id === SETTINGS_PAGE.id) { setOnSettings(true); return; }
    setOnSettings(false);
    if (id !== APP_PAGE_ID) onNavigate?.(id);
  };
  const settingsUnavailable = useCallback(() => { setSettingsGone(true); setOnSettings(false); }, []);
  const agentLabel = "Ask " + (me.agent?.name ?? "your agent");
  // The agent's avatar (an emoji or an image) when the kit names one.
  const agentAvatar = typeof me.agent?.avatar === "string" && me.agent.avatar ? me.agent.avatar : undefined;
  const side = chat?.placement === "side";
  const showSide = side && !narrow && !hidden;
  const launcher = side && (narrow || hidden);
  const sheetOpen = side && narrow && sheet !== "closed";
  // The chat mounts once the app has settled (preloaded, hidden), or the first time it is shown if that comes first, and
  // then stays mounted (hidden when closed): opening it only shows it, and its frame never reloads.
  const preloaded = usePreload(side);
  const [opened, setOpened] = useState(false);
  if (!opened && side && (preloaded || (narrow ? sheet !== "closed" : !hidden))) setOpened(true);
  // The chat inside is still deciding or loading (AgentChat says so): the sheet holds a placeholder of the card over it.
  const [chatLoading, setChatLoading] = useState(false);
  const full = sheetOpen && sheet === "full";
  const onApp = full && tab === "app";
  // Inside Flock's app viewer the full page asks for the whole viewer (its bar and banner go), and says off once on leaving
  // it: Shrink, Close, or the window widening past 720px. The viewer's add-to-home offer then shows here, on the App tab.
  const [homeOffer, setHomeOffer] = useState<{ show: boolean; appName: string } | null>(null);
  useEffect(() => (side ? onViewerMessage(({ show, appName }) => setHomeOffer({ show, appName })) : undefined), [side]);
  const toldFull = useRef(false);
  useEffect(() => {
    if (full === toldFull.current) return;
    toldFull.current = full;
    tellViewer({ type: "flock:viewer-chat-full", on: full });
  }, [full]);
  useEffect(() => () => { if (toldFull.current) tellViewer({ type: "flock:viewer-chat-full", on: false }); }, []);
  // The App tab hands the page back to the app: no focus trap, no scroll lock, while the tab bar stays on top.
  useModal(sheetOpen && !onApp, sheetRef, closeSheet);
  // The App tab keeps its own height (--fl-full-top); the sheet and the chat tab follow the visual viewport.
  useVisualViewportBox(sheetOpen && !onApp, layerRef);

  const pick = useCallback((t: "chat" | "app") => { setTab(t); if (t === "app") setDot(false); }, []);
  const chatMode = useMemo<ChatMode>(() => ({
    mode: !narrow ? "side" : sheet === "full" ? "full" : "sheet",
    hide: () => (narrow ? closeSheet() : setHidden(true)),
    expand: () => { setSheet((s) => (s === "sheet" ? "full" : s)); setTab("chat"); setSlide(false); },
    shrink: () => { setSheet((s) => (s === "full" ? "sheet" : s)); setTab("chat"); setDot(false); },
    // Only the full page's Chat tab hides the app; the sheet leaves it in view above.
    appChanged: () => { if (sheet === "full" && tab === "chat") setDot(true); },
    showApp: () => {
      if (!narrow) return;
      if (sheet === "full") { setTab("app"); setDot(false); } else closeSheet();
    },
    // Flock's chat draws the full page's tabs in its own top (the shell's own tabs give way to it, app-shell.css).
    tab, appName: name, dot, pickTab: pick,
    // The chat inside wears the app's theme (Flock's, when the app follows it).
    theme: resolvedTheme,
    loading: setChatLoading,
    open: narrow ? sheetOpen && !onApp : side && !hidden,
  }), [narrow, sheet, tab, closeSheet, name, dot, pick, resolvedTheme, sheetOpen, onApp, side, hidden]);
  const openChat = () => {
    if (!narrow) { setHidden(false); return; }
    if (sheet === "closed") setSlide(true);
    setSheet("sheet");
  };
  // App code opens the chat too (useChat), optionally with a message for it to take.
  const [request, setRequest] = useState<ChatRequest | null>(null);
  const openFromApp = (options?: OpenChatOptions) => {
    if (!side && !chatIsPage) return;
    const text = options?.message?.trim();
    if (text) setRequest((r) => ({ id: (r?.id ?? 0) + 1, text, send: !!options?.send }));
    if (chatIsPage) { go(CHAT_ID); return; }
    if (narrow && sheet === "full") { pick("chat"); return; }
    openChat();
  };
  const openRef = useRef(openFromApp);
  openRef.current = openFromApp;
  const stableOpen = useCallback((options?: OpenChatOptions) => openRef.current(options), []);
  const shellChat = useMemo<ShellChat>(() => ({ available: side || chatIsPage, openChat: stableOpen, request }), [side, chatIsPage, stableOpen, request]);
  // Flock asked for the chat at load (flock_chat=open: a notification for a chat written in here): opened once, as the
  // launcher would.
  const [askedOpen] = useState(flockAsksChatOpen);
  useEffect(() => { if (askedOpen) stableOpen(); }, [askedOpen, stableOpen]);
  // The slide-up done (the card's own animation, not one inside it): the mark goes, so nothing replays it.
  useEffect(() => {
    const el = sheetRef.current;
    if (!slide || !el) return;
    const done = (e: Event) => { if (e.target === el) setSlide(false); };
    el.addEventListener("animationend", done);
    return () => el.removeEventListener("animationend", done);
  }, [slide]);
  // The placeholder only ever shows in the open card: closed, the card rests invisible in view, and a chat loading while
  // preloaded (a visitor's, until the first open) must not draw a ghost card or a reachable Close there.
  const placeholder = chatLoading && sheetOpen;

  const style = accent && (ACCENT_NAMES as readonly string[]).includes(accent) ? ({ "--ua": `var(--ua-${accent})` } as CSSProperties) : undefined;
  const body = showSettings
    ? (settings ? settings.render() : <FlockSettingsFrame theme={resolvedTheme} onUnavailable={settingsUnavailable} />)
    : chatIsPage && active === CHAT_ID ? chat!.render() : children;
  // People and the theme switch: the end of the title row, or of the tabs row when Flock names the app. Nothing to show: none.
  const endItems = people?.length || !followsFlock ? (
    <div className="fl-shell-end">
      {people?.length ? <AvatarStack people={people} /> : null}
      {/* Opened from a Flock chat the app wears Flock's theme: no choice of its own to offer. */}
      {followsFlock ? null : (
        <button type="button" className="fl-shell-theme" onClick={toggleTheme}
          aria-label={`Switch to ${NEXT[choice]} theme`} title={`Theme: ${choice}`}>
          <Icon name={choice === "dark" ? "moon" : choice === "light" ? "sun" : "monitor"} size={16} />
        </button>
      )}
    </div>
  ) : null;
  const cls = `fl-shell fl-shell-nav-${mode}${showSide ? " fl-shell-chat" : ""}${launcher ? " fl-shell-has-launcher" : ""}${onApp ? " fl-shell-under-tabs" : ""}`;
  const sideChat = side && opened ? <ChatModeContext.Provider value={chatMode}>{chat!.render()}</ChatModeContext.Provider> : null;

  return (
    <ToastProvider>
      <ShellChatContext.Provider value={shellChat}>
      <div className={cls} style={style}>
        {/* Before the column (header, tabs, page), on the left: it runs from the top of the viewport and sticks there. */}
        {side && opened && !narrow ? <aside className="fl-shell-agent" aria-label="Agent chat" hidden={hidden} inert={hidden} aria-hidden={hidden ? "true" : undefined}>{sideChat}</aside> : null}
        <div className="fl-shell-col">
        {onApp && homeOffer?.show ? <HomeOfferBanner appName={homeOffer.appName} /> : null}
        {framed ? null : (
          <header className="fl-shell-head">
            {ownerIcon ? <span className="fl-shell-ic fl-shell-ic-own">{ownerIcon.startsWith("/") ? <img src={ownerIcon} alt="" /> : <span aria-hidden="true">{ownerIcon}</span>}</span>
              : object ? <span className="fl-shell-ic"><ObjectIcon name={object} size={32} /></span> : null}
            <div className="fl-shell-title">
              <div className="fl-shell-name">{name}</div>
              {subtitle ? <small>{subtitle}</small> : null}
            </div>
            {endItems}
          </header>
        )}
        {mode === "top" ? (
          <div className={`fl-shell-tabs${framed ? " fl-shell-tabs-row" : ""}`}>
            <Tabs tabs={items.map((p) => ({ id: p.id, label: p.label, icon: p.icon }))} value={active ?? ""} onChange={go} />
            {framed ? endItems : null}
          </div>
        ) : framed && endItems ? <div className="fl-shell-bar">{endItems}</div> : null}
        <UpdateBanner />
        <OwnerRemovalBanner />
        <SampleBanner />
        <div className="fl-shell-grid">
          {mode === "side" ? (
            <nav className="fl-shell-rail" aria-label="Pages">
              {items.map((p) => (
                <button key={p.id} type="button" aria-current={p.id === active ? "page" : undefined} onClick={() => go(p.id)}>
                  {p.icon ? <Icon name={p.icon} size={16} /> : null}<span>{p.label}</span>
                </button>
              ))}
            </nav>
          ) : null}
          <main className="fl-shell-main">{body}</main>
        </div>
        </div>
        {launcher ? (
          <>
            {/* Kept mounted while the chat is open (focus comes back to it); out of sight under the full page. */}
            <button type="button" className="fl-shell-launch" hidden={full} onClick={openChat}>
              <AgentMark key={agentAvatar ?? ""} avatar={agentAvatar} />{agentLabel}
            </button>
            {opened && narrow ? (
              // One layer for the sheet and the full page: only classes change, so the chat inside (an iframe for the owner)
              // is never moved or remounted. The app's main stays mounted underneath.
              <div ref={layerRef} className={full ? `fl-shell-full-wrap${onApp ? " fl-shell-full-app" : ""}` : "fl-shell-sheet-wrap"} hidden={!sheetOpen}
                inert={!sheetOpen} aria-hidden={sheetOpen ? undefined : "true"} data-slide={slide && sheetOpen && !full ? "" : undefined}>
                {full ? null : <div className="fl-shell-scrim" onClick={closeSheet} />}
                <div ref={sheetRef} className={full ? "fl-shell-full" : "fl-shell-sheet"} role="dialog" aria-modal={sheetOpen && !onApp ? "true" : undefined} aria-label={agentLabel}>
                  {/* The kit's own tabs, for its own chat: Flock's chat draws them in its top instead (app-shell.css). */}
                  {full ? (
                    <div className="fl-shell-fulltabs" role="tablist" aria-label={agentLabel}>
                      <button type="button" role="tab" aria-selected={tab === "chat"} onClick={() => pick("chat")}>
                        <Icon name="message-circle" size={15} />Chat
                      </button>
                      <button type="button" role="tab" aria-selected={tab === "app"} onClick={() => pick("app")}>
                        {name}{dot && tab !== "app" ? <span className="fl-shell-dot" aria-label="Changed" /> : null}
                      </button>
                    </div>
                  ) : <div className="fl-shell-grab" aria-hidden="true" />}
                  {full ? null : <button type="button" className="fl-shell-close" aria-label="Close chat" onClick={closeSheet}><Icon name="x" size={16} /></button>}
                  <div className="fl-shell-sheet-chat" hidden={onApp}>{sideChat}</div>
                  {/* A light copy of the card (header, empty body, pill composer) while the chat is not ready yet; it fades
                      out over the chat once it is, in place. */}
                  {full ? null : (
                    <div className="fl-shell-sheet-ph" data-on={placeholder ? "" : undefined} aria-hidden={placeholder ? undefined : "true"}>
                      <div className="fl-shell-ph-head">
                        <span className="fl-shell-ph-av" /><span className="fl-shell-ph-name" />
                        {placeholder ? <button type="button" className="fl-shell-ph-close" aria-label="Close chat" onClick={closeSheet}><Icon name="x" size={16} /></button> : null}
                      </div>
                      <div className="fl-shell-ph-body" />
                      <div className="fl-shell-ph-composer" />
                    </div>
                  )}
                </div>
              </div>
            ) : null}
          </>
        ) : null}
      </div>
      </ShellChatContext.Provider>
    </ToastProvider>
  );
}
