// The 3.0 data as an agent sees it, and the upgrade from a 2.0.x database: the old tables stay, untouched and unlisted.
import { describe, it, expect } from "bun:test";
import { Database } from "bun:sqlite";
import { join } from "path";
import { boot, tempDir } from "./testkit";
import { OLD_TABLES, ORDER_STATUSES } from "./db/constants";

const columns = (s: any, table: string) => (s.tables[table].columns as { name: string }[]).map((c) => c.name);

describe("planner data", () => {
  it("shows the new tables to agents and hides the old ones", async () => {
    const { owner } = await boot();
    const s = (await owner("GET", "/api/_data/_schema")).body;
    expect(Object.keys(s.tables).sort()).toEqual(["dish_ingredients", "house", "item_events", "items", "library", "order_lines", "orders", "people", "plan_feedback", "products", "regulars",
      "rules", "saved_recipes", "slot_days", "slot_dishes", "slots"]);
  });

  // The slot model (docs/slot-model-spec.md §2.1, §3): its tables on a fresh install, the old ones and the house's old lists gone.
  it("a fresh install has the slot model's tables and columns, and none of the old plan's", async () => {
    const { kit } = await boot();
    const tables = (kit.sqlite.query(`SELECT name FROM sqlite_master WHERE type = 'table'`).all() as { name: string }[]).map((t) => t.name);
    for (const t of ["slots", "slot_days", "slot_dishes", "dish_ingredients", "library", "rules"]) expect(tables, t).toContain(t);
    for (const t of ["plan_meals", "dishes", "dish_items", "dish_book"]) expect(tables, t).not.toContain(t);
    const cols = (t: string) => (kit.sqlite.query(`PRAGMA table_info(${t})`).all() as { name: string }[]).map((c) => c.name);
    expect(cols("slots")).toEqual(expect.arrayContaining(["name", "kind", "addon_of", "usual_people", "days", "skip_days", "order", "active"]));
    expect(cols("slot_days")).toEqual(expect.arrayContaining(["date", "slot", "people", "guests", "occasion", "new_dishes_allowed", "skip", "status", "edited", "note"]));
    expect(cols("slot_dishes")).toEqual(expect.arrayContaining(["slot_day_id", "position", "dish", "new", "feedback_asked", "note"]));
    expect(cols("dish_ingredients")).toEqual(expect.arrayContaining(["slot_dish_id", "item", "amount", "unit"]));
    expect(cols("library")).toEqual(expect.arrayContaining(["key", "slot", "name", "frequency", "days", "contains", "contains_read", "origin", "suggested", "untried",
      "offers", "disliked", "prep", "video_url", "video_title", "video_thumbnail", "rating", "rating_note", "rated_on", "rated_by", "ratings"]));
    expect(cols("rules")).toEqual(expect.arrayContaining(["hard", "what", "who", "slots", "days", "items", "to", "frequency", "per_meal", "fasting_food", "quote"]));
    for (const gone of ["rules", "extra_slots", "order_in", "meal_examples", "cooking_days", "meal_parts"]) expect(cols("house"), gone).not.toContain(gone);
    expect(cols("house")).toEqual(expect.arrayContaining(["cook_name", "cook_days", "cook_arrival", "connected_apps", "notes", "intro_sent_at", "plan_time"]));
    // Unique: a slot's name, a slot-day's date and slot, a library dish's key and slot.
    const indexes = (t: string) => (kit.sqlite.query(`PRAGMA index_list(${t})`).all() as { name: string; unique: number }[]).filter((i) => i.unique).map((i) => i.name);
    expect(indexes("slot_days")).toContain("slot_days_date_slot");
    expect(indexes("library")).toContain("library_key_slot");
    expect(indexes("slots").length).toBeGreaterThan(0);
  });

  it("an upgraded 2.0 install keeps its own ingredients table untouched beside the new dish_ingredients", async () => {
    const dir = tempDir("planner-up-"); const file = join(dir, "app.db");
    const old = new Database(file);
    old.run(`CREATE TABLE ingredients (id text primary key, name text, aisle text)`);
    old.run(`INSERT INTO ingredients VALUES ('i1', 'Toor dal', 'pulses')`);
    old.close();
    const { kit } = await boot({ dbFile: file, dataDir: dir });
    expect(kit.status.state).toBe("ok");
    expect(kit.sqlite.query("SELECT name, aisle FROM ingredients").get()).toEqual({ name: "Toor dal", aisle: "pulses" });
    expect(kit.sqlite.query("SELECT count(*) n FROM dish_ingredients").get()).toEqual({ n: 0 });
  });

  it("upgrades a 2.0.x database without a block and keeps its old rows", async () => {
    const dir = tempDir("planner-up-"); const file = join(dir, "app.db");
    const old = new Database(file);
    old.run(`CREATE TABLE meals (id text primary key, date text, slot text, dish text)`);
    old.run(`INSERT INTO meals VALUES ('m1','2026-11-10','Lunch','Rajma')`);
    old.close();
    const { kit } = await boot({ dbFile: file, dataDir: dir });
    expect(kit.status.state).toBe("ok");
    expect(kit.sqlite.query("SELECT dish FROM meals").get()).toEqual({ dish: "Rajma" });
  });

  it("keeps every one of the 18 old tables through the upgrade", async () => {
    const dir = tempDir("planner-up-"); const file = join(dir, "app.db");
    const old = new Database(file);
    for (const t of OLD_TABLES) { old.run(`CREATE TABLE "${t}" (id text primary key, v text)`); old.run(`INSERT INTO "${t}" VALUES ('1', '${t}')`); }
    old.close();
    const { kit, owner } = await boot({ dbFile: file, dataDir: dir });
    expect(OLD_TABLES).toHaveLength(18);
    expect(kit.status.state).toBe("ok");
    for (const t of OLD_TABLES) expect(kit.sqlite.query(`SELECT v FROM "${t}"`).get()).toEqual({ v: t });
    expect((await owner("GET", "/api/_data/meals")).status).toBe(404);
  });

  it("revision 2's tables boot on an empty database", async () => {
    const { rows, kit } = await boot();
    for (const t of ["items", "item_events", "orders", "order_lines"]) expect(rows(t), t).toEqual([]);
    const cols = (t: string) => (kit.sqlite.query(`PRAGMA table_info(${t})`).all() as { name: string }[]).map((c) => c.name);
    expect(cols("dish_ingredients")).not.toContain("keeps");
    expect(cols("regulars")).not.toContain("keeps");
    expect(cols("orders")).not.toContain("place_at");
  });

  it("has four settings: the main app, the fallback, ordering without asking and new dishes a week (2 unless set: 0, 2, 4 or 7)", async () => {
    const { owner } = await boot();
    expect((await owner("GET", "/api/_app")).body.settings).toEqual({ grocery_app: "zepto", fallback_app: "none", order_without_asking: false, new_dishes_per_week: 2 });
    expect((await owner("PATCH", "/api/_app/settings", { new_dishes_per_week: 3 })).status).toBe(400);
    expect((await owner("PATCH", "/api/_app/settings", { new_dishes_per_week: 7 })).status).toBe(200);
    expect((await owner("PATCH", "/api/_app/settings", { grocery_app: "dmart" })).status).toBe(400);
    expect((await owner("PATCH", "/api/_app/settings", { fallback_app: "zepto" })).status).toBe(200);
    expect((await owner("PATCH", "/api/_app/settings", { fallback_app: "none" })).status).toBe(200);
    expect((await owner("PATCH", "/api/_app/settings", { grocery_app: "amazon" })).status).toBe(200);
    expect((await owner("PATCH", "/api/_app/settings", { order_without_asking: "yes" })).status).toBe(400);
  });

  it("a cart is open, ordering, placed, paid, not paid or cancelled; its lines say where they came from", async () => {
    const { owner } = await boot();
    const s = (await owner("GET", "/api/_data/_schema")).body;
    expect(ORDER_STATUSES).toEqual(["open", "ordering", "placed", "paid", "not_paid", "cancelled"]);
    expect(columns(s, "orders")).toEqual(expect.arrayContaining(["app", "status", "total", "delivery_gap", "synced_at", "sync_state", "sync_asked_at", "outside_lines", "ordering_at", "placed_at", "paid_at", "app_order_ref", "unpaid_notice", "note"]));
    expect(columns(s, "order_lines")).toEqual(expect.arrayContaining(["order_id", "item_id", "item", "qty", "product_id", "name_on_app", "pack", "price", "image", "source", "for_note", "for_date", "rolled_from"]));
    expect(columns(s, "items")).toEqual(expect.arrayContaining(["item", "name", "group", "unit", "follows_plan", "subscription", "dont_ask", "snoozed_until", "usual_amount", "lasts_days", "run_out", "confident", "wait_factor"]));
    expect(columns(s, "item_events")).toEqual(expect.arrayContaining(["item_id", "date", "kind", "tag", "app", "amount", "count", "price", "days", "cycle_days", "order_ref", "order_id", "void"]));
    expect(columns(s, "house")).toEqual(expect.arrayContaining(["afternoon_time", "evening_time", "plan_time", "connected_apps", "history_synced", "asks_confirmed", "asks_still_have"]));
  });

  it("fills the defaults an agent may leave out: an active person, an active row of the retired everyday items table", async () => {
    const { owner, rows } = await boot();
    expect((await owner("POST", "/api/_data/people", { name: "Agastya", group: "child" })).status).toBe(201);
    expect(rows("people")[0]).toMatchObject({ name: "Agastya", group: "child", active: 1 });
    expect((await owner("POST", "/api/_data/regulars", { item: "milk", every: "day" })).status).toBe(201);
    expect(rows("regulars")[0]).toMatchObject({ item: "milk", active: 1 });
    expect((await owner("POST", "/api/_data/people", { group: "child" })).status).toBe(400);
  });

  it("the guide operation answers as the agent's own", async () => {
    const { op } = await boot();
    expect((await op("guide")).guide).toContain("# Meal Planner");
  });
});
