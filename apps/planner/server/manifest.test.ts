// What the agent reads to use the app: the manifest's operations and instructions, and the guide. Every operation declared
// has a handler, nothing of Meal Planner 2.0 is left in the text, and both stay short enough to be read whole.
import { describe, it, expect } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";
import { agentOps, FIELDS, FIELDS_SECTION, OPERATION_NAMES, ROUTES } from "./agentOps";
import { APP_NAMES } from "./db/constants";

const manifest = JSON.parse(readFileSync(join(import.meta.dir, "..", "flock.app.json"), "utf8"));
const guide = readFileSync(join(import.meta.dir, "agent-guide.md"), "utf8");
const instructions: string = manifest.agentInterface.instructions;
const operations: { name: string; description: string }[] = manifest.agentInterface.operations;
type Target = { operation?: string; setting?: string; preference?: string };
type SetupQ = { id: string; ask?: string; help?: string; when?: string; fixed?: boolean; multi?: boolean; fills?: string[]; after?: string[];
  action?: string; args?: unknown; answer?: Target | Target[]; show?: Record<string, { operation: string; field: string }> };
const setup: SetupQ[] = manifest.setup;
const joiner: SetupQ[] = manifest.setupJoiner;
/** A question's answer targets, as a list (3.4.0: `answer` may be a list). */
const targetsOf = (t: Target | Target[] | undefined): Target[] => (t === undefined ? [] : Array.isArray(t) ? t : [t]);
const targets = (q: SetupQ): string[] => targetsOf(q.answer).map((t) => t.operation ?? t.setting ?? t.preference ?? "");

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

  it("has no Settings page of its own: how the house orders is a settings group on Flock's Settings tab", () => {
    // Flock's AppShell adds the owner's Settings tab itself; a page of the app's own named settings made two.
    expect(manifest.pages).toEqual(["week", "shopping", "pantry", "recipes", "family"]);
    expect(Object.keys(manifest.labels).filter((k) => k.endsWith(".settings"))).toEqual([]);
    const settings: { key: string; label: string; group?: string; help?: string }[] = manifest.settings;
    expect(settings.map((s) => s.key)).toEqual(["grocery_app", "fallback_app", "order_without_asking"]);
    for (const s of settings) {
      expect(s.group, s.key).toBe("How we order");
      expect(s.label.trim().length > 0 && (s.help ?? "").trim().length > 0, s.key).toBe(true);
    }
  });

  it("the grocery app settings show each app by its name, not its id", () => {
    const named = { ...APP_NAMES, none: "None" } as Record<string, string>;
    for (const key of ["grocery_app", "fallback_app"]) {
      const s: { options: string[]; optionLabels: Record<string, string> } = manifest.settings.find((x: { key: string }) => x.key === key);
      expect(s.optionLabels, key).toEqual(Object.fromEntries(s.options.map((o) => [o, named[o]])));
    }
  });

  it("the app is changed only through its operations: no row write is taught", () => {
    for (const method of ["PATCH", "DELETE"]) expect(guide + instructions).not.toContain(method);
    expect(guide + instructions).not.toContain("_app/settings");
    expect(guide).toContain("remove: true");
    expect(guide).toContain("set_shopping_apps { main, fallback, connected }");
  });

  // Live run 11 (2026-11-21): rules the family said were kept as free text no code reads, and the plan broke them. Every
  // question whose answer can state a food rule saves it with set_house_rules (3.4.0: an `answer` target Flock's interview
  // runner writes, add: true, only the rules said), in the checked shape; the rules are read back right after the rules
  // question, and a fix there sends the whole list. Flock refuses a help over 800 characters.
  it("every setup question that can state a food rule saves it with set_house_rules, and the rules are read back", () => {
    const RULE_QUESTIONS = ["cookLimits", "cookTime", "newRecipes", "cookingDays", "kidsBreakfast", "kidsLunch", "kidsDinner",
      "adultsBreakfast", "adultsLunch", "adultsDinner", "diet", "elders", "rules", "orderIn", "rulesReadBack"];
    for (const id of RULE_QUESTIONS) {
      const variants = setup.filter((x) => x.id === id);
      expect(variants.length, id).toBeGreaterThan(0);
      for (const q of variants) {
        expect(targets(q), id).toContain("set_house_rules");
        if (id !== "rulesReadBack") expect(q.help ?? "", id).toContain("add: true");
      }
    }
    for (const q of [...setup, ...joiner]) expect((q.help ?? "").length, q.id).toBeLessThanOrEqual(800);
    expect(manifest.setupOptions.about.length).toBeLessThanOrEqual(800);
    for (const said of ["set_house_rules", "add: true", "WHOLE list", "who?", "slots?", "items?", "per_week?", "@protein"]) expect(manifest.setupOptions.about, said).toContain(said);
    // Each checked kind is taught by a worked example in the contract's JSON.
    const helps = setup.map((q) => q.help ?? "").join("\n");
    for (const kind of ["avoid", "only", "swap", "require", "cap", "other"]) expect(helps, kind).toContain(`"kind":"${kind}"`);
    const ids = setup.map((q) => q.id);
    const back = setup.find((q) => q.id === "rulesReadBack")!;
    expect(ids.indexOf("rulesReadBack")).toBe(ids.indexOf("rules") + 1);
    expect(targets(back)).toEqual(["set_house_rules"]);
    expect(back.after).toEqual(["rules"]);
    expect(back.ask).toContain("{{rulesSaid}}");
    expect(back.ask).toContain("Did I get these right?");
    expect(back.show).toEqual({ rulesSaid: { operation: "set_house_rules", field: "said" } });
    expect(back.help).toContain("WHOLE list");
    expect(back.help).not.toContain("add: true");
    expect(guide).toContain("RULE_BROKEN");
  });

  // 3.4.0: Flock's interview runner sends every setup line as written and a model reads each reply into the facts and each
  // target's payload, reading `help`. So an ask is the line a person reads, and a help speaks to that reader, not the Butler.
  it("every setup line is the exact line a person reads, and every help is how to read the reply", () => {
    const FLOCK_VALUES = ["firstName", "inviter", "sharedApps", "appLink", "appId", "appName", "plannerId", "offerLink", "sharedAppLink", "shareQuestion", "said", "menu"];
    for (const q of [...setup, ...joiner]) {
      if (q.action) continue;
      expect(q.fixed, q.id).toBe(true);
      const ask = q.ask ?? "";
      expect(ask.trim().length > 0, q.id).toBe(true);
      expect(ask, q.id).not.toMatch(/\((the|what|every|a |an )/);
      expect(ask, q.id).not.toMatch(/^(Send|Ask|Say|Tell them)\b/);
      for (const [, name] of ask.matchAll(/\{\{(\w+)\}\}/g)) expect([...FLOCK_VALUES, ...Object.keys(q.show ?? {})], `${q.id} {{${name}}}`).toContain(name);
      for (const [name, from] of Object.entries(q.show ?? {})) {
        expect(ask, `${q.id} shows ${name}`).toContain(`{{${name}}}`);
        expect(operations.some((o) => o.name === from.operation) && typeof from.field === "string", `${q.id} ${name}`).toBe(true);
      }
    }
    for (const q of [...setup, ...joiner])
      for (const butler of ["yourself", "end the turn", "end your turn", "Flock asks", "never start", "Delegate", "family_members", "send the how-to", "Then the next question"])
        expect(q.help ?? "", `${q.id}: ${butler}`).not.toContain(butler);
    // Each target is an operation the app has, named once.
    for (const q of setup) {
      const t = targets(q);
      expect(new Set(t).size, q.id).toBe(t.length);
      for (const n of t) expect(OPERATION_NAMES as readonly string[], `${q.id} ${n}`).toContain(n);
    }
    // Owner rules that stay: connectors first, past-week meals in detail, never brands or pack sizes, the final plan last.
    const ids = setup.map((q) => q.id);
    expect(ids.slice(0, 3)).toEqual(["pain", "apps", "mainApp"]);
    for (const id of ["kidsBreakfast", "kidsLunch", "kidsDinner", "adultsBreakfast", "adultsLunch", "adultsDinner"]) expect(setup.find((q) => q.id === id)!.multi, id).toBe(true);
    for (const q of setup) expect(q.ask ?? "", q.id).not.toMatch(/\b(brand|pack size)/i);
    const final = setup[setup.length - 1];
    expect([final.id, final.action, final.args]).toEqual(["final", "plan_week", { mode: "final" }]);
  });

  it("everyone at home is saved before any rule can name them, from the household answer", () => {
    const ids = setup.map((q) => q.id);
    const people = setup.find((q) => q.id === "people")!;
    expect(targets(people)).toEqual(["set_person"]);
    expect(people.help).toContain("household.people");
    const firstRule = setup.findIndex((q) => targets(q).includes("set_house_rules"));
    expect(ids.indexOf("people")).toBeLessThan(firstRule);
  });

  // The owner, 22 Nov: the cook and cooking-days questions repeated the household answer, and the elders question half
  // repeated the diet answer. The cook's facts fill from household.help; cooking days asks only what the cook's days leave.
  it("the cook's facts fill from the household answer, and the cooking-days and elders questions ask only what is still unknown", () => {
    const cook = setup.filter((q) => q.id === "cook");
    for (const q of cook) {
      expect(q.fills).toEqual(["cook.name:text", "cook.days:list", "cook.visits:list"]);
      expect(targets(q)).toEqual(["set_cook"]);
      expect(q.help).toContain("household.help");
      expect(q.help).toContain("Lakshmi comes at 7 for breakfast and lunch and 6 for dinner");
      expect(q.help).toContain("arrival");
      expect(q.when).toStartWith("household.help has cook");
    }
    expect(cook[cook.length - 1].when).toBe("household.help has cook");
    const days = setup.filter((q) => q.id === "cookingDays");
    const ask = (when: string) => days.find((q) => q.when === when)?.ask;
    expect(ask("cook.days = mon,tue,wed,thu,fri,sat")).toBe("Is food cooked at home on Sunday too?");
    expect(ask("cook.days = mon,tue,wed,thu,fri")).toBe("Is food cooked at home on Saturday and Sunday too?");
    expect(ask("!cook.days")).toBe("Which days is food cooked at home? Monday to Saturday, or Sunday too?");
    for (const q of days) expect(targets(q)).toEqual(["set_cooking_days", "set_house_rules"]);
    // Variants of one question: each has a when, and the general one is the last.
    expect(days.every((q) => typeof q.when === "string")).toBe(true);
    expect(days[days.length - 1].when).toBe("!cook.days");
    const diet = setup.find((q) => q.id === "diet")!;
    expect(diet.fills).toContain("dietElders:text");
    const elders = setup.filter((q) => q.id === "elders");
    expect(elders.map((q) => q.when)).toEqual(["household.elders and dietElders", "household.elders"]);
    for (const q of elders) expect(q.ask).not.toMatch(/sugar|diabet/i);
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
    const notOurs = new Set<string>([...manifest.tables, "get_payment_methods", "set_menu"]);   // set_menu: a value of set_cook's new_recipes
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

  it("the operations' fields are the code's: each description, every call written in the guide and the guide's field list name exactly those", async () => {
    expect(Object.keys(FIELDS).sort()).toEqual([...OPERATION_NAMES].sort());
    /** The field names at the top level of the "{ ... }" that starts at `at`: nested lists and objects are not looked into. */
    const keysAt = (text: string, at: number): string[] => {
      let depth = 0, top = "";
      for (let i = at; i < text.length; i++) {
        const ch = text[i];
        if (ch === "{" || ch === "[" || ch === "(") { depth++; if (depth === 1) continue; }
        if (ch === "}" || ch === "]" || ch === ")") { depth--; if (depth === 0) break; }
        if (depth === 1) top += ch; else if (depth > 1 && top.slice(-1) !== " ") top += " ";
      }
      const words = top.replace(/"[^"]*"/g, " ").split(/[,;]/).map((part) => /^\s*(?:or\s+)?([a-z_]+)\??\s*(?::|$)/.exec(part)?.[1]).filter((w): w is string => !!w && w !== "null");
      return words.flatMap((w) => (w === "date" && /date and slot/.test(top) ? ["date", "slot"] : [w]));
    };
    for (const o of operations) {
      const at = o.description.indexOf("{");
      const keys = keysAt(o.description, at);
      if (o.name === "set_dish") keys.push("date", "slot");   // "{ dish_id, or meal_id, or date and slot; ... }"
      expect(new Set(keys), o.name).toEqual(new Set(FIELDS[o.name].fields));
    }
    for (const [, op, rest] of guide.matchAll(/`([a-z_]+) (\{[^`]*\})`/g)) {
      if (!FIELDS[op]) continue;
      for (const k of keysAt(rest, 0)) expect(FIELDS[op].fields, `${op} ${k} in the guide`).toContain(k);
    }
    const served = (await agentOps(() => null as any).guide({}, { agentId: null } as any)) as { guide: string };
    expect(served.guide).toContain(FIELDS_SECTION);
    expect(FIELDS_SECTION).toContain("- set_cook { name, days?, arrival?, makes_well?, wont_make?, time_limit?, new_recipes?, note? }");
    expect(FIELDS_SECTION).toContain("- plan_week { week_start, mode, meals?, keep_rest? }");
  });
});
