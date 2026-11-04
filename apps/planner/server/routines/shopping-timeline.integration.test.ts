// End-to-end: the shoppingTimeline routine against a real (in-memory) kit database, with a fake ctx that records
// every wake and every notification instead of reaching the platform. `now` is pinned through runShoppingTimeline (the real body).
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
  const notes: string[] = [];
  const ctx = {
    wakeAgent: async (message: string, data?: unknown) => { wakes.push({ message, data }); return wakeOk ? { ok: true, data: {} } : { ok: false }; },
    notify: async (text: string) => { notes.push(text); return wakeOk ? { ok: true, data: { delivered: 1 } } : { ok: false }; },
    routine: { id: "test-routine" },
    platform: { dataDir },
    kit: { db: kit.db, sqlite: kit.sqlite, emitChange: (t: string, i: string, o: "insert" | "update" | "delete", b: string) => kit.emitChange(t, i, o, b) },
  };
  // Needed Fri Oct 30 → the draft orders Thu Oct 29 18:00 (buy.preferred_order_time, the evening before).
  await call("POST", "/api/_data/groceries", { item: "Palak", category: "vegetables", needed_by: "2026-10-30", source: "manual", status: "pending" });
  /** The window's messages as the app logged them, in order. */
  const slots = () => (kit.sqlite.query("SELECT slot FROM message_log ORDER BY requested_at").all() as { slot: string }[]).map((r) => r.slot);
  return { kit, call, wakes, notes, slots, ctx, dataDir };
}

const at = (day: number, h: number, m = 0) => new Date(2026, 9, day, h, m);
const cartRows = async (call: Awaited<ReturnType<typeof boot>>["call"]) => (await call("GET", "/api/_data/carts?limit=50")).body.rows as any[];

describe("shoppingTimeline: one window's three messages", () => {
  it("reminder the evening before and heads-up before the window from the app, price at it from the agent — each once, then the draft is let go silently", async () => {
    const { call, wakes, notes, slots, ctx } = await boot();
    await runShoppingTimeline(ctx as any, at(28, 19, 45));
    expect([wakes.length, notes.length]).toEqual([0, 0]);   // nothing due yet

    await runShoppingTimeline(ctx as any, at(28, 20, 0));
    expect(wakes).toHaveLength(0);                           // the reminder is the app's own: no model call
    expect(notes).toHaveLength(1);
    expect(notes[0]).toContain("Next grocery order 2026-10-29 18:00");
    expect(notes[0]).toContain("Palak");
    await runShoppingTimeline(ctx as any, at(28, 20, 15));
    expect(notes).toHaveLength(1);                           // sent once

    await runShoppingTimeline(ctx as any, at(29, 17, 45));
    expect(wakes).toHaveLength(0);
    expect(notes[1]).toContain("Anything to cancel or add?");
    expect(notes[1]).toContain("Palak");
    expect(notes[1]).toContain("otherwise the list stands");

    await runShoppingTimeline(ctx as any, at(29, 18, 0));
    expect(wakes).toHaveLength(1);                           // only the price step needs the agent
    expect(wakes[0].data).toMatchObject({ slot: "price", services: ["zepto", "zomato-blinkit", "bigbasket"], let_go_at: "2026-10-29T21:00" });
    expect(wakes[0].message).toContain(`add_quote {cart_id: "${wakes[0].data.cart_id}"`);
    expect(wakes[0].message).toContain("explicit yes");

    await runShoppingTimeline(ctx as any, at(29, 21, 0));
    expect([wakes.length, notes.length]).toEqual([1, 2]);    // let go without a word
    expect(slots()).toEqual(["reminder", "heads_up", "price"]);
    const cart = (await cartRows(call)).find((c) => c.id === wakes[0].data.cart_id);
    expect(cart.status).toBe("let_go");
  });

  it("never more than three messages in a window, and one model call, however often it ticks", async () => {
    const { wakes, slots, ctx } = await boot();
    for (let t = at(28, 12, 0).getTime(); t <= at(29, 22, 0).getTime(); t += 15 * 60_000) await runShoppingTimeline(ctx as any, new Date(t));
    expect(slots()).toEqual(["reminder", "heads_up", "price"]);
    expect(wakes).toHaveLength(1);
  });

  it("a draft that appears late (an overdue item, ordered now) gets no reminder and no heads-up: only the price step", async () => {
    const { call, wakes, notes, ctx } = await boot();
    await call("POST", "/api/_data/groceries", { item: "Milk", category: "dairy", needed_by: "2026-10-29", source: "manual", status: "pending" });
    await runShoppingTimeline(ctx as any, at(29, 10, 0));
    expect(wakes.map((w) => [w.data.slot, w.data.order_at])).toEqual([["price", "2026-10-29T10:00"]]);
    expect(notes).toHaveLength(0);
  });

  it("after a let-go, the items' next draft gets no reminder straight away (no follow-up on silence)", async () => {
    const { wakes, notes, ctx } = await boot();
    await runShoppingTimeline(ctx as any, at(29, 18, 0));
    await runShoppingTimeline(ctx as any, at(29, 21, 0));    // let go; Palak rolls to a Fri 06:30 draft
    await runShoppingTimeline(ctx as any, at(29, 21, 15));
    expect(wakes.map((w) => w.data.slot)).toEqual(["price"]);
    await runShoppingTimeline(ctx as any, at(30, 6, 30));    // heads-up fell in quiet hours; the price step still comes
    expect(wakes.map((w) => [w.data.slot, w.data.order_at])).toEqual([["price", "2026-10-29T18:00"], ["price", "2026-10-30T06:30"]]);
    expect(notes).toHaveLength(0);
  });

  it("quiet hours hold a message until they end, and drop it once its moment is over", async () => {
    const { kit, notes, slots, ctx } = await boot();
    kit.sqlite.run(`INSERT INTO _settings (id, created_at, updated_at, key, value) VALUES ('s-r', '2026-01-01', '2026-01-01', 'shop.reminder_time', '"23:00"')`);
    await runShoppingTimeline(ctx as any, at(28, 23, 0));
    expect(notes).toHaveLength(0);   // 22:30–06:30 is quiet
    await runShoppingTimeline(ctx as any, at(29, 6, 30));
    expect(slots()).toEqual(["reminder"]);
    expect(notes).toHaveLength(1);
  });

  it("a message that was never sent is tried again next tick", async () => {
    const { kit, notes, ctx } = await boot(false);
    await runShoppingTimeline(ctx as any, at(28, 20, 0));
    await runShoppingTimeline(ctx as any, at(28, 20, 15));
    expect(notes).toHaveLength(2);
    expect(kit.sqlite.query("SELECT count(*) AS n FROM message_log").get()).toEqual({ n: 0 });
  });

  it("no messages for a draft a family member already said yes to", async () => {
    const { kit, call, wakes, notes, ctx } = await boot();
    await runShoppingTimeline(ctx as any, at(28, 9, 0));
    const cart = (await cartRows(call))[0];
    kit.db.update(cartsTable).set({ yes_at: at(28, 9, 0).toISOString() }).where(eq(cartsTable.id, cart.id)).run();
    await runShoppingTimeline(ctx as any, at(28, 20, 0));
    await runShoppingTimeline(ctx as any, at(29, 17, 45));
    expect([wakes.length, notes.length]).toEqual([0, 0]);
  });

  it("remembers its own routine id, so the app's 'Order with …' can wake it", async () => {
    const { ctx, dataDir } = await boot();
    await runShoppingTimeline(ctx as any, at(28, 9, 0));
    expect(readRoutineId(dataDir)).toBe("test-routine");
  });
});
