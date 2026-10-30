// recalcTimeline against a real (in-memory) kit database: staples spawning their own grocery rows, items batching
// into one draft, drafts staying live until a yes, and a draft with no yes in time being let go.
import { describe, it, expect } from "bun:test";
import { mkdtempSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { Hono } from "hono";
import { mountKit } from "@flock/app-kit";
import { eq } from "drizzle-orm";
import * as schema from "./db/schema";
import { carts } from "./db/schema";
import { SETTINGS } from "./db/constants";
import { recalcTimeline } from "./timeline";
import { letGoExpired } from "./shopping";
import { requestMessage } from "./messages";

async function boot() {
  const hono = new Hono();
  const dataDir = mkdtempSync(join(tmpdir(), "planner-timeline-"));
  const kit = await mountKit({ hono, env: { appId: "t", dataDir, apiUrl: null, token: null, agent: null } },
    { schema, dbFile: ":memory:", appName: "T", settings: SETTINGS, privateTables: { prep_reminders: "server-only" } });
  const call = async (method: string, path: string, body?: unknown) => {
    const r = await hono.request(path, { method, headers: { "Content-Type": "application/json", "X-Flock-User": "tester" }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, body: (await r.json()) as any };
  };
  return { kit, call };
}

describe("recalcTimeline", () => {
  it("spawns a grocery row for a staple due today, with no prior row for it", async () => {
    const { kit, call } = await boot();
    await call("POST", "/api/_data/staples", { item: "Buffalo milk", category: "dairy", every_min_days: 1 });
    recalcTimeline(kit.db, kit.settings, 7, new Date(2026, 9, 29));
    const groceries = (await call("GET", "/api/_data/groceries?limit=50")).body.rows;
    expect(groceries.some((g: any) => g.item === "Buffalo milk" && g.source === "staple")).toBe(true);
  });

  it("never spawns a grocery row for a pantry or spices staple, however overdue its own check is", async () => {
    const { kit, call } = await boot();
    await call("POST", "/api/_data/staples", { item: "Toor dal", category: "pantry", last_checked_at: "2026-10-01T00:00:00.000Z" });
    await call("POST", "/api/_data/staples", { item: "Garam masala", category: "spices", last_checked_at: "2026-10-01T00:00:00.000Z" });
    recalcTimeline(kit.db, kit.settings, 7, new Date(2026, 9, 29));
    const groceries = (await call("GET", "/api/_data/groceries?limit=50")).body.rows;
    expect(groceries.some((g: any) => g.item === "Toor dal" || g.item === "Garam masala")).toBe(false);
  });

  it("a same-day item joins the live draft; once a family member said yes, it goes on a new draft instead", async () => {
    const { kit, call } = await boot();
    const now = new Date(2026, 9, 29);
    await call("POST", "/api/_data/groceries", { item: "Palak", category: "vegetables", needed_by: "2026-10-29", source: "meal", status: "pending" });
    recalcTimeline(kit.db, kit.settings, 7, now);
    await call("POST", "/api/_data/groceries", { item: "Onion", category: "vegetables", needed_by: "2026-10-29", source: "meal", status: "pending" });
    recalcTimeline(kit.db, kit.settings, 7, now);
    let all = (await call("GET", "/api/_data/carts?limit=50")).body.rows as any[];
    expect(all).toHaveLength(1);
    expect(all[0].status).toBe("draft");

    kit.db.update(carts).set({ yes_at: now.toISOString() }).where(eq(carts.id, all[0].id)).run();
    await call("POST", "/api/_data/groceries", { item: "Curd", category: "dairy", needed_by: "2026-10-29", source: "meal", status: "pending" });
    recalcTimeline(kit.db, kit.settings, 7, now);
    all = (await call("GET", "/api/_data/carts?limit=50")).body.rows as any[];
    expect(all).toHaveLength(2);
    const groceries = (await call("GET", "/api/_data/groceries?limit=50")).body.rows as any[];
    const cartOf = (item: string) => groceries.find((g) => g.item === item).cart_id;
    expect(cartOf("Palak")).toBe(cartOf("Onion"));
    expect(cartOf("Curd")).not.toBe(cartOf("Palak"));   // never added under an order being placed
  });

  it("keeps a draft's identity when its meals move to another day (its message budget follows it)", async () => {
    const { kit, call } = await boot();
    const now = new Date(2026, 9, 28, 9, 0);
    const g = (await call("POST", "/api/_data/groceries", { item: "Palak", category: "vegetables", needed_by: "2026-10-30", source: "meal", status: "pending" })).body.row;
    recalcTimeline(kit.db, kit.settings, 7, now);
    const before = (await call("GET", "/api/_data/carts?limit=50")).body.rows[0];
    await call("PATCH", `/api/_data/groceries/${g.id}`, { needed_by: "2026-11-01" });
    recalcTimeline(kit.db, kit.settings, 7, now);
    const after = (await call("GET", "/api/_data/carts?limit=50")).body.rows as any[];
    expect(after).toHaveLength(1);
    expect(after[0].id).toBe(before.id);
    expect(after[0].buy_at).toBe("2026-10-31T18:00");
  });

  it("an opened window keeps its time: an overdue item's 'now' slot never drags the draft along", async () => {
    const { kit, call } = await boot();
    await call("POST", "/api/_data/groceries", { item: "Milk", category: "dairy", needed_by: "2026-10-27", source: "manual", status: "pending" });
    recalcTimeline(kit.db, kit.settings, 7, new Date(2026, 9, 28, 9, 0));
    expect((await call("GET", "/api/_data/carts?limit=50")).body.rows[0].buy_at).toBe("2026-10-28T09:00");
    recalcTimeline(kit.db, kit.settings, 7, new Date(2026, 9, 28, 9, 45));
    const cart = (await call("GET", "/api/_data/carts?limit=50")).body.rows[0];
    expect(cart.buy_at).toBe("2026-10-28T09:00");
    expect(cart.order_at).toBe("2026-10-28T09:00");
  });

  it("an item added to a draft with no due date of its own stays on that draft", async () => {
    const { kit, call } = await boot();
    const now = new Date(2026, 9, 28, 9, 0);
    await call("POST", "/api/_data/groceries", { item: "Palak", category: "vegetables", needed_by: "2026-10-31", source: "meal", status: "pending" });
    await call("POST", "/api/_data/groceries", { item: "Milk", category: "dairy", needed_by: "2026-10-29", source: "meal", status: "pending" });
    recalcTimeline(kit.db, kit.settings, 7, now);
    const later = ((await call("GET", "/api/_data/carts?limit=50")).body.rows as any[]).sort((a, b) => (a.buy_at < b.buy_at ? 1 : -1))[0];
    const curd = (await call("POST", "/api/_data/groceries", { item: "Curd", source: "manual", status: "pending", cart_id: later.id, buy_at: later.buy_at })).body.row;
    recalcTimeline(kit.db, kit.settings, 7, now);
    expect((await call("GET", `/api/_data/groceries/${curd.id}`)).body.row.cart_id).toBe(later.id);
  });

  it("a staple the family removed from a draft doesn't come straight back", async () => {
    const { kit, call } = await boot();
    const now = new Date(2026, 9, 29);
    await call("POST", "/api/_data/staples", { item: "Buffalo milk", category: "dairy", every_min_days: 1 });
    recalcTimeline(kit.db, kit.settings, 7, now);
    const row = (await call("GET", "/api/_data/groceries?limit=50")).body.rows[0];
    await call("PATCH", `/api/_data/groceries/${row.id}`, { status: "skipped" });
    recalcTimeline(kit.db, kit.settings, 7, now);
    const rows = (await call("GET", "/api/_data/groceries?limit=50")).body.rows as any[];
    expect(rows).toHaveLength(1);
  });

  it("never duplicates a staple's grocery row while one is still open", async () => {
    const { kit, call } = await boot();
    await call("POST", "/api/_data/staples", { item: "Buffalo milk", category: "dairy", every_min_days: 1 });
    const now = new Date(2026, 9, 29);
    recalcTimeline(kit.db, kit.settings, 7, now);
    recalcTimeline(kit.db, kit.settings, 7, now);
    const groceries = (await call("GET", "/api/_data/groceries?limit=50")).body.rows;
    expect(groceries.filter((g: any) => g.item === "Buffalo milk").length).toBe(1);
  });

  it("batches a dairy item and a same-day vegetable into one cart", async () => {
    const { kit, call } = await boot();
    const now = new Date(2026, 9, 29);
    // Genuinely the same calendar day as the dairy staple (due "today"): a vegetable due the next day instead must NOT
    // be swept in just because vegetables' own 2-day fresh window reaches that far from a different category's order.
    await call("POST", "/api/_data/groceries", { item: "Palak", category: "vegetables", needed_by: "2026-10-29", source: "meal", status: "pending" });
    await call("POST", "/api/_data/staples", { item: "Buffalo milk", category: "dairy", every_min_days: 1 });
    recalcTimeline(kit.db, kit.settings, 7, now);
    const groceries = (await call("GET", "/api/_data/groceries?limit=50")).body.rows as any[];
    const palak = groceries.find((g) => g.item === "Palak"), dairy = groceries.find((g) => g.item === "Buffalo milk");
    expect(palak.cart_id).toBeTruthy();
    expect(palak.cart_id).toBe(dairy.cart_id);
    const carts = (await call("GET", "/api/_data/carts?limit=50")).body.rows as any[];
    expect(carts).toHaveLength(1);
    expect(carts[0].status).toBe("draft");
  });

  it("pulls a reused cart's own buy_at earlier when a later pass finds a more urgent item for the same calendar day", async () => {
    const { kit, call } = await boot();
    // Pass 1: an item due tomorrow lands on its preferred evening slot, today 18:00 (still well ahead of it).
    await call("POST", "/api/_data/groceries", { item: "Palak", category: "vegetables", needed_by: "2026-10-29", source: "meal", status: "pending" });
    recalcTimeline(kit.db, kit.settings, 7, new Date(2026, 9, 28, 9, 0));
    const firstPass = (await call("GET", "/api/_data/carts?limit=50")).body.rows as any[];
    expect(firstPass).toHaveLength(1);
    expect(firstPass[0].buy_at).toBe("2026-10-28T18:00");

    // Pass 2, an hour later: a second item needed TODAY shows up and floors to right now — earlier, on the very
    // same calendar day, than the cart's own recorded 18:00. The cart must track that earlier deadline, not
    // silently keep the later one it was created with (the bug: only `categories` used to be updated on reuse).
    await call("POST", "/api/_data/groceries", { item: "Buffalo milk", category: "dairy", needed_by: "2026-10-28", source: "manual", status: "pending" });
    recalcTimeline(kit.db, kit.settings, 7, new Date(2026, 9, 28, 10, 0));
    const carts = (await call("GET", "/api/_data/carts?limit=50")).body.rows as any[];
    expect(carts).toHaveLength(1);
    expect(carts[0].buy_at).toBe("2026-10-28T10:00");
    const groceries = (await call("GET", "/api/_data/groceries?limit=50")).body.rows as any[];
    expect(groceries.every((g: any) => g.buy_at === "2026-10-28T10:00")).toBe(true);
  });

  it("raises a live draft's buy_at back up once the item that justified the earlier time is gone", async () => {
    const { kit, call } = await boot();
    // Pass 1: an item due tomorrow (Oct 31), checked after its own preferred evening slot already passed, floors
    // to the morning cutoff on its own day.
    const a = (await call("POST", "/api/_data/groceries", { item: "Palak", category: "vegetables", needed_by: "2026-10-31", source: "meal", status: "pending" })).body.row;
    recalcTimeline(kit.db, kit.settings, 7, new Date(2026, 9, 30, 20, 0));
    const firstPass = (await call("GET", "/api/_data/carts?limit=50")).body.rows as any[];
    expect(firstPass).toHaveLength(1);
    expect(firstPass[0].buy_at).toBe("2026-10-31T06:30");
    expect(firstPass[0].status).toBe("draft");

    // Pass 2: that item is bought elsewhere (no longer open) — nothing left justifies the early time — and a
    // genuinely later item lands on the very same calendar day via its own evening-before preference. The draft
    // (live, so every one of its rows was re-planned this pass) must rise to match, not stay stuck.
    await call("PATCH", `/api/_data/groceries/${a.id}`, { status: "skipped" });
    await call("POST", "/api/_data/groceries", { item: "Onion", category: "vegetables", needed_by: "2026-11-01", source: "meal", status: "pending" });
    recalcTimeline(kit.db, kit.settings, 7, new Date(2026, 9, 30, 21, 0));
    const carts = (await call("GET", "/api/_data/carts?limit=50")).body.rows as any[];
    expect(carts).toHaveLength(1);
    expect(carts[0].buy_at).toBe("2026-10-31T18:00");
  });

  it("drops a draft once its only item is marked ordered elsewhere and nothing replaces it", async () => {
    const { kit, call } = await boot();
    const now = new Date(2026, 9, 29);
    const g = (await call("POST", "/api/_data/groceries", { item: "Palak", category: "vegetables", needed_by: "2026-10-30", source: "meal", status: "pending" })).body.row;
    recalcTimeline(kit.db, kit.settings, 7, now);
    const before = (await call("GET", "/api/_data/carts?limit=50")).body.rows as any[];
    expect(before).toHaveLength(1);
    await call("PATCH", `/api/_data/groceries/${g.id}`, { status: "ordered" });   // bought elsewhere: recalc should let its draft go
    recalcTimeline(kit.db, kit.settings, 7, now);
    const after = (await call("GET", "/api/_data/carts?limit=50")).body.rows as any[];
    expect(after).toHaveLength(0);
  });

  it("leaves a draft the owner moved where it is", async () => {
    const { kit, call } = await boot();
    const now = new Date(2026, 9, 29);
    await call("POST", "/api/_data/groceries", { item: "Palak", category: "vegetables", needed_by: "2026-10-30", source: "meal", status: "pending" });
    recalcTimeline(kit.db, kit.settings, 7, now);
    const cart = (await call("GET", "/api/_data/carts?limit=50")).body.rows[0];
    kit.db.update(carts).set({ buy_at: "2026-10-30T07:00", order_at: "2026-10-30T07:00", moved_at: now.toISOString() }).where(eq(carts.id, cart.id)).run();
    recalcTimeline(kit.db, kit.settings, 7, now);
    const all = (await call("GET", "/api/_data/carts?limit=50")).body.rows as any[];
    expect(all).toHaveLength(1);
    expect(all[0].order_at).toBe("2026-10-30T07:00");
  });

  it("keeps an emptied draft the family was already messaged about (the routine lets it go at its time)", async () => {
    const { kit, call } = await boot();
    const now = new Date(2026, 9, 29);
    const g = (await call("POST", "/api/_data/groceries", { item: "Palak", category: "vegetables", needed_by: "2026-10-30", source: "meal", status: "pending" })).body.row;
    recalcTimeline(kit.db, kit.settings, 7, now);
    const cart = (await call("GET", "/api/_data/carts?limit=50")).body.rows[0];
    requestMessage(kit.db, cart.id, "reminder", now);
    await call("PATCH", `/api/_data/groceries/${g.id}`, { status: "skipped" });
    recalcTimeline(kit.db, kit.settings, 7, now);
    expect((await call("GET", "/api/_data/carts?limit=50")).body.rows).toHaveLength(1);
  });

  it("leaves an item marked 'in stock until' a future date off the timeline, then schedules it once that date passes", async () => {
    const { kit, call } = await boot();
    const now = new Date(2026, 9, 29);
    const g = (await call("POST", "/api/_data/groceries", { item: "Rice", category: "pantry", needed_by: "2026-10-30", in_stock_until: "2026-11-05", source: "manual", status: "pending" })).body.row;
    recalcTimeline(kit.db, kit.settings, 7, now);
    const duringStock = (await call("GET", `/api/_data/groceries/${g.id}`)).body.row;
    expect(duringStock.cart_id).toBeNull();
    expect((await call("GET", "/api/_data/carts?limit=50")).body.rows).toHaveLength(0);

    recalcTimeline(kit.db, kit.settings, 7, new Date(2026, 10, 6));   // Nov 6: past the in_stock_until date
    const afterStock = (await call("GET", `/api/_data/groceries/${g.id}`)).body.row;
    expect(afterStock.cart_id).toBeTruthy();
  });
});

describe("letGoExpired", () => {
  it("lets a draft go silently once shop.yes_wait_h has passed with no yes; its open rows roll into the next draft", async () => {
    const { kit, call } = await boot();
    const g = (await call("POST", "/api/_data/groceries", { item: "Palak", category: "vegetables", needed_by: "2026-10-30", source: "meal", status: "pending" })).body.row;
    recalcTimeline(kit.db, kit.settings, 7, new Date(2026, 9, 29, 9, 0));
    const cart = (await call("GET", "/api/_data/carts?limit=50")).body.rows[0];
    expect(cart.order_at).toBe("2026-10-29T18:00");

    expect(letGoExpired(kit.db, kit.settings, new Date(2026, 9, 29, 20, 59))).toEqual([]);   // 3 h not up yet
    const now = new Date(2026, 9, 29, 21, 0);
    expect(letGoExpired(kit.db, kit.settings, now)).toEqual([cart.id]);
    const gone = (await call("GET", `/api/_data/carts/${cart.id}`)).body.row;
    expect(gone.status).toBe("let_go");
    expect(gone.let_go_at).toBeTruthy();
    const freed = (await call("GET", `/api/_data/groceries/${g.id}`)).body.row;
    expect(freed).toMatchObject({ cart_id: null, status: "pending" });
    const log = (await call("GET", "/api/_data/choice_log?limit=50")).body.rows as any[];
    expect(log.map((c) => [c.kind, c.source])).toEqual([["draft_let_go", "inferred"]]);

    recalcTimeline(kit.db, kit.settings, 7, now);
    const next = (await call("GET", `/api/_data/groceries/${g.id}`)).body.row;
    expect(next.cart_id).toBeTruthy();
    expect(next.cart_id).not.toBe(cart.id);
  });

  it("a yes keeps the draft while the order is placed; only a yes with no order for the same wait lets it go", async () => {
    const { kit, call } = await boot();
    await call("POST", "/api/_data/groceries", { item: "Palak", category: "vegetables", needed_by: "2026-10-30", source: "meal", status: "pending" });
    recalcTimeline(kit.db, kit.settings, 7, new Date(2026, 9, 29, 9, 0));
    const cart = (await call("GET", "/api/_data/carts?limit=50")).body.rows[0];
    kit.db.update(carts).set({ yes_at: new Date(2026, 9, 29, 20, 0).toISOString() }).where(eq(carts.id, cart.id)).run();
    expect(letGoExpired(kit.db, kit.settings, new Date(2026, 9, 29, 22, 0))).toEqual([]);
    expect(letGoExpired(kit.db, kit.settings, new Date(2026, 9, 29, 23, 0))).toEqual([cart.id]);
  });

  it("never touches an order, however old", async () => {
    const { kit, call } = await boot();
    const g = (await call("POST", "/api/_data/groceries", { item: "Palak", category: "vegetables", needed_by: "2026-10-01", source: "meal", status: "pending" })).body.row;
    recalcTimeline(kit.db, kit.settings, 7, new Date(2026, 9, 1));
    const cart = (await call("GET", "/api/_data/carts?limit=50")).body.rows[0];
    await call("PATCH", `/api/_data/carts/${cart.id}`, { status: "ordered" });
    await call("PATCH", `/api/_data/groceries/${g.id}`, { status: "ordered" });
    expect(letGoExpired(kit.db, kit.settings, new Date(2026, 9, 28))).toEqual([]);
    expect((await call("GET", `/api/_data/groceries/${g.id}`)).body.row.cart_id).toBe(cart.id);
  });
});
