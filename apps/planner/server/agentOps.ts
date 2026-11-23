// The app's operations for its agent (flock.app.json agentInterface.operations; Flock puts them in the paired agent's
// context and relays the api tool's `POST /api/apps/<app>/ops/<name>` here). The app owns how its agent works: each operation
// is a thin door onto the app's own route, so validation, change hooks and recomputes stay in one place, and every write
// is stamped as the agent's (x-flock-agent) exactly as a direct call would be. The full guide is the `guide` operation.
import type { Hono } from "hono";
import type { OpHandler } from "@flock/app-sdk";
import guide from "./agent-guide.md" with { type: "text" };

type Call = { method: "GET" | "POST" | "PATCH" | "DELETE"; path: string; body?: unknown };
type Route = (p: Record<string, unknown>) => Call | { error: string; code: string; status: number };

/** Each operation: where it goes in the app's own API. */
export const ROUTES: Record<string, Route> = {
  set_person: (p) => ({ method: "POST", path: "/api/family/people", body: p }),
  set_cook: (p) => ({ method: "POST", path: "/api/family/cook", body: p }),
  set_shopping_apps: (p) => ({ method: "POST", path: "/api/family/shopping-apps", body: p }),
  apply_setup: (p) => ({ method: "POST", path: "/api/family/setup", body: p }),
  make_plan: (p) => typeof p.week_start === "string" || typeof p.week_start === "number"
    ? { method: "POST", path: `/api/weeks/${encodeURIComponent(String(p.week_start))}/make-plan`, body: p }
    : { error: "week_start is required: the week's Monday as YYYY-MM-DD", code: "APP_REFUSED", status: 400 },
  // Later changes (docs/slot-model-spec.md §6) and the answer to the next-day question (§5.7): changes.ts.
  set_slot: (p) => ({ method: "POST", path: "/api/slots", body: p }),
  set_slot_day: (p) => ({ method: "POST", path: "/api/slot-days", body: p }),
  add_dish: (p) => ({ method: "POST", path: "/api/library", body: p }),
  set_rule: (p) => ({ method: "POST", path: "/api/rules", body: p }),
  set_setting: (p) => ({ method: "POST", path: "/api/planner-settings", body: p }),
  record_made: (p) => ({ method: "POST", path: "/api/slot-days/made", body: p }),
  record_feedback: (p) => ({ method: "POST", path: "/api/slot-days/feedback", body: p }),
  set_regular: (p) => ({ method: "POST", path: "/api/regulars", body: p }),
  import_order_history: (p) => ({ method: "POST", path: "/api/order-history", body: p }),
  record_bought_outside: (p) => ({ method: "POST", path: "/api/items/outside", body: p }),
  set_item: (p) => ({ method: "POST", path: "/api/items", body: p }),
  set_subscription: (p) => ({ method: "POST", path: "/api/items/subscription", body: p }),
  answer_running_low: (p) => ({ method: "POST", path: "/api/items/answers", body: p }),
  get_reminder: (p) => typeof p.which === "string"
    ? { method: "POST", path: `/api/reminders/${encodeURIComponent(p.which)}`, body: p.date === undefined ? {} : { date: p.date } }
    : { error: "which is required: afternoon or evening", code: "APP_REFUSED", status: 400 },
  get_cart: (p) => ({ method: "GET", path: p.app == null ? "/api/carts" : `/api/carts?app=${encodeURIComponent(String(p.app))}` }),
  set_cart_line: (p) => ({ method: "POST", path: "/api/carts/line", body: p }),
  sync_cart: (p) => typeof p.order_id === "string" && p.order_id
    ? { method: "POST", path: `/api/carts/${encodeURIComponent(p.order_id)}/sync`, body: p }
    : { error: "order_id is required: the cart's order_id from get_cart", code: "APP_REFUSED", status: 400 },
  order_cart: (p) => typeof p.app === "string" && p.app.trim()
    ? { method: "POST", path: `/api/carts/${encodeURIComponent(p.app.trim())}/order`, body: p }
    : { error: "app is required: the shopping app whose cart she said yes to", code: "APP_REFUSED", status: 400 },
  record_order: (p) => typeof p.order_id === "string" && p.order_id
    ? { method: "POST", path: `/api/orders/${encodeURIComponent(p.order_id)}/record`, body: p }
    : { error: "order_id is required: the order_id order_cart answered", code: "APP_REFUSED", status: 400 },
  cancel_order: (p) => typeof p.order_id === "string" && p.order_id
    ? { method: "POST", path: `/api/orders/${encodeURIComponent(p.order_id)}/cancel`, body: p }
    : { error: "order_id is required: the order_id order_cart answered", code: "APP_REFUSED", status: 400 },
  remember_product: (p) => ({ method: "POST", path: "/api/products", body: p }),
  save_recipe: (p) => ({ method: "POST", path: "/api/recipes/save", body: p }),
  set_dish_video: (p) => ({ method: "POST", path: "/api/dish-book/video", body: p }),
  rate_dishes: (p) => ({ method: "POST", path: "/api/dish-book/ratings", body: p }),
  get_dish: (p) => typeof p.dish === "string" && p.dish.trim()
    ? { method: "GET", path: `/api/dish-book?dish=${encodeURIComponent(p.dish.trim())}` }
    : { error: "dish is required: the dish's name, as planned", code: "APP_REFUSED", status: 400 },
};

/** Each operation's fields, exactly as its route reads them (the guide and the manifest name the same: manifest.test.ts holds
 *  them equal). A field outside the list is refused with the list, so a guessed field never passes unread. `need`: the fields
 *  it cannot do without. */
export const FIELDS: Record<string, { fields: string[]; need?: string[] }> = {
  guide: { fields: [] },
  set_person: { fields: ["name", "relationship", "group", "portions", "diet", "allergies", "dislikes", "targets", "note", "remove"], need: ["name"] },
  set_cook: { fields: ["name", "days", "arrival", "makes_well", "wont_make", "time_limit", "new_recipes", "note"], need: ["name"] },
  set_shopping_apps: { fields: ["main", "fallback", "connected"], need: ["main", "connected"] },
  apply_setup: { fields: ["household", "transcript"], need: ["transcript"] },
  make_plan: { fields: ["week_start", "household"], need: ["week_start"] },
  set_slot: { fields: ["name", "kind", "addon_of", "usual_people", "days", "skip_days", "order", "remove"], need: ["name"] },
  set_slot_day: { fields: ["date", "slot", "people", "add_people", "remove_people", "guests", "occasion", "new_dishes_allowed", "skip", "dishes"], need: ["date", "slot"] },
  add_dish: { fields: ["name", "slot", "frequency", "days", "quote", "link"], need: ["name", "slot"] },
  set_rule: { fields: ["id", "hard", "what", "who", "slots", "days", "items", "to", "frequency", "per_meal", "fasting_food", "quote", "remove"] },
  set_setting: { fields: ["new_dishes_per_week"], need: ["new_dishes_per_week"] },
  record_made: { fields: ["date", "slot", "dishes"], need: ["date", "slot", "dishes"] },
  record_feedback: { fields: ["date", "slot", "dish", "made", "liked", "again"], need: ["date", "dish", "made"] },
  set_regular: { fields: ["item", "amount", "unit", "every", "times_per_week", "weekdays", "for_whom", "active", "paused_until", "remove"], need: ["item"] },
  import_order_history: { fields: ["app", "account", "orders"], need: ["app", "orders"] },
  record_bought_outside: { fields: ["item", "date"], need: ["item"] },
  set_item: { fields: ["item", "group", "usual_amount", "unit", "every_days", "follows_plan", "dont_ask", "snooze_days"], need: ["item"] },
  set_subscription: { fields: ["item", "source", "active"], need: ["item", "active"] },
  answer_running_low: { fields: ["answers"], need: ["answers"] },
  get_reminder: { fields: ["which", "date"], need: ["which"] },
  get_cart: { fields: ["app"] },
  set_cart_line: { fields: ["item", "qty", "app", "source", "for_note", "for_date", "product_id", "name_on_app", "pack", "price", "image"], need: ["item", "qty"] },
  sync_cart: { fields: ["order_id", "lines", "total", "delivery_gap", "outside_lines"], need: ["order_id", "lines"] },
  order_cart: { fields: ["app"], need: ["app"] },   // picks and seen are the Order button's, sent by the page itself
  record_order: { fields: ["order_id", "placed", "paid", "app_order_ref", "total"], need: ["order_id"] },
  cancel_order: { fields: ["order_id"], need: ["order_id"] },
  remember_product: { fields: ["item", "app", "product_id", "name_on_app", "pack", "pack_amount", "pack_unit", "price", "image"], need: ["item", "app", "product_id", "name_on_app"] },
  save_recipe: { fields: ["recipe_id", "name", "links", "notes", "ingredients", "tags", "for", "thumbnail"] },
  set_dish_video: { fields: ["dish", "dish_id", "url", "title", "thumbnail", "remove"] },
  rate_dishes: { fields: ["date", "ratings"], need: ["ratings"] },
  get_dish: { fields: ["dish"], need: ["dish"] },
};

/** A field sent to the wrong operation that has a home elsewhere: the refusal names that operation. */
const MOVED: Record<string, Record<string, string>> = {
  // Sim run 9: a cook correction sent its times as visits (the interview's fact name), and the 7:30 was lost.
  set_cook: { times: "the times go in arrival: [{ at, meals }]" },
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
/** Words an agent reaches for that name another operation: "save" and "add" a person is set_person. */
const OP_WORDS: Record<string, string> = { save: "set", add: "set", update: "set", create: "set", change: "set", edit: "set", put: "set" };

const fieldList = (op: string) => (FIELDS[op].fields.length ? FIELDS[op].fields.join(", ") : "none");

/** The answer to an operation the app does not have: the closest one and its fields. (Flock answers an undeclared name itself
 *  today; this is the text for when it asks the app.) */
export function unknownOperation(name: string): { error: string; code: string; status: number } {
  const swapped = name.split("_").map((w) => OP_WORDS[w.toLowerCase()] ?? w).join("_");
  const known = Object.keys(FIELDS);
  const near = known.includes(swapped) ? swapped : closest(swapped, known) ?? closest(name, known);
  const hint = near ? ` Did you mean ${near}? Its fields: ${fieldList(near)}.` : "";
  return { error: `${name} is not an operation of this app.${hint} The operations: ${known.join(", ")}.`, code: "UNKNOWN_OP", status: 404 };
}

/** The fields sent that the operation does not take, and the ones it needs that are missing: refused with its whole field list. */
export function checkFields(op: string, p: Record<string, unknown>): { error: string; code: string; status: number } | null {
  const spec = FIELDS[op];
  if (!spec) return null;
  const wrong = Object.keys(p).filter((k) => !spec.fields.includes(k));
  const missing = (spec.need ?? []).filter((k) => p[k] === undefined || p[k] === null);
  if (!wrong.length && !missing.length) return null;
  const said: string[] = [];
  for (const k of wrong) {
    const moved = MOVED[op]?.[k];
    const near = moved ? null : closest(k, spec.fields);
    said.push(moved ? `${op} does not take ${k}: ${moved}.` : `${op} does not take ${k}${near ? ` (did you mean ${near}?)` : ""}.`);
  }
  if (missing.length) said.push(`${op} needs ${missing.join(", ")}.`);
  return { error: `${said.join(" ")} Its fields: ${fieldList(op)}. Send it again with those only.`, code: "APP_REFUSED", status: 400 };
}

/** Operations that take more than one call, or none. */
type Multi = (p: Record<string, unknown>, call: (c: Call) => Promise<{ status: number; body: any }>) => Promise<unknown>;

/** The guide's last section: every operation with its fields as the code reads them (a field it can do without has "?"). */
export const FIELDS_SECTION = ["## Operations and their fields (exactly these; no other name or field is taken)", "",
  ...Object.entries(FIELDS).map(([op, f]) => `- ${op} { ${f.fields.map((k) => (f.need?.includes(k) ? k : `${k}?`)).join(", ")} }`)].join("\n");

const MULTI: Record<string, Multi> = {
  guide: async () => ({ guide: `${guide.trimEnd()}\n\n${FIELDS_SECTION}\n` }),
};

/** The operation names, for the manifest test: every declared operation has a handler. */
export const OPERATION_NAMES = [...Object.keys(ROUTES), ...Object.keys(MULTI)];

export function agentOps(hono: () => Hono<any>): Record<string, OpHandler> {
  const caller = (agentId: string | null) => async (c: Call) => {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (agentId) headers["x-flock-agent"] = agentId;
    const res = await hono().request(c.path, { method: c.method, headers, body: c.body === undefined ? undefined : JSON.stringify(c.body) });
    const text = await res.text();
    let body: unknown = text;
    try { body = JSON.parse(text); } catch { /* a non-JSON answer is passed on as text */ }
    return { status: res.status, body: body as any };
  };
  const ops: Record<string, OpHandler> = {};
  for (const [name, route] of Object.entries(ROUTES)) {
    ops[name] = async (payload, ctx) => {
      // The cook's times sent under the interview's fact name (planner.cook.visits): the same shape as arrival (sim runs
      // 9-11: every 7:30 correction was sent as visits and lost).
      if (name === "set_cook" && payload && payload.visits !== undefined && payload.arrival === undefined) {
        const { visits, ...rest } = payload as Record<string, unknown>;
        payload = { ...rest, arrival: visits };
      }
      const bad = checkFields(name, payload ?? {});
      if (bad) return bad;
      const c = route(payload ?? {});
      if ("error" in c) return c;
      const res = await caller(ctx.agentId)(c);
      // A refusal the route gave its own code (NEEDS_NAME) keeps it, so the agent can tell what to do about it.
      if (res.status >= 400) {
        const refusal = typeof res.body === "object" && res.body ? res.body : null;
        return { error: refusal ? (refusal.reason ?? refusal.error ?? "refused") : String(res.body),
          code: typeof refusal?.code === "string" ? refusal.code : "APP_REFUSED", status: res.status, detail: res.body };
      }
      return res.body;
    };
  }
  for (const [name, run] of Object.entries(MULTI)) ops[name] = (payload, ctx) => run(payload ?? {}, caller(ctx.agentId)) as Promise<unknown>;
  return ops;
}
