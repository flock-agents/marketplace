import type { z } from "zod";
import { chatSchemas as registry } from "./chat-schemas";
import { chatObjectNames } from "./object-names";
import { BLOCK_ID_MESSAGE, BLOCK_ID_PATTERN, CHAT_ALLOWLIST, CHAT_LIMITS, LIFTED_PROPS, RENDERER_OWNED, REPLY_CAPABLE, WRAPPABLE, type ChatComponent } from "./allowlist";
import { parseBlock } from "./parse-block";
import { closest, isLoneTab, keepOneReplyNode, NODE_HINT, normalize, questionsAsChoice, unwrapLoneTab, type BlockIssue } from "./normalize";
import { isRequired, needsLine, propsByKind } from "./schema-info";

export type { BlockIssue };
export type BlockNode = { type: string; id?: string; props?: Record<string, unknown>; children?: BlockNode[] };
/** `spec` is what to draw: near-misses repaired (`repairs`), each broken part left out (`issues`, with a hint), unknown
 *  props left out (`warnings`), and a top-level reply node carrying a frame's title/subtitle/makeApp wrapped in the
 *  MiniApp that holds them. Not ok only when the block itself cannot be drawn: over a limit, unsafe, or its root broken. */
export type BlockResult =
  | { ok: true; spec: BlockNode; warnings: BlockIssue[]; issues: BlockIssue[]; repairs: BlockIssue[] }
  | { ok: false; issues: BlockIssue[]; repairs: BlockIssue[] };

/** Everything the agent should hear about a checked block, in one list (repairs, left-out parts, warnings). */
export const reportOf = (r: BlockResult): BlockIssue[] => (r.ok ? [...r.repairs, ...r.issues, ...r.warnings] : [...r.repairs, ...r.issues]);

const NODE_KEYS = new Set(["type", "id", "props", "children"]);
const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const join = (at: string, key: string) => (at ? `${at}.${key}` : key);
const REPLY = REPLY_CAPABLE as readonly string[];
/** What a body that is not JSON should have been, the shape a model that never read the guidance needs. */
const NOT_JSON_HINT = `a block is one JSON node, like {"type":"Choice","id":"pick","props":{"question":"Which one?","options":["First","Second"]}}`;

interface Compiled { schema: z.ZodObject<any>; known: Set<string>; callbacks: Set<string>; nodes: Set<string>; required: Set<string>; requiredNodes: string[]; needs: string }
const compiled = new Map<string, Compiled | null>();

/** The def's schema without callback and node props (unknown props are sorted out before it runs). */
function compile(name: string): Compiled | null {
  if (compiled.has(name)) return compiled.get(name)!;
  const def = registry.find((d) => d.name === name);
  let out: Compiled | null = null;
  if (def) {
    const shape = def.props.shape as Record<string, z.ZodTypeAny>;
    const { callbacks, nodes } = propsByKind(shape);
    const omit = Object.fromEntries([...callbacks, ...nodes].map((k) => [k, true as const]));
    out = {
      schema: def.props.omit(omit).strict(), known: new Set(Object.keys(shape)), callbacks: new Set(callbacks), nodes: new Set(nodes),
      required: new Set(Object.keys(shape).filter((k) => isRequired(shape[k]))), requiredNodes: nodes.filter((k) => isRequired(shape[k])),
      needs: needsLine(name, shape),
    };
  }
  compiled.set(name, out);
  return out;
}
const isNodeProp = (type: string, key: string) => !!compile(type)?.nodes.has(key);

const zodPath = (p: PropertyKey[]) => p.map((k) => (typeof k === "number" ? `[${k}]` : `.${String(k)}`)).join("");

type ZodIssue = z.core.$ZodIssue;
/** The issues to report for a zod issue: an `invalid_union` is replaced by the issues of the branch the value was
 *  written as (the one that does not reject the value's own shape, or its first element's for an array), so the path
 *  names the field that is wrong and not the whole union. No branch fits: the union issue stays. Branch paths are
 *  relative to the union's, so they are joined onto it. */
function unionIssues(e: ZodIssue, depth = 0): ZodIssue[] {
  if (e.code !== "invalid_union" || depth > 6) return [e];
  const branches = ((e as { errors?: ZodIssue[][] }).errors ?? []).filter((b) => b.length);
  const fits = branches.filter((b) => !b.some((x) => x.code === "invalid_type" && x.path.length <= 1 && (x.path.length === 0 || x.path[0] === 0)));
  const pick = fits[0];
  if (!pick) return [e];
  return pick.flatMap((x) => unionIssues({ ...x, path: [...e.path, ...x.path] } as ZodIssue, depth + 1));
}

type Ctx = { hard: BlockIssue[]; issues: BlockIssue[]; warnings: BlockIssue[]; repairs: BlockIssue[]; nodes: number; lifted: Record<string, unknown> };

/** The props a wrapped node hands to its MiniApp, checked as the MiniApp's own. */
let liftSchema: z.ZodObject<any> | null = null;
function liftedSchema(): z.ZodObject<any> {
  const mini = registry.find((d) => d.name === "MiniApp")!;
  return (liftSchema ??= mini.props.pick(Object.fromEntries(LIFTED_PROPS.map((k) => [k, true as const]))).partial().strict());
}

const UNKNOWN_HINT = `the chat's components are ${CHAT_ALLOWLIST.join(", ")}`;

/** The data props after the def's schema: a bad entry of a list is left out, a bad optional prop is left out, a bad
 *  required prop fails the node (null). */
function checkData(info: Compiled, data: Record<string, unknown>, at: string, ctx: Ctx, fail: (path: string, message: string) => void): Record<string, unknown> | null {
  const cur = { ...data };
  const trimmed = new Set<string>();   // props that lost entries: a count rule that then fails is a consequence, not a second mistake
  for (let round = 0; round < 10; round++) {
    const parsed = info.schema.safeParse(cur);
    if (parsed.success) return cur;
    const rows = new Map<string, Map<number, string>>();
    const props = new Map<string, string>();
    for (const e of parsed.error.issues.flatMap((x) => unionIssues(x))) {
      const [k, i] = e.path;
      const path = join(at, `props${zodPath(e.path)}`);
      if (typeof k !== "string") { fail(path, e.message); return null; }
      if (typeof i === "number" && Array.isArray(cur[k])) { if (!rows.has(k)) rows.set(k, new Map()); if (!rows.get(k)!.has(i)) rows.get(k)!.set(i, `${path}\u0000${e.message}`); }
      else if (!props.has(k)) props.set(k, `${path}\u0000${e.message}`);
    }
    if (!rows.size && !props.size) return null;
    for (const [k, bad] of rows) {
      for (const v of bad.values()) { const [path, message] = v.split("\u0000"); ctx.issues.push({ path, message: `${message}; that entry was left out`, hint: info.needs }); }
      cur[k] = (cur[k] as unknown[]).filter((_, j) => !bad.has(j));
      trimmed.add(k);
    }
    let failed = false;
    for (const [k, v] of props) {
      if (rows.has(k)) continue;   // next round, after its bad entries are gone
      const [path, message] = v.split("\u0000");
      if (info.required.has(k)) { if (!trimmed.has(k)) fail(path, message); failed = true; }
      else { ctx.issues.push({ path, message: `${message}; ${k} was left out`, hint: info.needs }); delete cur[k]; }
    }
    if (failed) return null;
  }
  return null;
}

/** The node as it will be drawn, or null when it cannot be (its issues say why); a broken child is left out and the
 *  node still draws. Hard limits (depth, callbacks) go to ctx.hard and stop the whole block. */
function walk(raw: unknown, at: string, depth: number, parent: string | undefined, ctx: Ctx): BlockNode | null {
  if (!isObject(raw)) { ctx.issues.push({ path: at, message: "a block node must be an object with a type; it was left out", hint: NODE_HINT }); return null; }
  ctx.nodes++;
  if (depth > CHAT_LIMITS.maxDepth) { ctx.hard.push({ path: at, message: `exceeds the maximum depth of ${CHAT_LIMITS.maxDepth} levels` }); return null; }
  const name = raw.type;
  if (typeof name !== "string" || !(CHAT_ALLOWLIST as readonly string[]).includes(name)) {
    ctx.issues.push({ path: join(at, "type"), message: `"${String(name)}" is not a component you can use in chat; it was left out`, hint: UNKNOWN_HINT });
    return null;
  }
  const info = compile(name);
  if (!info) { ctx.issues.push({ path: join(at, "type"), message: `"${name}" is not in the component library; it was left out`, hint: UNKNOWN_HINT }); return null; }
  const fails: BlockIssue[] = [];
  const fail = (path: string, message: string) => { fails.push({ path, message, hint: info.needs }); };
  const drop = (path: string, message: string) => { ctx.issues.push({ path, message, hint: info.needs }); };
  const warn = (path: string, message: string) => { ctx.warnings.push({ path, message, warning: true }); };
  for (const k of Object.keys(raw)) if (!NODE_KEYS.has(k)) warn(join(at, k), `unknown key "${k}" (a node has type, id, props and children); left out`);

  // id: a reply node cannot route without one; on any other node a bad one is just left out
  const replyNode = REPLY.includes(name) && !(name === "Choice" && parent === "Questions");
  let id: string | undefined;
  if (raw.id !== undefined) {
    const bad = typeof raw.id !== "string" ? "id must be a string" : !BLOCK_ID_PATTERN.test(raw.id) ? BLOCK_ID_MESSAGE : null;
    if (!bad) id = raw.id as string;
    else if (replyNode) fail(join(at, "id"), bad);
    else drop(join(at, "id"), `${bad}; the id was left out`);
  } else if (replyNode) fail(join(at, "id"), `${name} sends a reply, so it needs a string id`);
  if (name === "Tab" && parent !== "MiniApp") fail(join(at, "type"), "Tab only goes directly inside MiniApp");
  if (raw.props !== undefined && !isObject(raw.props)) fail(join(at, "props"), "props must be an object");
  if (raw.children !== undefined && !Array.isArray(raw.children)) fail(join(at, "children"), "children must be an array");
  const p = isObject(raw.props) ? raw.props : {};

  // props: callbacks are a hard stop, the chat's own props and unknown props are left out, a top-level reply node's
  // frame props are lifted, node props are walked below, the rest is checked by the def's schema
  const data: Record<string, unknown> = {};
  const nodeProps: [string, unknown][] = [];
  const canLift = parent === undefined && (WRAPPABLE as readonly string[]).includes(name);
  for (const [k, v] of Object.entries(p)) {
    const path = join(at, `props.${k}`);
    if (/^on[A-Z]/.test(k)) ctx.hard.push({ path, message: "callback props are not accepted from an agent" });
    else if (info.callbacks.has(k)) warn(path, `"${k}" is supplied by the chat, not by an agent; left out`);
    else if (info.nodes.has(k)) nodeProps.push([k, v]);
    else if (info.known.has(k)) data[k] = v;
    else if (RENDERER_OWNED[name as ChatComponent]?.includes(k)) drop(path, `"${k}" is set by the chat, not by an agent; it was left out`);
    else if (canLift && (LIFTED_PROPS as readonly string[]).includes(k)) {
      const lift = liftedSchema().shape[k].safeParse(v);
      if (lift.success) ctx.lifted[k] = v;
      else drop(path, `${lift.error.issues[0]?.message ?? "wrong type"}; ${k} was left out`);
    }
    else warn(path, `unknown prop "${k}" for ${name}; left out`);
  }
  if (data.makeApp === true && id === undefined) { drop(join(at, "id"), "a block with makeApp needs a string id; makeApp was left out"); delete data.makeApp; }
  if (ctx.lifted.makeApp === true && id === undefined && parent === undefined) { drop(join(at, "id"), "a block with makeApp needs a string id; makeApp was left out"); delete ctx.lifted.makeApp; }
  const checked = fails.length ? null : checkData(info, data, at, ctx, fail);
  if (fails.length || !checked) { ctx.issues.push(...fails); return null; }

  if (name === "ObjectIcon" && typeof checked.name === "string") {
    const names = chatObjectNames();
    if (names.length && !names.includes(checked.name)) {
      ctx.issues.push({ path: join(at, "props.name"), message: `no icon "${checked.name}"; closest: ${closest(checked.name, names).join(", ")}`, hint: "an ObjectIcon name is one of the object pictures; an unknown one shows a blank tile" });
    }
  }

  // node props and children: a broken one is left out
  const out: BlockNode = { type: name, ...(id !== undefined ? { id } : {}) };
  const props: Record<string, unknown> = { ...checked };
  for (const [k, v] of nodeProps) {
    if (typeof v === "string") { props[k] = v; continue; }
    if (Array.isArray(v)) props[k] = v.map((c, i) => walk(c, join(at, `props.${k}[${i}]`), depth + 1, name, ctx)).filter((c) => c !== null);
    else { const c = walk(v, join(at, `props.${k}`), depth + 1, name, ctx); if (c) props[k] = c; }
  }
  let kids: [number, BlockNode][] = [];
  if (Array.isArray(raw.children) && raw.children.length) {
    if (!info.nodes.has("children")) drop(join(at, "children"), `${name} does not take children; they were left out`);
    else kids = raw.children.map((c, i) => [i, walk(c, `${join(at, "children")}[${i}]`, depth + 1, name, ctx)] as [number, BlockNode | null]).filter((e): e is [number, BlockNode] => e[1] !== null);
  }
  const kidPath = (i: number) => `${join(at, "children")}[${i}]`;

  if (name === "Questions") kids = questionsChildren(kids, kidPath, drop);
  if (name === "MiniApp" && kids.length) {
    const tabbed = kids[0][1].type === "Tab";
    kids = kids.filter(([i, c]) => {
      if ((c.type === "Tab") === tabbed) return true;
      drop(`${kidPath(i)}.type`, tabbed ? "MiniApp children are all Tab or none: this is not a Tab; it was left out" : "MiniApp children are all Tab or none: this is a Tab; it was left out");
      return false;
    });
  }
  const missing = info.requiredNodes.filter((k) => (k === "children" ? !kids.length && props.children === undefined : props[k] === undefined || (Array.isArray(props[k]) && !(props[k] as unknown[]).length)));
  if (missing.length) {
    for (const k of missing) ctx.issues.push({ path: join(at, `props.${k}`), message: `${name} needs ${k === "children" ? "children" : `a ${k}`}; it was left out`, hint: info.needs });
    return null;
  }
  if (name === "Questions" && kids.length < 2) {
    // one question left after the rest were left out: shown as that Choice (the same repair as a 1-Choice Questions)
    ctx.repairs.push({ path: at, message: "a Questions with one question shown as a Choice; Questions is for 2 to 6", repaired: true });
    const choice = questionsAsChoice({ ...out, props, children: [kids[0][1]] }, parent === undefined) as BlockNode;
    if (parent === undefined) for (const k of LIFTED_PROPS) { if (choice.props?.[k] !== undefined) { ctx.lifted[k] = choice.props[k]; delete choice.props[k]; } }
    return choice;
  }
  if (raw.props !== undefined || Object.keys(props).length) out.props = props;
  if (raw.children !== undefined && info.nodes.has("children")) out.children = kids.map(([, c]) => c);
  if (isLoneTab(out)) {
    ctx.repairs.push({ path: join(at, "children"), message: "a MiniApp with one Tab shows its content without the tab; Tabs are for 2 to 6 parts", repaired: true });
    return unwrapLoneTab(out) as BlockNode;
  }
  return out;
}

/** A Questions' children that can be asked: Choices with their own tab key, at most 6; the rest are left out. */
function questionsChildren(kids: [number, BlockNode][], kidPath: (i: number) => string, drop: (path: string, message: string) => void): [number, BlockNode][] {
  const seen = new Set<string>();
  const ok = kids.filter(([i, c]) => {
    if (c.type !== "Choice") { drop(`${kidPath(i)}.type`, "Questions children must all be Choice; it was left out"); return false; }
    const props = isObject(c.props) ? c.props : {};
    const key = props.tab ?? props.question;
    if (typeof key !== "string" || !key) { drop(`${kidPath(i)}.props`, "a Choice inside Questions needs a tab or a question: it labels the tab and keys the answer; it was left out"); return false; }
    if (seen.has(key)) { drop(`${kidPath(i)}.props.${typeof props.tab === "string" ? "tab" : "question"}`, `"${key}" is already another tab's name; each tab needs its own; it was left out`); return false; }
    seen.add(key);
    return true;
  });
  for (const [i] of ok.slice(6)) drop(kidPath(i), "Questions takes 2 to 6 Choice children; this one was left out");
  return ok.slice(0, 6);
}

const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);

/** JSON.parse makes `__proto__` an own key; reject it (and constructor/prototype) at every object level before anything copies the tree. */
function scanKeys(root: unknown, out: BlockIssue[]): void {
  const stack: [unknown, string][] = [[root, ""]];   // explicit stack: agent JSON can nest far deeper than the call stack allows
  while (stack.length) {
    const [v, at] = stack.pop()!;
    if (Array.isArray(v)) { v.forEach((x, i) => stack.push([x, `${at}[${i}]`])); continue; }
    if (!isObject(v)) continue;
    for (const k of Object.keys(v)) {
      if (FORBIDDEN_KEYS.has(k)) out.push({ path: join(at, k), message: `the key "${k}" is not allowed` });
      else stack.push([v[k], join(at, k)]);
    }
  }
}

/** Whether any node of the parsed block has one of these types (children and node props, any depth). */
function hasType(v: unknown, types: readonly string[]): boolean {
  const stack: unknown[] = [v];
  let seen = 0;
  while (stack.length && seen++ < 20_000) {
    const x = stack.pop();
    if (Array.isArray(x)) { stack.push(...x); continue; }
    if (!isObject(x)) continue;
    if (typeof x.type === "string" && types.includes(x.type)) return true;
    stack.push(...Object.values(x));
  }
  return false;
}

function validate(raw: string): BlockResult {
  const bytes = new TextEncoder().encode(raw).length;
  const parsed = parseBlock(raw);
  if (bytes > CHAT_LIMITS.maxBytes) {
    // only a block holding a large component (ProductCards) may be longer, up to large.maxBytes
    const limit = parsed.ok && hasType(parsed.value, CHAT_LIMITS.large.components) ? CHAT_LIMITS.large.maxBytes : CHAT_LIMITS.maxBytes;
    if (bytes > limit) return { ok: false, issues: [{ path: "", message: `block is over ${limit} bytes` }], repairs: [] };
  }
  if (!parsed.ok) return { ok: false, issues: [{ path: "", message: `not valid JSON: ${parsed.error}`, hint: NOT_JSON_HINT }], repairs: [] };
  const json = parsed.value;
  const unsafe: BlockIssue[] = [];
  scanKeys(json, unsafe);
  if (unsafe.length) return { ok: false, issues: unsafe, repairs: [] };
  const norm = normalize(json, isNodeProp, CHAT_LIMITS.maxDepth, REPLY);
  const ctx: Ctx = { hard: [], issues: [...norm.issues], warnings: [], repairs: [...(parsed.repaired ? [{ path: "", message: parsed.repaired, repaired: true as const }] : []), ...norm.repairs], nodes: 0, lifted: {} };
  const spec = walk(norm.spec, "", 1, undefined, ctx);
  if (ctx.nodes > CHAT_LIMITS.maxNodes) ctx.hard.unshift({ path: "", message: `block has ${ctx.nodes} nodes; at most ${CHAT_LIMITS.maxNodes}` });
  if (ctx.hard.length) return { ok: false, issues: ctx.hard, repairs: ctx.repairs };
  if (!spec) return { ok: false, issues: ctx.issues, repairs: ctx.repairs };
  ctx.issues.push(...keepOneReplyNode(spec, REPLY, isNodeProp, CHAT_LIMITS.maxDepth));
  return { ok: true, spec: wrap(spec, ctx.lifted), warnings: ctx.warnings, issues: ctx.issues, repairs: ctx.repairs };
}

/** The implicit MiniApp around a top-level reply node that carried a frame's props. It takes the node's id, so
 *  Make it an app names the block the transcript knows; the node keeps its id, so its reply routes as before. */
function wrap(node: BlockNode, lifted: Record<string, unknown>): BlockNode {
  if (!Object.keys(lifted).length || !(WRAPPABLE as readonly string[]).includes(node.type)) return node;
  return {
    type: "MiniApp", ...(typeof node.id === "string" ? { id: node.id } : {}),
    props: { title: typeof lifted.title === "string" ? lifted.title : "", ...lifted }, children: [node],
  };
}

/** Fails closed: whatever goes wrong inside, the caller gets an issue, never an exception. */
export function validateBlock(raw: string): BlockResult {
  try { return validate(raw); }
  catch (e) { return { ok: false, issues: [{ path: "", message: `could not check this block: ${(e as Error).message}` }], repairs: [] }; }
}
