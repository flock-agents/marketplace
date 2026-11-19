// What the agent reads to use the app: the manifest's operations and instructions, and the guide. Every operation declared
// has a handler, nothing of Meal Planner 2.0 is left in the text, and both stay short enough to be read whole.
import { describe, it, expect } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";
import { OPERATION_NAMES, ROUTES } from "./agentOps";

const manifest = JSON.parse(readFileSync(join(import.meta.dir, "..", "flock.app.json"), "utf8"));
const guide = readFileSync(join(import.meta.dir, "agent-guide.md"), "utf8");
const instructions: string = manifest.agentInterface.instructions;
const operations: { name: string; description: string }[] = manifest.agentInterface.operations;

// The operations the onboarding plan calls by name, plus the ones this app has always had.
const FIXED = ["set_person", "set_house_rules", "set_cook", "set_slots", "set_cooking_days", "set_shopping_apps", "set_subscription", "set_regular", "import_order_history", "plan_week"];

describe("the agent's interface", () => {
  it("declares every fixed operation and every declared one has a handler", () => {
    const declared = operations.map((o) => o.name);
    for (const n of FIXED) expect(declared).toContain(n);
    expect([...declared].sort()).toEqual([...OPERATION_NAMES].sort());
  });

  it("every operation says what it does and what it takes", () => {
    for (const o of operations) {
      expect(typeof o.description === "string" && o.description.trim().length > 0, o.name).toBe(true);
      expect(o.description, o.name).toContain("{");
    }
  });

  it("names no 2.0 operation or table anywhere in the guide or instructions", () => {
    for (const old of ["save_meal", "set_meal_recipes", "write_recipe", "household.profile", "diners", "get_draft"])
      expect(guide + instructions).not.toContain(old);
  });

  it("says nothing of the 2.0 ordering rules: no yes before placing, and a placed order can be let go", () => {
    for (const old of ["explicit yes", "record_yes", "can't be cancelled here"]) {
      expect(guide + instructions).not.toContain(old);
      for (const o of operations) expect(o.description, o.name).not.toContain(old);
    }
  });

  it("names no 3.0 ordering rule anywhere: nothing is bought from the plan, nothing is placed without a yes", () => {
    const all = [guide, instructions, manifest.description, ...operations.map((o) => o.description), ...manifest.useCases.for, ...manifest.useCases.notFor].join("\n");
    for (const old of ["ask_low_or_out", "place_order", "add_to_order", "without waiting for a yes", "Saturday", "long-life"]) expect(all, old).not.toContain(old);
  });

  it("no em dash in the guide, the instructions, the description or any operation description", () => {
    expect(guide).not.toContain("\u2014");
    expect(instructions).not.toContain("\u2014");
    expect(manifest.description).not.toContain("\u2014");
    for (const o of operations) expect(o.description, o.name).not.toContain("\u2014");
  });

  it("set_cart_line says only a lower qty changes the cart being ordered", () => {
    const d = operations.find((o) => o.name === "set_cart_line")!.description;
    expect(d).toContain("lower");
    expect(d).not.toContain("change or take off a line of the cart being ordered");
  });

  it("the Pantry page has its label and the cook is never he or she", () => {
    expect(manifest.labels["nav.pantry"]).toBe("Pantry");
    expect(manifest.labels["title.pantry"]).toBe("Pantry");
    for (const text of [guide, instructions, manifest.description, ...operations.map((o) => o.description)]) expect(text).not.toMatch(/\b(he|she|his|her|him)\b/i);
  });

  it("the app is changed only through its operations: no row write is taught", () => {
    for (const method of ["PATCH", "DELETE"]) expect(guide + instructions).not.toContain(method);
    expect(guide + instructions).not.toContain("_app/settings");
    expect(guide).toContain("remove: true");
    expect(guide).toContain("set_shopping_apps { main, fallback, connected }");
  });

  it("the instructions fit in 1,200 characters and the guide in 150 lines", () => {
    expect(instructions.length).toBeLessThanOrEqual(1200);
    expect(guide.trimEnd().split("\n").length).toBeLessThanOrEqual(150);
  });

  // Flock refuses an operation whose body is over 16 KB (flock-app/server/src/routes/app-ops.ts MAX_BODY_BYTES, counted in
  // UTF-8 bytes of the JSON as sent), so a week is planned a day a call (plan_week keep_rest).
  it("one day of a week, as plan_week takes it, fits in Flock's 16,384 bytes for an operation's body; the whole week does not", () => {
    const ingredients = ["basmati rice", "toor dal", "cauliflower florets", "green chillies", "coriander leaves", "mustard oil"]
      .map((item, i) => ({ item, amount: 250 + i * 50, unit: i % 2 ? "g" : "ml", keeps: i < 2 ? "long" : "fresh" }));
    const dish = (name: string) => ({ name, for: ["Shivashankar", "Ananya", "Agastya"], portion_note: "4 for me, 2 for Ananya, 1 small one for Agastya",
      video_url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PL1234567890", ingredients });
    const day = (date: string) => ["Breakfast", "Lunch", "Agastya's tiffin", "Dinner"].map((slot) => ({ date, slot, note: "the cook comes late today",
      dishes: [`${slot} main with gravy`, `${slot} side, dry`, `${slot} salad or raita`].map(dish) }));
    const bytes = (body: object) => Buffer.byteLength(JSON.stringify(body), "utf8");
    const oneDay = bytes({ week_start: "2026-11-23", mode: "draft", keep_rest: true, meals: day("2026-11-23") });
    expect(oneDay).toBeLessThan(16_384);
    // With room to spare: a day twice as heavy still goes.
    expect(oneDay).toBeLessThan(16_384 / 2);
    const week = bytes({ week_start: "2026-11-23", mode: "final", meals: [23, 24, 25, 26, 27, 28, 29].flatMap((d) => day(`2026-11-${d}`)) });
    expect(week).toBeGreaterThan(16_384);
    for (const text of [guide, operations.find((o) => o.name === "plan_week")!.description]) expect(text).toContain("keep_rest: true");
    expect(guide).toContain("one day a call");
    // Ruling T6-R1: each day a final call with keep_rest, then a closing final call without meals; draft only to propose a week.
    const plan = operations.find((o) => o.name === "plan_week")!.description;
    expect(plan).toContain("each day with mode final and keep_rest: true, then one closing call with mode final and no meals");
    expect(plan).not.toContain("the first day with mode draft");
  });

  it("a line the app does not have today moves to the fallback app (guide and the sync-cart ask)", () => {
    const sync = manifest.agentInterface.intents.find((i: { name: string }) => i.name === "sync-cart").instructions as string;
    for (const text of [guide, sync]) {
      expect(text).toContain("in_stock");
      expect(text).toContain("set_cart_line { item, qty, app: <fallback> }");
      expect(text).toContain("leave it marked");
    }
  });

  it("import_order_history is taught at most about 8 orders and 80 items a call, one app a call, and that fits", () => {
    const d = operations.find((o) => o.name === "import_order_history")!.description;
    for (const text of [guide, d]) for (const said of ["8 orders", "80 items", "one app a call", "oldest", "delivered or paid"]) expect(text).toContain(said);
    for (const text of [guide, d]) expect(text).not.toContain("most recent");
    // 8 orders of 10 items in the full shape at its longest (45-character product names, 20-character product ids, group and
    // price given) fit Flock's 16,384 bytes for an operation's body.
    const item = (i: number) => ({ item: `toned milk ${i}`, group: "few_days", product: `Amul Taaza Toned Fresh Milk Pouch Homogenis ${i}`,
      product_id: `prod_0123456789abcd${i}`, pack: "500 ml", count: 2, price: 29 });
    expect(item(0).product).toHaveLength(45);
    expect(item(0).product_id).toHaveLength(20);
    const history = { app: "swiggy-instamart", orders: Array.from({ length: 8 }, (_, k) => ({
      date: `2026-11-${String(k + 1).padStart(2, "0")}`, order_ref: `ORD-2026-11-${String(k + 1).padStart(2, "0")}-000123456`,
      items: Array.from({ length: 10 }, (_, i) => item(i)) })) };
    expect(Buffer.byteLength(JSON.stringify(history), "utf8")).toBeLessThan(16_384);
  });

  it("the instructions and the guide name only operations the app has", () => {
    const known = new Set<string>(OPERATION_NAMES);
    // Written like an operation (a verb, then "_"), and not one: the app's tables, and a tool of Zepto's own connection.
    const notOurs = new Set<string>([...manifest.tables, "get_payment_methods"]);
    const verb = /^(set|plan|save|import|place|ask|add|record|cancel|remember|get|list|answer|edit|move|skip|ack|search|write|remove|have)_[a-z_]+$/;
    for (const text of [guide, instructions])
      for (const [word] of text.matchAll(/\b[a-z]+_[a-z_]+\b/g))
        if (verb.test(word) && !notOurs.has(word)) expect(known.has(word), word).toBe(true);
  });

  it("the guide covers what the agent is asked to do", () => {
    expect(guide.startsWith("# Meal Planner")).toBe(true);
    for (const n of Object.keys(ROUTES)) expect(guide, n).toContain(n);
    for (const said of ["NEEDS_NAME", "structured: true", "get_reminder", "answer_running_low", "Order my", "sync_cart", "import_order_history", "Fine for a week", "record_order", "STOCK_OPTIONS", "taken_off"]) expect(guide, said).toContain(said);
    for (const n of ["guide", ...Object.keys(ROUTES)]) expect(operations.map((o) => o.name), n).toContain(n);
  });
});
