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
    expect(Object.keys(s.tables).sort()).toEqual(["dish_items", "dishes", "house", "item_events", "items", "order_lines", "orders", "people", "plan_meals", "products", "regulars", "saved_recipes"]);
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
    expect(cols("dish_items")).not.toContain("keeps");
    expect(cols("regulars")).not.toContain("keeps");
    expect(cols("orders")).not.toContain("place_at");
  });

  it("has three settings: the main app, the fallback and ordering without asking", async () => {
    const { owner } = await boot();
    expect((await owner("GET", "/api/_app")).body.settings).toEqual({ grocery_app: "zepto", fallback_app: "none", order_without_asking: false });
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
    expect(columns(s, "house")).toEqual(expect.arrayContaining(["afternoon_time", "evening_time", "plan_time", "cooking_days", "connected_apps", "history_synced", "asks_confirmed", "asks_still_have"]));
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
