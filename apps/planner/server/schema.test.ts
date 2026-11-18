// The 3.0 data as an agent sees it, and the upgrade from a 2.0.x database: the old tables stay, untouched and unlisted.
import { describe, it, expect } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { boot } from "./testkit";
import { OLD_TABLES, ORDER_STATUSES } from "./db/constants";

const columns = (s: any, table: string) => (s.tables[table].columns as { name: string }[]).map((c) => c.name);

describe("planner 3.0 data", () => {
  it("shows the new tables to agents and hides the old ones", async () => {
    const { owner } = await boot();
    const s = (await owner("GET", "/api/_data/_schema")).body;
    expect(Object.keys(s.tables).sort()).toEqual(["dish_items", "dishes", "house", "order_lines", "orders", "people", "plan_meals", "products", "regulars", "saved_recipes"]);
  });

  it("upgrades a 2.0.x database without a block and keeps its old rows", async () => {
    const dir = mkdtempSync(join(tmpdir(), "planner-up-")); const file = join(dir, "app.db");
    const old = new Database(file);
    old.run(`CREATE TABLE meals (id text primary key, date text, slot text, dish text)`);
    old.run(`INSERT INTO meals VALUES ('m1','2026-11-10','Lunch','Rajma')`);
    old.close();
    const { kit } = await boot({ dbFile: file, dataDir: dir });
    expect(kit.status.state).toBe("ok");
    expect(kit.sqlite.query("SELECT dish FROM meals").get()).toEqual({ dish: "Rajma" });
  });

  it("keeps every one of the 18 old tables through the upgrade", async () => {
    const dir = mkdtempSync(join(tmpdir(), "planner-up-")); const file = join(dir, "app.db");
    const old = new Database(file);
    for (const t of OLD_TABLES) { old.run(`CREATE TABLE "${t}" (id text primary key, v text)`); old.run(`INSERT INTO "${t}" VALUES ('1', '${t}')`); }
    old.close();
    const { kit, owner } = await boot({ dbFile: file, dataDir: dir });
    expect(OLD_TABLES).toHaveLength(18);
    expect(kit.status.state).toBe("ok");
    for (const t of OLD_TABLES) expect(kit.sqlite.query(`SELECT v FROM "${t}"`).get()).toEqual({ v: t });
    expect((await owner("GET", "/api/_data/meals")).status).toBe(404);
  });

  it("has one setting, grocery_app, defaulting to zepto, refusing other apps", async () => {
    const { owner } = await boot();
    expect((await owner("GET", "/api/_app")).body.settings).toEqual({ grocery_app: "zepto" });
    expect((await owner("PATCH", "/api/_app/settings", { grocery_app: "amazon" })).status).toBe(400);
    expect((await owner("PATCH", "/api/_app/settings", { grocery_app: "bigbasket" })).status).toBe(200);
  });

  it("an order is scheduled, placed, paid, not paid or cancelled, with when it was paid and no waiting flag", async () => {
    const { owner } = await boot();
    const s = (await owner("GET", "/api/_data/_schema")).body;
    expect(ORDER_STATUSES).toEqual(["scheduled", "placed", "paid", "not_paid", "cancelled"]);
    expect(columns(s, "orders")).toContain("paid_at");
    expect(columns(s, "orders")).not.toContain("ask_pending");
    expect(columns(s, "house")).toEqual(expect.arrayContaining(["dinner_check_time", "tomorrow_check_time"]));
  });

  it("fills the defaults an agent may leave out: an active person, a fresh item, a checked quantity", async () => {
    const { owner, rows } = await boot();
    expect((await owner("POST", "/api/_data/people", { name: "Agastya", group: "child" })).status).toBe(201);
    expect(rows("people")[0]).toMatchObject({ name: "Agastya", group: "child", active: 1 });
    expect((await owner("POST", "/api/_data/regulars", { item: "milk", every: "day" })).status).toBe(201);
    expect(rows("regulars")[0]).toMatchObject({ item: "milk", keeps: "fresh", active: 1 });
    expect((await owner("POST", "/api/_data/people", { group: "child" })).status).toBe(400);
  });

  it("the guide operation answers as the agent's own", async () => {
    const { op } = await boot();
    expect((await op("guide")).guide).toContain("# Meal Planner");
  });
});
