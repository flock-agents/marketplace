// The app's operations for its agent (flock.app.json agentInterface.operations; Flock puts them in the agent's context and
// relays the api tool's `POST /api/apps/<app>/ops/<name>` here), as Meal Planner's are: each operation is a thin door onto
// the app's own route, so the checks stay in one place and every write is stamped as the agent's (x-flock-agent). The full
// guide is the `guide` operation.
import type { Hono } from "hono";
import type { OpHandler } from "@flock/app-sdk";
import guide from "./agent-guide.md" with { type: "text" };
import { EVENT_FIELDS, MEMBER_FIELDS } from "./events";
import { BRIEF_FIELDS, IMPORT_FIELDS, ITEM_FIELDS, PLAN_DONE_FIELDS, STEP_FIELDS, brief, importEvents, planDone, type Cal } from "./calendar";

/** Each operation's fields, exactly as its route reads them. A field outside the list is refused with the list, so a guessed
 *  field never passes unread. `need`: the fields it cannot do without. */
export const FIELDS: Record<string, { fields: string[]; need?: string[] }> = {
  guide: { fields: [] },
  add_events: { fields: ["events", "members", "added_by"], need: ["events"] },
  import_events: { fields: IMPORT_FIELDS, need: ["source", "items"] },
  plan_done: { fields: PLAN_DONE_FIELDS, need: ["planId", "events"] },
  brief: { fields: BRIEF_FIELDS, need: ["kind"] },
};

/** How alike two names are: shared words count most, then the edit distance between them. Lower is closer. */
function distance(a: string, b: string): number {
  const wa = a.toLowerCase().split(/[_\s-]+/), wb = b.toLowerCase().split(/[_\s-]+/);
  const shared = wa.filter((w) => wb.includes(w)).length;
  const s = a.toLowerCase(), t = b.toLowerCase();
  let prev = Array.from({ length: t.length + 1 }, (_, j) => j);
  for (let i = 1; i <= s.length; i++) {
    const cur = [i];
    for (let j = 1; j <= t.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (s[i - 1] === t[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[t.length] - shared * 3;
}
/** The closest of `names` to `given`, when it is close enough to be what was meant. */
export function closest(given: string, names: string[]): string | null {
  let best: string | null = null, score = Infinity;
  for (const n of names) { const d = distance(given, n); if (d < score) { score = d; best = n; } }
  return best !== null && score <= Math.max(3, Math.ceil(given.length / 2)) ? best : null;
}

const fieldList = (op: string) => (FIELDS[op].fields.length ? FIELDS[op].fields.join(", ") : "none");

/** The fields sent that the operation does not take, and the ones it needs that are missing: refused with its whole field list. */
export function checkFields(op: string, p: Record<string, unknown>): { error: string; code: string; status: number } | null {
  const spec = FIELDS[op];
  const wrong = Object.keys(p).filter((k) => !spec.fields.includes(k));
  const missing = (spec.need ?? []).filter((k) => p[k] === undefined || p[k] === null);
  if (!wrong.length && !missing.length) return null;
  const said = wrong.map((k) => { const near = closest(k, spec.fields); return `${op} does not take ${k}${near ? ` (did you mean ${near}?)` : ""}.`; });
  if (missing.length) said.push(`${op} needs ${missing.join(", ")}.`);
  return { error: `${said.join(" ")} Its fields: ${fieldList(op)}. Send it again with those only.`, code: "APP_REFUSED", status: 400 };
}

/** The guide's last section: every operation with its fields as the code reads them (a field it can do without has "?"). */
export const FIELDS_SECTION = ["## Operations and their fields (exactly these; no other name or field is taken)", "",
  "- guide {}",
  `- add_events { events: [{ ${EVENT_FIELDS.map((k) => (k === "title" ? k : `${k}?`)).join(", ")} }], members?: [{ ${MEMBER_FIELDS.map((k) => (k === "name" ? k : `${k}?`)).join(", ")} }], added_by? }`,
  `- plan_done { planId, events: [{ event, type, steps: [{ ${STEP_FIELDS.map((k) => (["key", "kind", "title", "due"].includes(k) ? k : `${k}?`)).join(", ")} }] }] }`,
  "- brief { kind: morning | evening }",
  `- import_events { source, label?, items: [{ ${ITEM_FIELDS.map((k) => (["ref", "title", "date"].includes(k) ? k : `${k}?`)).join(", ")} }] } (Flock's own harvest calls this one, not you)`].join("\n");

/** The operation names, for the manifest test: every declared operation has a handler. */
export const OPERATION_NAMES = Object.keys(FIELDS);

/** `cal`: the app's database and clock; each operation is given Flock (the SDK's platform) by its caller. */
export function agentOps(hono: () => Hono<any>, cal: () => Omit<Cal, "platform">): Record<string, OpHandler> {
  const withFlock = (ctx: { platform?: unknown }): Cal => ({ ...cal(), platform: () => (ctx.platform ?? null) as any });
  const by = (ctx: { agentId?: string | null }) => (ctx.agentId ? `agent:${ctx.agentId}` : "app");
  return {
    guide: async () => ({ guide: `${guide.trimEnd()}\n\n${FIELDS_SECTION}\n` }),
    add_events: async (payload, ctx) => {
      const bad = checkFields("add_events", payload ?? {});
      if (bad) return bad;
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (ctx.agentId) headers["x-flock-agent"] = ctx.agentId;
      const res = await hono().request("/api/events/add", { method: "POST", headers, body: JSON.stringify(payload) });
      const body = (await res.json().catch(() => null)) as any;
      if (res.status >= 400) return { error: body?.reason ?? body?.error ?? "refused", code: "APP_REFUSED", status: res.status };
      return body;
    },
    import_events: async (payload, ctx) => checkFields("import_events", payload ?? {}) ?? importEvents(withFlock(ctx), payload ?? {}),
    plan_done: async (payload, ctx) => checkFields("plan_done", payload ?? {}) ?? planDone(withFlock(ctx), payload ?? {}, by(ctx)),
    brief: async (payload, ctx) => checkFields("brief", payload ?? {}) ?? brief(withFlock(ctx), payload ?? {}),
  };
}
