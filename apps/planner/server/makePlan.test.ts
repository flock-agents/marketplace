// make_plan on the kinds model (makePlan.ts, planDays.ts, fillWeek.ts, planChecks.ts; docs/kinds-model-build.md) with a fake
// model: the slot-days worked out in code (weekly patterns, the calendar or dated stays, fasts, meals eaten out, edited
// slot-days kept), the week filled by code from each meal's templates (no model call plans a meal), what dishes contain read
// only where nothing else knows it, allergies read carefully, each day's ingredients, the save and the message. The fake
// answers by the call's purpose.
import { describe, it, expect } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";
import { boot } from "./testkit";
import { CAREFUL_SYSTEM, CONTAINS_SYSTEM, GUESTS_SYSTEM, INGREDIENT_SYSTEM, makePlan } from "./makePlan";
import { coveredByWeek, EVENTS_SYSTEM, lunchSaid, platformPeers, readHousehold, withLunchSaid, type CalendarEvent } from "./planDays";
import { catalogIngredients, type MealKind, type MealTemplate } from "./kinds";
import type { ModelRequest, ModelResult } from "./model";
import { addRule, commit, getLibraryDish, listSlotDays, saveSlotDay, upsertLibrary, upsertSlot, type LibraryInput, type RuleInput, type SlotInput } from "./slotStore";
import { DELIVER_PROMPT, FESTIVAL_PROMPT } from "./routines/weekly-plan";

const MON = "2026-11-30", TODAY = "2026-11-29";
const WEEK = ["2026-11-30", "2026-12-01", "2026-12-02", "2026-12-03", "2026-12-04", "2026-12-05", "2026-12-06"];
const quiet = () => {};
const READ = ["egg", "meat", "fish", "onion_garlic", "nuts", "peanut", "sugar", "white_rice", "dairy"];
const T = (...parts: MealTemplate["parts"]): MealTemplate => ({ parts });
/** A made-up family's meals: breakfast one of four dishes, lunch rice with a dal and a sabzi, dinner roti with a sabzi or a gravy. */
const SHAPES: Record<string, { kinds: MealKind[]; templates: MealTemplate[] }> = {
  Breakfast: { kinds: [{ name: "Poha" }, { name: "Upma" }, { name: "Idli" }, { name: "Dosa" }], templates: [T({ kind: "Poha" }), T({ kind: "Upma" }), T({ kind: "Idli" }), T({ kind: "Dosa" })] },
  Lunch: { kinds: [{ name: "Rice", staple: true }, { name: "Dal" }, { name: "Sabzi" }], templates: [T({ kind: "Rice" }, { kind: "Dal" }, { kind: "Sabzi" })] },
  Dinner: { kinds: [{ name: "Roti", staple: true }, { name: "Sabzi" }, { name: "Gravy" }], templates: [T({ kind: "Roti" }, { kind: "Sabzi" }), T({ kind: "Roti" }, { kind: "Gravy" })] },
};
const MAIN: SlotInput[] = [{ name: "Breakfast", kind: "main", order: 10, ...SHAPES.Breakfast }, { name: "Lunch", kind: "main", order: 30, ...SHAPES.Lunch },
  { name: "Dinner", kind: "main", order: 50, ...SHAPES.Dinner }];
/** The family's dishes, with their kinds: [name, kind, sub?]. */
const LIB: Record<string, [string, string, string?][]> = {
  Breakfast: [["Kanda poha", "Poha"], ["Rava upma", "Upma"], ["Idli", "Idli"], ["Masala dosa", "Dosa"], ["Plain dosa", "Dosa"], ["Batata poha", "Poha"]],
  Lunch: [["Rice", "Rice"], ["Dal tadka", "Dal", "Dal"], ["Moong dal", "Dal", "Dal"], ["Masoor dal", "Dal", "Dal"], ["Toor dal", "Dal", "Dal"], ["Aloo gobi", "Sabzi"], ["Bhindi sabzi", "Sabzi"],
    ["Lauki sabzi", "Sabzi"], ["Jeera aloo", "Sabzi"], ["Cabbage sabzi", "Sabzi"], ["Beans sabzi", "Sabzi"], ["Tinda sabzi", "Sabzi"]],
  Dinner: [["Phulka", "Roti"], ["Palak paneer", "Gravy"], ["Aloo matar", "Gravy"], ["Malai kofta", "Gravy"], ["Matar paneer", "Gravy"]],
};

type Call = { req: ModelRequest; user: any };
/** A fake model by purpose: `contains`, `careful` (default: has nothing), `guests`, `day` (ingredients), `events`. */
function fakeModel(h: { contains?: (u: any) => unknown; careful?: (u: any) => unknown; guests?: (u: any) => unknown; day?: (u: any) => unknown; events?: (u: any) => unknown;
  wait?: number } = {}) {
  const calls: Call[] = [];
  const wrap = (v: unknown): ModelResult => (v && typeof v === "object" && "ok" in (v as object) ? v as ModelResult : { ok: true, json: v, model: "fake" });
  const model = async (req: ModelRequest): Promise<ModelResult> => {
    const user = JSON.parse(req.user);
    calls.push({ req, user });
    if (h.wait) await Bun.sleep(h.wait);
    const p = req.purpose ?? "";
    if (p.includes("carefully")) return wrap((h.careful ?? ((u: any) => ({ dishes: u.dishes.map((d: string) => ({ dish: d, has: [] })) })))(user));
    if (p.includes("contain")) return wrap((h.contains ?? (() => ({ dishes: [] })))(user));
    if (p.includes("guests")) return wrap((h.guests ?? (() => ({ rules: [] })))(user));
    if (p.includes("calendar")) return wrap((h.events ?? (() => ({ changes: [] })))(user));
    return wrap((h.day ?? ingredients)(user));
  };
  const of = (s: string) => calls.filter((c) => (c.req.purpose ?? "").includes(s));
  return { model, calls, contains: () => of("contain").filter((c) => !c.req.purpose!.includes("carefully")), careful: () => of("carefully"), days: () => of("ingredients"),
    events: () => of("calendar"), guests: () => of("guests") };
}
const ingredients = (u: any) => ({ dishes: u.dishes.map((d: any) => ({ slot: d.slot, name: d.name, ingredients: [{ item: d.name.toLowerCase(), amount: 200, unit: "g", tags: [] }] })) });

async function home(o: { people?: [string, string][]; slots?: SlotInput[]; lib?: Record<string, [string, string, string?][]>; library?: LibraryInput[]; rules?: RuleInput[];
  seed?: { slot: string; dishes: string[] }[]; history?: { date: string; slot: string; dishes: string[]; status: "planned" | "confirmed" }[]; newPerWeek?: number } = {}) {
  const k = await boot({ now: () => new Date(2026, 10, 29, 11, 0) });
  for (const [name, group] of o.people ?? [["Asha", "adult"], ["Ravi", "adult"], ["Kabir", "child"]]) await k.op("set_person", { name, group });
  if (o.newPerWeek !== undefined) k.kit.sqlite.run(`INSERT INTO _settings (id, created_at, updated_at, updated_by, key, value, scope) VALUES ('n1', '', '', 'app', 'new_dishes_per_week', ?, 'owner')`, [JSON.stringify(o.newPerWeek)]);
  commit(k.kit.db, k.kit.emitChange, (tx, ch) => {
    for (const s of o.slots ?? MAIN) upsertSlot(tx, s, "app", ch);
    for (const [slot, rows] of Object.entries(o.lib ?? LIB)) for (const [name, kind, sub] of rows)
      upsertLibrary(tx, { name, slot, kind, sub: sub ?? null, origin: "setup_named", contains: [], contains_read: READ }, "app", ch);
    for (const d of o.library ?? []) upsertLibrary(tx, { contains_read: READ, ...d }, "app", ch);
    for (const r of o.rules ?? []) addRule(tx, r, "app", ch);
    for (const s of o.seed ?? []) saveSlotDay(tx, { date: null, slot: s.slot, dishes: s.dishes.map((dish) => ({ dish })) }, "app", ch);
    for (const h of o.history ?? []) saveSlotDay(tx, { date: h.date, slot: h.slot, status: h.status, dishes: h.dishes.map((dish) => ({ dish })) }, "app", ch);
  });
  const plan = (model: (r: ModelRequest) => Promise<ModelResult>, x: { household?: unknown; peers?: any; log?: (l: string) => void; suggest_new?: boolean } = {}) =>
    makePlan({ db: k.kit.db, emit: k.kit.emitChange, model, weekStart: MON, today: TODAY, basePath: "/a/t", log: x.log ?? quiet, household: x.household, peers: x.peers,
      sqlite: k.kit.sqlite, suggest_new: x.suggest_new });
  const week = () => listSlotDays(k.kit.db, { from: MON, to: WEEK[6] });
  const at = (date: string, slot: string) => week().find((d) => d.date === date && d.slot === slot);
  const dishesAt = (date: string, slot: string) => at(date, slot)?.dishes.map((d) => d.dish) ?? [];
  return { ...k, plan, week, at, dishesAt };
}
const STAPLES = ["Rice", "Phulka"];

describe("make_plan: the week filled by code from the templates", () => {
  it("no model call plans a meal: only each day's ingredients are asked; every slot-day saved planned, with ingredients; the week by day in the message", async () => {
    const k = await home();
    const f = fakeModel();
    const lines: string[] = [];
    const r = await k.plan(f.model, { log: (l) => lines.push(l) });
    if (!r.ok) throw new Error(r.say);
    expect(f.calls.map((c) => c.req.purpose)).toEqual(Array(7).fill("meal plan: a day's ingredients"));
    expect(f.days().every((c) => c.req.tier === "fast" && c.req.system === INGREDIENT_SYSTEM)).toBe(true);
    expect(k.week()).toHaveLength(21);
    for (const d of k.week()) {
      expect(d.status).toBe("planned");
      expect(d.people).toEqual(["Asha", "Ravi", "Kabir"]);
      expect(d.dishes.length).toBeGreaterThan(0);
      for (const x of d.dishes) expect(x.ingredients.length).toBeGreaterThan(0);
    }
    // Every lunch is the family's plate: rice, a dal, a sabzi; every dinner roti with a sabzi or a gravy.
    for (const d of WEEK) {
      expect(k.dishesAt(d, "Lunch")).toHaveLength(3);
      expect(k.dishesAt(d, "Lunch")[0]).toBe("Rice");
      expect(k.dishesAt(d, "Dinner")).toHaveLength(2);
      expect(k.dishesAt(d, "Dinner")[0]).toBe("Phulka");
    }
    expect(r.message).toContain("Your week is planned.");
    expect(r.message).toContain(`*Monday*\nBreakfast: ${k.dishesAt(MON, "Breakfast").join(", ")}\nLunch: ${k.dishesAt(MON, "Lunch").join(", ")}\nDinner:`);
    expect(r.message).toContain("[Week page](/a/t/?flock_scope=app#/week?week=2026-11-30)");
    expect(r.intro).toContain("How it works");
    expect(lines.some((l) => l.startsWith("filled 21 slot-days in "))).toBe(true);
  });

  it("the owner's rules hold over the week: no dish two days running, none at two meals a day, none twice on a plate, never a bare category", async () => {
    const k = await home();
    await k.plan(fakeModel().model);
    const nonStaple = (d: string) => [...k.dishesAt(d, "Breakfast"), ...k.dishesAt(d, "Lunch"), ...k.dishesAt(d, "Dinner")].filter((x) => !STAPLES.includes(x));
    for (let i = 0; i < 7; i++) {
      const today = nonStaple(WEEK[i]);
      expect(new Set(today).size).toBe(today.length);
      if (i) for (const x of today) expect(nonStaple(WEEK[i - 1])).not.toContain(x);
      for (const x of today) expect(["Sabzi", "Dal", "Gravy"]).not.toContain(x);
    }
    // The family's own dishes first: the first lunch sabzis are theirs.
    const sabzis = WEEK.map((d) => k.dishesAt(d, "Lunch")[2]);
    expect(sabzis.slice(0, 4).every((x) => LIB.Lunch.some(([n]) => n === x))).toBe(true);
  });

  it("a meal set up before templates is planned from its seed plates: the rice and curd on every plate, a part per dish", async () => {
    const k = await home({ slots: [MAIN[0], { name: "Lunch", kind: "main", order: 30 }, MAIN[2]],
      lib: { ...LIB, Lunch: [["Rice", "Rice"], ["Curd", "Curd"], ["Drumstick sambar", "Rice curry", "Sambar"], ["Arachuvitta sambar", "Rice curry", "Sambar"], ["Tomato rasam", "Rice curry", "Rasam"]] },
      seed: [1, 2, 3].map(() => ({ slot: "Lunch", dishes: ["Rice", "Drumstick sambar", "Curd"] })) });
    const r = await k.plan(fakeModel().model);
    if (!r.ok) throw new Error(r.say);
    for (const d of WEEK) {
      const p = k.dishesAt(d, "Lunch");
      expect(p[0]).toBe("Rice");
      expect(p.at(-1)).toBe("Curd");
      expect(p).toHaveLength(3);
      expect(p[1].toLowerCase()).toContain("sambar");
    }
  });

  it("a later week is guided by what was had: last week's dishes come last", async () => {
    const k = await home({ history: [{ date: "2026-11-29", slot: "Lunch", status: "planned", dishes: ["Rice", "Dal tadka", "Aloo gobi"] },
      { date: "2026-11-28", slot: "Lunch", status: "confirmed", dishes: ["Rice", "Moong dal", "Bhindi sabzi"] }] });
    await k.plan(fakeModel().model);
    const mon = k.dishesAt(MON, "Lunch");
    for (const x of ["Dal tadka", "Aloo gobi", "Moong dal", "Bhindi sabzi"]) expect(mon).not.toContain(x);
  });

  it("a disliked dish and a dropped untried one are never planned", async () => {
    const k = await home({ library: [{ name: "Karela sabzi", slot: "Lunch", kind: "Sabzi", disliked: true }, { name: "Reel sabzi", slot: "Lunch", kind: "Sabzi", untried: true, offers: 2, origin: "family_added" }] });
    await k.plan(fakeModel().model);
    for (const d of k.week()) for (const x of d.dishes) expect(["Karela sabzi", "Reel sabzi"]).not.toContain(x.dish);
  });

  it("a pinned dish is on its days only; a dish said once a week comes once", async () => {
    const k = await home({ slots: [{ ...MAIN[0], templates: [...SHAPES.Breakfast.templates, T({ kind: "Paratha" })] }, MAIN[1], MAIN[2]],
      library: [{ name: "Aloo paratha", slot: "Breakfast", kind: "Paratha", days: ["Sat", "Sun"] }, { name: "Rajma", slot: "Lunch", kind: "Dal", sub: "Rajma/Chole", frequency: "1/week" }] });
    await k.plan(fakeModel().model);
    expect(WEEK.filter((d) => k.dishesAt(d, "Breakfast").includes("Aloo paratha"))).toEqual([WEEK[5], WEEK[6]]);
    expect(WEEK.filter((d) => k.dishesAt(d, "Lunch").includes("Rajma")).length).toBeLessThanOrEqual(1);
  });
});

describe("make_plan: new dishes (kinds model rule 4)", () => {
  const FEW = { ...LIB, Lunch: [["Rice", "Rice"], ["Dal tadka", "Dal", "Dal"], ...LIB.Lunch.filter(([, kind]) => kind === "Sabzi")] as [string, string, string?][] };
  it("only once the family's own have come: of the part's kind, saved untried with an offer each placement, said with the dish of theirs it stands in for", async () => {
    const k = await home({ lib: FEW });
    const r = await k.plan(fakeModel().model);
    if (!r.ok) throw new Error(r.say);
    const dals = WEEK.map((d) => k.dishesAt(d, "Lunch")[1]);
    expect(dals[0]).toBe("Dal tadka");
    const news = k.week().flatMap((d) => d.dishes.filter((x) => x.new).map((x) => x.dish));
    expect(news.length).toBeGreaterThan(0);
    for (const n of news) {
      const row = getLibraryDish(k.kit.db, n, k.week().find((d) => d.dishes.some((x) => x.dish === n))!.slot)!;
      expect(row).toMatchObject({ origin: "planner_suggested", suggested: true, untried: true, catalog_item: n });
      expect(row.kind).toBeString();
    }
    const untried = () => k.rows("library").filter((x: any) => x.untried === 1);
    const placements = (name: string) => k.week().filter((d) => d.dishes.some((x) => x.dish === name)).length;
    for (const row of untried()) expect(row.offers).toBe(placements(row.name));
    const newDal = news.find((n) => dals.includes(n))!;
    expect(r.message).toContain("New this week: ");
    expect(r.message).toMatch(new RegExp(`${newDal} on \\w{3}[^(]*\\(like your Dal tadka\\)`));
    // Planned again: the offers of the placements it replaces are taken back first.
    await k.plan(fakeModel().model);
    for (const row of untried()) expect(row.offers).toBeLessThanOrEqual(Math.max(placements(row.name), 1));
  });

  it("the family's new-dishes setting caps them when they set it; a slot-day set to no new dish gets none", async () => {
    const none = await home({ lib: FEW, newPerWeek: 0 });
    await none.plan(fakeModel().model);
    expect(none.week().flatMap((d) => d.dishes).filter((x) => x.new)).toEqual([]);
    const k = await home({ lib: FEW });
    commit(k.kit.db, k.kit.emitChange, (tx, ch) => saveSlotDay(tx, { date: WEEK[1], slot: "Lunch", people: ["Asha", "Ravi", "Kabir"], new_dishes_allowed: 0, edited: true }, "app", ch));
    await k.plan(fakeModel().model);
    expect(k.at(WEEK[1], "Lunch")!.dishes.filter((x) => x.new)).toEqual([]);
    expect(k.dishesAt(WEEK[1], "Lunch")).toHaveLength(3);
  });

  it("a part they named as a category (\"dal\", \"sabzi\") is filled with real dishes of it, theirs: none new, none a bare word", async () => {
    const k = await home({ lib: { ...LIB, Lunch: [["Rice", "Rice"], ["Dal", "Dal", "Dal"], ["Sabzi", "Sabzi", "Sabzi"]] } });
    const r = await k.plan(fakeModel().model);
    if (!r.ok) throw new Error(r.say);
    for (const d of WEEK) {
      const p = k.at(d, "Lunch")!.dishes;
      expect(p).toHaveLength(3);
      expect(p.map((x) => x.dish)).not.toContain("Dal");
      expect(p.map((x) => x.dish)).not.toContain("Sabzi");
      expect(p.every((x) => !x.new)).toBe(true);
    }
  });

  it("\"suggest some\" for a meal with none of theirs: a plain plate of that meal, every part a real dish", async () => {
    const k = await home({ slots: [MAIN[0], MAIN[1], { name: "Dinner", kind: "main", order: 50 }], lib: { Breakfast: LIB.Breakfast, Lunch: LIB.Lunch } });
    const r = await k.plan(fakeModel().model, { suggest_new: true });
    if (!r.ok) throw new Error(r.say);
    for (const d of WEEK) {
      const p = k.dishesAt(d, "Dinner");
      expect(p.length).toBeGreaterThanOrEqual(3);
      for (const x of p) expect(["Sabzi", "Dal"]).not.toContain(x);
    }
  });
});

describe("make_plan: hard rules per person, fail closed", () => {
  const GRANDMA: RuleInput = { hard: true, what: "veg", who: "Nani", quote: "Nani is vegetarian" };
  const people: [string, string][] = [["Asha", "adult"], ["Nani", "elder"]];
  const FISH_LUNCH: SlotInput = { name: "Lunch", kind: "main", order: 30, 
    templates: [T({ kind: "Rice" }, { kind: "Fish & seafood" }, { kind: "Dal" })] };

  it("a fish lunch with a vegetarian grandmother: the fish is not for her, she has her own dish for its part, the fish stays in the fish curry", async () => {
    const k = await home({ people, rules: [GRANDMA], slots: [MAIN[0], FISH_LUNCH, MAIN[2]],
      library: [{ name: "Rohu curry", slot: "Lunch", kind: "Fish & seafood", sub: "Fish curry", contains: ["fish"] }] });
    const f = fakeModel({ day: (u) => ({ dishes: u.dishes.map((d: any) => ({ slot: d.slot, name: d.name, ingredients: [{ item: d.name === "Rohu curry" ? "rohu" : d.name.toLowerCase(), amount: 200, unit: "g", tags: d.name === "Rohu curry" ? ["fish"] : [] }] })) }) });
    const r = await k.plan(f.model);
    if (!r.ok) throw new Error(r.say);
    const mon = k.at(MON, "Lunch")!.dishes;
    const fish = mon.find((d) => d.dish === "Rohu curry")!;
    expect(fish.not_for).toEqual(["Nani"]);
    expect(fish.ingredients.map((i) => i.item)).toEqual(["rohu"]);
    expect(mon.filter((d) => d.dish !== "Rice" && !d.not_for.length).length).toBeGreaterThanOrEqual(2);
    expect(r.message).toContain("Rohu curry (not for Nani)");
    const week = (await k.owner("GET", `/api/weeks/${MON}`)).body;
    expect(week.days[0].meals.find((m: any) => m.slot === "Lunch").dishes.find((d: any) => d.name === "Rohu curry").not_for).toEqual(["Nani"]);
    // Never a fish or meat dish given to her: whatever is not marked not for her has none.
    for (const d of k.week()) for (const x of d.dishes) if (!x.not_for.includes("Nani")) expect(x.dish).not.toMatch(/fish|chicken|mutton|prawn|rohu|macher|meen/i);
  });

  it("a dish never read for her rule's item is not hers (fail closed), read first when setup never read it; she gets a dish of her own", async () => {
    const k = await home({ people, rules: [GRANDMA], slots: [MAIN[0], { name: "Lunch", kind: "main", order: 30, templates: [T({ kind: "Rice" }, { items: ["Mystery curry"] })] }, MAIN[2]],
      library: [{ name: "Mystery curry", slot: "Lunch", contains: [], contains_read: [] }] });
    const f = fakeModel({ contains: (u) => ({ dishes: u.dishes.map((d: string) => ({ dish: d, has: [], not: [] })) }) });
    const r = await k.plan(f.model);
    expect(f.contains()[0].user.dishes).toEqual(["Mystery curry"]);
    expect(f.contains()[0].req.system).toBe(CONTAINS_SYSTEM);
    const mon = k.at(MON, "Lunch")!.dishes;
    expect(mon.find((x) => x.dish === "Mystery curry")!.not_for).toEqual(["Nani"]);
    expect(mon.some((x) => x.dish !== "Rice" && !x.not_for.includes("Nani"))).toBe(true);
    if (r.ok) expect((r.unmet ?? []).filter((u) => u.includes("nothing"))).toEqual([]);
  });

  it("a read that says chicken but not meat still counts as meat (a tag's family is added)", async () => {
    const k = await home({ people, rules: [GRANDMA], slots: [MAIN[0], { name: "Lunch", kind: "main", order: 30, templates: [T({ kind: "Rice" }, { items: ["House special"] })] }, MAIN[2]],
      library: [{ name: "House special", slot: "Lunch", contains: [], contains_read: [] }] });
    const f = fakeModel({ contains: (u) => ({ dishes: u.dishes.map((d: string) => ({ dish: d, has: ["chicken"], not: ["meat", "fish", "egg"] })) }) });
    await k.plan(f.model);
    expect(k.at(MON, "Lunch")!.dishes.find((x) => x.dish === "House special")!.not_for).toEqual(["Nani"]);
  });

  it("library dishes setup never read are read before the week is planned; a dish the catalog knows needs no read", async () => {
    const k = await home({ people, rules: [{ hard: true, what: "veg", quote: "we are vegetarian" }],
      library: [{ name: "Grandma's kootu", slot: "Lunch", kind: "Sabzi", contains: [], contains_read: [] }, { name: "Aloo gobi", slot: "Lunch", kind: "Sabzi", contains: [], contains_read: [] }] });
    const f = fakeModel({ contains: (u) => ({ dishes: u.dishes.map((d: string) => ({ dish: d, has: [], not: ["egg", "meat", "fish", "onion_garlic"] })) }) });
    const r = await k.plan(f.model);
    expect(r.ok).toBe(true);
    const read = f.contains().flatMap((c) => c.user.dishes);
    expect(read).toContain("Grandma's kootu");
    expect(read).not.toContain("Aloo gobi");
    expect(getLibraryDish(k.kit.db, "Grandma's kootu", "Lunch")!.contains_read.sort()).toEqual(["egg", "fish", "meat", "onion_garlic"]);
  });

  it("guests' food rules are read once into tags: a fish-only dinner for vegetarian guests gets a dish of theirs beside", async () => {
    const k = await home({ slots: [MAIN[0], MAIN[1], { name: "Dinner", kind: "main", order: 50, templates: [T({ kind: "Roti" }, { items: ["Fish fry"] })] }],
      library: [{ name: "Fish fry", slot: "Dinner", kind: "Fish & seafood", contains: ["fish"] }] });
    const SAT = WEEK[5];
    commit(k.kit.db, k.kit.emitChange, (tx, ch) => saveSlotDay(tx, { date: SAT, slot: "Dinner", people: ["Asha", "Ravi", "Kabir"], guests: [{ count: 4, rules: ["Vegetarian"] }], edited: true, dishes: [] }, "app", ch));
    const f = fakeModel({ guests: () => ({ rules: [{ rule: "vegetarian", never: ["meat", "fish", "unknown_tag"] }] }) });
    await k.plan(f.model);
    expect(f.guests()).toHaveLength(1);
    expect(f.guests()[0].req.system).toBe(GUESTS_SYSTEM);
    expect(f.guests()[0].user.rules).toEqual(["vegetarian"]);
    const sat = k.dishesAt(SAT, "Dinner");
    expect(sat).toContain("Fish fry");
    expect(sat.filter((x) => x !== "Fish fry" && x !== "Phulka").length).toBeGreaterThan(0);
  });

  it("a person with their own add-on that day is fed there; the add-on has its dishes", async () => {
    const k = await home({ people, rules: [GRANDMA], slots: [MAIN[0], FISH_LUNCH, MAIN[2], { name: "Nani's lunch", kind: "addon", addon_of: "Lunch", order: 60, usual_people: ["Nani"] }],
      library: [{ name: "Rohu curry", slot: "Lunch", kind: "Fish & seafood", contains: ["fish"] }, ...["Lauki sabzi", "Tinda sabzi", "Turai sabzi"].map((name) => ({ name, slot: "Nani's lunch", kind: "Sabzi" }))] });
    const r = await k.plan(fakeModel().model);
    if (!r.ok) throw new Error(r.say);
    for (const d of WEEK) expect(k.dishesAt(d, "Nani's lunch").length).toBeGreaterThan(0);
    expect((r.unmet ?? []).filter((u) => u.includes("Nani"))).toEqual([]);
  });

  it("a soft swap with a count the week falls short of is kept by a note on some of the person's days, one a day, up to its least", async () => {
    const k = await home({ rules: [{ hard: false, what: "swap", who: "Ravi", items: ["white_rice"], to: "millet", frequency: "sometimes", quote: "millets are good for Ravi" }],
      library: [{ name: "Rice", slot: "Lunch", kind: "Rice", contains: ["white_rice"], contains_read: [...READ, "millet"] }] });
    await k.plan(fakeModel().model);
    const notes = WEEK.flatMap((d) => k.at(d, "Lunch")!.dishes.filter((x) => x.note).map((x) => `${d} ${x.dish}: ${x.note}`));
    expect(notes).toEqual([`${MON} Rice: millet in place of white rice for Ravi`, `${WEEK[1]} Rice: millet in place of white rice for Ravi`]);
  });

  it("onion and garlic: a dish is planned for the person with a note, and stays bought (kinds model rule 7)", async () => {
    const k = await home({ rules: [{ hard: true, what: "avoid", who: "Ravi", items: ["onion_garlic"], quote: "Ravi eats no onion or garlic" }],
      library: LIB.Lunch.filter(([, kind]) => kind === "Sabzi").map(([name]) => ({ name, slot: "Lunch", kind: "Sabzi", contains: ["onion_garlic"] })) });
    const f = fakeModel({ day: (u) => ({ dishes: u.dishes.map((d: any) => ({ slot: d.slot, name: d.name, ingredients: [{ item: "onion", amount: 50, unit: "g", tags: ["onion_garlic"] }, { item: d.name.toLowerCase(), amount: 200, unit: "g", tags: [] }] })) }) });
    await k.plan(f.model);
    const sabzi = k.at(MON, "Lunch")!.dishes[2];
    expect(sabzi.not_for).toEqual([]);
    expect(sabzi.note).toBe("make without onion and garlic, or keep Ravi's portion aside");
    expect(sabzi.ingredients.map((i) => i.item)).toContain("onion");
  });

  it("an ingredient tagged with what a person at the slot-day avoids is taken out, and a shared dish says so", async () => {
    const k = await home({ rules: [{ hard: true, what: "avoid", who: "Asha", items: ["sugar"], quote: "no sugar for me" }] });
    const f = fakeModel({ day: (u) => ({ dishes: u.dishes.map((d: any) => ({ slot: d.slot, name: d.name, ingredients: [{ item: "rice", amount: 100, unit: "g", tags: [] },
      ...(d.slot === "Breakfast" ? [{ item: "jaggery", amount: 10, unit: "g", tags: ["sugar"] }] : [])] })) }) });
    await k.plan(f.model);
    expect(f.days()[0].user.dishes[0].tags).toEqual(["sugar"]);
    const first = k.at(MON, "Breakfast")!.dishes[0];
    expect(first.ingredients.map((i) => i.item)).toEqual(["rice"]);
    expect(first.note).toBe("no jaggery for Asha");
  });
});

describe("make_plan: an add-on and a box", () => {
  it("an add-on whose only dish is had twice a week is filled on 2 days, spread apart; the other 5 have no slot-day, nothing unmet, nothing said", async () => {
    const k = await home({ slots: [...MAIN, { name: "Ravi's fish", kind: "addon", addon_of: "Dinner", order: 60, usual_people: ["Ravi"] }],
      library: [{ name: "Rohu curry", slot: "Ravi's fish", kind: "Fish & seafood", frequency: "2/week", contains: ["fish"] }] });
    const r = await k.plan(fakeModel().model);
    if (!r.ok) throw new Error(r.say);
    const fish = k.week().filter((d) => d.slot === "Ravi's fish");
    expect(fish).toHaveLength(2);
    expect(fish.every((d) => d.dishes.map((x) => x.dish).join() === "Rohu curry")).toBe(true);
    const [a, b] = fish.map((d) => Date.parse(d.date!)).sort();
    expect((b - a) / 86_400_000).toBeGreaterThanOrEqual(2);
    expect((r.unmet ?? []).filter((u) => u.includes("Ravi's fish"))).toEqual([]);
    expect(r.message.split("Ravi's fish:").length - 1).toBe(2);
    await k.plan(fakeModel().model);
    expect(k.week().filter((d) => d.slot === "Ravi's fish")).toHaveLength(2);
  });

  it("a box with no dishes does not stop the plan: it is left out and named in the one question; nothing known at all is asked", async () => {
    const k = await home({ slots: [...MAIN, { name: "Snack box", kind: "custom", order: 20, usual_people: ["Kabir"], days: ["Mon", "Tue", "Wed", "Thu", "Fri"] }] });
    const lines: string[] = [];
    const r = await k.plan(fakeModel().model, { log: (l) => lines.push(l) });
    if (!r.ok) throw new Error(r.say);
    expect(k.week().filter((d) => d.slot === "Snack box")).toEqual([]);
    expect(k.week()).toHaveLength(21);
    expect(r.asked).toHaveLength(1);
    expect(r.asked![0]).toContain("Snack box");
    expect(lines.some((l) => l.includes("no dishes known for Snack box"))).toBe(true);
    const bare = await home({ lib: {}, slots: MAIN.map((s) => ({ name: s.name, kind: s.kind, order: s.order })) });
    expect(await bare.plan(fakeModel().model)).toMatchObject({ ok: false, reason: "no_dishes" });
  });
});

describe("make_plan: allergies (owner 25 Nov)", () => {
  const ALLERGY: RuleInput = { hard: true, what: "avoid", who: "Kabir", items: ["peanut"], quote: "Kabir is allergic to peanuts" };
  const readAll = [...READ, "nuts"];
  const POHA_ONLY: SlotInput = { name: "Breakfast", kind: "main", order: 10, templates: [T({ kind: "Poha" })] };

  it("a family dish on their own plates at a slot Kabir eats is his by their word: no careful read, the note keeps his portion aside, its peanuts still bought", async () => {
    const k = await home({ rules: [ALLERGY], seed: [{ slot: "Breakfast", dishes: ["Kanda poha"] }, { slot: "Breakfast", dishes: ["Rava upma"] }],
      library: [{ name: "Kanda poha", slot: "Breakfast", kind: "Poha", contains: ["peanut"], contains_read: readAll }] });
    const f = fakeModel({ day: (u) => ({ dishes: u.dishes.map((d: any) => ({ slot: d.slot, name: d.name, ingredients: [{ item: d.name === "Kanda poha" ? "peanuts" : "rice", amount: 50, unit: "g", tags: d.name === "Kanda poha" ? ["peanut"] : [] }] })) }) });
    const r = await k.plan(f.model);
    if (!r.ok) throw new Error(r.say);
    expect(f.careful().flatMap((c) => c.user.dishes)).not.toContain("Kanda poha");
    const day = WEEK.find((d) => k.dishesAt(d, "Breakfast").includes("Kanda poha"))!;
    const poha = k.at(day, "Breakfast")!.dishes.find((x) => x.dish === "Kanda poha")!;
    expect(poha.not_for).toEqual([]);
    expect(poha.note).toBe("Kabir's Kanda poha without peanut");
    expect(poha.ingredients.map((i) => i.item)).toEqual(["peanuts"]);
  });

  it("every other dish is read carefully on the balanced tier, the new ones placed too: one that may have it is not his (unless only an ingredient it can be made without brings it, decided 21), and he has his own", async () => {
    const k = await home({ rules: [ALLERGY], slots: [POHA_ONLY, MAIN[1], MAIN[2]], lib: { ...LIB, Breakfast: [["Kanda poha", "Poha"]] } });
    const f = fakeModel({ careful: (u) => ({ dishes: u.dishes.map((d: string) => ({ dish: d, has: d === "Kanda poha" ? [] : ["peanut"] })) }) });
    await k.plan(f.model);
    const c = f.careful();
    expect(c.length).toBeGreaterThanOrEqual(2);
    expect(c.every((x) => x.req.tier === "balanced" && x.req.system === CAREFUL_SYSTEM)).toBe(true);
    expect(CAREFUL_SYSTEM).toContain("not sure");
    expect(c[0].user.dishes).toContain("Kanda poha");
    expect(c.slice(1).flatMap((x) => x.user.dishes).length).toBeGreaterThan(0);
    for (const d of WEEK) {
      const plate = k.at(d, "Breakfast")!.dishes;
      for (const x of plate) if (x.dish !== "Kanda poha") {
        const leaveOut = (catalogIngredients(x.dish) ?? []).some((i) => i.name === "peanuts" && !i.main);
        expect(x.not_for).toEqual(leaveOut ? [] : ["Kabir"]);
        if (leaveOut) expect(x.note).toContain("make without peanuts for Kabir");
      }
      expect(plate.some((x) => !x.not_for.includes("Kabir"))).toBe(true);
    }
  });

  it("a careful read that leaves a dish out counts as having it (fail closed)", async () => {
    const k = await home({ rules: [ALLERGY], slots: [POHA_ONLY, MAIN[1], MAIN[2]], lib: { ...LIB, Breakfast: [["Kanda poha", "Poha"], ["Batata poha", "Poha"]] }, newPerWeek: 0 });
    const f = fakeModel({ careful: (u) => ({ dishes: u.dishes.filter((d: string) => d !== "Kanda poha").map((d: string) => ({ dish: d, has: [] })) }) });
    await k.plan(f.model);
    for (const d of WEEK) for (const x of k.at(d, "Breakfast")!.dishes) expect(x.not_for).toEqual(x.dish === "Kanda poha" ? ["Kabir"] : []);
  });
});

describe("make_plan: failures", () => {
  it("out of credits on a read stops at once: a plain line, nothing saved, nothing more asked", async () => {
    const k = await home({ rules: [{ hard: true, what: "veg", who: "Asha", quote: "Asha is vegetarian" }], library: [{ name: "Mystery curry", slot: "Lunch", contains: [], contains_read: [] }] });
    const f = fakeModel({ contains: () => ({ ok: false, code: "out_of_credits", message: "no credits" }) });
    const r = await k.plan(f.model);
    expect(r).toEqual({ ok: false, reason: "out_of_credits", say: expect.stringContaining("credits have run out") });
    expect(k.week()).toHaveLength(0);
    expect(f.days()).toHaveLength(0);
  });

  it("the day's budget spent while the ingredients are asked stops too, nothing saved", async () => {
    const k = await home();
    const r = await k.plan(fakeModel({ day: () => ({ ok: false, code: "daily_budget", message: "spent" }) }).model);
    expect(r).toMatchObject({ ok: false, reason: "daily_budget" });
    expect(k.week()).toHaveLength(0);
  });

  it("a day's ingredients are asked once more for what was left out, then saved without them and named", async () => {
    const k = await home();
    const f = fakeModel({ day: (u) => (u.date === MON ? { dishes: [] } : ingredients(u)) });
    const r = await k.plan(f.model);
    expect(f.days().filter((c) => c.user.date === MON)).toHaveLength(2);
    if (!r.ok) throw new Error(r.say);
    expect(r.no_ingredients).toEqual([...k.dishesAt(MON, "Breakfast").map((x) => `Mon Breakfast: ${x}`), ...k.dishesAt(MON, "Lunch").map((x) => `Mon Lunch: ${x}`),
      ...k.dishesAt(MON, "Dinner").map((x) => `Mon Dinner: ${x}`)]);
  });

  it("make_plan needs a Monday, a family and the slots; two runs for one week at once are one run; with no model the week is still planned", async () => {
    const k = await home();
    expect((await k.op("make_plan", { week_start: "2026-12-01" })).error).toContain("must be a Monday");
    const bare = await boot({ now: () => new Date(2026, 10, 29, 11, 0) });
    expect(await bare.op("make_plan", { week_start: MON })).toMatchObject({ ok: false, reason: "no_family" });
    await bare.op("set_person", { name: "Asha", group: "adult" });
    expect(await bare.op("make_plan", { week_start: MON })).toMatchObject({ ok: false, reason: "no_slots" });
    const f = fakeModel({ wait: 5 });
    const [a, b] = await Promise.all([k.plan(f.model), k.plan(f.model)]);
    expect(a).toEqual(b);
    expect(f.days()).toHaveLength(7);
    // Flock's op, no model to ask: planned by code, the ingredients named as missing.
    const r = await k.op("make_plan", { week_start: MON, household: { "household.weekly": [] } });
    expect(r.ok).toBe(true);
    expect(r.no_ingredients.length).toBeGreaterThan(0);
  });
});

describe("make_plan: who eats (spec §5.1)", () => {
  it("a child carrying a box of their own is not at the home lunch on those days; a parent carrying the home lunch is (owner, 25 Nov)", async () => {
    const k = await home({ slots: [...MAIN, { name: "Kabir's tiffin", kind: "custom", order: 20, usual_people: ["Kabir"], days: ["Mon", "Tue", "Wed", "Thu", "Fri"] }],
      library: ["Sandwich", "Pasta", "Curd rice"].map((name) => ({ name, slot: "Kabir's tiffin" })) });
    const weekly = [{ person: "Kabir", where: "school", weekdays: ["Mon", "Tue", "Wed", "Thu", "Fri"], from: "08:00", to: "14:00", lunch: "carries" },
      { person: "Ravi", where: "office", weekdays: ["Mon", "Tue", "Wed", "Thu", "Fri"], from: "09:00", to: "18:00", lunch: "carries" }];
    await k.plan(fakeModel().model, { household: { "household.weekly": weekly } });
    expect(k.at(MON, "Lunch")!.people).toEqual(["Asha", "Ravi"]);
    expect(k.at(WEEK[5], "Lunch")!.people).toEqual(["Asha", "Ravi", "Kabir"]);
    expect(k.dishesAt(MON, "Kabir's tiffin").length).toBeGreaterThan(0);
  });

  it("household.weekly: away at weekday lunch is left out Mon to Fri, home on the weekend; the fresh household wins over the payload", async () => {
    const k = await home();
    const weekly = [{ person: "Ravi", where: "office", weekdays: ["Mon", "Tue", "Wed", "Thu", "Fri"], from: "09:00", to: "18:00" }];
    await k.plan(fakeModel().model, { household: { "household.weekly": [] }, peers: { household: async () => ({ "household.weekly": weekly }) } });
    expect(k.at(MON, "Lunch")!.people).toEqual(["Asha", "Kabir"]);
    expect(k.at(WEEK[5], "Lunch")!.people).toEqual(["Asha", "Ravi", "Kabir"]);
    expect(k.at(MON, "Dinner")!.people).toEqual(["Asha", "Ravi", "Kabir"]);
    expect(k.at(MON, "Breakfast")!.people).toEqual(["Asha", "Ravi", "Kabir"]);
    await k.plan(fakeModel().model, { household: { "household.weekly": [{ person: "Kabir", where: "school", weekdays: ["Mon"], from: "07:30", to: "13:30", lunch: "home" },
      { person: "Ravi", where: "office", weekdays: ["Mon"], from: "09:00", to: "21:00" }, { person: "Asha", where: "night shift", weekdays: ["Mon"], from: "18:00", to: "23:00" }] } });
    expect(k.at(MON, "Breakfast")!.people).toEqual(["Asha", "Ravi", "Kabir"]);
    expect(k.at(MON, "Lunch")!.people).toEqual(["Asha", "Kabir"]);
    expect(k.at(MON, "Dinner")!.people).toEqual(["Ravi", "Kabir"]);
    await k.plan(fakeModel().model, { household: { "household.weekly": "office" } });
    expect(k.at(MON, "Lunch")!.people).toEqual(["Asha", "Ravi", "Kabir"]);
  });

  it("what setup read of weekday lunch (house.setup_state) wins over household.weekly; read tolerantly", async () => {
    const h = readHousehold({ "household.weekly": [{ person: "Ravi", where: "office", weekdays: ["Mon"], lunch: "away" }] });
    expect(withLunchSaid(h, [{ person: "Ravi", lunch: "home" }, { person: "Asha", lunch: "carries" }]).weekly).toEqual([
      { person: "Ravi", where: "office", weekdays: ["Mon"], lunch: "home" }, { person: "Asha", where: "", weekdays: ["Mon", "Tue", "Wed", "Thu", "Fri"], lunch: "carries" }]);
    const k = await home();
    expect(lunchSaid(k.kit.sqlite)).toEqual([]);
    const fake = { query: () => ({ get: () => ({ setup_state: JSON.stringify({ weekday_lunch: [{ person: "Asha", lunch: "away", quote: "I eat at work" }, { person: "X", lunch: "maybe" }] }) }) }) };
    expect(lunchSaid(fake)).toEqual([{ person: "Asha", lunch: "away" }]);
  });

  it("the calendar's entries go to one fast call: away and joins change the slot-days; unsure is asked; a deadline is never read", async () => {
    const k = await home();
    const events: CalendarEvent[] = [{ id: "e1", title: "Ravi to Pune", date: "2026-12-01", end_date: "2026-12-02", who: "Ravi", kind: "event" },
      { id: "e2", title: "Nani comes", date: "2026-12-05", kind: "event" }, { id: "e3", title: "Thing", date: "2026-12-03", kind: "event" },
      { id: "e4", title: "Fees due", date: "2026-12-04", kind: "deadline" }];
    const f = fakeModel({ events: () => ({ changes: [{ id: "e1", effect: "away", people: ["Ravi"], dates: ["2026-12-01", "2026-12-02"], slots: null },
      { id: "e2", effect: "joins", people: ["Nani"], dates: ["2026-12-05"], slots: ["Lunch", "Dinner"] }, { id: "e3", effect: "unsure" }] }) });
    const r = await k.plan(f.model, { peers: { calendar: async () => events } });
    expect(f.events()).toHaveLength(1);
    expect(f.events()[0].req.tier).toBe("fast");
    expect(f.events()[0].user.entries.map((e: any) => e.id)).toEqual(["e1", "e2", "e3"]);
    expect(k.at("2026-12-01", "Breakfast")!.people).toEqual(["Asha", "Kabir"]);
    expect(k.at("2026-12-05", "Lunch")!.people).toEqual(["Asha", "Ravi", "Kabir", "Nani"]);
    expect(k.at("2026-12-05", "Breakfast")!.people).toEqual(["Asha", "Ravi", "Kabir"]);
    expect(r.ok && r.asked).toEqual(['Does "Thing" (Thu) change who eats at home?']);
    if (r.ok) expect(r.message).toContain('\nDoes "Thing" (Thu) change who eats at home?\n');
  });

  it("an entry that is part of its person's week (office, school, a weekly class) is never read nor asked; one that may change who eats is", () => {
    const weekly = readHousehold({ "household.weekly": [{ person: "Shiva", where: "office", weekdays: ["Mon", "Tue", "Wed", "Thu", "Fri"], from: "09:00", to: "18:00" },
      { person: "Agastya", where: "school", weekdays: ["Mon", "Tue", "Wed", "Thu", "Fri"], from: "08:00", to: "15:00" },
      { person: "Ankita", where: "home", weekdays: ["Mon", "Tue", "Wed", "Thu", "Fri"] }] }).weekly;
    const wk = { from: MON, to: WEEK[6] };
    const ev = (title: string, who: string | null, from: string, x: Partial<{ to: string; repeat: string; start_time: string; end_time: string }> = {}) => ({ title, who, from, to: x.to ?? from, ...x });
    expect(coveredByWeek(ev("Office", "Shiva", MON, { repeat: "weekly" }), weekly, wk)).toBe(true);
    expect(coveredByWeek(ev("School", "Agastya", WEEK[1], { repeat: "weekly" }), weekly, wk)).toBe(true);
    expect(coveredByWeek(ev("Football", "Agastya", WEEK[1], { repeat: "weekly", start_time: "16:00", end_time: "17:30" }), weekly, wk)).toBe(true);
    expect(coveredByWeek(ev("Office", "Shiva", MON), weekly, wk)).toBe(true);
    expect(coveredByWeek(ev("Client call", "Shiva", MON, { start_time: "11:00", end_time: "12:00" }), weekly, wk)).toBe(true);
    expect(coveredByWeek(ev("Dinner with clients", "Shiva", WEEK[1], { start_time: "20:00", end_time: "22:00" }), weekly, wk)).toBe(false);
    expect(coveredByWeek(ev("Pune trip", "Shiva", MON, { to: WEEK[2] }), weekly, wk)).toBe(false);
    expect(coveredByWeek(ev("Football", "Agastya", WEEK[5], { repeat: "weekly" }), weekly, wk)).toBe(false);
    expect(coveredByWeek(ev("Yoga", "Ankita", MON, { repeat: "weekly" }), weekly, wk)).toBe(false);
    expect(coveredByWeek(ev("Office", null, MON, { repeat: "weekly" }), weekly, wk)).toBe(false);
    expect(coveredByWeek(ev("Office", "Shiva", MON, { repeat: "weekly" }), null, wk)).toBe(false);
    expect(coveredByWeek(ev("School run", "Shiva and Agastya", MON, { repeat: "weekly" }), weekly, wk)).toBe(true);
    expect(coveredByWeek(ev("School run", "Shiva, Ankita", MON, { repeat: "weekly" }), weekly, wk)).toBe(false);
    // Class 3: an entry that names the place but is more than the routine (a school trip, an office offsite) may take them away
    // from meals at home: read, not taken as the routine. The place alone ("Office", "Agastya school") is the routine.
    expect(coveredByWeek(ev("School trip to Udaipur", "Agastya", WEEK[3], { to: WEEK[4] }), weekly, wk)).toBe(false);
    expect(coveredByWeek(ev("Office offsite", "Shiva", WEEK[1]), weekly, wk)).toBe(false);
    expect(coveredByWeek(ev("Agastya school", "Agastya", WEEK[1]), weekly, wk)).toBe(true);
  });

  it("run 31: the routine's entries are not sent to the calendar call nor asked; the one it is unsure of is the message's only question", async () => {
    const k = await home({ people: [["Shiva", "adult"], ["Ankita", "adult"], ["Agastya", "child"]] });
    const weekly = [{ person: "Shiva", where: "office", weekdays: ["Mon", "Tue", "Wed", "Thu", "Fri"], from: "09:00", to: "18:00" },
      { person: "Agastya", where: "school", weekdays: ["Mon", "Tue", "Wed", "Thu", "Fri"], from: "08:00", to: "15:00" }];
    const routine = [["Office", "Shiva", "o1", "09:00", "18:00"], ["School", "Agastya", "s1", "08:00", "15:00"], ["Football", "Agastya", "f1", "16:00", "17:30"]] as const;
    const events: CalendarEvent[] = [
      ...WEEK.slice(0, 5).flatMap((date) => routine.map(([title, who, id, start_time, end_time]) => ({ id, title, date, repeat: "weekly", kind: "event", who, start_time, end_time }))),
      { id: "d1", title: "Dinner at the Raos", date: WEEK[3], repeat: "none", kind: "event", who: "Shiva", start_time: "20:00" }];
    const f = fakeModel({ events: () => ({ changes: [{ id: "d1", effect: "unsure" }] }) });
    const r = await k.plan(f.model, { household: { "household.weekly": weekly }, peers: { calendar: async () => events } });
    if (!r.ok) throw new Error(r.say);
    expect(f.events()).toHaveLength(1);
    expect(f.events()[0].user.entries.map((e: any) => e.id)).toEqual(["d1"]);
    expect(r.asked).toEqual(['Does "Dinner at the Raos" (Shiva, Thu) change who eats at home?']);
    expect(r.message).not.toContain("Office");
    expect(r.message.split("\n").filter((l) => l.trim().endsWith("?"))).toEqual(r.asked!);
    const g = fakeModel();
    const r2 = await k.plan(g.model, { household: { "household.weekly": weekly }, peers: { calendar: async () => events.filter((e) => e.id !== "d1") } });
    expect(g.events()).toHaveLength(0);
    expect(r2.ok && r2.asked).toBeFalsy();
  });

  it("no calendar (an older SDK, or none installed): the household's dated stays are read instead", async () => {
    expect(platformPeers({})).toEqual({});
    expect(platformPeers({ apps: { read: () => null } })).toEqual({});
    const both = platformPeers({ household: { get: async () => ({ ok: true, data: { household: { "household.weekly": [] } } }) },
      apps: { op: async () => ({ ok: false, status: 404, code: "not_installed" }) } });
    expect(await both.household!()).toEqual({ "household.weekly": [] });
    expect(await both.calendar!(MON, WEEK[6])).toBeNull();
    const peers = platformPeers({ apps: { op: async () => ({ ok: false, status: 404 }) } });
    const k = await home();
    const f = fakeModel({ events: (u) => ({ changes: [{ id: u.entries[0].id, effect: "away", people: ["Asha"], dates: ["2026-12-02"], slots: null }] }) });
    await k.plan(f.model, { household: { "household.dated": [{ person: "Asha", what: "at her sister's", from: "2026-12-02" }] }, peers });
    expect(f.events()[0].user.entries[0]).toMatchObject({ title: "at her sister's", who: "Asha", from: "2026-12-02" });
    expect(k.at("2026-12-02", "Dinner")!.people).toEqual(["Ravi", "Kabir"]);
  });

  it("a fast with nothing to eat takes the person off that slot-day; one with fasting food keeps them, with a note; a skip day is skipped, not asked", async () => {
    const k = await home({
      slots: [MAIN[0], MAIN[1], { ...MAIN[2], skip_days: [{ day: "Sun", skip: "eaten_out" }] }, { name: "Ravi's dinner", kind: "addon", addon_of: "Dinner", order: 60, usual_people: ["Ravi"] }],
      library: ["Phulka", "Jowar roti"].map((name) => ({ name, slot: "Ravi's dinner" })),
      rules: [{ hard: true, what: "fasting", who: "Asha", days: ["Thu"], slots: ["Breakfast", "Lunch"], quote: "I fast Thursdays till evening" },
        { hard: true, what: "fasting", who: "Ravi", days: ["Mon"], fasting_food: ["fruit", "sabudana"], quote: "Monday fast, only fruit" }],
    });
    const r = await k.plan(fakeModel().model);
    expect(k.at("2026-12-03", "Lunch")!.people).toEqual(["Ravi", "Kabir"]);
    expect(k.at(MON, "Lunch")!.people).toContain("Ravi");
    expect(k.at(MON, "Lunch")!.note).toBe("Ravi fasts: only fruit, sabudana (Monday fast, only fruit)");
    expect(k.at("2026-12-06", "Dinner")).toMatchObject({ skip: "eaten_out", dishes: [] });
    expect(k.at("2026-12-06", "Ravi's dinner")).toMatchObject({ skip: "eaten_out", dishes: [] });
    expect(k.dishesAt("2026-12-05", "Ravi's dinner").length).toBeGreaterThan(0);
    if (r.ok) expect(r.message).toContain("Dinner: eating out");
  });

  it("a meal ordered in on its day gets no dishes; a person's own meal in place of it is still cooked, and they are never at the family's (classes 3, 4)", async () => {
    const k = await home({
      slots: [MAIN[0], MAIN[1], { ...MAIN[2], usual_people: ["Asha", "Ravi"], skip_days: [{ day: "Sat", skip: "ordered_in" }] },
        { name: "Kabir's dinner", kind: "custom", order: 55, usual_people: ["Kabir"] }],
      library: ["Khichdi", "Dal rice"].map((name) => ({ name, slot: "Kabir's dinner" })),
    });
    await k.plan(fakeModel().model);
    expect(k.at("2026-12-05", "Dinner")).toMatchObject({ skip: "ordered_in", dishes: [] });
    expect(k.dishesAt("2026-12-05", "Dinner")).toEqual([]);
    expect(k.dishesAt("2026-12-05", "Kabir's dinner").length).toBeGreaterThan(0);
    for (const d of WEEK) expect(k.at(d, "Dinner")!.people).not.toContain("Kabir");
    for (const d of WEEK) expect(k.at(d, "Kabir's dinner")!.people).toEqual(["Kabir"]);
  });

  it("an edited slot-day is kept: with dishes it is not planned again; without, its people, guests and occasion stay as the family set them", async () => {
    const k = await home();
    commit(k.kit.db, k.kit.emitChange, (tx, ch) => {
      saveSlotDay(tx, { date: "2026-12-02", slot: "Lunch", people: ["Asha"], edited: true, dishes: [{ dish: "Biryani" }] }, "user:x", ch);
      saveSlotDay(tx, { date: "2026-12-03", slot: "Dinner", people: ["Asha", "Ravi", "Kabir"], guests: [{ count: 4 }], occasion: "dinner party", edited: true }, "user:x", ch);
    });
    await k.plan(fakeModel().model);
    await k.plan(fakeModel().model);
    expect(k.at("2026-12-02", "Lunch")).toMatchObject({ people: ["Asha"], edited: true });
    expect(k.dishesAt("2026-12-02", "Lunch")).toEqual(["Biryani"]);
    expect(k.at("2026-12-03", "Dinner")).toMatchObject({ edited: true, guests: [{ count: 4 }], occasion: "dinner party" });
    expect(k.dishesAt("2026-12-03", "Dinner").length).toBeGreaterThan(0);
    expect(k.week()).toHaveLength(21);
  });
});

describe("make_plan: guards", () => {
  // Eval households (tuned h1–h8 and held-out h9–h12) and the sim family: no name of theirs in any model-facing text.
  const NAMES = ["Sharma", "Iyer", "Shiva", "Reddy", "Agarwal", "Kulkarni", "Menon", "Banerjee", "Ankita", "Agastya", "Gowri", "Lakshmi", "Mehta", "Qureshi",
    "Dsouza", "D'souza", "Gita", "Geeta", "Vihaan", "Reyansh", "Zayan", "Farah", "Shabana", "Debjani", "Sourav", "Rituparna", "Kantaben", "Selvi", "Srinivas"];
  it("no eval household name in any text a plan's model reads", () => {
    for (const t of [GUESTS_SYSTEM, CAREFUL_SYSTEM, CONTAINS_SYSTEM, INGREDIENT_SYSTEM, EVENTS_SYSTEM, DELIVER_PROMPT(true), FESTIVAL_PROMPT(MON)])
      for (const n of NAMES) expect(t.toLowerCase(), n).not.toContain(n.toLowerCase());
  });
  it("no word lists for meaning in the plan's code: no regex of day names, kinship words or less/more", () => {
    for (const file of ["makePlan.ts", "planDays.ts", "planChecks.ts", "fillWeek.ts"]) {
      const src = readFileSync(join(import.meta.dir, file), "utf8");
      for (const r of src.match(/\/\^?\(?[^/\n*][^/\n]*\/[gimsuy]*\.test|new RegExp\([^)]*\)|\/[^/\n]+\/[gimsuy]*(?=\.test|,\s*"|\))/g) ?? [])
        expect(r, `${file}: ${r}`).not.toMatch(/monday|tuesday|\bmon\b|\bsun\b|weekend|amma|papa|nani|mother|father|\bless\b|\bmore\b/i);
    }
  });
});
