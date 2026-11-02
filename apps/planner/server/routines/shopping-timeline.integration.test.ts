// End-to-end: the shoppingTimeline routine against a real (in-memory) kit database, with a fake ctx that records
// every wake instead of reaching the platform. `now` is pinned through runShoppingTimeline (the real body).
import { describe, it, expect } from "bun:test";
import { mkdtempSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { Hono } from "hono";
import { mountKit } from "@flock/app-kit";
import { eq } from "drizzle-orm";
import * as schema from "../db/schema";
import { carts as cartsTable } from "../db/schema";
import { SETTINGS } from "../db/constants";
import { runShoppingTimeline } from "./shopping-timeline";
import { mountShoppingRoutes } from "../routes";
import { readRoutineId } from "../routineRegistry";

async function boot(wakeOk = true) {
  const hono = new Hono();
  const dataDir = mkdtempSync(join(tmpdir(), "planner-shopping-"));
  const kit = await mountKit({ hono, env: { appId: "t", dataDir, apiUrl: null, token: null, agent: null } },
    { schema, dbFile: ":memory:", appName: "T", settings: SETTINGS, privateTables: { prep_reminders: "server-only" } });
  mountShoppingRoutes(hono, kit.db, kit.settings);
  const call = async (method: string, path: string, body?: unknown) => {
    const r = await hono.request(path, { method, headers: { "Content-Type": "application/json", "X-Flock-User": "tester" }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, body: (await r.json()) as any };
  };
  const wakes: { message: string; data: any }[] = [];
  const ctx = {
    wakeAgent: async (message: string, data?: unknown) => { wakes.push({ message, data }); return wakeOk ? { ok: true, data: {} } : { ok: false }; },
    routine: { id: "test-routine" },
    platform: { dataDir },
    kit: { db: kit.db, sqlite: kit.sqlite, emitChange: (t: string, i: string, o: "insert" | "update" | "delete", b: string) => kit.emitChange(t, i, o, b) },
  };
  // Needed Fri Oct 30 → the draft orders Thu Oct 29 18:00 (buy.preferred_order_time, the evening before).
  await call("POST", "/api/_data/groceries", { item: "Palak", category: "vegetables", needed_by: "2026-10-30", source: "manual", status: "pending" });
  return { kit, call, wakes, ctx, dataDir };
}

const at = (day: number, h: number, m = 0) => new Date(2026, 9, day, h, m);
const cartRows = async (call: Awaited<ReturnType<typeof boot>>["call"]) => (await call("GET", "/api/_data/carts?limit=50")).body.rows as any[];

describe("shoppingTimeline: one window's three messages", () => {
  it("reminder the evening before, heads-up before the window, price at it — each once, then the draft is let go silently", async () => {
    const { call, wakes, ctx } = await boot();
    await runShoppingTimeline(ctx as any, at(28, 19, 45));
    expect(wakes).toHaveLength(0);   // nothing due yet: no model call

    await runShoppingTimeline(ctx as any, at(28, 20, 0));
    expect(wakes).toHaveLength(1);
    expect(wakes[0].message).toContain("message slot: reminder");
    expect(wakes[0].message).toContain(`ack_message {message_id: "${wakes[0].data.message_id}"}`);
    expect(wakes[0].data).toMatchObject({ slot: "reminder", order_at: "2026-10-29T18:00", lines: [{ item: "Palak" }] });
    expect(Array.isArray(wakes[0].data.pantry_check)).toBe(true);
    await runShoppingTimeline(ctx as any, at(28, 20, 15));
    expect(wakes).toHaveLength(1);   // asked once

    await runShoppingTimeline(ctx as any, at(29, 17, 45));
    expect(wakes[1].data.slot).toBe("heads_up");
    expect(wakes[1].message).toContain("Anything to cancel or add?");
    const card = wakes[1].data.card;
    expect(card.type).toBe("MiniApp");
    expect(card.children[0]).toMatchObject({ type: "Checklist", props: { items: [{ label: "Palak", done: true }] } });

    await runShoppingTimeline(ctx as any, at(29, 18, 0));
    expect(wakes[2].data).toMatchObject({ slot: "price", services: ["zepto", "zomato-blinkit", "bigbasket"], let_go_at: "2026-10-29T21:00" });
    expect(wakes[2].message).toContain(`add_quote {cart_id: "${wakes[2].data.cart_id}"`);
    expect(wakes[2].message).toContain("explicit yes");

    await runShoppingTimeline(ctx as any, at(29, 21, 0));
    expect(wakes).toHaveLength(3);   // let go without a word
    const cart = (await cartRows(call)).find((c) => c.id === wakes[0].data.cart_id);
    expect(cart.status).toBe("let_go");
  });

  it("never more than three messages in a window, however often it ticks", async () => {
    const { wakes, ctx } = await boot();
    for (let t = at(28, 12, 0).getTime(); t <= at(29, 22, 0).getTime(); t += 15 * 60_000) await runShoppingTimeline(ctx as any, new Date(t));
    expect(wakes.map((w) => w.data.slot)).toEqual(["reminder", "heads_up", "price"]);
  });

  it("a draft that appears late (an overdue item, ordered now) gets no reminder and no heads-up: only the price step", async () => {
    const { call, wakes, ctx } = await boot();
    await call("POST", "/api/_data/groceries", { item: "Milk", category: "dairy", needed_by: "2026-10-29", source: "manual", status: "pending" });
    await runShoppingTimeline(ctx as any, at(29, 10, 0));
    expect(wakes.map((w) => [w.data.slot, w.data.order_at])).toEqual([["price", "2026-10-29T10:00"]]);
  });

  it("after a let-go, the items' next draft gets no reminder straight away (no follow-up on silence)", async () => {
    const { wakes, ctx } = await boot();
    await runShoppingTimeline(ctx as any, at(29, 18, 0));
    await runShoppingTimeline(ctx as any, at(29, 21, 0));    // let go; Palak rolls to a Fri 06:30 draft
    await runShoppingTimeline(ctx as any, at(29, 21, 15));
    expect(wakes.map((w) => w.data.slot)).toEqual(["price"]);
    await runShoppingTimeline(ctx as any, at(30, 6, 30));    // heads-up fell in quiet hours; the price step still comes
    expect(wakes.map((w) => [w.data.slot, w.data.order_at])).toEqual([["price", "2026-10-29T18:00"], ["price", "2026-10-30T06:30"]]);
  });

  it("quiet hours hold a message until they end, and drop it once its moment is over", async () => {
    const { kit, wakes, ctx } = await boot();
    kit.sqlite.run(`INSERT INTO _settings (id, created_at, updated_at, key, value) VALUES ('s-r', '2026-01-01', '2026-01-01', 'shop.reminder_time', '"23:00"')`);
    await runShoppingTimeline(ctx as any, at(28, 23, 0));
    expect(wakes).toHaveLength(0);   // 22:30–06:30 is quiet
    await runShoppingTimeline(ctx as any, at(29, 6, 30));
    expect(wakes.map((w) => w.data.slot)).toEqual(["reminder"]);
  });

  it("a wake that never reached the agent is asked again next tick", async () => {
    const { kit, wakes, ctx } = await boot(false);
    await runShoppingTimeline(ctx as any, at(28, 20, 0));
    await runShoppingTimeline(ctx as any, at(28, 20, 15));
    expect(wakes.map((w) => w.data.slot)).toEqual(["reminder", "reminder"]);
    expect(kit.sqlite.query("SELECT count(*) AS n FROM message_log").get()).toEqual({ n: 0 });
  });

  it("no messages for a draft a family member already said yes to", async () => {
    const { kit, call, wakes, ctx } = await boot();
    await runShoppingTimeline(ctx as any, at(28, 9, 0));
    const cart = (await cartRows(call))[0];
    kit.db.update(cartsTable).set({ yes_at: at(28, 9, 0).toISOString() }).where(eq(cartsTable.id, cart.id)).run();
    await runShoppingTimeline(ctx as any, at(28, 20, 0));
    await runShoppingTimeline(ctx as any, at(29, 17, 45));
    expect(wakes).toHaveLength(0);
  });

  it("remembers its own routine id, so the app's 'Order with …' can wake it", async () => {
    const { ctx, dataDir } = await boot();
    await runShoppingTimeline(ctx as any, at(28, 9, 0));
    expect(readRoutineId(dataDir)).toBe("test-routine");
  });
});
