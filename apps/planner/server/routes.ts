// The shopping JSON endpoints (docs/V3-FLOW-SPEC.md "Agent surface"). Mounted on a Hono app so tests can drive them
// without the SDK. Every read recomputes the plan first, and every write answers with the app's own updated state.
import type { Hono } from "hono";
import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import { searchAll } from "./search";
import { letGo, listSlots, markOrdered, mealReadiness, mealReadinessMap, refreshShopping, type OrderedBody } from "./shopping";
import { clearYes, draftView, editDraftItems, itemsProblem, moveWindow, nextDraftId, recordYes, saveQuote, type ItemsBody } from "./draft";
import { quoteProblem, type QuoteInput } from "./quotes";
import { markMessageSent } from "./messages";
import { orderYesWake } from "./routines/shopping-timeline";
import type { SettingsReader } from "./timeline";
import { pinnedWindow, readWindows, setPinnedWindows } from "./orderPatterns";

type Emit = (table: string, id: string, op: "insert" | "update" | "delete") => void;
/** Wakes the shopping-timeline routine's agent (index.ts: flock.platform.routines.wake with the remembered routine id). */
export type WakeAgent = (message: string, data: unknown) => Promise<{ ok: boolean; reason?: string }>;
type Fail = { ok: false; status: 400 | 404 | 409; reason: string };

const body = async <T,>(c: { req: { json(): Promise<unknown> } }): Promise<T | null> => { try { return (await c.req.json()) as T; } catch { return null; } };
const userOf = (c: { req: { header(name: string): string | undefined } }) => c.req.header("X-Flock-User") ?? null;
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

export function mountShoppingRoutes(hono: Hono<any>, db: BunSQLiteDatabase<any>, settings: SettingsReader, emit?: Emit, clock: () => Date = () => new Date(), wake?: WakeAgent) {
  const refreshed = () => { const now = clock(); refreshShopping(db, settings, now, emit); return now; };
  const fail = (c: { json(b: unknown, s: number): Response }, f: Fail) => c.json({ ok: false, reason: f.reason }, f.status);
  /** The draft after a change, as the agent should echo it. */
  const draftAfter = (cartId: string) => { const now = refreshed(); return draftView(db, settings, cartId, now); };

  hono.get("/api/search", (c) => {
    const q = c.req.query("q") ?? "";
    const limit = Math.min(Math.max(Number(c.req.query("limit")) || 30, 1), 100);
    return c.json({ q, results: searchAll(db, q, limit) });
  });

  hono.get("/api/shopping/slots", (c) => {
    const now = refreshed();
    return c.json({ generated_at: now.toISOString(), slots: listSlots(db, settings, now) });
  });

  hono.get("/api/shopping/patterns", (c) => c.json(readWindows(db)));

  // Replaces the pinned windows ({windows: []} unpins all); learned ones are kept. Drafts re-plan straight away.
  hono.put("/api/shopping/patterns/pinned", async (c) => {
    const b = await body<{ windows?: unknown[] }>(c);
    if (!b || !Array.isArray(b.windows)) return c.json({ ok: false, reason: "windows must be a list" }, 400);
    const pinned = b.windows.map(pinnedWindow);
    if (pinned.some((w) => !w)) return c.json({ ok: false, reason: "each window needs days (0-6), from and to (HH:MM)" }, 400);
    setPinnedWindows(db, pinned as NonNullable<(typeof pinned)[number]>[], clock());
    refreshed();
    return c.json({ ok: true, ...readWindows(db) });
  });

  // The next draft: span, lines (with ranges), removed lines, quotes + best, the yes, and which message is next.
  hono.get("/api/shopping/draft", (c) => {
    const now = refreshed();
    const id = nextDraftId(db);
    return c.json({ draft: id ? draftView(db, settings, id, now) : null });
  });

  hono.post("/api/shopping/draft/items", async (c) => {
    const b = await body<ItemsBody>(c);
    const problem = itemsProblem(b);
    if (problem) return c.json({ ok: false, reason: problem }, 400);
    refreshed();
    const cartId = str(b!.cart_id) ?? nextDraftId(db);
    if (!cartId) return c.json({ ok: false, reason: "no_draft" }, 404);
    const res = editDraftItems(db, cartId, b!, clock(), userOf(c), emit);
    if (!res.ok) return fail(c, res);
    return c.json({ ...res, draft: draftAfter(cartId) });
  });

  hono.post("/api/shopping/windows/move", async (c) => {
    const b = await body<{ cart_id?: string; order_at?: string }>(c);
    const cartId = str(b?.cart_id) ?? nextDraftId(db);
    if (!cartId) return c.json({ ok: false, reason: "no_draft" }, 404);
    const res = moveWindow(db, settings, cartId, b?.order_at, clock(), emit);
    if (!res.ok) return fail(c, res);
    return c.json({ ok: true, late: res.late, draft: draftAfter(cartId) });
  });

  hono.post("/api/carts/:id/quotes", async (c) => {
    const b = await body<QuoteInput>(c);
    const problem = quoteProblem(b);
    if (problem) return c.json({ ok: false, reason: problem }, 400);
    refreshed();
    const res = saveQuote(db, settings, c.req.param("id"), b!, clock(), emit);
    return res.ok ? c.json(res) : fail(c, res);
  });

  // A family member's yes heard in chat (the agent records it before placing the order).
  hono.post("/api/carts/:id/yes", async (c) => {
    const b = await body<{ service?: string; by?: string }>(c);
    const res = recordYes(db, c.req.param("id"), str(b?.service), str(b?.by) ?? userOf(c), clock(), emit);
    return res.ok ? c.json(res) : fail(c, res);
  });

  // The owner's "Order with <service>" in the app: their yes is recorded and the agent is woken with it (a wake that
  // can't be delivered takes the yes back, so the draft isn't held for an order nobody is placing).
  hono.post("/api/carts/:id/order", async (c) => {
    const b = await body<{ service?: string }>(c);
    const service = str(b?.service);
    if (!service) return c.json({ ok: false, reason: "service is required" }, 400);
    const now = refreshed();
    const view = draftView(db, settings, c.req.param("id"), now);
    if (!view) return c.json({ ok: false, reason: "no_draft" }, 404);
    if (!wake) return c.json({ ok: false, reason: "not_ready" }, 409);
    const by = userOf(c);
    const yes = recordYes(db, view.id, service, by, clock(), emit);
    if (!yes.ok) return fail(c, yes);
    const w = orderYesWake(view, service, by);
    const res = await wake(w.message, w.data).catch(() => ({ ok: false, reason: "wake_failed" }));
    if (res.ok) return c.json(yes);
    clearYes(db, view.id, emit);
    return c.json({ ok: false, reason: res.reason ?? "wake_failed" }, res.reason === "not_ready" ? 409 : 502);
  });

  hono.post("/api/carts/:id/let-go", (c) => {
    const res = letGo(db, settings, c.req.param("id"), clock(), "owner", emit);
    if (!res.ok) return fail(c, res);
    refreshed();
    return c.json(res);
  });

  hono.post("/api/carts/:id/ordered", async (c) => {
    const b = await body<OrderedBody>(c);
    if (!b || typeof b.service !== "string" || !b.service.trim()) return c.json({ ok: false, reason: "service is required" }, 400);
    if (b.total != null && typeof b.total !== "number") return c.json({ ok: false, reason: "total must be a number" }, 400);
    const res = markOrdered(db, settings, c.req.param("id"), b, clock(), emit);
    return res.ok ? c.json({ ok: true, cart_id: c.req.param("id"), status: "ordered", rows_ordered: res.rows_ordered }) : fail(c, res);
  });

  // The agent's ack for a message the app asked it to send (each wake names its message id).
  hono.post("/api/messages/:id/sent", (c) => {
    const m = markMessageSent(db, c.req.param("id"), clock());
    return m ? c.json({ ok: true, message: m }) : c.json({ ok: false, reason: "message_not_found" }, 404);
  });

  // ?ids=a,b,c → {statuses: {id: "ready"|"ordering"|"missing"|"none"}}. Registered before :id so "readiness" never reads as an id.
  hono.get("/api/meals/readiness", (c) => {
    const ids = (c.req.query("ids") ?? "").split(",").map((x) => x.trim()).filter(Boolean).slice(0, 200);
    return c.json({ statuses: mealReadinessMap(db, settings, ids, clock()) });
  });

  hono.get("/api/meals/:id/readiness", (c) => {
    const r = mealReadiness(db, settings, c.req.param("id"), clock());
    return r ? c.json(r) : c.json({ ok: false, reason: "meal_not_found" }, 404);
  });
}
