// Each operation as a typed tool (flock.app.json agentInterface.operations[].input and .use): Flock exposes every operation
// with an input schema as a tool of its own, checked before the call. The schema must say exactly what the handler takes
// (agentOps.ts FIELDS: the same fields, the same required ones), and good payloads pass it while known-bad ones do not.
import { describe, it, expect } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";
import { checkFields, FIELDS } from "./agentOps";
import { boot } from "./testkit";

type Schema = { type?: string | string[]; enum?: unknown[]; properties?: Record<string, Schema>; required?: string[]; additionalProperties?: boolean;
  items?: Schema; minItems?: number; minimum?: number; maximum?: number; description?: string };
const manifest = JSON.parse(readFileSync(join(import.meta.dir, "..", "flock.app.json"), "utf8"));
const operations: { name: string; use?: string; input?: Schema }[] = manifest.agentInterface.operations;
const inputOf = (op: string): Schema => operations.find((o) => o.name === op)!.input!;

/** The draft-07 subset the tools use: type (one or a list), enum, properties, required, additionalProperties: false, items,
 *  minItems, minimum, maximum. Answers the problems found, [] when the value fits. */
function problems(s: Schema, v: unknown, at = "input"): string[] {
  const typeOf = (x: unknown): string => (x === null ? "null" : Array.isArray(x) ? "array" : Number.isInteger(x) ? "integer" : typeof x);
  const out: string[] = [];
  if (s.type) {
    const types = Array.isArray(s.type) ? s.type : [s.type];
    const t = typeOf(v);
    if (!types.includes(t) && !(t === "integer" && types.includes("number"))) return [`${at}: ${t} is not ${types.join(" or ")}`];
  }
  if (s.enum && !s.enum.includes(v)) out.push(`${at}: ${JSON.stringify(v)} is not one of ${JSON.stringify(s.enum)}`);
  if (typeof v === "number") {
    if (s.minimum !== undefined && v < s.minimum) out.push(`${at}: below ${s.minimum}`);
    if (s.maximum !== undefined && v > s.maximum) out.push(`${at}: above ${s.maximum}`);
  }
  if (Array.isArray(v)) {
    if (s.minItems !== undefined && v.length < s.minItems) out.push(`${at}: fewer than ${s.minItems} items`);
    if (s.items) v.forEach((x, i) => out.push(...problems(s.items!, x, `${at}[${i}]`)));
  }
  if (v && typeof v === "object" && !Array.isArray(v)) {
    const o = v as Record<string, unknown>;
    for (const k of s.required ?? []) if (o[k] === undefined) out.push(`${at}.${k}: required`);
    for (const [k, x] of Object.entries(o)) {
      const p = s.properties?.[k];
      if (p) out.push(...problems(p, x, `${at}.${k}`));
      else if (s.properties && s.additionalProperties === false) out.push(`${at}.${k}: not a field`);
    }
  }
  return out;
}

describe("the operations as typed tools", () => {
  it("every operation has an input schema and a one-line use", () => {
    expect(operations.length).toBe(Object.keys(FIELDS).length);
    for (const o of operations) {
      expect(typeof o.use === "string" && o.use.trim().length > 10 && !o.use.includes("\n"), `${o.name} use`).toBe(true);
      expect(o.use, o.name).not.toContain("—");
      expect(o.input?.type, `${o.name} input`).toBe("object");
      expect(o.input?.additionalProperties, `${o.name} closed`).toBe(false);
    }
  });

  it("each schema takes exactly the handler's fields, and requires exactly the ones it needs", () => {
    for (const o of operations) {
      const f = FIELDS[o.name];
      expect(Object.keys(o.input!.properties ?? {}).sort(), o.name).toEqual([...f.fields].sort());
      expect([...(o.input!.required ?? [])].sort(), o.name).toEqual([...(f.need ?? [])].sort());
      for (const [k, p] of Object.entries(o.input!.properties ?? {})) expect(p.type ?? p.enum, `${o.name}.${k} has a type`).toBeTruthy();
    }
  });

  // [operation, a payload the handler takes]
  const GOOD: [string, Record<string, unknown>][] = [
    ["status", {}], ["status", { person: "Neha" }],
    ["set_person", { name: "Dadi", group: "elder", diet: "veg, no onion", allergies: "none", targets: { protein: "high", note: "for her knees" }, usually_home: false }],
    ["set_person", { name: "Papa", targets: "less rice" }], ["set_person", { name: "Papa", targets: null, dislikes: null }],
    ["set_rule", { hard: true, what: "no_eggs", when_present: ["Mummy", "Papa"], quote: "no eggs when my parents are here" }],
    ["set_rule", { hard: true, what: "avoid", who: "Riya", items: ["peanut"], quote: "Riya is allergic to peanuts" }],
    ["set_slot", { name: "Riya's tiffin", kind: "custom", usual_people: ["Riya"], days: ["Mon", "Tue", "Wed", "Thu", "Fri"] }],
    ["set_slot_day", { date: "2026-11-30", slot: "Lunch", add_people: ["Mummy"], guests: [{ count: 2, as: ["Mummy", "Papa"] }] }],
    ["set_slot_day", { date: "2026-11-30", slot: "Dinner", skip: null, dishes: ["Rajma chawal", { dish: "Raita", note: "less salt" }] }],
    ["set_cook", { name: "Sunita", days: ["Mon", "Sat"], arrival: [{ at: "06:00", meals: ["Breakfast"] }, "16:30"], new_recipes: "set_menu" }],
    ["set_roles", { menu: "Dadi", cooking: "the cook", shopping: "each buys their own" }],
    ["set_setting", { new_dishes_per_week: 4 }],
    ["make_plan", { from: "2026-11-28", days: 3 }], ["make_plan", { week_start: "2026-11-30", keep_edited: false }],
    ["record_feedback", { date: "2026-11-28", slot: "Lunch", dish: "Aloo gobi", made: true, liked: false, who: "Arjun", quote: "too dry" }],
    ["record_feedback", { date: "2026-11-28", dish: "Aloo gobi", answer: "swap" }],
    ["rate_dishes", { ratings: [{ dish: "Aloo gobi", rating: "didnt_work", again: false, said_by: "Arjun" }] }],
    ["set_answered", { ids: ["fasting", "feedback"] }], ["set_cuisine", { cuisine: ["Tamil", "Kerala"] }],
    ["answer_running_low", { answers: [{ item: "atta", answer: "in_stock", days: 7 }] }], ["set_cart_line", { item: "dal", qty: 0 }],
  ];
  // [operation, a payload the handler refuses, why]
  const BAD: [string, Record<string, unknown>][] = [
    ["set_person", { group: "adult" }], ["set_person", { name: "Kabir", group: "teen" }], ["set_person", { name: "Kabir", targets: { protein: "lots" } }],
    ["set_person", { name: "Kabir", age: 6 }], ["set_rule", { what: "vegan", quote: "x" }], ["set_slot", { name: "Snack", kind: "side" }],
    ["set_slot_day", { slot: "Lunch" }], ["set_slot_day", { date: "2026-11-30", slot: "Lunch", skip: "fasting" }],
    ["set_cook", { name: "Sunita", new_recipes: "sometimes" }], ["set_setting", { new_dishes_per_week: 3 }],
    ["make_plan", { from: "2026-11-28", days: 0 }], ["make_plan", { from: "2026-11-28", days: 15 }],
    ["record_feedback", { date: "2026-11-28", dish: "Poha", answer: "maybe" }], ["rate_dishes", { ratings: [] }], ["rate_dishes", { ratings: [{ dish: "Poha", rating: "meh" }] }],
    ["set_answered", { ids: ["weather"] }], ["status", { person: 3 }], ["set_roles", { cook: "Sunita" }],
  ];

  it("good payloads fit the schema and pass the handler's own field check", () => {
    for (const [op, p] of GOOD) {
      expect(problems(inputOf(op), p), `${op} ${JSON.stringify(p)}`).toEqual([]);
      expect(checkFields(op, p), `${op} ${JSON.stringify(p)}`).toBeNull();
    }
  });

  it("known-bad payloads do not fit the schema", () => {
    for (const [op, p] of BAD) expect(problems(inputOf(op), p).length, `${op} ${JSON.stringify(p)}`).toBeGreaterThan(0);
  });

  it("what a schema refuses the handler refuses too", async () => {
    const { op } = await boot({ now: () => new Date(2026, 10, 28, 11, 0) });
    await op("set_person", { name: "Kabir", group: "child", diet: "veg" });
    await op("set_slot", { name: "Lunch", kind: "main" });
    for (const [name, p] of BAD) {
      const r = await op(name, p);
      expect(r?.error, `${name} ${JSON.stringify(p)}`).toBeTruthy();
    }
  });
});
