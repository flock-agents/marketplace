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

const FIXED = ["set_person", "set_house_rules", "set_cook", "set_regular", "set_slots", "plan_week", "set_meal", "set_dish", "save_recipe", "import_order_history", "place_order", "ask_low_or_out"];

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
    for (const old of ["save_meal", "set_meal_recipes", "write_recipe", "pantry", "household.profile", "diners", "get_draft"])
      expect(guide + instructions).not.toContain(old);
  });

  it("says nothing of the 2.0 ordering rules: no yes before placing, and a placed order can be let go", () => {
    for (const old of ["explicit yes", "record_yes", "can't be cancelled here"]) {
      expect(guide + instructions).not.toContain(old);
      for (const o of operations) expect(o.description, o.name).not.toContain(old);
    }
  });

  it("the app is changed only through its operations: no row write is taught", () => {
    for (const method of ["PATCH", "DELETE"]) expect(guide + instructions).not.toContain(method);
    expect(guide).toContain("remove: true");
  });

  it("the instructions fit in 1,200 characters and the guide in 150 lines", () => {
    expect(instructions.length).toBeLessThanOrEqual(1200);
    expect(guide.trimEnd().split("\n").length).toBeLessThanOrEqual(150);
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
    for (const said of ["needs_product", "needs_qty", "NEEDS_NAME", "structured: true", "ItemPicker", "search-products", "add-to-cart", "view-cart", "checkout", "view-order-history",
      "never their websites"]) expect(guide, said).toContain(said);
  });
});
