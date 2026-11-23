import "./agent-chat.css";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Markdown } from "../Markdown/Markdown";
import { Button } from "../Button/Button";
import { Icon } from "../Icon/Icon";
import { useAgentChat, type ChatChange, type ChatContext, type ChatMessage } from "./useAgentChat";
import { useChatPresence } from "./useChatPresence";
import { FlockChatFrame } from "./FlockChatFrame";
import { useMe } from "../../data/hooks";
import { useFlockOwner } from "../../data/flock-host";
import { useFlockChatPass } from "../../data/flock-chat-pass";
import { useChatMode } from "./chat-mode";
import { useChatRequest, type ChatRequest } from "../AppShell/shell-chat";

export type { ChatContext } from "./useAgentChat";
export interface AgentChatProps { placement: "side" | "page"; context?: ChatContext | null; starters?: string[]; title?: string }

function Changes({ items, note, onUndo }: { items: ChatChange[]; note: Record<string, string>; onUndo: (id: string) => void }) {
  return (
    <div className="fl-chat-changes">
      <div className="fl-chat-changes-head"><Icon name="check" size={14} />{items.length === 1 ? "1 change made" : `${items.length} changes made`}</div>
      <ul>
        {items.map((c) => (
          <li key={c.id}>
            <span>{c.summary}{note[c.id] ? <small className="fl-chat-undo-note">{note[c.id]}</small> : null}</span>
            {c.undone ? <em>Undone</em> : <Button variant="ghost" size="sm" onClick={() => onUndo(c.id)}>Undo</Button>}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Bubble({ m }: { m: ChatMessage }) {
  if (m.role === "user") return <div className="fl-chat-msg fl-chat-user"><p>{m.content}</p></div>;
  if (m.role === "error") return <div className="fl-chat-msg fl-chat-err">{m.content}</div>;
  return <div className="fl-chat-msg fl-chat-agent"><Markdown text={m.content} /></div>;
}

const at = (t?: string) => (t ? Date.parse(t) : NaN);
/** Each change belongs to the turn it happened in: between that turn's user message and the next one. A change with
 *  no usable time goes under the last turn. Returns the changes to show after message i. */
export function changesAfter(messages: ChatMessage[], changes: ChatChange[]): Map<number, ChatChange[]> {
  const out = new Map<number, ChatChange[]>();
  const users = messages.map((m, i) => (m.role === "user" ? i : -1)).filter((i) => i >= 0);
  if (!users.length) return out;
  const turnOf = (c: ChatChange) => {
    const t = at(c.created_at); if (Number.isNaN(t)) return users.length - 1;
    let k = 0;
    users.forEach((u, j) => { if (t >= at(messages[u].created_at)) k = j; });
    return k;
  };
  for (const c of changes) {
    const k = turnOf(c);
    const end = (users[k + 1] ?? messages.length) - 1;   // the last message of that turn
    out.set(end, [...(out.get(end) ?? []), c]);
  }
  return out;
}

/** How long the side chat waits to learn whether the viewer is the owner (and which app this is) before it settles on the kit's. */
const DECIDE_MS = 5000;

/** The agent chat in an app. Beside the app, the signed-in Flock owner gets Flock's own chat (FlockChatFrame), and so does a
 *  visitor the kit hands a pass (a public app); everyone else, an app whose kit does not name itself, or an embed that can't
 *  be used here, gets the kit's chat. As a page, always the kit's. */
export function AgentChat(props: AgentChatProps) {
  return props.placement === "side" ? <SideChat {...props} /> : <KitChat {...props} />;
}

function SideChat(props: AgentChatProps) {
  const { owner, loading } = useFlockOwner();
  const me = useMe();
  const shell = useChatMode();
  const open = shell.open ?? true;
  // Opened at least once: a preloaded chat nobody opened asks for no visitor's pass (each holds one of the app's tokens).
  const [openedOnce, setOpenedOnce] = useState(open);
  if (open && !openedOnce) setOpenedOnce(true);
  // Anyone else asks the kit for a visitor's pass: on a public app they get Flock's chat with it, else the kit's. The owner's
  // chat preloads in full; anyone else's waits for the first open (deciding meanwhile, so no kit chat is drawn and dropped).
  const waitingOpen = !loading && !owner && !openedOnce;
  const visitor = useFlockChatPass(!loading && !owner && openedOnce);
  const [unavailable, setUnavailable] = useState(false);
  // Flock or the app slow to answer (or _me failing): the kit's chat, for good, rather than a blank panel.
  const [gaveUp, setGaveUp] = useState(false);
  const deciding = loading || me.loading || (!owner && (waitingOpen || visitor.loading));
  useEffect(() => {
    if (!deciding || gaveUp || waitingOpen) return;
    const t = setTimeout(() => setGaveUp(true), DECIDE_MS);
    return () => clearTimeout(t);
  }, [deciding, gaveUp, waitingOpen]);
  // The kit's chat has no way out of the full page (Flock's chat drew its tabs and Shrink): falling back there, the full
  // page goes back to the sheet.
  const fellBack = unavailable || gaveUp;
  const { mode, shrink } = shell;
  useEffect(() => {
    if (fellBack && mode === "full") shrink();
  }, [fellBack, mode, shrink]);
  // A message the app asked for (useChat), handed to Flock's chat once it shows; the kit's chat takes its own.
  const [compose, setCompose] = useState<ChatRequest | undefined>(undefined);
  useChatRequest((r) => { if (!fellBack) setCompose(r); });
  const flock = !fellBack && !deciding && !!(owner || visitor.pass) && typeof me.appId === "string" && !!me.appId && !!me.agent?.id;
  // Still deciding, or Flock's chat not yet in view: the shell's phone sheet holds its placeholder over this. Told before
  // paint, so a sheet opened on a fresh mount never shows a blank card first.
  const [shown, setShown] = useState(false);
  const pending = !fellBack && (deciding || (flock && !shown));
  const { loading: tell } = shell;
  useLayoutEffect(() => { tell?.(pending); }, [tell, pending]);
  useEffect(() => () => tell?.(false), [tell]);
  if (fellBack) return <KitChat {...props} visible={open} />;
  if (deciding) return <section className="fl-chat fl-chat-side" aria-label="Agent chat" aria-busy="true" />;
  if (flock) {
    // AppShell says how it shows the chat (side panel, phone sheet or full page) and what Hide, Expand and Shrink do.
    return (
      <section className="fl-chat fl-chat-side fl-chat-flock" aria-label="Agent chat">
        <FlockChatFrame mode={shell.mode} starters={props.starters ?? []} onHide={shell.hide} onExpand={shell.expand} onShrink={shell.shrink}
          onAppChanged={shell.appChanged} onShowApp={shell.showApp} onUnavailable={() => setUnavailable(true)} onShown={() => setShown(true)}
          tab={shell.tab} appName={shell.appName} dot={shell.dot} onPickTab={shell.pickTab} theme={shell.theme}
          visible={open} visitor={owner ? undefined : visitor.pass ?? undefined} compose={compose} />
      </section>
    );
  }
  return <KitChat {...props} visible={open} />;
}

/** The kit's own chat with the app's agent, on the app's kit routes (./api/_agent/*). */
/** `visible`: in view now (default). Hidden (preloaded, closed, or the full page's App tab), it reports nothing to the
 *  kit's notifications: no `viewing`, no `seen`. */
function KitChat({ placement, context = null, starters = [], title, visible = true }: AgentChatProps & { visible?: boolean }) {
  const chat = useAgentChat();
  const [input, setInput] = useState("");
  const [ctx, setCtx] = useState<ChatContext | null>(context);
  const [showList, setShowList] = useState(false);
  const thread = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const [announce, setAnnounce] = useState("");
  const seen = useRef<{ conv: string | null; last: string | null }>({ conv: null, last: null });
  const ctxKey = context ? `${context.table}:${context.id}` : "";
  useEffect(() => { setCtx(context); }, [ctxKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const { current, busy, draft, error, canRetry, lastSent, gone, undoNote } = chat;
  const count = current?.messages.length ?? 0;
  const latestReply = current?.messages.filter((m) => m.role === "assistant").at(-1);
  useChatPresence(visible && !gone ? current?.id ?? null : null, latestReply?.id ?? null);
  useEffect(() => { thread.current?.scrollTo?.({ top: thread.current.scrollHeight }); }, [count, draft, current?.changes.length]);
  // Screen readers hear a new reply once, not the whole thread on every update.
  useEffect(() => {
    const tail = current?.messages[current.messages.length - 1];
    const prev = seen.current;
    if (current && tail && prev.conv === current.id && prev.last !== tail.id && tail.role === "assistant") setAnnounce(`${chat.agentName ?? "Your agent"} replied: ${tail.content}`);
    seen.current = { conv: current?.id ?? null, last: tail?.id ?? null };
  }, [current]); // eslint-disable-line react-hooks/exhaustive-deps
  // A message that failed to arrive goes back into the box, so nothing typed is lost.
  useEffect(() => { if (error && lastSent) setInput((v) => v || lastSent); }, [error, lastSent]);

  // Sending while the agent is still replying is fine: the message joins the conversation and its reply follows in order.
  const submit = async (text: string) => {
    const t = text.trim(); if (!t) return;
    setInput(""); box.current?.focus();
    try { await chat.send(t, ctx); } catch { setInput(t); }
  };
  // A message the app asked for (useChat): into the box, or sent.
  useChatRequest((r) => {
    if (r.send) { void submit(r.text); return; }
    setInput(r.text); box.current?.focus();
  });
  const again = async () => { setInput(""); box.current?.focus(); await chat.retry(); };
  const name = chat.agentName;
  const heading = title ?? `Ask ${name ?? "your agent"}`;
  const messages = (current?.messages ?? []).filter((m, i, all) => !(error && m.role === "error" && m.content === error && i === all.length - 1));
  const turnChanges = changesAfter(messages, current?.changes ?? []);
  const fresh = !current || (messages.length === 0 && !draft);

  const list = (
    <nav className="fl-chat-list" aria-label="Conversations">
      <button type="button" className="fl-chat-new" onClick={() => { void chat.open(null); setShowList(false); }}><Icon name="plus" size={14} />New chat</button>
      {chat.conversations.map((c) => (
        <button key={c.id} type="button" className="fl-chat-conv" aria-current={current?.id === c.id ? "true" : undefined}
          onClick={() => { void chat.open(c.id); setShowList(false); }}>{c.title || "Untitled chat"}</button>
      ))}
    </nav>
  );

  const body = gone ? (
    <div className="fl-chat-empty"><Icon name="message-circle" size={22} /><p>This conversation is gone.</p>
      <Button variant="soft" size="sm" onClick={() => void chat.open(null)}>New chat</Button></div>
  ) : chat.paired === false ? (
    <div className="fl-chat-empty"><Icon name="message-circle" size={22} /><p>This app isn't paired with an agent yet.</p></div>
  ) : (
    <>
      <div className="fl-chat-sr" role="status" aria-live="polite">{announce}</div>
      <div className="fl-chat-thread" ref={thread}>
        {fresh ? (
          <div className="fl-chat-hello">
            <p>{name ? `Ask ${name} to change this app, or about what is in it.` : "Ask to change this app, or about what is in it."}</p>
            {starters.length ? (
              <div className="fl-chat-starters">
                {starters.map((s) => <button key={s} type="button" disabled={busy} onClick={() => void submit(s)}>{s}</button>)}
              </div>
            ) : null}
          </div>
        ) : null}
        {messages.map((m, i) => (
          <div key={m.id} className="fl-chat-turn-part">
            <Bubble m={m} />
            {turnChanges.get(i)?.length ? <Changes items={turnChanges.get(i)!} note={undoNote} onUndo={(id) => void chat.undo(id)} /> : null}
          </div>
        ))}
        {draft ? <div className="fl-chat-msg fl-chat-agent fl-chat-draft"><Markdown text={draft} /></div>
          : busy ? <span className="fl-chat-typing" role="status" aria-label={`${name ?? "Your agent"} is working`}><i /><i /><i /></span> : null}
      </div>
      <div className="fl-chat-foot">
        {error ? (
          <div className="fl-chat-error" role="alert">
            <span>{error}</span>
            {error && canRetry ? <Button variant="soft" size="sm" onClick={() => void again()}>Send again</Button> : null}
          </div>
        ) : null}
        <form className="fl-chat-composer" onSubmit={(e) => { e.preventDefault(); void submit(input); }}>
          {ctx ? (
            <span className="fl-chat-chip">About: {ctx.label}
              <button type="button" aria-label="Clear context" onClick={() => setCtx(null)}><Icon name="x" size={12} /></button>
            </span>
          ) : null}
          <div className="fl-chat-row">
            <textarea ref={box} aria-label="Message" rows={1} value={input} placeholder={name ? `Message ${name}` : "Message your agent"}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void submit(input); } }} />
            <button type="submit" className="fl-chat-send" aria-label="Send" disabled={!input.trim()}><Icon name="arrow-up" size={16} /></button>
          </div>
        </form>
      </div>
    </>
  );

  if (placement === "page") {
    return (
      <section className="fl-chat fl-chat-page" aria-label="Agent chat">
        {list}
        <div className="fl-chat-main"><h2 className="fl-chat-title">{heading}</h2>{body}</div>
      </section>
    );
  }
  return (
    <section className="fl-chat fl-chat-side" aria-label="Agent chat">
      <header className="fl-chat-head">
        <h2 className="fl-chat-title">{heading}</h2>
        <button type="button" className="fl-chat-hist" aria-label="Conversation history" aria-expanded={showList} onClick={() => setShowList((v) => !v)}><Icon name="history" size={16} /></button>
      </header>
      {showList ? list : null}
      {body}
    </section>
  );
}
