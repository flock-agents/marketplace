// A block the frame cannot draw, as plain text the owner can still read: a checklist as a bulleted list,
// choices as a numbered list, a table as lines. The frame-side equivalent of the server's blocksAsText
// (server/src/chat-blocks/text-fallback.ts), which channels use; only looseBlockText is shared. Pure, never throws.

import { WRAPPABLE } from "./allowlist";
import { parseBlock } from "./parse-block";

type Obj = Record<string, any>;
type Node = { type?: unknown; props?: unknown; children?: unknown };

const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);
const propsOf = (n: Node): Obj => (isObj(n.props) ? n.props : {});
const kidsOf = (n: Node): Node[] => (Array.isArray(n.children) ? n.children.filter(isObj) : []);
const objs = (v: unknown): Obj[] => (Array.isArray(v) ? v.filter(isObj) : []);
const str = (v: unknown): string => (typeof v === "string" ? v : typeof v === "number" && isFinite(v) ? String(v) : "");
const INR = new Intl.NumberFormat("en-IN");
const MAX_DEPTH = 8;

function valueText(v: unknown, kind?: unknown): string {
  if (typeof v === "number" && isFinite(v)) {
    if (kind === "money") return `${v < 0 ? "−" : ""}₹${INR.format(Math.abs(v))}`;
    if (kind === "percent" || kind === "share") return `${v}%`;
    return INR.format(v);
  }
  return str(v);
}

/** ProductCards as a numbered list of what was read (the server's productCardsText in chat-blocks/text-fallback.ts says the same). */
function productCardsText(p: Obj): string[] {
  const items = objs(p.items);
  const lines = items.flatMap((it, k) => {
    const vs = objs(it.variants).filter((v) => v.available !== false);
    const prices = vs.map((v) => v.price).filter((x): x is number => typeof x === "number" && isFinite(x));
    const delivery = vs.map((v) => str(v.delivery)).find(Boolean) ?? "";
    const r = isObj(it.rating) && typeof it.rating.stars === "number" ? it.rating : null;
    const head = [
      [str(it.brand), str(it.title)].filter(Boolean).join(" "),
      r ? `★${r.stars}${typeof r.count === "number" ? ` (${INR.format(r.count)})` : ""}` : "",
      prices.length ? `from ${valueText(Math.min(...prices), "money")}` : "",
    ].filter(Boolean).join(" · ");
    const colours = objs(it.colours).map((c) => str(c.name)).filter(Boolean);
    const sizes = (Array.isArray(it.sizes) ? it.sizes : []).map(str).filter(Boolean);
    return [`${k + 1}. ${head}`, colours.length ? `   Colours: ${colours.join(", ")}` : "", sizes.length ? `   Sizes: ${sizes.join(", ")}` : "", delivery ? `   Delivery: ${delivery}` : ""].filter(Boolean);
  });
  return [...lines, "Reply with the number, colour and size you'd like (for example: 2, blue, M)."];
}

function choiceText(p: Obj): string {
  const opts = Array.isArray(p.options) ? p.options : [];
  const lines = opts.map((o: unknown, i: number) => {
    if (!isObj(o)) return `${i + 1}. ${str(o)}`;
    const val = [valueText(o.value, o.kind), str(o.unit)].filter(Boolean).join(" ");
    return [`${i + 1}. ${str(o.title) || str(o.label) || str(o.name)}${val ? ` · ${val}` : ""}`, ...factLines(o)].join("\n");
  });
  return [str(p.question), ...lines].filter(Boolean).join("\n");
}

/** A card's facts as "Label: value" lines. */
function factLines(p: Obj): string[] {
  return objs(p.facts).map((f) => `${str(f.label)}: ${valueText(f.value, f.kind)}`);
}

function statText(p: Obj): string {
  const v = valueText(p.value, p.kind);
  const label = str(p.label) || str(p.title);
  const head = label && v ? `${label}: ${v}` : label || v;
  return [[head, str(p.caption)].filter(Boolean).join(" · "), ...factLines(p)].filter(Boolean).join("\n");
}

function nodeText(n: Node, depth: number): string {
  if (depth > MAX_DEPTH) return "";
  const p = propsOf(n);
  const kids = () => kidsOf(n).map((c) => nodeText(c, depth + 1));
  // a reply node's title shows only where the frame would wrap it (top level); elsewhere it is left out
  const framed = depth === 1 && (WRAPPABLE as readonly unknown[]).includes(n.type);
  const titled = (body: string[]) => [framed ? str(p.title) : "", ...body].filter(Boolean).join("\n");
  switch (n.type) {
    case "MiniApp": case "Questions": return [str(p.subtitle), str(p.title), ...kids()].filter(Boolean).join("\n\n");
    case "Tab": return [str(p.label), ...kids()].filter(Boolean).join("\n");
    case "Choice": return titled([choiceText(p)]);
    case "Checklist": return titled(objs(p.items).map((i) => `• ${str(i.label)}${i.done === true ? " (done)" : ""}`));
    case "Form": return titled(objs(p.fields).map((f) => `• ${str(f.label) || str(f.name)}`));
    case "SlotPicker": return titled([`Times from ${str(p.open)} to ${str(p.close)}`]);
    case "ItemPicker": return titled(objs(p.items).map((i, k) => `${k + 1}. ${str(i.name)}${i.price !== undefined && str(i.price) ? ` · ${valueText(typeof i.price === "number" ? i.price : str(i.price), "money")}` : ""}${str(i.meta) ? ` (${str(i.meta)})` : ""}`));
    case "ProductCards": return titled(productCardsText(p));
    case "Bullets": return (Array.isArray(p.items) ? p.items : []).map((i: unknown) => `• ${str(i)}`).join("\n");
    case "Markdown": return str(p.text);
    case "Table": {
      const cols = objs(p.columns);
      return [cols.map((c) => str(c.label) || str(c.key)).join(" · "),
        ...objs(p.rows).map((r) => cols.map((c) => valueText(r[c.key], c.kind) || "—").join(" · "))].join("\n");
    }
    case "BigCard": case "HeroStat": return statText(p);
    case "StatStrip": return objs(p.stats).map(statText).join("\n");
    case "Progress": return `${str(p.label) ? `${str(p.label)}: ` : ""}${valueText(p.value, p.kind)} of ${valueText(p.limit, p.kind)}`;
    case "ProgressList": return objs(p.items).map((i) => `${str(i.label)}: ${valueText(i.value, i.kind)} of ${valueText(i.limit, i.kind)}`).join("\n");
    case "RowList": return objs(p.rows).map((r) => `• ${str(r.name) || str(r.title)}`).join("\n");
    case "Calendar": case "Schedule": return objs(p.rows).map((r) => `• ${[str(r.date), str(r.time), str(r.title)].filter(Boolean).join(" ")}`).join("\n");
    case "Detail": return objs(p.fields).map((f) => `${str(f.label)}: ${valueText(f.value, f.kind)}`).join("\n");
    case "PropertyChips": return objs(p.items).map((i) => `${str(i.label)}: ${valueText(i.value, i.kind)}`).join(" · ");
    case "Button": return str(p.children);
    case "Heading": case "Section": case "Callout": case "Card": case "Columns":
      return [str(p.title), typeof p.children === "string" ? p.children : "", ...kids()].filter(Boolean).join("\n");
    default: return "";
  }
}

const WORD_FIELD = /^(question|title|label|name|text|caption|value|price)$/;
/** A word field in JSON too broken to parse, its value still in quotes. */
const QUOTED_WORD_FIELD = /"(?:question|title|label|name|text|caption)"\s*:\s*"((?:[^"\\]|\\.)*)"/g;

/** The words in JSON of no shape the blocks know, an array's entries as a numbered list. */
function looseLines(v: unknown, depth = 1): string[] {
  if (depth > MAX_DEPTH) return [];
  if (Array.isArray(v)) {
    const entries = v.map((x) => (typeof x === "string" ? x : looseLines(x, depth + 1).join(" · "))).filter(Boolean);
    return entries.length > 1 ? entries.map((e, i) => `${i + 1}. ${e}`) : entries;
  }
  if (!isObj(v)) return [];
  return Object.entries(v).flatMap(([k, x]) => (isObj(x) || Array.isArray(x) ? looseLines(x, depth + 1) : WORD_FIELD.test(k) && str(x) ? [str(x)] : []));
}

function unquoted(s: string): string {
  try { return JSON.parse(`"${s}"`); } catch { return s; }
}

/** What a body that is not JSON says: plain words as written; JSON broken mid-way, only the words its fields hold. */
function wordsOfUnparsed(raw: string): string {
  const text = raw.trim();
  if (!/^[{[]/.test(text)) return text;
  return [...text.matchAll(QUOTED_WORD_FIELD)].map((m) => unquoted(m[1])).join("\n");
}

/** What a block of no shape the blocks know still says (options a model wrote its own way, words that were never JSON),
 *  or "" when it says nothing. The server's channel text uses this too (chat-blocks/text-fallback.ts). */
export function looseBlockText(raw: string): string {
  const parsed = parseBlock(raw);
  return parsed.ok ? looseLines(parsed.value).join("\n") : wordsOfUnparsed(raw);
}

/** The block's words, or "" when it holds none to show. */
export function blockText(raw: string): string {
  const parsed = parseBlock(raw);
  const node = parsed.ok ? parsed.value : null;
  const words = isObj(node) ? nodeText(node, 1).replace(/\n{3,}/g, "\n\n").trim() : "";
  return words || looseBlockText(raw);
}
