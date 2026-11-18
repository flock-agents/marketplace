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
      if (res.status >= 400) return { error: typeof res.body === "object" && res.body ? (res.body.reason ?? res.body.error ?? "refused") : String(res.body), code: "APP_REFUSED", status: res.status, detail: res.body };
      return res.body;
    };
  }
  for (const [name, run] of Object.entries(MULTI)) ops[name] = (payload, ctx) => run(payload ?? {}, caller(ctx.agentId)) as Promise<unknown>;
  return ops;
}
