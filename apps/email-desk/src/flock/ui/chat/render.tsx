import { Component, createElement, useCallback, useRef, useState, type ReactNode } from "react";
import { chatRegistry as registry } from "./chat-registry";
import { Button } from "../components/Button/Button";
import { Checklist, type ChecklistItem } from "../components/Checklist/Checklist";
import type { MakeAppState } from "../components/MiniApp/MiniApp";
import { Choice, type Answer } from "../components/Choice/Choice";
import { SlotPicker, clockLabel, slotStarts, type SlotPickerProps } from "../components/SlotPicker/SlotPicker";
import { Value } from "../components/Value/Value";
import { Image } from "../components/Image/Image";
import { ImageSourceContext, type ImageState } from "../components/Image/image-source";
import { ItemPicker, type PickedItem } from "../components/ItemPicker/ItemPicker";
import { ProductCards, type ProductCardsAnswer } from "../components/ProductCards/ProductCards";
import type { ValueKind } from "../components/Value/kind";
import { objectKnown, objectNames } from "../objects-index";
import { setChatObjectNames } from "./object-names";
import { figure } from "../format";
import { propsByKind } from "./schema-info";
import { MAKE_APP_TEXT, replyText } from "./reply-text";
import { blockText } from "./text-fallback";
import { datesAsList, ISO_DAY, text } from "./normalize";
import { reportOf, validateBlock, type BlockIssue, type BlockNode, type BlockResult } from "./validate";
import "./chat.css";

// The validator reads ObjectIcon's names through object-names.ts (it never imports the vite-only pictures): the frame knows them.
setChatObjectNames(objectNames);

export type { Answer };
export type BlockEvent =
  | { kind: "reply"; blockId: string; text: string; value: unknown }
  | { kind: "state"; blockId: string; answers: Record<string, Answer> }
  | { kind: "makeApp"; blockId: string }
  /** A product title was clicked: the chat opens it only if the block holds this address. Not gated by the lock (a sent block's links still open). */
  | { kind: "openUrl"; url: string };

export interface ChatBlockProps {
  spec: BlockNode;
  /** false once the conversation has moved on or the block was answered: every control is disabled and nothing is emitted. */
  live: boolean;
  /** The reply this block already got, shown as the chosen state on the node `replyTo` names (the root when absent). */
  answered?: { value: unknown; replyTo?: string } | null;
  /** Saved Questions drafts. */
  restored?: Record<string, Answer> | null;
  /** Make it an app was already pressed for this block (read from the transcript): it reads App requested, disabled. */
  appRequested?: boolean;
  onEvent: (e: BlockEvent) => void;
}

/** What every node renders against: lock state and the three things a node may emit. */
interface Env {
  locked: boolean;
  makeAppState: MakeAppState;
  /** The block's saved reply; a node reads it as `answered` when it is the one the reply came from. */
  answer: { value: unknown; replyTo?: string } | null;
  /** The saved reply value, for the node the reply came from only. */
  answered: unknown;
  restored: Record<string, Answer> | null;
  /** The node a saved reply without replyTo belongs to. */
  replyRoot: BlockNode;
  reply: (node: BlockNode, value: unknown) => void;
  state: (node: BlockNode, answers: Record<string, Answer>) => void;
  makeApp: (node: BlockNode) => void;
  openUrl: (url: string) => void;
}

const isObj = (v: unknown): v is Record<string, any> => !!v && typeof v === "object" && !Array.isArray(v);
const propsOf = (n: BlockNode): Record<string, any> => (isObj(n.props) ? n.props : {});
/** A row with every object or list field read as words: Table and RowList draw fields as text. */
const readableRow = (row: unknown): unknown =>
  isObj(row) ? Object.fromEntries(Object.entries(row).map(([k, v]) => [k, v !== null && typeof v === "object" ? text(v) : v])) : row;
const field = (row: any, key: string): unknown => (isObj(row) ? row[key] : undefined);

/** The first of `keys` a row has, as words. */
const first = (r: unknown, ...keys: string[]): string => { for (const k of keys) { const v = field(r, k); if (v !== undefined && v !== null && v !== "") return text(v); } return ""; };
/** A row's value at the right, formatted by its kind (a RowList's amount). */
function trailing(r: unknown): ReactNode {
  const v = field(r, "value");
  if (v === undefined || v === null || v === "") return null;
  const kind = field(r, "kind");
  return <Value kind={(typeof kind === "string" ? kind : typeof v === "number" ? "number" : "text") as ValueKind} value={v} />;
}

/** A row's photo at the left (a RowList's `image`). */
function thumb(r: unknown): ReactNode {
  const src = text(field(r, "image"));
  return <span className="fl-chat-thumb"><Image src={src || null} alt={first(r, "name", "title")} /></span>;
}
const hasImage = (r: unknown): boolean => { const v = field(r, "image"); return typeof v === "string" && v.trim() !== ""; };

/** Accessors for the components that need a function to read each row, by the field names agents write (R5). */
const ACCESSORS: Record<string, Record<string, (row: any) => unknown>> = {
  Calendar: { date: (r) => text(field(r, "date")), title: (r) => first(r, "title", "name"), time: (r) => text(field(r, "time")), lane: (r) => first(r, "lane", "slot") },
  Schedule: {
    date: (r) => text(field(r, "date")), title: (r) => first(r, "title", "name"), time: (r) => text(field(r, "time")),
    secondary: (r) => first(r, "meta", "note", "location") || undefined, slot: (r) => first(r, "slot") || undefined,
  },
  RowList: { title: (r) => first(r, "name", "title"), meta: (r) => first(r, "meta", "note", "subtitle", "caption"), trailing },
};

/** A list longer than this shows its first SHOWN rows and "Show all N" (Checklist's collapseAfter, for every list). */
const LONG = 8, SHOWN = 6;
function LongList({ count, unit, draw }: { count: number; unit?: string; draw: (all: boolean) => ReactNode }) {
  const [all, setAll] = useState(false);
  return (
    <div className="fl-chat-long">
      {draw(all)}
      {all ? null : <button type="button" className="fl-check-more" onClick={() => setAll(true)}>Show all {count}{unit ? ` ${unit}` : ""}</button>}
    </div>
  );
}
/** The prop holding each list's rows. */
const LIST_PROP: Record<string, string> = { Table: "rows", RowList: "rows", ProgressList: "items", Bullets: "items" };

const FIELDSET_RESET = { border: 0, padding: 0, margin: 0, minWidth: 0 } as const;
/** Native controls inside a disabled fieldset are all disabled at once. */
function Lockable({ locked, children }: { locked: boolean; children: ReactNode }) {
  return <fieldset disabled={locked} style={FIELDSET_RESET}>{children}</fieldset>;
}

function ChoiceBlock({ node, env }: { node: BlockNode; env: Env }) {
  const [mine, setMine] = useState<Answer | null>(null);
  const p = propsOf(node) as any;
  const answer = mine ?? (env.answered as Answer | null | undefined) ?? null;
  return <Choice {...p} answer={answer} disabled={env.locked} onAnswer={(a) => { setMine(a); env.reply(node, a); }} />;
}

function ItemPickerBlock({ node, env }: { node: BlockNode; env: Env }) {
  const [mine, setMine] = useState<PickedItem[] | null>(null);
  const p = propsOf(node) as any;
  const answer = mine ?? (Array.isArray(env.answered) ? (env.answered as PickedItem[]) : null);
  return <ItemPicker {...p} answer={answer} disabled={env.locked} collapseAfter={SHOWN} onSubmit={(picked) => { setMine(picked); env.reply(node, picked); }} />;
}

function ProductCardsBlock({ node, env }: { node: BlockNode; env: Env }) {
  const [mine, setMine] = useState<ProductCardsAnswer | null>(null);
  const p = propsOf(node) as any;
  const saved = Array.isArray(env.answered) || (isObj(env.answered) && "written" in env.answered) ? (env.answered as ProductCardsAnswer) : null;
  const answer = mine ?? saved;
  return <ProductCards {...p} answer={answer} disabled={env.locked} onSubmit={(a) => { setMine(a); env.reply(node, a); }} onOpenUrl={env.openUrl} />;
}

function ChecklistBlock({ node, env }: { node: BlockNode; env: Env }) {
  const p = propsOf(node);
  const items: ChecklistItem[] = Array.isArray(p.items) ? p.items : [];
  const start = Array.isArray(env.answered) ? (env.answered as string[]) : items.filter((i) => i.done).map((i) => i.id);
  const [ticked, setTicked] = useState<string[]>(start);
  const toggle = (id: string, done: boolean) => { if (!env.locked) setTicked((t) => (done ? [...t, id] : t.filter((x) => x !== id))); };
  return (
    <div>
      <Lockable locked={env.locked}>
        <Checklist {...p} items={items.map((i) => ({ ...i, done: ticked.includes(i.id) }))} onToggle={toggle} collapseAfter={6} />
        <Button disabled={env.locked} onClick={() => env.reply(node, items.filter((i) => ticked.includes(i.id)).map((i) => i.id))}>Send</Button>
      </Lockable>
    </div>
  );
}

function SlotPickerBlock({ node, env }: { node: BlockNode; env: Env }) {
  const p = propsOf(node);
  const saved = isObj(env.answered) ? (env.answered as { start?: string }).start ?? null : null;
  const [picked, setPicked] = useState<string | null>(saved);
  const length: number = typeof p.length === "number" ? p.length : p.slotMinutes;
  const known = picked !== null && slotStarts(p.open, p.close, p.slotMinutes, p.length).includes(picked);
  const end = (start: string) => { const [h, m] = start.split(":").map(Number); const t = h * 60 + m + length; return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`; };
  const range = known ? `${clockLabel(picked!)}–${clockLabel(end(picked!))}` : "";
  return (
    <div>
      <Lockable locked={env.locked}>
        <SlotPicker {...(p as SlotPickerProps)} value={picked} onChange={(t) => { if (!env.locked) setPicked(t); }} />
        <Button disabled={env.locked || !known} onClick={() => env.reply(node, { start: picked, end: end(picked!) })}>{known ? `Book ${range}` : "Book"}</Button>
      </Lockable>
    </div>
  );
}

function labelOf(node: BlockNode): string {
  const p = propsOf(node);
  if (typeof p.children === "string") return p.children;
  const kid = node.children?.[0];
  return kid && typeof propsOf(kid).text === "string" ? propsOf(kid).text : "";
}

/** The node a reply without replyTo came from: the root, or the node an implicit MiniApp wraps (same id, only child). */
function replyRoot(spec: BlockNode): BlockNode {
  const only = spec.type === "MiniApp" && spec.children?.length === 1 ? spec.children[0] : undefined;
  return only && typeof spec.id === "string" && only.id === spec.id ? only : spec;
}

/** The Monday of an ISO day. */
function mondayOf(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

function renderNode(node: BlockNode, env: Env, parent: BlockNode | undefined, key: number | string, isRoot: boolean): ReactNode {
  // A Schedule or Calendar with any date that is not YYYY-MM-DD is a list, no row dropped (the check repairs it the
  // same way; this covers a spec drawn without it).
  const asList = datesAsList(node);
  if (asList) return renderNode(asList as BlockNode, env, parent, key, isRoot);
  const def = registry.find((d) => d.name === node.type);
  if (!def) return null;
  const p = propsOf(node);
  const mine = !!env.answer && (env.answer.replyTo === undefined ? node === env.replyRoot : node.id === env.answer.replyTo);
  const e: Env = { ...env, answered: mine ? env.answer!.value : undefined, restored: isRoot ? env.restored : null };
  const kids = (node.children ?? []).map((c, i) => renderNode(c, e, node, i, false));
  const shape = def.props.shape as Record<string, any>;
  const { callbacks, nodes } = propsByKind(shape);

  // data props as given; node props as nodes (a string stays text); callbacks never come from the agent
  const props: Record<string, unknown> = {};
  const asNodes = (v: unknown, k: string): ReactNode =>
    Array.isArray(v) ? v.map((c, i) => renderNode(c as BlockNode, e, node, i, false)) : renderNode(v as BlockNode, e, node, k, false);
  for (const [k, v] of Object.entries(p)) {
    if (callbacks.includes(k) || k === "children") continue;
    props[k] = nodes.includes(k) && typeof v !== "string" ? asNodes(v, k) : v;
  }
  // props.children: text stays text, a node (or nodes) renders like node.children; node.children wins when both are given
  const propKids: ReactNode[] = p.children === undefined || p.children === null ? [] : typeof p.children === "string" ? [p.children] : [asNodes(p.children, "children")];
  const withKids = (extra: Record<string, unknown> = {}) =>
    createElement(def.component, { key, ...props, ...extra }, ...(kids.length ? kids : propKids));

  switch (node.type) {
    case "Choice":
      // Questions looks for Choice elements among its children and clones each with its own answer, disabled and onAnswer, so no wrapper here.
      return parent?.type === "Questions" ? createElement(Choice, { key, ...props, onAnswer: () => {} } as any) : <ChoiceBlock key={key} node={node} env={e} />;
    case "Checklist": return <ChecklistBlock key={key} node={node} env={e} />;
    case "ItemPicker": return <ItemPickerBlock key={key} node={node} env={e} />;
    case "ProductCards": return <ProductCardsBlock key={key} node={node} env={e} />;
    case "SlotPicker": return <SlotPickerBlock key={key} node={node} env={e} />;
    case "Form":
      return <Lockable key={key} locked={e.locked}>{createElement(def.component, { ...props, initial: isObj(e.answered) ? e.answered : props.initial, onSubmit: (values: Record<string, unknown>) => e.reply(node, values) })}</Lockable>;
    case "Button":
      return withKids({ disabled: e.locked || p.disabled === true, onClick: () => e.reply(node, labelOf(node)) });
    case "Questions": {
      const answers = (isObj(e.answered) ? e.answered : e.restored) as Record<string, Answer> | null;
      return withKids({ makeAppState: e.makeAppState,
        answers: answers ?? undefined, disabled: e.locked,
        onChange: (a: Record<string, Answer>) => e.state(node, a), onSubmit: (a: Record<string, Answer>) => e.reply(node, a), onMakeApp: () => e.makeApp(node),
      });
    }
    case "MiniApp":
      return withKids({ makeAppState: e.makeAppState, onMakeApp: () => e.makeApp(node) });
    case "ObjectIcon":
      // An unknown name draws a quiet blank tile, not nothing (the check names the closest pictures to the agent).
      if (typeof props.name !== "string" || !objectKnown(props.name)) {
        const size = typeof props.size === "number" ? props.size : 48;
        return <span key={key} className="fl-obj fl-obj-missing" style={{ width: size, height: size }} role="img" aria-label={typeof props.label === "string" ? props.label : `no picture for ${String(props.name)}`} />;
      }
      return withKids();
    case "Progress": {
      // With no limit there is nothing to measure against: the amount alone, never a full red "over" bar.
      const limit = figure(props.limit);
      if (limit !== null && limit > 0) return withKids();
      const kind = (typeof props.kind === "string" ? props.kind : "number") as ValueKind;
      return (
        <div key={key} className="fl-chat-amount">
          {typeof props.label === "string" ? <span className="fl-chat-amount-l">{props.label}</span> : null}
          <Value kind={kind} value={props.value} />
        </div>
      );
    }
    default: {
      // A row with no usable date cannot be placed, and the date maths throws on it: leave such rows out.
      if ((node.type === "Table" || node.type === "RowList") && Array.isArray(props.rows)) props.rows = props.rows.map(readableRow);
      const accessors = ACCESSORS[node.type] ? Object.fromEntries(Object.entries(ACCESSORS[node.type]).filter(([k]) => !(k in props))) : {};
      // A RowList with no notes or amounts has no empty meta line or trailing slot under every row.
      if (node.type === "RowList" && Array.isArray(props.rows)) {
        if (!props.rows.some((r: unknown) => first(r, "meta", "note", "subtitle", "caption"))) delete accessors.meta;
        if (!props.rows.some((r: unknown) => text(field(r, "value")))) delete accessors.trailing;
        if (!("leading" in props) && props.rows.some(hasImage)) accessors.leading = thumb;
      }
      if ((node.type === "Calendar" || node.type === "Schedule") && Array.isArray(props.rows)) {
        const rows: unknown[] = props.rows.filter((r) => ISO_DAY.test(text(field(r, "date"))));
        props.rows = rows;
        const dates = [...new Set(rows.map((r) => text(field(r, "date"))))].sort();
        // A plan in chat is about its own days, not this week (owner 2026-10-21: a 7–11 Jan trip showed "Nothing planned"
        // from today): a Schedule opens on its first row's day and runs to its last, past days shown.
        if (node.type === "Schedule" && dates.length && props.from === undefined) {
          const span = (to: string) => Math.round((Date.parse(to) - Date.parse(dates[0])) / 86_400_000) + 1;
          const days = Math.min(31, Math.max(typeof props.days === "number" ? props.days : 0, span(dates[dates.length - 1])));
          Object.assign(props, { from: dates[0], days, showEarlier: true });
          if (dates.length > LONG) {
            const upTo = dates[SHOWN - 1];
            const some = { rows: rows.filter((r) => text(field(r, "date")) <= upTo), days: span(upTo) };
            return <LongList key={key} count={dates.length} unit="days" draw={(all) => withKids({ ...accessors, ...(all ? {} : some) })} />;
          }
        }
        // A week view opens on the week its rows are in, not this week.
        if (node.type === "Calendar" && dates.length && props.weekStart === undefined && (props.view === "schedule" || props.view === "week-grid")) props.weekStart = mondayOf(dates[0]);
        if (node.type === "Calendar" && props.view === "timeline" && rows.length > LONG) {
          const at = (r: unknown) => `${text(field(r, "date"))} ${text(field(r, "time"))}`;
          const sorted = [...rows].sort((a, b) => at(a).localeCompare(at(b)));
          return <LongList key={key} count={sorted.length} draw={(all) => withKids({ ...accessors, rows: all ? sorted : sorted.slice(0, SHOWN) })} />;
        }
      }
      const listKey = LIST_PROP[node.type];
      const list = listKey ? props[listKey] : undefined;
      if (Array.isArray(list) && list.length > LONG) {
        return <LongList key={key} count={list.length} draw={(all) => withKids({ ...accessors, [listKey]: all ? list : list.slice(0, SHOWN) })} />;
      }
      return withKids(accessors);
    }
  }
}

/** A validated block as the real components. It supplies every callback and reports what the user does as events. */
export function ChatBlock({ spec, live, answered, restored, appRequested, onEvent }: ChatBlockProps) {
  const [replied, setReplied] = useState(false);
  const repliedRef = useRef(false);
  const madeAppRef = useRef(false);
  const [pressed, setPressed] = useState(false);
  const madeApp = pressed || !!appRequested;
  if (appRequested) madeAppRef.current = true;
  const locked = !live || replied || !!answered;
  const lockedRef = useRef(locked);
  lockedRef.current = locked;
  const idOf = (n: BlockNode) => (typeof n.id === "string" ? n.id : "");

  const env: Env = {
    locked,
    makeAppState: madeApp ? "requested" : locked ? "disabled" : "ready",
    answer: answered ?? null,
    answered: undefined,
    restored: restored ?? null,
    replyRoot: replyRoot(spec),
    reply: (node, value) => {
      if (lockedRef.current || repliedRef.current) return;
      repliedRef.current = true; setReplied(true);
      onEvent({ kind: "reply", blockId: idOf(node), text: replyText(node, value), value });
    },
    state: (node, answers) => { if (!lockedRef.current) onEvent({ kind: "state", blockId: idOf(node), answers }); },
    makeApp: (node) => {
      if (lockedRef.current || madeAppRef.current) return;
      madeAppRef.current = true; setPressed(true);
      onEvent({ kind: "makeApp", blockId: idOf(node) });
    },
    openUrl: (url) => onEvent({ kind: "openUrl", url }),
  };
  // .fl-chatblock (not .fl-chat, AgentChat's): the compact card rules (chat.css) apply to blocks in a chat only.
  return <div className="fl-chatblock">{renderNode(spec, env, undefined, 0, true)}</div>;
}

/** What a block shows when it cannot be drawn: its words under a quiet note, never the JSON or the issues
 *  (those go to the console and the server log). With no words to show, only "Couldn't show this". */
export function TextFallback({ raw }: { raw: string }) {
  const words = blockText(raw);
  if (!words) return <div className="fl-chat-fallback-note">Couldn't show this</div>;
  return (
    <div className="fl-chat-fallback">
      <div className="fl-chat-fallback-note">Shown as text</div>
      <div className="fl-chat-fallback-text">{words}</div>
    </div>
  );
}

export interface ChatFrameBodyProps extends Omit<ChatBlockProps, "spec"> {
  raw: string;
  /** The block's photos as the chat fetched them, by the address the agent wrote: a data: URL, null when it could not
   *  be had, absent while it is still coming. Undefined when the chat sent none. */
  images?: Record<string, string | null>;
  /** A render failure, reported once. */
  onInvalid: (issues: BlockIssue[]) => void;
}

let lastChecked: { raw: string; result: BlockResult } | null = null;
/** validateBlock for the frame, kept for the last block (a frame holds one, and is told it again on every
 *  theme, lock or answer change): checked and logged to the console once per block text. */
export function checkBlock(raw: string): BlockResult {
  if (lastChecked?.raw === raw) return lastChecked.result;
  const result = validateBlock(raw);
  lastChecked = { raw, result };
  if (!result.ok) console.warn("[chat-blocks] block not drawn", reportOf(result));
  else if (reportOf(result).length) console.warn("[chat-blocks] block drawn after", reportOf(result));
  return result;
}

/** One block as the frame shows it: checked, then drawn, or read as text when it cannot be. */
export function ChatFrameBody({ raw, onInvalid, images, ...rest }: ChatFrameBodyProps) {
  const result = checkBlock(raw);
  // The frame loads nothing from the network: a picture is the chat's copy, or a placeholder while it comes.
  const source = useCallback((src: string): ImageState => {
    if (!images) return { src: null };
    if (!(src in images)) return { src: null, pending: true };
    return { src: images[src] };
  }, [images]);
  if (!result.ok) return <TextFallback raw={raw} />;
  return (
    <ImageSourceContext.Provider value={source}>
      <BlockBoundary key={raw} raw={raw} onInvalid={onInvalid}>
        <ChatBlock spec={result.spec} {...rest} />
      </BlockBoundary>
    </ImageSourceContext.Provider>
  );
}

/** Fails closed: a renderer throw shows the block as text and is reported once, instead of unmounting the frame. */
export class BlockBoundary extends Component<{ raw: string; onInvalid: (issues: BlockIssue[]) => void; children: ReactNode }, { issues: BlockIssue[] | null }> {
  state: { issues: BlockIssue[] | null } = { issues: null };
  private reported = false;
  static getDerivedStateFromError(err: unknown) {
    return { issues: [{ path: "render", message: err instanceof Error ? err.message : String(err) }] };
  }
  componentDidCatch() {
    if (this.reported || !this.state.issues) return;
    this.reported = true;
    this.props.onInvalid(this.state.issues);
  }
  render() {
    return this.state.issues ? <TextFallback raw={this.props.raw} /> : this.props.children;
  }
}

export { MAKE_APP_TEXT };
