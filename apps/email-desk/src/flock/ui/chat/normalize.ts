// Repairs an agent's near-miss block before it is checked, so a slip draws instead of falling back to text (owner
// 2026-10-21, after Thesys OpenUI: "a mistake removes the smallest possible unit, and everything else renders"; every
// repair and every removal is reported, never silent). Pure and import-light (no React, no zod, no CSS): the frame's
// validate.ts and the server's manifest.ts both run this same code, so they repair the same way.
import { figure, readable } from "../format";
import { foldShare, MAX_SLICES } from "../components/Chart/share";
import { BLOCK_ID_PATTERN } from "./allowlist";
import { blockHash, generatedId } from "./block-id";

/** One thing the agent should hear about its block. `warning`: an unknown prop left out. `repaired`: the block was
 *  changed to draw (the message says how). Neither: that part was left out (`hint` says what the component needs), or,
 *  when the block is not drawn at all, why. */
export type BlockIssue = { path: string; message: string; hint?: string; warning?: true; repaired?: true };

type Obj = Record<string, any>;
/** Which props of a component hold nodes (the frame reads the registry, the server the manifest). */
export type IsNodeProp = (type: string, key: string) => boolean;

export const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);
const join = (at: string, key: string) => (at ? `${at}.${key}` : key);
const field = (row: unknown, key: string): unknown => (isObj(row) ? row[key] : undefined);
export const text = readable;
export const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const NUMERIC = new Set(["number", "money", "compact", "signed", "percent", "share"]);
const quote = (s: string) => JSON.stringify(s.length > 40 ? `${s.slice(0, 40)}…` : s);

class Repairs {
  out: BlockIssue[] = [];
  private figures = new Map<string, { first: string; to: number; count: number }>();
  add(path: string, message: string) { this.out.push({ path, message, repaired: true }); }
  /** A figure written as text, read as a number: one line per prop, however many figures it held. */
  figure(path: string, from: string, to: number) {
    const f = this.figures.get(path);
    if (f) f.count++; else this.figures.set(path, { first: from, to, count: 1 });
  }
  done(): BlockIssue[] {
    for (const [path, f] of this.figures) {
      this.add(path, `read ${quote(f.first)} as ${f.to}${f.count > 1 ? ` (and ${f.count - 1} more figure${f.count > 2 ? "s" : ""} given as text)` : ""}; give numbers as numbers`);
    }
    this.figures.clear();
    return this.out;
  }
}

type Ctx = { r: Repairs; dropped: BlockIssue[]; isNodeProp: IsNodeProp; maxDepth: number };

/** A string figure in `o[key]` as a number, when it reads as one. */
function numberIn(o: Obj, key: string, path: string, ctx: Ctx): void {
  const v = o[key];
  if (typeof v !== "string") return;
  const n = figure(v);
  if (n === null) return;
  o[key] = n;
  ctx.r.figure(path, v, n);
}

/** A Schedule or Calendar with any date that is not YYYY-MM-DD cannot be placed on days: in chat it is one list in row
 *  order, "date: title" a row, so no row is dropped (owner 2026-10-21: a 10-day plan dated "Day 1".."Day 10" showed
 *  "Today: Nothing planned"). Null when every row has a real date. */
export function datesAsList(node: unknown): Obj | null {
  if (!isObj(node) || (node.type !== "Schedule" && node.type !== "Calendar")) return null;
  const rows = isObj(node.props) ? node.props.rows : undefined;
  if (!Array.isArray(rows) || !rows.length || rows.every((r) => ISO_DAY.test(text(field(r, "date"))))) return null;
  return {
    type: "RowList", ...(typeof node.id === "string" ? { id: node.id } : {}),
    props: { rows: rows.map((r, i) => {
      const day = text(field(r, "date")), title = text(field(r, "title") ?? field(r, "name"));
      const note = text(field(r, "meta") ?? field(r, "note") ?? field(r, "location"));
      return { id: text(field(r, "id")) || String(i + 1), name: day && title ? `${day}: ${title}` : day || title, meta: [text(field(r, "time")), note].filter(Boolean).join(" · ") };
    }) },
  };
}

/** A Questions holding one Choice is that Choice: the Questions' id, its question (else its tab), and at the top the
 *  Questions' frame props, which the check then wraps in a MiniApp (owner incident: a 1-question Questions fell to text). */
export function questionsAsChoice(q: Obj, top: boolean): Obj {
  const c = q.children[0] as Obj;
  const props: Obj = { ...(isObj(c.props) ? c.props : {}) };
  if (props.question === undefined && typeof props.tab === "string") props.question = props.tab;
  delete props.tab;
  const qp = isObj(q.props) ? q.props : {};
  if (top) for (const k of ["title", "subtitle", "makeApp"]) if (qp[k] !== undefined) props[k] = qp[k];
  const id = typeof q.id === "string" ? q.id : c.id;
  return { type: "Choice", ...(id !== undefined ? { id } : {}), props };
}

/** A MiniApp with a single Tab shows that tab's content, no tab strip. */
export function unwrapLoneTab(m: Obj): Obj {
  const tab = m.children[0] as Obj;
  return { ...m, children: Array.isArray(tab.children) ? tab.children : [] };
}
export const isLoneTab = (m: Obj) => m.type === "MiniApp" && Array.isArray(m.children) && m.children.length === 1 && isObj(m.children[0]) && m.children[0].type === "Tab" && Array.isArray(m.children[0].children) && m.children[0].children.length > 0;

/** A BigCard, or a Choice's card option: a string value with no digit is an id, not a figure (left out); a figure
 *  written as text with a numeric kind is a number; so are its facts' figures. */
function card(c: Obj, at: string, ctx: Ctx): Obj {
  const out = { ...c };
  if (typeof out.value === "string" && out.value.trim()) {
    if (!/\d/.test(out.value)) {
      ctx.r.add(join(at, "value"), `${quote(out.value)} is not a figure, so the card shows no big value; value is only a price, time or count`);
      delete out.value;
    } else if (NUMERIC.has(out.kind)) numberIn(out, "value", join(at, "value"), ctx);
  }
  if (Array.isArray(out.facts)) {
    out.facts = out.facts.map((f: unknown) => {
      if (!isObj(f) || !NUMERIC.has(f.kind)) return f;
      const g = { ...f };
      numberIn(g, "value", join(at, "facts"), ctx);
      return g;
    });
  }
  return out;
}

const RULES: Record<string, (n: Obj, p: Obj, at: string, ctx: Ctx, top: boolean) => Obj> = {
  Questions(n, _p, at, ctx, top) {
    const kids = Array.isArray(n.children) ? n.children : [];
    if (kids.length !== 1 || !isObj(kids[0]) || kids[0].type !== "Choice") return n;
    ctx.r.add(at, "a Questions with one question shown as a Choice; Questions is for 2 to 6");
    return fixRules(questionsAsChoice(n, top), at, ctx, top);
  },
  Choice(n, p, at, ctx) {
    if (!Array.isArray(p.options)) return n;
    let opts: unknown[] = p.options;
    const scalar = (x: unknown) => typeof x === "string" || typeof x === "number";
    if (opts.some(scalar) && opts.some(isObj)) {
      opts = opts.map((x) => (scalar(x) ? { title: String(x) } : x));
      ctx.r.add(join(at, "props.options"), "Choice options mixed text and cards: the text ones shown as cards");
    }
    const seen = new Set<string>();
    const kept = opts.filter((x) => {
      const key = isObj(x) ? (typeof x.title === "string" ? x.title : null) : scalar(x) ? String(x) : null;
      if (key === null) return true;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    if (kept.length < opts.length) ctx.r.add(join(at, "props.options"), `${opts.length - kept.length} repeated Choice option${opts.length - kept.length > 1 ? "s" : ""} left out; each option once`);
    p.options = kept.map((x, i) => (isObj(x) ? card(x, join(at, `props.options[${i}]`), ctx) : x));
    return n;
  },
  ProductCards(n, p, at, ctx) {
    // No ProductCards prop takes null: a null detail (an agent's "no badge") is one not given, not a reason to
    // leave the whole product out (live 2026-10-25: three of five blazers lost to "badge": null).
    let nulls = 0;
    const unnull = (v: unknown): void => {
      if (Array.isArray(v)) { v.forEach(unnull); return; }
      if (!isObj(v)) return;
      for (const k of Object.keys(v)) {
        if (v[k] === null) { delete v[k]; nulls++; } else unnull(v[k]);
      }
    };
    unnull(p);
    if (nulls) ctx.r.add(join(at, "props"), `${nulls} empty (null) ProductCards details left out as not given; leave a detail out instead of null`);
    const max = 10;   // ProductCards.def.ts items .max(10) and sizes .max(10)
    if (Array.isArray(p.items) && p.items.length > max) {
      ctx.r.add(join(at, "props.items"), `ProductCards shows up to ${max} products: the first ${max} kept, ${p.items.length - max} left out`);
      p.items = p.items.slice(0, max);
    }
    if (Array.isArray(p.items)) p.items.forEach((it: unknown, i: number) => {
      if (!isObj(it) || !Array.isArray(it.sizes) || it.sizes.length <= max) return;
      ctx.r.add(join(at, `props.items[${i}].sizes`), `a product shows up to ${max} sizes: the first ${max} kept, ${it.sizes.length - max} left out`);
      it.sizes = it.sizes.slice(0, max);
    });
    return n;
  },
  BigCard(n, p, at, ctx) { n.props = card(p, join(at, "props"), ctx); return n; },
  Checklist(n, p, at, ctx) {
    if (!Array.isArray(p.items)) return n;
    const used = new Set(p.items.map((i: unknown) => (isObj(i) && typeof i.id === "string" ? i.id : null)).filter(Boolean));
    const fresh = (i: number) => { let id = String(i + 1); while (used.has(id)) id = `item-${id}`; used.add(id); return id; };
    let asText = 0, noDone = 0, noId = 0;
    p.items = p.items.map((it: unknown, i: number) => {
      if (typeof it === "string" || typeof it === "number") { asText++; return { id: fresh(i), label: String(it), done: false }; }
      if (!isObj(it)) return it;
      const x = { ...it };
      if (x.label === undefined) { const l = x.text ?? x.title ?? x.name; if (typeof l === "string") x.label = l; }
      if (x.done === undefined) { x.done = false; noDone++; }
      if (typeof x.id === "number") x.id = String(x.id);
      if (x.id === undefined) { x.id = fresh(i); noId++; }
      return x;
    });
    const items = join(at, "props.items");
    if (asText) ctx.r.add(items, `${asText} Checklist item${asText > 1 ? "s" : ""} given as text made into items, not done; an item is {id, label, done}`);
    if (noDone) ctx.r.add(items, `${noDone} Checklist item${noDone > 1 ? "s" : ""} without done start not done`);
    if (noId) ctx.r.add(items, `${noId} Checklist item${noId > 1 ? "s" : ""} without an id numbered`);
    return n;
  },
  LineItems(n, p, at, ctx) {
    if (!Array.isArray(p.rows)) return n;
    let missing = 0;
    p.rows = p.rows.map((r: unknown) => {
      if (!isObj(r)) return r;
      const x = { ...r };
      for (const k of ["qty", "unit_price", "gst_rate"]) { if (x[k] === undefined) { x[k] = null; missing++; } else numberIn(x, k, join(at, "props.rows"), ctx); }
      return x;
    });
    if (missing) ctx.r.add(join(at, "props.rows"), `${missing} missing qty, unit_price or gst_rate read as none (null); give all three on every row`);
    return n;
  },
  StatStrip(n, p, at, ctx) {
    if (!Array.isArray(p.stats)) return n;
    if (p.stats.length > 5) {
      ctx.r.add(join(at, "props.stats"), `a StatStrip shows at most 5 figures; the first 5 of ${p.stats.length} kept`);
      p.stats = p.stats.slice(0, 5);
    }
    p.stats = p.stats.map((s: unknown) => {
      if (!isObj(s) || !NUMERIC.has(s.kind)) return s;
      const x = { ...s }; numberIn(x, "value", join(at, "props.stats"), ctx); return x;
    });
    const one = p.stats.length === 1 ? p.stats[0] : null;
    if (isObj(one) && typeof one.label === "string" && figure(one.value) !== null) {
      ctx.r.add(at, "a StatStrip of one figure shown as a HeroStat");
      if (typeof one.value === "string") ctx.r.figure(join(at, "props.stats"), one.value, figure(one.value)!);
      const props: Obj = { label: one.label, value: figure(one.value) };
      for (const k of ["kind", "delta"]) if (one[k] !== undefined) props[k] = one[k];
      return { type: "HeroStat", props };
    }
    return n;
  },
  Bullets(n, p, at, ctx) {
    if (!Array.isArray(p.items)) return n;
    let changed = 0;
    p.items = p.items.map((x: unknown) => { if (typeof x === "string") return x; if (typeof x === "number" || isObj(x) || Array.isArray(x)) { changed++; const t = isObj(x) ? (x as Obj).text : undefined; return typeof t === "string" ? t : text(x); } return x; });
    if (changed) ctx.r.add(join(at, "props.items"), `${changed} Bullets item${changed > 1 ? "s" : ""} given as objects shown as their text; items are strings`);
    return n;
  },
  HeroStat(n, p, at, ctx) { numberIn(p, "value", join(at, "props.value"), ctx); return n; },
  Progress(n, p, at, ctx) { numberIn(p, "value", join(at, "props.value"), ctx); numberIn(p, "limit", join(at, "props.limit"), ctx); return n; },
  ProgressList(n, p, at, ctx) {
    if (Array.isArray(p.items)) p.items = p.items.map((it: unknown) => {
      if (!isObj(it)) return it;
      const x = { ...it }; numberIn(x, "value", join(at, "props.items"), ctx); numberIn(x, "limit", join(at, "props.items"), ctx); return x;
    });
    return n;
  },
  Table(n, p, at, ctx) {
    if (!Array.isArray(p.columns) || !Array.isArray(p.rows)) return n;
    const keys = p.columns.filter((c: unknown) => isObj(c) && typeof c.key === "string" && NUMERIC.has(c.kind)).map((c: Obj) => c.key as string);
    if (keys.length) p.rows = p.rows.map((r: unknown) => { if (!isObj(r)) return r; const x = { ...r }; for (const k of keys) numberIn(x, k, join(at, "props.rows"), ctx); return x; });
    return n;
  },
  Detail(n, p, at, ctx) { if (Array.isArray(p.fields)) p.fields = labelled(p.fields, join(at, "props.fields"), ctx); return n; },
  PropertyChips(n, p, at, ctx) { if (Array.isArray(p.items)) p.items = labelled(p.items, join(at, "props.items"), ctx); return n; },
  Chart(n, p, at, ctx) {
    if (!Array.isArray(p.data) || !Array.isArray(p.series) || !p.data.length) return n;
    const keys = p.series.filter(isObj).map((s: Obj) => s.key).filter((k: unknown): k is string => typeof k === "string");
    p.data = p.data.map((d: unknown) => { if (!isObj(d)) return d; const x = { ...d }; for (const k of keys) numberIn(x, k, join(at, "props.data"), ctx); return x; });
    // A series key no row has would draw a flat zero line: that series is left out, and the agent is told.
    p.series = p.series.filter((s: unknown, i: number) => {
      if (!isObj(s) || typeof s.key !== "string" || p.data.some((d: unknown) => isObj(d) && d[s.key] !== undefined)) return true;
      ctx.dropped.push({ path: join(at, `props.series[${i}]`), message: `series key ${quote(s.key)} is on no data row; that series was left out`, hint: "every series key is a field on each data row, e.g. data: [{label:\"Oct\", spent: 142000}], series: [{key:\"spent\", label:\"Spent\"}]" });
      return false;
    });
    const first = p.series.find(isObj)?.key;
    if (p.type === "share" && typeof first === "string" && p.data.length > MAX_SLICES) {
      ctx.r.add(join(at, "props.data"), `a share Chart of ${p.data.length} slices: the smallest ${p.data.length - (MAX_SLICES - 1)} folded into Other; at most ${MAX_SLICES}`);
      p.data = foldShare(p.data.filter(isObj), first);
    }
    return n;
  },
  Form(n, p, at, ctx) {
    if (!Array.isArray(p.fields)) return n;
    p.fields = p.fields.filter((f: unknown, i: number) => {
      if (!isObj(f) || (f.type !== "select" && f.type !== "multi") || (Array.isArray(f.options) && f.options.length)) return true;
      ctx.dropped.push({ path: join(at, `props.fields[${i}]`), message: `the ${f.type} field ${quote(String(f.name ?? f.label ?? i))} has no options; it was left out`, hint: "a select or multi field lists its options: {type:\"select\", name, label, options:[\"a\",\"b\"]}" });
      return false;
    });
    return n;
  },
  Schedule(n, _p, at, ctx) {
    const list = datesAsList(n);
    if (!list) return n;
    ctx.r.add(at, "a Schedule with dates that are not YYYY-MM-DD shown as a list; a plan with no dates yet is tabs or a RowList");
    return list;
  },
  Calendar(n, p, at, ctx) {
    const list = datesAsList(n);
    if (list) { ctx.r.add(at, "a Calendar with dates that are not YYYY-MM-DD shown as a list"); return list; }
    if ((p.view === "schedule" || p.view === "week-grid") && Array.isArray(p.rows) && p.rows.length) {
      const days = p.rows.map((r: unknown) => Date.parse(text(field(r, "date")))).filter((d: number) => !isNaN(d));
      const span = days.length ? Math.round((Math.max(...days) - Math.min(...days)) / 86_400_000) + 1 : 0;
      if (span > 7) { ctx.r.add(join(at, "props.view"), `a ${p.view} Calendar shows one week; rows across ${span} days shown as a timeline`); p.view = "timeline"; }
    }
    return n;
  },
  MiniApp(n, _p, at, ctx) {
    if (!isLoneTab(n)) return n;
    ctx.r.add(join(at, "children"), "a MiniApp with one Tab shows its content without the tab; Tabs are for 2 to 6 parts");
    return unwrapLoneTab(n);
  },
};

/** Detail fields and PropertyChips items: a figure written as text with a numeric kind is a number. */
function labelled(list: unknown[], at: string, ctx: Ctx): unknown[] {
  return list.map((f) => { if (!isObj(f) || !NUMERIC.has(f.kind)) return f; const x = { ...f }; numberIn(x, "value", at, ctx); return x; });
}

function fixRules(n: Obj, at: string, ctx: Ctx, top: boolean): Obj {
  const rule = Object.hasOwn(RULES, n.type) ? RULES[n.type] : undefined;
  if (!rule) return n;
  const out = { ...n, ...(isObj(n.props) ? { props: { ...n.props } } : {}) };
  return rule(out, isObj(out.props) ? out.props : {}, at, ctx, top);
}

/** Children first, then the node's own rule (a rule may return a different component). */
function fix(input: unknown, at: string, depth: number, ctx: Ctx): unknown {
  if (!isObj(input) || typeof input.type !== "string" || depth > ctx.maxDepth) return input;
  let raw: Obj = input;
  // Child nodes written inside props ({"props":{…,"children":[{"type":…}]}}, live eval 2026-10-21) sit beside them.
  if (raw.children === undefined && isObj(raw.props) && Array.isArray(raw.props.children) && raw.props.children.length && raw.props.children.every((c: unknown) => isObj(c) && typeof c.type === "string")) {
    const { children, ...rest } = raw.props;
    raw = { ...raw, props: rest, children };
    ctx.r.add(at, `${raw.type}'s children moved out of its props`);
  }
  const n: Obj = { ...raw };
  if (isObj(raw.props)) {
    const p: Obj = { ...raw.props };
    for (const [k, v] of Object.entries(p)) {
      if (!ctx.isNodeProp(raw.type, k) || typeof v === "string") continue;
      p[k] = Array.isArray(v) ? v.map((c, i) => fix(c, join(at, `props.${k}[${i}]`), depth + 1, ctx)) : fix(v, join(at, `props.${k}`), depth + 1, ctx);
    }
    n.props = p;
  }
  if (Array.isArray(raw.children)) n.children = raw.children.map((c, i) => fix(c, `${join(at, "children")}[${i}]`, depth + 1, ctx));
  return fixRules(n, at, ctx, depth === 1);
}

type Slot = { node: Obj; path: string; tab?: string; holder: Obj; key: string; index?: number };

/** Every node under `root` in reading order, with where it sits (children, or a node prop). */
function slots(root: Obj, isNodeProp: IsNodeProp, maxDepth: number): Slot[] {
  const out: Slot[] = [];
  const visit = (n: Obj, at: string, tab: string | undefined, depth: number) => {
    if (depth > maxDepth) return;
    const here = n.type === "Tab" && isObj(n.props) && typeof n.props.label === "string" ? n.props.label : tab;
    const p = isObj(n.props) ? n.props : {};
    for (const [k, v] of Object.entries(p)) {
      if (!isNodeProp(n.type, k) || typeof v === "string") continue;
      if (Array.isArray(v)) v.forEach((c, i) => { if (isObj(c)) { const path = join(at, `props.${k}[${i}]`); out.push({ node: c, path, tab: here, holder: p, key: k, index: i }); visit(c, path, here, depth + 1); } });
      else if (isObj(v)) { const path = join(at, `props.${k}`); out.push({ node: v, path, tab: here, holder: p, key: k }); visit(v, path, here, depth + 1); }
    }
    if (Array.isArray(n.children)) n.children.forEach((c: unknown, i: number) => {
      if (!isObj(c)) return;
      const path = `${join(at, "children")}[${i}]`;
      out.push({ node: c, path, tab: here, holder: n, key: "children", index: i });
      visit(c, path, here, depth + 1);
    });
  };
  visit(root, "", undefined, 1);
  return out;
}

/** Take the nodes in `gone` out of the tree (in place: the tree is the caller's own copy), then drop Tabs left empty
 *  and unwrap a MiniApp left with one Tab. */
function remove(root: Obj, gone: Slot[], isNodeProp: IsNodeProp, maxDepth: number): void {
  const doomed = new Set<unknown>(gone.map((s) => s.node));
  const prune = (n: Obj, depth: number) => {
    if (depth > maxDepth) return;
    const p = isObj(n.props) ? n.props : {};
    for (const [k, v] of Object.entries(p)) {
      if (!isNodeProp(n.type, k) || typeof v === "string") continue;
      if (Array.isArray(v)) { p[k] = v.filter((c) => !doomed.has(c)); p[k].forEach((c: unknown) => isObj(c) && prune(c, depth + 1)); }
      else if (doomed.has(v)) delete p[k];
      else if (isObj(v)) prune(v, depth + 1);
    }
    if (Array.isArray(n.children)) {
      n.children = n.children.filter((c: unknown) => !doomed.has(c));
      n.children.forEach((c: unknown) => isObj(c) && prune(c, depth + 1));
      if (n.type === "MiniApp") {
        n.children = n.children.filter((c: unknown) => !(isObj(c) && c.type === "Tab" && Array.isArray(c.children) && !c.children.length));
        if (isLoneTab(n)) n.children = unwrapLoneTab(n).children;
      }
    }
  };
  prune(root, 1);
}

/** Several Checklists in one block are one grouped Checklist where the first one was, each item grouped by its Tab's
 *  label (or its own group): one Send for the whole list (owner incident: a packing MiniApp held 3 Checklists in tabs,
 *  and sending one locked the other two). */
function mergeChecklists(root: Obj, ctx: Ctx): void {
  const lists = slots(root, ctx.isNodeProp, ctx.maxDepth).filter((s) => s.node.type === "Checklist" && isObj(s.node.props) && Array.isArray(s.node.props.items));
  if (lists.length < 2) return;
  const used = new Set<string>();
  const items = lists.flatMap((s, li) => (s.node.props.items as unknown[]).filter(isObj).map((it) => {
    let id = text(it.id) || String(used.size + 1);
    if (used.has(id)) id = `${typeof s.node.id === "string" ? s.node.id : `list${li + 1}`}-${id}`;
    while (used.has(id)) id = `${id}_`;
    used.add(id);
    const group = s.tab ? (typeof it.group === "string" && it.group ? `${s.tab} · ${it.group}` : s.tab) : it.group;
    return { ...it, id, ...(group !== undefined ? { group } : {}) };
  }));
  const [first, ...rest] = lists;
  const merged = { ...first.node, props: { ...first.node.props, items, ...(items.some((i) => typeof i.group === "string") ? { grouped: true } : {}) } };
  if (first.index === undefined) first.holder[first.key] = merged; else first.holder[first.key][first.index] = merged;
  remove(root, rest, ctx.isNodeProp, ctx.maxDepth);
  ctx.r.add(first.path, `${lists.length} Checklists in one block merged into one, grouped by ${lists.some((s) => s.tab) ? "tab" : "their groups"}; one Checklist per block, its parts are groups`);
}

/** A reply-capable node (other than a Choice inside Questions) or a makeApp frame with no id, or one that is not
 *  letters, digits, - and _, is given one (block-id.ts: a slug of its title, question or label, else its type, and the
 *  hash of the block as written, `hash`), so a later block in the chat does not take the same id and look answered
 *  (owner screenshot 2026-10-21: a Questions with ids only on its Choices was shown as text). */
function giveIds(root: Obj, replyCapable: readonly string[], hash: string, ctx: Ctx): void {
  const all = [{ node: root, path: "", holder: {}, key: "" } as Slot, ...slots(root, ctx.isNodeProp, ctx.maxDepth)];
  const inQuestions = new Set<unknown>();
  for (const s of all) if (s.node.type === "Questions" && Array.isArray(s.node.children)) s.node.children.forEach((c: unknown) => inQuestions.add(c));
  const good = (id: unknown): id is string => typeof id === "string" && BLOCK_ID_PATTERN.test(id);
  const taken = new Set(all.map((s) => s.node.id).filter(good));
  for (const s of all) {
    const n = s.node, p = isObj(n.props) ? n.props : {};
    const needs = (replyCapable.includes(n.type) && !inQuestions.has(n)) || p.makeApp === true;
    if (!needs || good(n.id)) continue;
    const name = [p.title, p.question, p.label, p.tab].find((x) => typeof x === "string" && x.trim()) as string | undefined;
    let id = generatedId(name, n.type, hash);
    while (taken.has(id)) id = `${id}_`;
    taken.add(id);
    ctx.r.add(join(s.path, "id"), n.id === undefined ? `${n.type} sends a reply or makes an app, so it needs an id; given "${id}"` : `${quote(String(n.id))} is not letters, digits, - and _ (at most 64); id "${id}" used`);
    n.id = id;
  }
}

export interface Normalized { spec: unknown; repairs: BlockIssue[]; issues: BlockIssue[] }

/** The block with every known near-miss repaired. `repairs` says what changed; `issues` what was left out (a Chart
 *  series on no row, a select with no options). `replyCapable`: the components that send a reply, which need an id
 *  (giveIds). The input is not changed. */
export function normalize(spec: unknown, isNodeProp: IsNodeProp, maxDepth = 6, replyCapable: readonly string[] = []): Normalized {
  const ctx: Ctx = { r: new Repairs(), dropped: [], isNodeProp, maxDepth };
  const out = fix(spec, "", 1, ctx);
  if (isObj(out)) { mergeChecklists(out, ctx); giveIds(out, replyCapable, blockHash(spec), ctx); }
  return { spec: out, repairs: ctx.r.done(), issues: ctx.dropped };
}

export const NODE_HINT = 'a node is {"type":"…","props":{…},"children":[…]}';
export const REPLY_HINT = "one reply-capable part per block: several questions are one Questions, several actions one Choice, parts of one list groups of one Checklist";

/** One reply-capable node per block (a Choice inside Questions is part of its Questions): the first is kept, every
 *  later one left out with an issue. Changes `root` in place (the checker's own copy). */
export function keepOneReplyNode(root: unknown, replyCapable: readonly string[], isNodeProp: IsNodeProp, maxDepth = 6): BlockIssue[] {
  if (!isObj(root)) return [];
  const all = [{ node: root, path: "", holder: {}, key: "" } as Slot, ...slots(root, isNodeProp, maxDepth)];
  const inQuestions = new Set<unknown>();
  for (const s of all) if (s.node.type === "Questions" && Array.isArray(s.node.children)) s.node.children.forEach((c: unknown) => inQuestions.add(c));
  const reply = all.filter((s) => replyCapable.includes(s.node.type) && !inQuestions.has(s.node));
  if (reply.length < 2) return [];
  const gone = reply.slice(1);
  remove(root, gone, isNodeProp, maxDepth);
  return gone.map((s) => ({ path: s.path, message: `a second reply-capable part (${s.node.type}) was left out; the block keeps its first (${reply[0].node.type})`, hint: REPLY_HINT }));
}

/** Levenshtein distance, for "closest: …" hints. */
function distance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0]; row[0] = i;
    for (let j = 1; j <= b.length; j++) { const cur = row[j]; row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = cur; }
  }
  return row[b.length];
}
/** The `n` names nearest `name` (a name containing it, or contained, first; then by edit distance). */
export function closest(name: string, names: readonly string[], n = 3): string[] {
  const q = name.toLowerCase();
  const score = (x: string) => (x.includes(q) || q.includes(x) ? 0 : 1) * 100 + distance(q, x);
  return [...names].sort((a, b) => score(a) - score(b) || a.localeCompare(b)).slice(0, n);
}
