// What the agent reads to use the app: the manifest's operations and instructions, and the guide. Every operation declared
// has a handler, nothing of Meal Planner 2.0 is left in the text, and both stay short enough to be read whole.
import { describe, it, expect } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";
import { agentOps, FIELDS, FIELDS_SECTION, OPERATION_NAMES, ROUTES } from "./agentOps";
import { APP_NAMES } from "./db/constants";
import { SETUP_SYSTEM } from "./setup";
import { PLAN_METHOD } from "./meals";
import { MENU_SYSTEM } from "./makePlan";
import { WEEKLY_PROMPT } from "./routines/weekly-plan";

const manifest = JSON.parse(readFileSync(join(import.meta.dir, "..", "flock.app.json"), "utf8"));
const guide = readFileSync(join(import.meta.dir, "agent-guide.md"), "utf8");
const instructions: string = manifest.agentInterface.instructions;
const operations: { name: string; description: string }[] = manifest.agentInterface.operations;
type Target = { operation?: string; setting?: string; preference?: string };
type SetupQ = { id: string; ask?: string; help?: string; when?: string; fixed?: boolean; multi?: boolean; fills?: string[]; after?: string[]; default?: unknown;
  action?: string; args?: unknown; answer?: Target | Target[]; show?: Record<string, { operation: string; field: string }> };
const setup: SetupQ[] = manifest.setup;
const joiner: SetupQ[] = manifest.setupJoiner;
/** A question's answer targets, as a list (3.4.0: `answer` may be a list). */
const targetsOf = (t: Target | Target[] | undefined): Target[] => (t === undefined ? [] : Array.isArray(t) ? t : [t]);
const targets = (q: SetupQ): string[] => targetsOf(q.answer).map((t) => t.operation ?? t.setting ?? t.preference ?? "");

// The operations the onboarding plan calls by name, plus the ones this app has always had.
const FIXED = ["set_person", "set_cook", "set_shopping_apps", "set_subscription", "set_regular", "import_order_history", "make_plan"];
// The old plan operations, gone with the slot model (docs/slot-model-spec.md §3, §6): no adapters.
const GONE = ["set_meal", "set_dish", "set_family_dishes", "set_slots", "set_house_rules", "set_cooking_days", "plan_week", "plan_menu"];

describe("the agent's interface", () => {
  it("declares every fixed operation and every declared one has a handler", () => {
    const declared = operations.map((o) => o.name);
    for (const n of FIXED) expect(declared).toContain(n);
    expect([...declared].sort()).toEqual([...OPERATION_NAMES].sort());
    for (const n of GONE) expect(declared, n).not.toContain(n);
    for (const n of GONE) expect(OPERATION_NAMES as readonly string[], n).not.toContain(n);
  });

  it("the old plan operations and tables are named nowhere the agent reads, and no setup question answers to them", () => {
    const all = JSON.stringify(manifest) + guide;
    for (const n of [...GONE, "plan_meals", "dish_items", "dish_book"]) expect(all, n).not.toMatch(new RegExp(`\\b${n}\\b`));
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
    expect(settings.map((s) => s.key)).toEqual(["grocery_app", "fallback_app", "order_without_asking", "new_dishes_per_week"]);
    for (const s of settings) {
      expect(s.group, s.key).toBe(s.key === "new_dishes_per_week" ? "How we plan" : "How we order");
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

  // 23 Nov (owner-approved, "model reads, code writes; the app owns its setup"): Flock no longer writes each reply's answer
  // targets. Each reply is read only into its facts (fills: the interview's when conditions and Flock's own read-backs), and
  // at the end Flock calls the app's setupApply operation once with the household facts and the transcript; the app reads it
  // and saves it in code, and its `said` read-back replaces the mid-chat ones (slots, rules). Flock refuses a help over 800
  // characters; a help now teaches only the facts a reply fills.
  it("the app saves the whole setup at the end (setupApply: apply_setup); no read-back mid-chat, and each help is only the reply's facts", () => {
    expect(manifest.setupApply).toBe("apply_setup");
    const apply = operations.find((o) => o.name === "apply_setup")!;
    for (const said of ["household", "transcript", '"Q: ..."', '"A: ..."', "said", "noted", "dropped", "{ ok: false, say }"]) expect(apply.description, said).toContain(said);
    const ids = setup.map((q) => q.id);
    for (const gone of ["slotsConfirm", "rulesReadBack"]) expect(ids).not.toContain(gone);
    // The one line that still shows the app's words is what it read from the orders.
    expect(setup.filter((q) => q.show).map((q) => q.id)).toEqual(["orderFindings"]);
    for (const q of [...setup, ...joiner]) {
      const help = q.help ?? "";
      expect(help.length, q.id).toBeLessThanOrEqual(800);
      // No write instruction is left: no operation call, no payload in the rules' JSON.
      for (const write of ["save ", "set_house_rules", "set_slots", "set_family_dishes", "set_person", "set_cook", "add: true", '"kind":', "WHOLE list"]) expect(help, `${q.id}: ${write}`).not.toContain(write);
    }
    // Every fact a question fills is named in its help, so the reader knows what to write.
    for (const q of setup) for (const f of q.fills ?? []) if (!f.startsWith("people") && !f.startsWith("cook.")) expect(q.help ?? "", `${q.id} ${f}`).toContain(f.split(":")[0].split(".").pop()!);
    const about: string = manifest.setupOptions.about;
    expect(about.length).toBeLessThanOrEqual(800);
    expect(about).toContain("apply_setup");
    expect(about).not.toContain("set_house_rules");
    // The checked kinds are taught where the rules are read now: the setup's own prompt.
    for (const kind of ["avoid {", "only {", "swap {", "require {", "cap {", "fasting {", "other {"]) expect(SETUP_SYSTEM, kind).toContain(kind);
  });

  // 3.4.0: Flock's interview runner sends every setup line as written and a model reads each reply into the facts and each
  // target's payload, reading `help`. So an ask is the line a person reads, and a help speaks to that reader, not the Butler.
  it("every setup line is the exact line a person reads, and every help is how to read the reply", () => {
    const FLOCK_VALUES = ["firstName", "inviter", "sharedApps", "appLink", "appId", "appName", "plannerId", "offerLink", "sharedAppLink", "shareQuestion", "said", "menu", "householdPeople", "householdCook"];
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
    expect([final.id, final.action, final.args]).toEqual(["final", "make_plan", {}]);
  });

  // Lane B (2026-11-23): the cook's limits are not a setup question; a limit said any time is kept in the cook's words (the
  // slot model turns limits into cap / note rules on the cook's days).
  it("no cook-limits question; the guide and set_cook keep a cook's limit said any time in the cook's words", () => {
    expect(setup.some((q) => q.id === "cookLimits")).toBe(false);
    const cook = operations.find((o) => o.name === "set_cook")!.description;
    for (const text of [guide, cook]) for (const said of ["wont_make", "time_limit", "which dishes?", "not only the swap"]) expect(text, said).toContain(said);
  });
  // The past week's meals: each answer is read into its fact in the family's words, an extra meal said there (a tiffin, an
  // evening snack) with it, for apply_setup to save. The answer targets stay for a Flock without setupApply.
  it("every past-week meal question reads the dishes and any extra meal said, and the meals part ends with no read-back", () => {
    const MEALS = ["kidsBreakfast", "kidsLunch", "kidsDinner", "adultsBreakfast", "adultsLunch", "adultsDinner"];
    for (const id of MEALS) {
      const q = setup.find((x) => x.id === id)!;
      expect(q.fills, id).toEqual([`pastWeek.${id}:text`]);
      expect(targets(q), id).toEqual([]);
      expect(q.help, id).toContain("extra meal");
      expect(q.help, id).toContain("in their words");
    }
    const ids = setup.map((q) => q.id);
    expect(ids[ids.indexOf("adultsDinner") + 1]).toBe("diet");
    expect(ids.filter((id) => id.toLowerCase().includes("tiffin"))).toEqual([]);
  });

  it("everyone at home is saved before any rule can name them, from the household answer", () => {
    const ids = setup.map((q) => q.id);
    const people = setup.find((q) => q.id === "people")!;
    expect(targets(people)).toEqual(["set_person"]);
    expect(people.help).toContain("household.people");
    const firstRule = setup.findIndex((q) => q.id === "diet");
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
      expect(q.help).toContain("Rani comes at 7 for breakfast and lunch and 6 for dinner");
      expect(q.when).toStartWith("household.help has cook");
    }
    expect(cook[cook.length - 1].when).toBe("household.help has cook");
    const days = setup.filter((q) => q.id === "cookingDays");
    const ask = (when: string) => days.find((q) => q.when === when)?.ask;
    // Every day is planned (owner, 23 Nov): the cook's days off ask who cooks, never whether the day is skipped.
    expect(ask("cook.days = mon,tue,wed,thu,fri,sat")).toBe("On Sunday, when the cook doesn't come, who cooks? Or is a meal eaten out?");
    expect(ask("cook.days = mon,tue,wed,thu,fri")).toBe("On Saturday and Sunday, when the cook doesn't come, who cooks? Or is a meal eaten out?");
    expect(ask("!cook.days")).toBe("Who cooks at home, and on which days? Is any day's meal eaten out?");
    for (const q of days) {
      expect(q.fills).toEqual(["cookingDays:list"]);
      expect(q.default).toEqual(["mon", "tue", "wed", "thu", "fri", "sat", "sun"]);
      expect(q.help).toContain("Every day is planned");
    }
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
    for (const said of ["NEEDS_NAME", "get_reminder", "answer_running_low", "Order my", "sync_cart", "import_order_history", "Fine for a week", "record_order", "STOCK_OPTIONS", "taken_off"]) expect(guide, said).toContain(said);
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
      expect(new Set(keys), o.name).toEqual(new Set(FIELDS[o.name].fields));
    }
    for (const [, op, rest] of guide.matchAll(/`([a-z_]+) (\{[^`]*\})`/g)) {
      if (!FIELDS[op]) continue;
      for (const k of keysAt(rest, 0)) expect(FIELDS[op].fields, `${op} ${k} in the guide`).toContain(k);
    }
    const served = (await agentOps(() => null as any).guide({}, { agentId: null } as any)) as { guide: string };
    expect(served.guide).toContain(FIELDS_SECTION);
    expect(FIELDS_SECTION).toContain("- set_cook { name, days?, arrival?, makes_well?, wont_make?, time_limit?, new_recipes?, note? }");
    expect(FIELDS_SECTION).toContain("- make_plan { week_start }");
  });

  // Owner, 23 Nov: the test family's names and lines (the simulated runs' family) are in no text a model reads, so a model
  // copying an example cannot pass as having read the family. Tests may keep them; every model-facing string may not.
  it("no model-facing text names the test family or its lines", () => {
    const texts = [JSON.stringify(manifest), guide, SETUP_SYSTEM, PLAN_METHOD, MENU_SYSTEM, WEEKLY_PROMPT("2026-11-30")];
    for (const t of texts) for (const word of [/shiva/i, /ankita/i, /agastya/i, /gowri/i, /lakshmi/i, /nut-free/i, /fasts thursday/i])
      expect(t, String(word)).not.toMatch(word);
  });
});
