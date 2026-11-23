import type { z } from "zod";

/** `fn(...)` props are callbacks, `node(...)` props take children; everything else is plain data. */
export type PropKind = "callback" | "node" | "data";

/** Zod 4 wrappers (.optional(), .nullable()) do not carry the inner schema's description, so look through them. */
export function descriptionOf(s: z.ZodTypeAny): string {
  let cur: any = s;
  while (cur) {
    if (cur.description) return cur.description;
    cur = cur._def?.innerType ?? cur._def?.in;
  }
  return "";
}

// TODO(text-as-state): prop kinds are read from description prefixes ("function — ", "React node — ", written in
// schema-def.ts). Use a typed marker instead.
export function propKind(s: z.ZodTypeAny): PropKind {
  const d = descriptionOf(s);
  if (d.startsWith("function — ")) return "callback";
  if (d.startsWith("React node — ")) return "node";
  return "data";
}

export function isRequired(s: z.ZodTypeAny): boolean {
  return (s as any)._zod.optin !== "optional";
}

/** The props of a def, split by kind. */
export function propsByKind(shape: Record<string, z.ZodTypeAny>): { callbacks: string[]; nodes: string[]; data: string[] } {
  const out = { callbacks: [] as string[], nodes: [] as string[], data: [] as string[] };
  for (const [k, s] of Object.entries(shape)) {
    const kind = propKind(s);
    (kind === "callback" ? out.callbacks : kind === "node" ? out.nodes : out.data).push(k);
  }
  return out;
}

/** What a component needs, for the hint on an issue: its required props, and the required fields of a list of objects
 *  ("Chart needs type, data: [{label}], series: [{key,label}]"). The frame and the manifest (the server) use this line. */
export function needsLine(name: string, shape: Record<string, z.ZodTypeAny>): string {
  const parts: string[] = [];
  for (const [k, s] of Object.entries(shape)) {
    if (propKind(s) === "callback" || !isRequired(s)) continue;
    const def = (s as any)._zod?.def;
    const el = def?.type === "array" ? def.element?._zod?.def : undefined;
    if (el?.type === "object") {
      const keys = Object.entries(el.shape as Record<string, z.ZodTypeAny>).filter(([, f]) => isRequired(f)).map(([f]) => f);
      parts.push(keys.length ? `${k}: [{${keys.join(",")}}]` : k);
    } else parts.push(k);
  }
  return parts.length ? `${name} needs ${parts.join(", ")}` : `${name} needs no props`;
}

/** The schema under .optional() / .nullable() wrappers. */
function inner(s: z.ZodTypeAny): any {
  let cur: any = (s as any)._zod?.def;
  while (cur && (cur.type === "optional" || cur.type === "nullable" || cur.type === "default")) cur = cur.innerType?._zod?.def;
  return cur;
}

/** One field's format line: "`key` (required): what it holds", the description less its kind prefix, else an enum's values. */
function fieldText(key: string, s: z.ZodTypeAny): string {
  const def = inner(s);
  let about = descriptionOf(s).replace(/^React node — /, "");
  if (!about && def?.type === "enum") about = Object.values(def.entries as Record<string, string>).join(", ");
  if (!about && def?.type === "nullable") about = "may be null";
  return `\`${key}\`${isRequired(s) ? " (required)" : ""}${about ? `: ${about}` : ""}`;
}

/** What each data or node prop holds, one line a prop (a list of objects names its fields after "each:"), from the zod
 *  descriptions: the block reference's field formats. `skip` leaves out app-only props (paging, loading). */
export function fieldLines(shape: Record<string, z.ZodTypeAny>, skip: ReadonlySet<string> = new Set()): string[] {
  const out: string[] = [];
  for (const [k, s] of Object.entries(shape)) {
    if (propKind(s) === "callback" || skip.has(k)) continue;
    let line = fieldText(k, s);
    const def = inner(s);
    const el = def?.type === "array" ? def.element?._zod?.def : undefined;
    if (el?.type === "object") {
      const subs = Object.entries(el.shape as Record<string, z.ZodTypeAny>).filter(([f, fs]) => propKind(fs) !== "callback" && !skip.has(f));
      line += `; each: ${subs.map(([f, fs]) => fieldText(f, fs)).join("; ")}`;
    }
    out.push(line);
  }
  return out;
}

/** A value set is shown in the shape when it has at most this many values; a longer one (`kind`'s 14) is left to the
 *  reference's field formats and the prompt's rules, and shows as the bare prop. */
const MAX_VALUES = 10;

/** One type in shape text, inside a list or an alternative: what the zod schema says, nothing invented. null when it
 *  cannot be given in JSON (an object that needs a callback, such as a split Button's menu item). */
function typeText(s: z.ZodTypeAny, appOnly: ReadonlySet<string>): string | null {
  const def = inner(s);
  switch (def?.type) {
    case "string": return "string";
    case "number": return "number";
    case "boolean": return "boolean";
    case "enum": return Object.values(def.entries as Record<string, string>).join("|");
    case "literal": return (def.values as unknown[]).map(String).join("|");
    case "array": { const el = typeText(def.element, appOnly); return el === null ? null : `[${el}]`; }
    case "object": { const f = fieldsText(def.shape, new Set(), appOnly, false); return f === null ? null : `{${f}}`; }
    case "record": return "{…}";
    case "union": {
      const opts = (def.options as z.ZodTypeAny[]).map((o) => typeText(o, appOnly));
      if (opts.some((o) => o === null)) return null;
      // a set of plain values reads as one value set ("string|number", "24|32|48"); lists or objects as alternatives
      return opts.every((o) => /^[^[{]/.test(o!)) ? opts.join("|") : opts.join(" | ");
    }
    default: return "…";   // unknown, any, a custom node
  }
}

/** A prop's annotation after its name: ": number", ": [{…}]", ": a|b"; "" for a plain string or a free value. */
function annotation(s: z.ZodTypeAny, appOnly: ReadonlySet<string>): string | null {
  const def = inner(s);
  if (def?.type === "string" || def?.type === "unknown" || def?.type === "any" || def?.type === "custom") return "";
  if (def?.type === "enum" && Object.keys(def.entries).length > MAX_VALUES) return "";
  const t = typeText(s, appOnly);
  return t === null ? null : `: ${t}`;
}

/** The props of one object level: required first, then optional with `?`. `top` is a component's own props, where a
 *  callback is the chat's to supply (left out); deeper, an object that needs a callback cannot be given (null). */
function fieldsText(shape: Record<string, z.ZodTypeAny>, skip: ReadonlySet<string>, appOnly: ReadonlySet<string>, top: boolean): string | null {
  const req: string[] = [], opt: string[] = [];
  for (const [k, s] of Object.entries(shape)) {
    const required = isRequired(s);
    if (propKind(s) === "callback") { if (!top && required) return null; continue; }
    if (skip.has(k) || appOnly.has(k)) continue;
    // A node prop that is not a container's child list takes words in chat (a Callout's or a Button's text).
    const ann = propKind(s) === "node" ? ": text" : annotation(s, appOnly);
    if (ann === null) { if (required) return null; continue; }
    (required ? req : opt).push(`${k}${required ? "" : "?"}${ann}`);
  }
  return [...req, ...opt].join(", ");
}

/** A component's shape in one line for the flock-blocks skill (owner 2026-10-21; Thesys OpenUI keeps a signature per
 *  component in its prompt), generated from its zod props so it cannot name a prop the schema lacks (Ruling: "generate
 *  and test every shape against the schema"; a hand-written ProgressList shape named a top-level `kind` that is per item).
 *  Required props first, then optional ones with `?`; a number, boolean or small value set is shown (`value: number`,
 *  `ratio?: 1:1|2:1`); a list of objects shows its item (`items: [{label, value: number, kind?}]`), a free-form record
 *  `{…}`. A node prop shows as text (a container's child blocks are its def's chat.kids, left out here with `skip`).
 *  `skip` leaves out the component's renderer-owned props; `appOnly` leaves out app-only props at every level. The id a
 *  reply-capable node needs sits beside props, so the prompt prints it outside the braces (server prompt.ts shapeText). */
export function signatureLine(shape: Record<string, z.ZodTypeAny>, skip: ReadonlySet<string> = new Set(), appOnly: ReadonlySet<string> = new Set()): string {
  return fieldsText(shape, skip, appOnly, true) ?? "";
}
