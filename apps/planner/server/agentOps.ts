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
  set_house_rules: (p) => ({ method: "POST", path: "/api/family/rules", body: p }),
  set_cook: (p) => ({ method: "POST", path: "/api/family/cook", body: p }),
  set_slots: (p) => ({ method: "POST", path: "/api/family/slots", body: p }),
  set_cooking_days: (p) => ({ method: "POST", path: "/api/family/cooking-days", body: p }),
  set_shopping_apps: (p) => ({ method: "POST", path: "/api/family/shopping-apps", body: p }),
  plan_week: (p) => typeof p.week_start === "string" || typeof p.week_start === "number"
    ? { method: "POST", path: `/api/weeks/${encodeURIComponent(String(p.week_start))}/plan`, body: p }
    : { error: "week_start is required: the week's Monday as YYYY-MM-DD", code: "APP_REFUSED", status: 400 },
  set_meal: (p) => ({ method: "POST", path: "/api/meals", body: p }),
  set_dish: (p) => ({ method: "POST", path: "/api/dishes", body: p }),
  set_regular: (p) => ({ method: "POST", path: "/api/regulars", body: p }),
  import_order_history: (p) => ({ method: "POST", path: "/api/order-history", body: p }),
  record_bought_outside: (p) => ({ method: "POST", path: "/api/items/outside", body: p }),
  set_item: (p) => ({ method: "POST", path: "/api/items", body: p }),
  set_subscription: (p) => ({ method: "POST", path: "/api/items/subscription", body: p }),
  answer_running_low: (p) => ({ method: "POST", path: "/api/items/answers", body: p }),
  get_reminder: (p) => typeof p.which === "string"
    ? { method: "POST", path: `/api/reminders/${encodeURIComponent(p.which)}`, body: {} }
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
};

/** Operations that take more than one call, or none. */
type Multi = (p: Record<string, unknown>, call: (c: Call) => Promise<{ status: number; body: any }>) => Promise<unknown>;

const MULTI: Record<string, Multi> = {
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
