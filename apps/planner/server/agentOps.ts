// The app's operations for its agent (flock.app.json agentInterface.operations; Flock puts them in the paired agent's
// context and relays `flock-api POST /api/apps/<app>/ops/<name>` here). The app owns how its agent works: each operation
// is a thin door onto the app's own route, so validation, change hooks and recomputes stay in one place, and every write
// is stamped as the agent's (x-flock-agent) exactly as a direct call would be. The full guide is the `guide` operation.
import type { Hono } from "hono";
import type { OpHandler } from "@flock/app-sdk";
import guide from "./agent-guide.md" with { type: "text" };

type Call = { method: "GET" | "POST" | "PATCH" | "DELETE"; path: string; body?: unknown };
type Route = (p: Record<string, unknown>) => Call | { error: string; code: string; status: number };

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const need = (field: string) => ({ error: `${field} is required`, code: "BAD_INPUT", status: 400 });
const enc = encodeURIComponent;

/** Each operation: where it goes in the app's own API. */
export const ROUTES: Record<string, Route> = {
  get_draft: () => ({ method: "GET", path: "/api/shopping/draft" }),
  edit_draft: (p) => ({ method: "POST", path: "/api/shopping/draft/items", body: p }),
  move_window: (p) => ({ method: "POST", path: "/api/shopping/windows/move", body: p }),
  add_quote: (p) => (str(p.cart_id) ? { method: "POST", path: `/api/carts/${enc(str(p.cart_id)!)}/quotes`, body: p } : need("cart_id")),
  record_yes: (p) => (str(p.cart_id) ? { method: "POST", path: `/api/carts/${enc(str(p.cart_id)!)}/yes`, body: p } : need("cart_id")),
  record_order: (p) => (str(p.cart_id) ? { method: "POST", path: `/api/carts/${enc(str(p.cart_id)!)}/ordered`, body: p } : need("cart_id")),
  skip_order: (p) => (str(p.cart_id) ? { method: "POST", path: `/api/carts/${enc(str(p.cart_id)!)}/let-go` } : need("cart_id")),
  ack_message: (p) => (str(p.message_id) ? { method: "POST", path: `/api/messages/${enc(str(p.message_id)!)}/sent` } : need("message_id")),
  list_jobs: () => ({ method: "GET", path: "/api/jobs" }),
  answer_job: (p) => (str(p.job_id) ? { method: "POST", path: `/api/jobs/${enc(str(p.job_id)!)}/answer`, body: p.answer ?? {} } : need("job_id")),
  pantry: () => ({ method: "GET", path: "/api/pantry" }),
  pantry_answer: (p) => ({ method: "POST", path: "/api/pantry/answer", body: p }),
  have_item: (p) => (str(p.ingredient_id) && str(p.item) ? { method: "POST", path: "/api/pantry/have", body: p } : need("ingredient_id and item")),
  set_meal_recipes: (p) => (str(p.meal_id) ? { method: "POST", path: `/api/meals/${enc(str(p.meal_id)!)}/recipes`, body: { recipes: p.recipes } } : need("meal_id")),
  search: (p) => (str(p.q) ? { method: "GET", path: `/api/search?q=${enc(str(p.q)!)}` } : need("q")),
  save_meal: (p) => {
    const { meal_id, ...fields } = p;
    return str(meal_id) ? { method: "PATCH", path: `/api/_data/meals/${enc(str(meal_id)!)}`, body: fields } : { method: "POST", path: "/api/_data/meals", body: fields };
  },
  remove_meal: (p) => (str(p.meal_id) ? { method: "DELETE", path: `/api/_data/meals/${enc(str(p.meal_id)!)}` } : need("meal_id")),
  set_shelf_life: (p) => (str(p.ingredient_id)
    ? { method: "PATCH", path: `/api/_data/ingredients/${enc(str(p.ingredient_id)!)}`, body: { shelf_life_days: p.shelf_life_days, shelf_life_note: p.note ?? null, shelf_life_source: "agent" } }
    : need("ingredient_id")),
};

/** Operations that take more than one call. */
type Multi = (p: Record<string, unknown>, call: (c: Call) => Promise<{ status: number; body: any }>) => Promise<unknown>;

const MULTI: Record<string, Multi> = {
  /** A recipe with its ingredient lines in one go (search first: the same dish may exist under another spelling). */
  write_recipe: async (p, call) => {
    const name = str(p.name);
    if (!str(p.recipe_id) && !name) return need("name (new recipe) or recipe_id (add lines)");
    let recipeId = str(p.recipe_id);
    if (!recipeId) {
      const made = await call({ method: "POST", path: "/api/_data/recipes", body: { name, method: p.method ?? null, notes: p.notes ?? null } });
      if (made.status >= 400) return { error: made.body?.error ?? "could not create the recipe", code: "BAD_INPUT", status: made.status };
      recipeId = made.body.row.id;
    }
    const lines = Array.isArray(p.lines) ? p.lines as Record<string, unknown>[] : [];
    for (const l of lines) {
      const res = await call({ method: "POST", path: "/api/_data/recipe_ingredients", body: { ...l, recipe_id: recipeId } });
      if (res.status >= 400) return { error: `line ${String(l.item ?? "")}: ${res.body?.error ?? "refused"}`, code: "BAD_INPUT", status: res.status, recipe_id: recipeId };
    }
    return { ok: true, recipe_id: recipeId, lines: lines.length };
  },
  guide: async () => ({ guide }),
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
      const c = route(payload ?? {});
      if ("error" in c) return c;
      const res = await caller(ctx.agentId)(c);
      if (res.status >= 400) return { error: typeof res.body === "object" && res.body ? (res.body.reason ?? res.body.error ?? "refused") : String(res.body), code: "APP_REFUSED", status: res.status, detail: res.body };
      return res.body;
    };
  }
  for (const [name, run] of Object.entries(MULTI)) ops[name] = (payload, ctx) => run(payload ?? {}, caller(ctx.agentId)) as Promise<unknown>;
  return ops;
}
