import { useCallback, useEffect, useRef, useState } from "react";
import { kitFetch, followConversation, KitError, store, checkDeploy } from "../../data/client";
import { useMe } from "../../data/hooks";
import { useToast } from "../Toast/Toast";

export interface ChatContext { table: string; id: string; label: string }
export interface ChatMessage { id: string; role: "user" | "assistant" | "error"; content: string; created_at: string }
export interface ChatChange { id: string; table: string; rowId: string; op: string; summary: string; undone: boolean; created_at?: string }
export interface ConversationSummary { id: string; title: string; last_message_at: string | null }
interface Current { id: string; messages: ChatMessage[]; changes: ChatChange[] }

export const UNREACHABLE = "Your agent couldn't be reached";
export const BUSY = "Your agent is still replying. Send that again in a moment";
const GENERIC = "Something went wrong. Try again in a moment";
const ROW_GONE = "That row was removed, so this change can't be undone";
/** The kit's REJECTED text ends "Try a shorter one": sending the same message again cannot help. */
const retryableText = (text: string) => !/shorter one/i.test(text);

/** The words a viewer sees for a failed call, and whether sending the same message again could help. */
function explain(e: unknown): { text: string; retryable: boolean } {
  if (!(e instanceof KitError)) return { text: UNREACHABLE, retryable: true };
  if (e.status === 409) return { text: BUSY, retryable: false };
  if (e.status === 400 && e.field === "message") return { text: e.message, retryable: false };
  if (e.status === 0) return { text: UNREACHABLE, retryable: true };
  const friendly = typeof e.body?.message === "string" && e.body.message ? e.body.message : null;   // never the raw error code
  if (e.status === 503) return { text: friendly ?? UNREACHABLE, retryable: true };
  return { text: friendly ?? GENERIC, retryable: false };
}

/** The open conversation is remembered per app page, so a reload lands back in it. */
const activeKey = () => `flock.chat.active.${typeof location === "undefined" ? "" : location.pathname}`;
const RECENT_MS = 24 * 60 * 60 * 1000;
const POLL_MS = 3000;
/** How long the chat keeps polling for a handed-off change (the platform stops one after 30 minutes); after that, the page's
 *  focus / visible checks and the stream are left to notice it. */
export const AWAIT_POLL_MAX_MS = 30 * 60_000;
const NEW = "new";   // stored when the owner starts a new chat

/** The conversation a notification's tap names (`?chat=<id>`), taken out of the address so a reload does not reopen it. */
function chatFromUrl(): string | null {
  if (typeof location === "undefined") return null;
  try {
    const u = new URL(location.href); const id = u.searchParams.get("chat");
    if (!id) return null;
    u.searchParams.delete("chat"); history.replaceState(history.state, "", u.toString());
    return id;
  } catch { return null; }
}

export function useAgentChat() {
  const me = useMe();
  const toast = useToast();
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [current, setCurrent] = useState<Current | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // A change to the app asked for here, handed to the paired agent and not reported back yet (kit `awaitingChange`).
  const [awaiting, setAwaiting] = useState(false);
  const awaitingRef = useRef(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [canRetry, setCanRetry] = useState(false);
  const [lastSent, setLastSent] = useState<string | null>(null);
  const [gone, setGone] = useState(false);
  const [undoNote, setUndoNote] = useState<Record<string, string>>({});
  const activeRef = useRef<string | null>(null);
  const sentIn = useRef<string | null>(null);   // the conversation this session last sent into
  const last = useRef<{ text: string; context?: ChatContext | null } | null>(null);
  const seq = useRef(0);

  const refreshList = useCallback(async () => {
    try { setConversations((await kitFetch<{ conversations: ConversationSummary[] }>("_agent/conversations")).conversations); } catch { /* the list is a convenience */ }
  }, []);
  const load = useCallback(async (id: string) => {
    const mine = ++seq.current;
    try {
      const r = await kitFetch<{ messages: ChatMessage[]; changes: ChatChange[]; busy: boolean; awaitingChange?: boolean }>(`_agent/conversations/${id}`);
      if (mine !== seq.current || activeRef.current !== id) return;
      setCurrent({ id, messages: r.messages, changes: r.changes }); setBusy(r.busy); setGone(false);
      // The handed-off change was reported back: its redeploy is live by now, so the page checks for it (and reloads), even
      // when its stream was shut the whole time (a hidden tab) and no `done` ever arrived (T13).
      const nowAwaiting = !!r.awaitingChange;
      if (awaitingRef.current && !nowAwaiting) void checkDeploy();
      awaitingRef.current = nowAwaiting; setAwaiting(nowAwaiting);
      if (!r.busy) {
        setDraft("");   // the saved reply replaces whatever was streaming
        // A turn that failed before the stream opened left only its saved error row.
        const tail = r.messages[r.messages.length - 1];
        if (tail?.role === "error" && sentIn.current === id && last.current) {
          setError(tail.content); setCanRetry(retryableText(tail.content));
        }
      }
    } catch (e) {
      if (e instanceof KitError && e.status === 404 && e.body?.error === "not_found" && mine === seq.current && activeRef.current === id) {
        setGone(true); if (store.get(activeKey()) === id) store.remove(activeKey());
      }
      /* otherwise the stream's reconnect refetches */
    }
  }, []);
  // On mount: reopen the conversation this page had open, else the latest one if it is recent.
  useEffect(() => {
    let live = true;
    void (async () => {
      let list: ConversationSummary[] = [];
      try { list = (await kitFetch<{ conversations: ConversationSummary[] }>("_agent/conversations")).conversations; setConversations(list); } catch { /* the list is a convenience */ }
      if (!live || activeRef.current) return;
      // A tapped notification for a reply names its conversation (?chat=): that one opens, whatever was open before.
      const asked = chatFromUrl();
      if (asked && list.some((c) => c.id === asked)) { store.set(activeKey(), asked); activeRef.current = asked; setActiveId(asked); await load(asked); return; }
      const saved = store.get(activeKey());
      if (saved === NEW) return;   // the owner started a new chat: a reload keeps it blank
      const top = list[0]; const at = top?.last_message_at ? Date.parse(top.last_message_at) : NaN;
      const id = saved ?? (top && Number.isFinite(at) && Date.now() - at < RECENT_MS ? top.id : null);
      if (id) { activeRef.current = id; setActiveId(id); await load(id); }
    })();
    return () => { live = false; };
  }, [load]);

  // While a turn is running, poll it: a hidden tab or a full connection pool can leave the stream shut, and the
  // agent's replies by /_agent/notice do arrive on the stream, and a hidden tab gets them on wake. Stops when the turn ends.
  // The same while a change asked for here is with the paired agent: its "done" note and the redeploy land without a stream.
  useEffect(() => {
    if (!(busy || awaiting) || !activeId || gone) return;
    const id = activeId;
    const t = setInterval(() => void load(id), POLL_MS);
    // A change that is never reported (its notice lost) must not poll for the key's whole life: polling for it alone stops.
    const cap = !busy ? setTimeout(() => clearInterval(t), AWAIT_POLL_MAX_MS) : null;
    return () => { clearInterval(t); if (cap) clearTimeout(cap); };
  }, [busy, awaiting, activeId, gone, load]);

  // The open conversation rides the page's one stream (followConversation): each ready reloads it, a drop or `gone` checks it.
  useEffect(() => {
    if (!activeId || gone) return;
    const id = activeId;
    const json = (d: string) => { try { return JSON.parse(d); } catch { return {}; } };
    return followConversation(id, {
      ready: () => { setDraft(""); void load(id); },
      error: () => void load(id),   // a 404 here means the conversation is gone: load says so and the follow ends
      gone: () => void load(id),
      state: (d) => setBusy(!!json(d).busy),
      text: (d) => { const c = json(d).content; if (typeof c === "string") setDraft((p) => (p ? `${p}\n\n${c}` : c)); },
      done: () => { void checkDeploy(); void load(id).then(() => { setDraft(""); void refreshList(); }); },
      failed: (d) => {
        const m = json(d).message; setDraft(""); setBusy(false);
        const text = typeof m === "string" && m ? m : UNREACHABLE;
        setError(text); setCanRetry(retryableText(text)); void load(id);
      },
    });
  }, [activeId, gone, load, refreshList]);

  const open = useCallback(async (id: string | null) => {
    store.set(activeKey(), id ?? NEW);
    activeRef.current = id; setActiveId(id); setDraft(""); setError(null); setCanRetry(false); setBusy(false); setGone(false);
    awaitingRef.current = false; setAwaiting(false);
    if (!id) { seq.current++; setCurrent(null); return; }
    await load(id);
  }, [load]);

  const send = useCallback(async (text: string, context?: ChatContext | null): Promise<void> => {
    const message = text.trim(); if (!message) return;
    last.current = { text: message, context }; setLastSent(message);
    setError(null); setCanRetry(false); setBusy(true);
    try {
      const r = await kitFetch<{ conversationId: string }>("_agent/message", { method: "POST", body: JSON.stringify({
        message, ...(activeRef.current ? { conversationId: activeRef.current } : {}),
        ...(context ? { context: { table: context.table, id: context.id } } : {}) }) });
      sentIn.current = r.conversationId;
      store.set(activeKey(), r.conversationId);
      if (activeRef.current !== r.conversationId) { activeRef.current = r.conversationId; setActiveId(r.conversationId); }
      await load(r.conversationId); void refreshList();
    } catch (e) {
      const x = explain(e); setError(x.text); setCanRetry(x.retryable);
      // A 409 is an older kit's "still replying" (it holds one turn at a time): the agent is busy all the same.
      if (!(e instanceof KitError && e.status === 409)) setBusy(false);
      throw e;
    }
  }, [load, refreshList]);

  const retry = useCallback(async () => {
    const l = last.current; if (!l) return;
    try { await send(l.text, l.context); } catch { /* the error is already shown */ }
  }, [send]);

  const undo = useCallback(async (changeId: string) => {
    try {
      await kitFetch(`_data/_changes/${changeId}/undo`, { method: "POST" });
    } catch (e) {
      if (e instanceof KitError && e.status === 409 && e.body?.error === "row_gone") { setUndoNote((n) => ({ ...n, [changeId]: ROW_GONE })); return; }
      if (!(e instanceof KitError && e.status === 409 && e.body?.error === "already_undone")) { toast.show({ message: "Couldn't undo that change", tone: "danger" }); return; }
    }
    setCurrent((c) => (c ? { ...c, changes: c.changes.map((x) => (x.id === changeId ? { ...x, undone: true } : x)) } : c));
  }, [toast]);

  return { conversations, current, busy, draft, error, canRetry, lastSent, gone, undoNote, agentName: me.agent?.name ?? null, paired: me.loading ? null : !!me.agent, open, send, retry, undo };
}
