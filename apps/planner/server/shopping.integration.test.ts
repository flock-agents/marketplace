// The v2 shopping endpoints and the quantity-engine bug fixes, against a real (in-memory) kit database.
import { describe, it, expect } from "bun:test";
import { mkdtempSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { Hono } from "hono";
import { mountKit } from "@flock/app-kit";
import * as schema from "./db/schema";
import { learned_prefs } from "./db/schema";
import { SETTINGS } from "./db/constants";
import { mountShoppingRoutes } from "./routes";
import { ensureMealGroceries } from "./mealGroceries";
import { seedFillFor, seedIngredientKnowledge } from "./db/ingredientSeed";
import { editDistance, fuzzyScore } from "./search";
import { migrateCartStatuses, rowReadiness, splitOnLetGo } from "./shopping";
import { requestMessage } from "./messages";
import type { WakeAgent } from "./routes";
import { istWeekdayHour, refreshOrderPatterns } from "./orderPatterns";

const ist = (day: number, h: number, m = 0) => new Date(Date.UTC(2026, 9, day, h, m) - 330 * 60_000);

const NOW = new Date(2026, 9, 28, 9, 0);   // Wed Oct 28, 2026 09:00

async function boot(wake?: WakeAgent) {
  const hono = new Hono();
  const dataDir = mkdtempSync(join(tmpdir(), "planner-v2-"));
  const kit = await mountKit({ hono, env: { appId: "t", dataDir, apiUrl: null, token: null, agent: null } },
    { schema, dbFile: ":memory:", appName: "T", settings: SETTINGS, privateTables: { prep_reminders: "server-only" } });
  mountShoppingRoutes(hono, kit.db, kit.settings, undefined, () => NOW, wake);
  const call = async (method: string, path: string, body?: unknown) => {
    const r = await hono.request(path, { method, headers: { "Content-Type": "application/json", "X-Flock-User": "tester" }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, body: (await r.json()) as any };
  };
  const rows = async (table: string) => (await call("GET", `/api/_data/${table}?limit=200`)).body.rows as any[];
  await call("POST", "/api/_data/diners", { name: "A" });
  await call("POST", "/api/_data/diners", { name: "B" });
  const onion = (await call("POST", "/api/_data/ingredients", { name: "Onion", category: "vegetables", default_unit: "g", unit_conversions: JSON.stringify({ pc: 150 }) })).body.row;
  const sambar = (await call("POST", "/api/_data/recipes", { name: "Sambar" })).body.row;
  await call("POST", "/api/_data/recipe_ingredients", { recipe_id: sambar.id, ingredient_id: onion.id, item: "Onion", qty: 1, unit: "pc", category: "vegetables" });
  const meal = async (date: string, slot = "Lunch", dish = "Sambar") => (await call("POST", "/api/_data/meals", { date, slot, dish, recipe_id: sambar.id })).body.row;
  return { kit, call, rows, onion, sambar, meal };
}

describe("quantity engine against the DB (audit bugs)", () => {
  it("never accumulates: repeated runs keep the same range", async () => {
    const { kit, rows, onion, meal } = await boot();
    await meal("2026-10-29");
    for (let i = 0; i < 5; i++) ensureMealGroceries(kit.db, 7, NOW);
    const mine = (await rows("groceries")).filter((r) => r.ingredient_id === onion.id);
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ qty_min: 300, qty_max: 500, qty_unit: "g", suggested_qty: "300–500 g" });
  });

  it("moving a meal moves its open row; deleting it removes the row", async () => {
    const { kit, call, rows, meal } = await boot();
    const m = await meal("2026-10-29");
    ensureMealGroceries(kit.db, 7, NOW);
    await call("PATCH", `/api/_data/meals/${m.id}`, { date: "2026-10-31" });
    ensureMealGroceries(kit.db, 7, NOW);
    let g = (await rows("groceries")).filter((r) => r.source === "meal");
    expect(g).toHaveLength(1);
    expect(g[0].needed_by).toBe("2026-10-31");
    await call("DELETE", `/api/_data/meals/${m.id}`);
    ensureMealGroceries(kit.db, 7, NOW);
    g = (await rows("groceries")).filter((r) => r.source === "meal");
    expect(g).toHaveLength(0);
  });

  it("a skipped row re-opens once the meal changes, and an ordered row is never re-added", async () => {
    const { kit, call, rows, meal } = await boot();
    const m = await meal("2026-10-29");
    ensureMealGroceries(kit.db, 7, NOW);
    const [row] = await rows("groceries");
    await call("PATCH", `/api/_data/groceries/${row.id}`, { status: "skipped" });
    ensureMealGroceries(kit.db, 7, NOW);
    expect((await rows("groceries"))[0].status).toBe("skipped");
    await call("PATCH", `/api/_data/meals/${m.id}`, { date: "2026-10-30" });
    ensureMealGroceries(kit.db, 7, NOW);
    expect((await rows("groceries"))[0]).toMatchObject({ status: "pending", needed_by: "2026-10-30" });
    await call("PATCH", `/api/_data/groceries/${row.id}`, { status: "ordered" });
    ensureMealGroceries(kit.db, 7, NOW);
    expect(await rows("groceries")).toHaveLength(1);
  });

  it("removes legacy accumulated meal rows that have no meal_id", async () => {
    const { kit, call, rows, onion, meal } = await boot();
    await call("POST", "/api/_data/groceries", { item: "Onion", ingredient_id: onion.id, source: "meal", status: "pending", needed_by: "2026-10-29", suggested_qty: "20805 g" });
    await meal("2026-10-29");
    ensureMealGroceries(kit.db, 7, NOW);
    const g = await rows("groceries");
    expect(g).toHaveLength(1);
    expect(g[0].suggested_qty).toBe("300–500 g");
  });
});

describe("GET /api/shopping/slots and the draft", () => {
  it("lists a draft covering both meals, with its span, one merged line per ingredient and a meal-time-aware deadline", async () => {
    const { call, onion, meal } = await boot();
    await meal("2026-10-29", "Lunch");
    await meal("2026-10-29", "Dinner", "Sambar");
    const { body } = await call("GET", "/api/shopping/slots");
    expect(body.slots).toHaveLength(1);
    const slot = body.slots[0];
    expect(slot).toMatchObject({ status: "draft", order_by: "2026-10-28T18:00", order_at: "2026-10-28T18:00", deadline: "2026-10-29T06:30" });
    expect(slot.span).toEqual({ from: { date: "2026-10-29", slot: "Lunch" }, to: { date: "2026-10-29", slot: "Dinner" }, label: "Thu lunch → Thu dinner" });
    expect(slot.covers[0].time).toBe("13:00");
    expect(slot.lines).toHaveLength(1);
    expect(slot.lines[0]).toMatchObject({ ingredient_id: onion.id, qty_min: 600, qty_max: 750, qty_unit: "g" });
  });

  it("GET /api/shopping/draft: the next draft with its span, ranges, window times and the message due next", async () => {
    const { call, meal } = await boot();
    expect((await call("GET", "/api/shopping/draft")).body).toEqual({ draft: null });
    await meal("2026-10-29", "Breakfast");
    await meal("2026-10-31", "Dinner");
    const d = (await call("GET", "/api/shopping/draft")).body.draft;
    expect(d.order_at).toBe("2026-10-28T18:00");
    expect(d.span.label).toBe("Thu breakfast → Sat dinner");   // Sat's onion keeps (vegetables: 2 days) from Wed 18:00
    expect(d.lines.map((l: any) => [l.item, l.range])).toEqual([["Onion", "600–750 g"]]);
    expect(d.times).toEqual({ reminder: "2026-10-27T20:00", heads_up: "2026-10-28T17:45", price: "2026-10-28T18:00", let_go: "2026-10-28T21:00" });
    expect(d.next_message).toEqual({ slot: "heads_up", due_at: "2026-10-28T17:45", due: false });   // made after its reminder moment: none
    expect(d).toMatchObject({ quotes: [], best: null, yes: null, moved: false, removed: [], messages: [] });
  });

  it("draft/items: remove skips the line for this draft, restore brings it back, add puts an item on it — each a logged choice", async () => {
    const { call, rows, onion, meal } = await boot();
    await meal("2026-10-29");
    const curd = (await call("POST", "/api/_data/ingredients", { name: "Curd", category: "dairy", default_unit: "g", aliases: JSON.stringify(["dahi"]) })).body.row;
    expect((await call("POST", "/api/shopping/draft/items", {})).status).toBe(400);

    let r = await call("POST", "/api/shopping/draft/items", { remove: ["onion"] });
    expect(r.body).toMatchObject({ ok: true, removed: ["Onion"], unknown: [] });
    expect(r.body.draft.lines).toEqual([]);
    expect(r.body.draft.removed).toEqual([{ key: onion.id, ingredient_id: onion.id, item: "Onion" }]);

    r = await call("POST", "/api/shopping/draft/items", { cart_id: r.body.cart_id, restore: [onion.id], add: [{ item: "dahi", qty: "500 g" }, { item: "Paper towels" }, { ingredient_id: "nope" }] });
    expect(r.body).toMatchObject({ restored: ["Onion"], added: ["Curd", "Paper towels"], unknown: ["nope"] });
    expect(r.body.draft.lines.map((l: any) => l.item).sort()).toEqual(["Curd", "Onion", "Paper towels"]);
    const added = (await rows("groceries")).find((g) => g.item === "Curd");
    expect(added).toMatchObject({ ingredient_id: curd.id, qty: "500 g", source: "manual", needed_by: null, cart_id: r.body.cart_id });

    // still on the draft after the plan recomputes; adding it again changes nothing
    r = await call("POST", "/api/shopping/draft/items", { add: [{ item: "Curd" }] });
    expect(r.body.added).toEqual([]);
    expect(r.body.draft.lines).toHaveLength(3);
    const log = (await rows("choice_log")).map((c) => `${c.kind}:${c.subject}`).sort();
    expect(log).toEqual([`item_added:${curd.id}`, "item_added:Paper towels", `item_dropped:${onion.id}`, `item_restored:${onion.id}`].sort());
  });

  it("windows/move: the owner's new time sticks through recomputes and names the meals it can't reach in time", async () => {
    const { call, meal } = await boot();
    await meal("2026-10-29", "Lunch");
    await meal("2026-10-30", "Dinner");
    const d = (await call("GET", "/api/shopping/draft")).body.draft;
    expect((await call("POST", "/api/shopping/windows/move", { cart_id: d.id, order_at: "tomorrow" })).status).toBe(400);
    expect((await call("POST", "/api/shopping/windows/move", { cart_id: d.id, order_at: "2026-10-27T10:00" })).status).toBe(400);
    const r = await call("POST", "/api/shopping/windows/move", { order_at: "2026-10-29T12:30" });
    expect(r.body.late.map((m: any) => `${m.date} ${m.slot}`)).toEqual(["2026-10-29 Lunch"]);
    expect(r.body.draft).toMatchObject({ id: d.id, order_at: "2026-10-29T12:30", moved: true });
    expect((await call("GET", "/api/shopping/draft")).body.draft.order_at).toBe("2026-10-29T12:30");
  });

  it("quotes: one per service, the best is the cheapest grand total unless a learned service rule says otherwise; a changed draft makes them stale", async () => {
    const { kit, call, meal } = await boot();
    await meal("2026-10-29");
    const d = (await call("GET", "/api/shopping/draft")).body.draft;
    expect((await call("POST", `/api/carts/${d.id}/quotes`, { service: "zepto" })).status).toBe(400);
    expect((await call("POST", "/api/carts/nope/quotes", { service: "zepto", total: 1 })).status).toBe(404);
    await call("POST", `/api/carts/${d.id}/quotes`, { service: "zepto", total: 260, screenshot_url: "https://x/z.png" });
    await call("POST", `/api/carts/${d.id}/quotes`, { service: "bigbasket", total: 240, fees: { delivery: 30 } });
    let q = await call("POST", `/api/carts/${d.id}/quotes`, { service: "zepto", total: 250, lines: [{ name: "Onion 500 g", qty: 1, price: 40 }] });
    expect(q.body.quotes.map((x: any) => [x.service, x.total])).toEqual([["bigbasket", 240], ["zepto", 250]]);
    expect(q.body.best).toEqual({ service: "bigbasket", total: 240, reason: "cheapest" });

    kit.db.insert(learned_prefs).values({ kind: "service", summary: "Zepto unless ₹50+ cheaper elsewhere", rule: JSON.stringify({ service: "zepto", unless_cheaper_by: 50 }), auto_apply: true, found_at: NOW.toISOString() }).run();
    q = await call("POST", `/api/carts/${d.id}/quotes`, { service: "zepto", total: 280 });
    expect(q.body.best).toEqual({ service: "zepto", total: 280, reason: "learned" });
    const cart = (await call("GET", `/api/_data/carts/${d.id}`)).body.row;
    expect(cart).toMatchObject({ chosen_service: "zepto", grand_total: 280 });

    await call("POST", "/api/shopping/draft/items", { add: [{ item: "Bread" }] });
    const view = (await call("GET", "/api/shopping/draft")).body.draft;
    expect(view.quotes.every((x: any) => x.stale)).toBe(true);
    expect(view.best).toBeNull();
  });

  it("a yes freezes the draft for the order; ordered keeps a frozen snapshot, logs the pick and records the purchase", async () => {
    const { call, rows, onion, meal } = await boot();
    await meal("2026-10-29");
    const d = (await call("GET", "/api/shopping/draft")).body.draft;
    await call("POST", `/api/carts/${d.id}/quotes`, { service: "zepto", total: 45, lines: [{ name: "Onion 500 g", pack: "500 g", qty: 1, price: 40 }], screenshot_url: "https://x/z.png" });
    const y = await call("POST", `/api/carts/${d.id}/yes`, { service: "zepto", by: "Asha" });
    expect(y.body).toEqual({ ok: true, service: "zepto" });
    expect((await call("GET", "/api/shopping/draft")).body.draft.yes).toMatchObject({ by: "Asha" });
    expect((await call("POST", "/api/shopping/draft/items", { remove: ["Onion"] })).body.reason).toBe("yes_given");

    expect((await call("POST", "/api/carts/nope/ordered", { service: "zepto" })).status).toBe(404);
    const o = await call("POST", `/api/carts/${d.id}/ordered`, { service: "zepto", total: 45, order_ref: "Z-1", delivery_eta: null });
    expect(o.body).toMatchObject({ ok: true, status: "ordered", rows_ordered: 1 });
    expect((await rows("groceries")).every((g) => g.status === "ordered")).toBe(true);
    expect((await rows("ingredients")).find((i) => i.id === onion.id).last_ordered_qty).toBe(500);
    const cart = (await rows("carts")).find((c) => c.id === d.id);
    expect(cart).toMatchObject({ status: "ordered", order_ref: "Z-1", grand_total: 45 });
    expect(JSON.parse(cart.snapshot)).toMatchObject({ service: "zepto", total: 45, screenshot_url: "https://x/z.png", lines: [{ name: "Onion 500 g" }], span: { label: "Thu lunch" } });
    expect((await rows("choice_log")).map((c) => [c.kind, c.subject, c.source])).toEqual([["service_picked", "zepto", "owner"]]);
    expect((await call("GET", "/api/shopping/draft")).body.draft).toBeNull();   // the order covers the need
  });

  it("let-go: the owner's 'Let it go' releases the items to the next draft; a let-go draft can't be ordered", async () => {
    const { call, rows, meal } = await boot();
    await meal("2026-10-29");
    const d = (await call("GET", "/api/shopping/draft")).body.draft;
    const r = await call("POST", `/api/carts/${d.id}/let-go`);
    expect(r.body).toEqual({ ok: true, rows_released: 1, rows_dropped: 0 });   // no later draft planned yet: nothing to judge against, all wait
    expect((await call("POST", `/api/carts/${d.id}/let-go`)).status).toBe(409);
    expect((await call("POST", `/api/carts/${d.id}/ordered`, { service: "zepto" })).body.reason).toBe("cart_let_go");
    const next = (await call("GET", "/api/shopping/draft")).body.draft;
    expect(next.id).not.toBe(d.id);
    expect(next.lines).toHaveLength(1);
    expect((await rows("choice_log")).map((c) => [c.kind, c.source])).toEqual([["draft_let_go", "owner"]]);
  });

  it("order: the owner's in-app yes is recorded and wakes the agent; a wake that fails takes it back", async () => {
    const wakes: { message: string; data: any }[] = [];
    const { call, meal } = await boot(async (message, data) => { wakes.push({ message, data }); return { ok: true }; });
    await meal("2026-10-29");
    const d = (await call("GET", "/api/shopping/draft")).body.draft;
    expect((await call("POST", `/api/carts/${d.id}/order`, {})).status).toBe(400);
    const r = await call("POST", `/api/carts/${d.id}/order`, { service: "zepto" });
    expect(r.body).toEqual({ ok: true, service: "zepto" });
    expect(wakes).toHaveLength(1);
    expect(wakes[0].message).toContain("tester said yes in the app");
    expect(wakes[0].data).toMatchObject({ cart_id: d.id, service: "zepto", by: "tester" });
    expect((await call("GET", "/api/shopping/draft")).body.draft.yes.by).toBe("tester");

    const down = await boot(async () => ({ ok: false, reason: "not_configured" }));
    await down.meal("2026-10-29");
    const dd = (await down.call("GET", "/api/shopping/draft")).body.draft;
    const failedYes = await down.call("POST", `/api/carts/${dd.id}/order`, { service: "zepto" });
    expect([failedYes.status, failedYes.body.reason]).toEqual([502, "not_configured"]);
    expect((await down.call("GET", "/api/shopping/draft")).body.draft.yes).toBeNull();   // the yes is taken back

    const other = await boot();
    await other.meal("2026-10-29");
    const od = (await other.call("GET", "/api/shopping/draft")).body.draft;
    expect((await other.call("POST", `/api/carts/${od.id}/order`, { service: "zepto" })).body.reason).toBe("not_ready");
    expect((await other.call("GET", "/api/shopping/draft")).body.draft.yes).toBeNull();
  });

  it("messages/:id/sent acks a message the app asked for", async () => {
    const { kit, call, meal } = await boot();
    await meal("2026-10-29");
    const d = (await call("GET", "/api/shopping/draft")).body.draft;
    const id = requestMessage(kit.db, d.id, "reminder", NOW)!;
    expect((await call("POST", "/api/messages/nope/sent")).status).toBe(404);
    const r = await call("POST", `/api/messages/${id}/sent`);
    expect(r.body.message).toMatchObject({ id, slot: "reminder", sent_at: NOW.toISOString() });
    expect((await call("GET", "/api/shopping/draft")).body.draft.next_message).toMatchObject({ slot: "heads_up", due: false, due_at: "2026-10-28T17:45" });
  });

  it("migrateCartStatuses maps every v2 state and is idempotent", async () => {
    const { kit, call, rows } = await boot();
    for (const status of ["upcoming", "discussed", "building", "awaiting_yes", "ordered", "skipped", "missed"]) await call("POST", "/api/_data/carts", { buy_at: "2026-10-27T18:00", status });
    migrateCartStatuses(kit.db);
    migrateCartStatuses(kit.db);
    expect((await rows("carts")).map((c) => c.status).sort()).toEqual(["draft", "draft", "draft", "draft", "let_go", "let_go", "ordered"]);
  });
});

describe("GET /api/meals/:id/readiness", () => {
  it("missing → ordering → ready as the meal's groceries move through a cart", async () => {
    const { call, meal } = await boot();
    const m = await meal("2026-10-29", "Dinner");
    const slot = (await call("GET", "/api/shopping/slots")).body.slots[0];
    let r = (await call("GET", `/api/meals/${m.id}/readiness`)).body;
    expect(r).toMatchObject({ status: "ordering", time: "19:00", deadline: "2026-10-29T18:00" });
    expect(r.items).toHaveLength(1);
    expect(r.ingredients).toEqual([{ name: "Onion", need: "300–500 g", in_stock: false, status: "ordering" }]);
    expect(r.cart).toMatchObject({ id: slot.id, status: "draft", buy_at: "2026-10-28T18:00", order_at: "2026-10-28T18:00" });
    await call("POST", `/api/carts/${slot.id}/ordered`, { service: "zepto" });
    r = (await call("GET", `/api/meals/${m.id}/readiness`)).body;
    expect(r.status).toBe("ready");
    expect((await call("GET", "/api/meals/nope/readiness")).status).toBe(404);
  });
  it("GET /api/meals/readiness?ids= gives the same status as the per-meal route", async () => {
    const { call, meal } = await boot();
    const m = await meal("2026-10-29", "Dinner");
    expect((await call("GET", `/api/meals/readiness?ids=${m.id}`)).body.statuses[m.id]).toBe("none");   // no rows yet
    await call("GET", "/api/shopping/slots");
    const one = (await call("GET", `/api/meals/${m.id}/readiness`)).body.status;
    expect(one).toBe("ordering");
    const many = (await call("GET", `/api/meals/readiness?ids=${m.id},nope`)).body;
    expect(many).toEqual({ statuses: { [m.id]: one } });
  });
  it("an item marked 'already have it' until a later date makes the meal ready", async () => {
    const { call, meal } = await boot();
    const m = await meal("2026-10-29", "Dinner");
    await call("GET", "/api/shopping/slots");
    const row = (await call("GET", `/api/meals/${m.id}/readiness`)).body.items[0];
    await call("PATCH", `/api/_data/groceries/${row.grocery_id}`, { in_stock_until: "2026-11-12", cart_id: null });
    const r = (await call("GET", `/api/meals/${m.id}/readiness`)).body;
    expect(r.status).toBe("ready");
    expect(r.ingredients[0].in_stock).toBe(true);
  });
  it("rowReadiness rules", () => {
    expect(rowReadiness("pending", false, null, null, "2026-10-28T09:00")).toBe("missing");
    expect(rowReadiness("pending", false, "draft", "2026-10-28T08:00", "2026-10-28T09:00")).toBe("missing");
    expect(rowReadiness("pending", false, "draft", "2026-10-28T10:00", "2026-10-28T09:00")).toBe("ordering");
    expect(rowReadiness("pending", false, "let_go", "2026-10-28T10:00", "2026-10-28T09:00")).toBe("missing");
    expect(rowReadiness("have_stock", false, null, null, "x")).toBe("ready");
    expect(rowReadiness("skipped", false, "draft", null, "x")).toBe("missing");
  });
});

describe("GET /api/search", () => {
  it("finds ingredients by Hindi alias with a typo, plus dishes, recipes, pantry and orders", async () => {
    const { kit, call, meal } = await boot();
    await call("POST", "/api/_data/ingredients", { name: "Spinach", category: "leafy_greens" });
    await call("POST", "/api/_data/staples", { item: "Basmati rice", category: "pantry" });
    seedIngredientKnowledge(kit.db);
    await meal("2026-10-29");
    let res = (await call("GET", "/api/search?q=plak")).body.results;
    expect(res[0]).toMatchObject({ kind: "ingredient", title: "Spinach", matched: "palak" });
    res = (await call("GET", "/api/search?q=pyaz")).body.results;
    expect(res[0]).toMatchObject({ kind: "ingredient", title: "Onion" });
    res = (await call("GET", "/api/search?q=samba")).body.results;
    expect(res.map((r: any) => r.kind).sort()).toEqual(["dish", "recipe"]);
    expect((await call("GET", "/api/search?q=basmti")).body.results[0]).toMatchObject({ kind: "pantry", title: "Basmati rice", meta: "pantry" });
    await call("POST", "/api/_data/carts", { buy_at: "2026-10-28T18:00", status: "ordered", chosen_service: "zepto", order_ref: "Z-99" });
    expect((await call("GET", "/api/search?q=zepto")).body.results[0].kind).toBe("order");
    expect((await call("GET", "/api/search?q=")).body.results).toEqual([]);
  });
  it("fuzzyScore ranks exact > prefix > substring > typo, and rejects far-off strings", () => {
    expect(fuzzyScore("onion", "Onion")).toBe(100);
    expect(fuzzyScore("oni", "Onion")).toBe(90);
    expect(fuzzyScore("paneer", "Palak paneer")).toBe(80);
    expect(fuzzyScore("tamtar", "tamatar")).toBeGreaterThan(0);
    expect(fuzzyScore("xyz", "onion")).toBe(0);
    expect(editDistance("plak", "palak")).toBe(1);
  });
});

describe("seed migration and pantry levels", () => {
  it("fills only nulls and is idempotent", async () => {
    const { kit, call, rows } = await boot();
    await call("POST", "/api/_data/ingredients", { name: "Tomatoes", aliases: JSON.stringify(["mine"]) });
    expect(seedIngredientKnowledge(kit.db)).toBeGreaterThan(0);
    expect(seedIngredientKnowledge(kit.db)).toBe(0);
    const ing = await rows("ingredients");
    const tomato = ing.find((i) => i.name === "Tomatoes");
    expect(JSON.parse(tomato.aliases)).toEqual(["mine"]);
    expect(JSON.parse(tomato.unit_conversions)).toEqual({ pc: 100 });
    const onion = ing.find((i) => i.name === "Onion");
    expect(JSON.parse(onion.unit_conversions)).toEqual({ pc: 150 });   // user value kept
    expect(onion.shelf_life_days).toBe(21);
    expect((await rows("shopping_prefs"))[0].id).toBe("household");
    expect(seedFillFor({ id: "x", name: "Unobtainium", aliases: null, unit_conversions: null, shelf_life_days: null })).toBeNull();
  });

});

describe("learned order windows in planning", () => {
  const dinnerAt21 = async (ctx: Awaited<ReturnType<typeof boot>>) => {
    const m = await ctx.meal("2026-10-30", "Dinner");
    await ctx.call("PATCH", `/api/_data/meals/${m.id}`, { time: "21:00" });
    return m;
  };
  const orderedAt = async (ctx: Awaited<ReturnType<typeof boot>>, d: Date) =>
    ctx.call("POST", "/api/_data/carts", { buy_at: "2026-10-01T18:00", status: "ordered", ordered_at: d.toISOString() });

  it("learns an 18:00 window from history; a 21:00 dinner orders at 18:00 that day", async () => {
    const ctx = await boot();
    for (const day of [20, 21, 22, 23]) await orderedAt(ctx, ist(day, 18, 15));
    refreshOrderPatterns(ctx.kit.db, NOW);
    const p = (await ctx.call("GET", "/api/shopping/patterns")).body;
    expect(p.windows).toEqual([expect.objectContaining({ from: "18:00", source: "learned", sample_count: 4 })]);
    expect(p.last_computed_at).toBeTruthy();
    await dinnerAt21(ctx);
    const slot = (await ctx.call("GET", "/api/shopping/slots")).body.slots.find((s: any) => s.status !== "ordered");
    expect(slot).toMatchObject({ order_at: "2026-10-30T18:00", status: "draft", deadline: "2026-10-30T20:00" });
  });

  it("no learned window → settings fallback (the evening before, buy.preferred_order_time)", async () => {
    const ctx = await boot();
    refreshOrderPatterns(ctx.kit.db, NOW);
    expect((await ctx.call("GET", "/api/shopping/patterns")).body.windows).toEqual([]);
    await dinnerAt21(ctx);
    const slot = (await ctx.call("GET", "/api/shopping/slots")).body.slots[0];
    expect(slot).toMatchObject({ order_at: "2026-10-29T18:00" });
  });

  it("a pinned window overrides the learned one and survives re-learning", async () => {
    const ctx = await boot();
    for (const day of [20, 21, 22]) await orderedAt(ctx, ist(day, 18, 15));
    seedIngredientKnowledge(ctx.kit.db);   // creates the household row
    const pinned = { days: [0, 1, 2, 3, 4, 5, 6], from: "10:00", to: "11:00", source: "pinned", confidence: 1, sample_count: 0 };
    await ctx.call("PATCH", "/api/_data/shopping_prefs/household", { order_windows: JSON.stringify([pinned]) });
    refreshOrderPatterns(ctx.kit.db, NOW);
    const windows = (await ctx.call("GET", "/api/shopping/patterns")).body.windows;
    expect(windows.map((w: any) => `${w.source}:${w.from}`)).toEqual(["pinned:10:00", "learned:18:00"]);
    await dinnerAt21(ctx);
    const slot = (await ctx.call("GET", "/api/shopping/slots")).body.slots.find((s: any) => s.status !== "ordered");
    expect(slot.order_at).toBe("2026-10-30T10:00");
  });

  it("PUT /api/shopping/patterns/pinned pins and unpins, keeping learned windows", async () => {
    const ctx = await boot();
    for (const day of [20, 21, 22]) await orderedAt(ctx, ist(day, 18, 15));
    refreshOrderPatterns(ctx.kit.db, NOW);
    expect((await ctx.call("PUT", "/api/shopping/patterns/pinned", { windows: [{ days: [9], from: "x", to: "y" }] })).status).toBe(400);
    const r = await ctx.call("PUT", "/api/shopping/patterns/pinned", { windows: [{ days: [1, 3], from: "10:00", to: "11:00" }] });
    expect(r.body.windows.map((w: any) => `${w.source}:${w.from}`)).toEqual(["pinned:10:00", "learned:18:00"]);
    const cleared = await ctx.call("PUT", "/api/shopping/patterns/pinned", { windows: [] });
    expect(cleared.body.windows.map((w: any) => w.source)).toEqual(["learned"]);
  });

  it("recording an order re-learns the windows", async () => {
    const ctx = await boot();
    const { hour } = istWeekdayHour(NOW);
    for (const day of [20, 21]) await orderedAt(ctx, ist(day, hour, 5));
    await ctx.meal("2026-10-29");
    const slot = (await ctx.call("GET", "/api/shopping/slots")).body.slots.find((s: any) => s.status !== "ordered");
    await ctx.call("POST", `/api/carts/${slot.id}/ordered`, { service: "zepto" });   // ordered at NOW, 09:00
    expect((await ctx.call("GET", "/api/shopping/patterns")).body.windows[0]).toMatchObject({ from: `${String(hour).padStart(2, "0")}:00`, sample_count: 3 });
  });
});

describe("splitOnLetGo", () => {
  const settings = { get: <T,>(k: string) => (({ "cook.morning": "07:30", "cook.lunch": "13:00", "cook.evening": "19:00", "buy.delivery_lead_min": 60 } as Record<string, unknown>)[k] as T) } as any;
  const row = (id: string, meal_id: string | null, needed_by: string | null) => ({ id, meal_id, needed_by, item: id } as any);
  const meals = new Map([["m1", { id: "m1", date: "2026-11-01", slot: "Lunch", dish: "a", time: null }], ["m2", { id: "m2", date: "2026-11-03", slot: "Dinner", dish: "b", time: null }]]);
  it("moves items still useful after the next order arrives, drops ones only for meals before it, always moves the family's own", () => {
    const r = splitOnLetGo([row("early", "m1", "2026-11-01"), row("late", "m2", "2026-11-03"), row("own", null, null)], meals as any, "2026-11-02T18:00", settings);
    expect(r.move.map((x) => x.id).sort()).toEqual(["late", "own"]);
    expect(r.drop.map((x) => x.id)).toEqual(["early"]);
  });
  it("keeps everything when no next order is planned", () => {
    expect(splitOnLetGo([row("early", "m1", "2026-11-01")], meals as any, null, settings).drop).toHaveLength(0);
  });
});
