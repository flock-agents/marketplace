// make_plan on the slot model (makePlan.ts, planDays.ts, planChecks.ts; docs/slot-model-spec.md §5) with a fake model: the
// slot-days worked out in code (weekly patterns, the calendar or dated stays, fasts, meals eaten out, edited slot-days kept),
// one call per slot in planning order (at most 3 at once, an add-on after its main), code's checks per person, one fix call,
// rotation, each day's ingredients, the save and the message. The fake answers by the call's purpose.
import { describe, it, expect } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";
import { boot } from "./testkit";
import { CONTAINS_SYSTEM, FIX_SYSTEM, INGREDIENT_SYSTEM, makePlan, SLOT_SYSTEM } from "./makePlan";
import { EVENTS_SYSTEM, lunchSaid, platformPeers, readHousehold, withLunchSaid, type CalendarEvent } from "./planDays";
import type { ModelRequest, ModelResult } from "./model";
import { addRule, commit, getLibraryDish, listSlotDays, saveSlotDay, upsertLibrary, upsertSlot, type LibraryInput, type RuleInput, type SlotInput } from "./slotStore";
import { DELIVER_PROMPT, FESTIVAL_PROMPT } from "./routines/weekly-plan";

const MON = "2026-11-30", TODAY = "2026-11-29";
const WEEK = ["2026-11-30", "2026-12-01", "2026-12-02", "2026-12-03", "2026-12-04", "2026-12-05", "2026-12-06"];
const quiet = () => {};
const MAIN: SlotInput[] = [{ name: "Breakfast", kind: "main", order: 10 }, { name: "Lunch", kind: "main", order: 30 }, { name: "Dinner", kind: "main", order: 50 }];
/** Four dishes a slot: a week of seven days rotates them two days each at most, four days apart. */
const LIB: Record<string, string[]> = { Breakfast: ["Poha", "Upma", "Idli", "Dosa"], Lunch: ["Sambar", "Rajma", "Kadhi", "Chole"], Dinner: ["Palak paneer", "Aloo gobi", "Bhindi", "Dal makhani"] };
const READ = ["egg", "meat", "fish", "onion_garlic"];

type Call = { req: ModelRequest; user: any };
/** A fake model by purpose. `slot`: a slot call's answer (default: staples, then the library in turn); `fix`; `contains`;
 *  `day` (ingredients); `events`; `wait`: how long a slot call takes. */
function fakeModel(h: { slot?: (u: any) => unknown; fix?: (u: any) => unknown; contains?: (u: any) => unknown; day?: (u: any) => unknown; events?: (u: any) => unknown;
  wait?: (u: any) => number } = {}) {
  const calls: Call[] = [];
  let running = 0, most = 0;
  const wrap = (v: unknown): ModelResult => (v && typeof v === "object" && "ok" in (v as object) ? v as ModelResult : { ok: true, json: v, model: "fake" });
  const model = async (req: ModelRequest): Promise<ModelResult> => {
    const user = JSON.parse(req.user);
    calls.push({ req, user });
    const p = req.purpose ?? "";
    if (p.startsWith("meal plan: the week's ") || p.startsWith("meal plan: fix the ")) {
      running++; most = Math.max(most, running);
      try {
        const ms = h.wait?.(user) ?? 0;
        if (ms) await Bun.sleep(ms);
        return wrap(p.includes("fix") ? (h.fix ?? rotateDays)(user) : (h.slot ?? rotateDays)(user));
      } finally { running--; }
    }
    if (p.includes("contain")) return wrap((h.contains ?? (() => ({ dishes: [] })))(user));
    if (p.includes("calendar")) return wrap((h.events ?? (() => ({ changes: [] })))(user));
    return wrap((h.day ?? ingredients)(user));
  };
  const of = (s: string) => calls.filter((c) => (c.req.purpose ?? "").includes(s));
  return { model, calls, slots: () => of("the week's "), fixes: () => of("fix the"), contains: () => of("contain"), days: () => of("ingredients"), events: () => of("calendar"), most: () => most };
}
/** A good answer: each day the staples, then the library's dishes in turn. A fix answers its `fix` dates the same way. */
function rotateDays(u: any): unknown {
  const lib = u.library.map((d: any) => d.dish);
  const all = u.days.filter((d: any) => !d.skip).map((d: any) => d.date);
  const dates = (u.fix ? u.fix.map((f: any) => f.date) : all) as string[];
  return { days: Object.fromEntries(dates.map((date) => [date, [...u.staples, ...(lib.length ? [lib[all.indexOf(date) % lib.length]] : [])]])) };
}
const ingredients = (u: any) => ({ dishes: u.dishes.map((d: any) => ({ slot: d.slot, name: d.name, ingredients: [{ item: d.name.toLowerCase(), amount: 200, unit: "g", tags: [] }] })) });

async function home(o: { people?: [string, string][]; slots?: SlotInput[]; lib?: Record<string, string[]>; library?: LibraryInput[]; rules?: RuleInput[];
  seed?: { slot: string; dishes: string[] }[]; history?: { date: string; slot: string; dishes: string[]; status: "planned" | "confirmed" }[]; newPerWeek?: number } = {}) {
  const k = await boot({ now: () => new Date(2026, 10, 29, 11, 0) });
  for (const [name, group] of o.people ?? [["Asha", "adult"], ["Ravi", "adult"], ["Kabir", "child"]]) await k.op("set_person", { name, group });
  if (o.newPerWeek !== undefined) k.kit.sqlite.run(`INSERT INTO _settings (id, created_at, updated_at, updated_by, key, value, scope) VALUES ('n1', '', '', 'app', 'new_dishes_per_week', ?, 'owner')`, [JSON.stringify(o.newPerWeek)]);
  commit(k.kit.db, k.kit.emitChange, (tx, ch) => {
    for (const s of o.slots ?? MAIN) upsertSlot(tx, s, "app", ch);
    for (const [slot, names] of Object.entries(o.lib ?? LIB)) for (const name of names) upsertLibrary(tx, { name, slot, origin: "setup_named", contains: [], contains_read: READ }, "app", ch);
    for (const d of o.library ?? []) upsertLibrary(tx, { contains_read: READ, ...d }, "app", ch);
    for (const r of o.rules ?? []) addRule(tx, r, "app", ch);
    for (const s of o.seed ?? []) saveSlotDay(tx, { date: null, slot: s.slot, dishes: s.dishes.map((dish) => ({ dish })) }, "app", ch);
    for (const h of o.history ?? []) saveSlotDay(tx, { date: h.date, slot: h.slot, status: h.status, dishes: h.dishes.map((dish) => ({ dish })) }, "app", ch);
  });
  const plan = (model: (r: ModelRequest) => Promise<ModelResult>, x: { household?: unknown; peers?: any; log?: (l: string) => void } = {}) =>
    makePlan({ db: k.kit.db, emit: k.kit.emitChange, model, weekStart: MON, today: TODAY, basePath: "/a/t", log: x.log ?? quiet, household: x.household, peers: x.peers, sqlite: k.kit.sqlite });
  const week = () => listSlotDays(k.kit.db, { from: MON, to: WEEK[6] });
  const at = (date: string, slot: string) => week().find((d) => d.date === date && d.slot === slot);
  const dishesAt = (date: string, slot: string) => at(date, slot)?.dishes.map((d) => d.dish) ?? [];
  return { ...k, plan, week, at, dishesAt };
}
const reqOf = (f: ReturnType<typeof fakeModel>, slot: string) => f.slots().find((c) => c.user.slot === slot)!.user;

describe("make_plan v2: a week that passes", () => {
  it("one call per slot, one ingredients call a day, every slot-day saved planned with ingredients, and the week by day in the message", async () => {
    const k = await home({ seed: [{ slot: "Lunch", dishes: ["Rice", "Sambar", "Curd"] }, { slot: "Lunch", dishes: ["Rice", "Rajma", "Curd"] }, { slot: "Lunch", dishes: ["Rice", "Kadhi", "Curd"] }] });
    const f = fakeModel();
    const r = await k.plan(f.model);
    expect(r.ok).toBe(true);
    expect(f.slots().map((c) => c.user.slot)).toEqual(["Breakfast", "Lunch", "Dinner"]);
    expect(f.fixes()).toHaveLength(0);
    expect(f.days()).toHaveLength(7);
    expect(f.slots().every((c) => c.req.tier === "balanced" && c.req.system === SLOT_SYSTEM && !!c.req.schema)).toBe(true);
    expect(f.days().every((c) => c.req.tier === "fast")).toBe(true);
    expect(k.week()).toHaveLength(21);
    for (const d of k.week()) {
      expect(d.status).toBe("planned");
      expect(d.people).toEqual(["Asha", "Ravi", "Kabir"]);
      expect(d.dishes.length).toBeGreaterThan(0);
      for (const x of d.dishes) expect(x.ingredients.length).toBeGreaterThan(0);
    }
    // The seed makes Rice and Curd Lunch's staples (in every row of its history), so they come every day.
    expect(reqOf(f, "Lunch").staples).toEqual(["Rice", "Curd"]);
    expect(reqOf(f, "Lunch").looks_like).toEqual(["Rice, Sambar, Curd", "Rice, Rajma, Curd", "Rice, Kadhi, Curd"]);
    expect(k.dishesAt(MON, "Lunch")).toEqual(["Rice", "Curd", "Chole"]);
    if (!r.ok) throw new Error();
    expect(r.message).toContain("Your week is planned.");
    expect(r.message).toContain("*Monday*\nBreakfast: Dosa\nLunch: Rice, Curd, Chole\nDinner:");
    expect(r.message).toContain("*Sunday*");
    expect(r.message).toContain("[Week page](/a/t/?flock_scope=app#/week?week=2026-11-30)");
    expect(r.intro).toContain("How it works");
    expect(r.unmet).toBeUndefined();
  });

  it("the request is the spec's: days with who, looks_like, staples, library with left, already_this_week, recent, rules, notes, new_dishes_allowed", async () => {
    const k = await home({ rules: [{ hard: true, what: "avoid", who: "Asha", items: ["sugar"], quote: "no sugar for me" },
      { hard: false, what: "note", who: "Kabir", quote: "less spicy" }] });
    const f = fakeModel({ wait: (u) => (u.slot === "Breakfast" ? 0 : 5) });
    await k.plan(f.model);
    const u = reqOf(f, "Lunch");
    expect(u.days).toHaveLength(7);
    expect(u.days[0]).toEqual({ date: MON, for: ["Asha", "Ravi", "Kabir"] });
    expect(u.library.map((d: any) => [d.dish, d.left])).toEqual([["Chole", 2], ["Kadhi", 2], ["Rajma", 2], ["Sambar", 2]]);
    expect(u.rules).toEqual(["Asha: no sugar for me [never: sugar]"]);
    expect(u.notes_for_people).toEqual(["Kabir: less spicy"]);
    expect(typeof u.new_dishes_allowed).toBe("number");
    expect(u.occasion).toBeNull();
    // The library dishes were never read for sugar: each is not for Asha (fail closed), said to the model.
    expect(u.library[0].not_for).toEqual(["Asha"]);
  });
});

describe("make_plan v2: history (spec §2.2)", () => {
  it("looks_like holds only the seed and confirmed rows; recent includes planned ones; staples come from confirmed rows only", async () => {
    const k = await home({
      seed: [{ slot: "Lunch", dishes: ["Rice", "Dal", "Curd"] }],
      history: [
        { date: "2026-11-26", slot: "Lunch", status: "confirmed", dishes: ["Rice", "Sambar"] },
        { date: "2026-11-27", slot: "Lunch", status: "confirmed", dishes: ["Rice", "Khichdi"] },
        { date: "2026-11-28", slot: "Lunch", status: "planned", dishes: ["Roti", "Paneer"] },
        { date: "2026-11-29", slot: "Lunch", status: "planned", dishes: ["Roti", "Chole"] },
      ],
    });
    const f = fakeModel();
    await k.plan(f.model);
    const u = reqOf(f, "Lunch");
    expect(u.looks_like).toEqual(["Rice, Khichdi", "Rice, Sambar", "Rice, Dal, Curd"]);
    expect(u.looks_like.join(" ")).not.toContain("Paneer");
    expect(u.recent).toEqual({ "2026-11-27": ["Rice", "Khichdi"], "2026-11-28": ["Roti", "Paneer"], "2026-11-29": ["Roti", "Chole"] });
    // Roti is in 2 of 5 history rows, but planned rows never feed staples: Rice (3 of 3 seed and confirmed rows) does.
    expect(u.staples).toEqual(["Rice"]);
    // Chole was shown on Sunday: on Monday it is within 3 days of itself, so a plan with it there is sent back.
    const g = fakeModel({ slot: (x) => x.slot === "Lunch" ? { days: Object.fromEntries(x.days.map((d: any, i: number) => [d.date, ["Rice", ["Chole", "Rajma", "Kadhi", "Sambar"][i % 4]]])) } : rotateDays(x) });
    await k.plan(g.model);
    expect(g.fixes().map((c) => c.user.slot)).toEqual(["Lunch"]);
    expect(g.fixes()[0].user.fix[0].wrong.join(" ")).toContain("Chole is on Sun and Mon");
  });

  it("a dish the family has daily is a staple by their word: given as one, and put on every slot-day of its slot when the model leaves it out", async () => {
    const k = await home({ library: [{ name: "Salad", slot: "Lunch", frequency: "daily", origin: "setup_named" }] });
    const f = fakeModel({ slot: (u) => ({ days: Object.fromEntries(u.days.map((d: any, i: number) => [d.date, [u.library[i % u.library.length].dish]])) }) });
    await k.plan(f.model);
    expect(reqOf(f, "Lunch").staples).toEqual(["Salad"]);
    for (const date of WEEK) expect(k.dishesAt(date, "Lunch")).toContain("Salad");
    expect(f.fixes()).toHaveLength(0);
  });
});

describe("make_plan v2: never planned", () => {
  it("a disliked dish and a dropped untried dish are not offered, are sent back when planned, and never saved", async () => {
    const k = await home({ library: [{ name: "Karela", slot: "Dinner", disliked: true }, { name: "Reel pasta", slot: "Dinner", untried: true, offers: 2, origin: "family_added" }] });
    const f = fakeModel({
      slot: (u) => u.slot === "Dinner" ? { days: { ...(rotateDays(u) as any).days, [MON]: ["Karela"], "2026-12-01": ["Reel pasta"] }, new: [{ dish: "Karela" }, { dish: "Reel pasta" }] } : rotateDays(u),
      fix: (u) => ({ days: Object.fromEntries(u.fix.map((x: any) => [x.date, ["Karela"]])) }),
    });
    const r = await k.plan(f.model);
    expect(r.ok).toBe(true);
    expect(reqOf(f, "Dinner").library.map((d: any) => d.dish)).not.toContain("Karela");
    expect(reqOf(f, "Dinner").library.map((d: any) => d.dish)).not.toContain("Reel pasta");
    const wrong = f.fixes()[0].user.fix.flatMap((x: any) => x.wrong).join(" ");
    expect(wrong).toContain("Karela: the family did not like it");
    expect(wrong).toContain("Reel pasta: offered twice and never made");
    for (const d of k.week()) for (const x of d.dishes) expect(["Karela", "Reel pasta"]).not.toContain(x.dish);
    // One fix call, then code: no loop.
    expect(f.fixes()).toHaveLength(1);
    expect(f.slots().filter((c) => c.user.slot === "Dinner")).toHaveLength(1);
  });
});

describe("make_plan v2: hard rules per person, fail closed", () => {
  const GRANDMA: RuleInput = { hard: true, what: "veg", who: "Nani", quote: "Nani is vegetarian" };
  const people: [string, string][] = [["Asha", "adult"], ["Nani", "elder"]];

  it("a fish lunch beside dal with a vegetarian grandmother passes: the fish is not for her, said in the message", async () => {
    const k = await home({ people, rules: [GRANDMA], lib: { Breakfast: LIB.Breakfast, Dinner: LIB.Dinner, Lunch: ["Dal", "Sambar", "Rajma", "Kadhi"] },
      library: [{ name: "Fish curry", slot: "Lunch", contains: ["fish"], contains_read: READ }] });
    const f = fakeModel({ slot: (u) => u.slot === "Lunch" ? { days: Object.fromEntries(u.days.map((d: any, i: number) => [d.date, i === 0 ? ["Fish curry", "Dal"] : [["Sambar", "Rajma", "Kadhi", "Dal"][i % 4]]])) } : rotateDays(u) });
    const r = await k.plan(f.model);
    expect(f.fixes()).toHaveLength(0);
    expect(k.at(MON, "Lunch")!.dishes.map((d) => [d.dish, d.not_for])).toEqual([["Fish curry", ["Nani"]], ["Dal", []]]);
    expect(reqOf(f, "Lunch").library.find((d: any) => d.dish === "Fish curry").not_for).toEqual(["Nani"]);
    if (r.ok) expect(r.message).toContain("Lunch: Fish curry (not for Nani), Dal");
    // The week page reads it too.
    const week = (await k.owner("GET", `/api/weeks/${MON}`)).body;
    expect(week.days[0].meals.find((m: any) => m.slot === "Lunch").dishes[0].not_for).toEqual(["Nani"]);
  });

  it("a dish not for someone keeps its ingredients (the fish stays in the fish curry); a slot where one person has none of its dishes gets a new dish for them", async () => {
    const k = await home({ people, rules: [GRANDMA], newPerWeek: 2, lib: { Breakfast: LIB.Breakfast, Dinner: LIB.Dinner, Lunch: [] },
      seed: [1, 2, 3].map(() => ({ slot: "Lunch", dishes: ["Rice", "Dal"] })),
      library: [{ name: "Rice", slot: "Lunch", contains: [], contains_read: READ }, { name: "Dal", slot: "Lunch", contains: [], contains_read: READ },
        { name: "Fish curry", slot: "Lunch", days: ["Sun"], contains: ["fish"], contains_read: READ }] });
    const f = fakeModel({ slot: (u) => u.slot === "Lunch" ? { days: Object.fromEntries(u.days.map((d: any) => [d.date, d.date === WEEK[6] ? ["Rice", "Dal", "Fish curry", "Lauki"] : ["Rice", "Dal"]])), new: [{ dish: "Lauki", why: "for Nani" }] } : rotateDays(u),
      contains: (u) => ({ dishes: u.dishes.map((d: string) => ({ dish: d, has: [], not: READ })) }),
      day: (u) => ({ dishes: u.dishes.map((d: any) => ({ slot: d.slot, name: d.name, ingredients: [{ item: d.name === "Fish curry" ? "rohu" : d.name.toLowerCase(), amount: 200, unit: "g", tags: d.name === "Fish curry" ? ["fish"] : [] }] })) }) });
    await k.plan(f.model);
    expect(reqOf(f, "Lunch").new_dishes_allowed).toBeGreaterThanOrEqual(1);
    const sun = k.at(WEEK[6], "Lunch")!.dishes;
    expect(sun.map((d) => [d.dish, d.not_for])).toEqual([["Rice", []], ["Dal", []], ["Fish curry", ["Nani"]], ["Lauki", []]]);
    expect(sun.find((d) => d.dish === "Fish curry")!.ingredients.map((i) => i.item)).toEqual(["rohu"]);
  });

  it("a person left with nothing they can eat is sent back; a dish never read for their rule's item is not theirs (fail closed); code adds one for them", async () => {
    const k = await home({ people, rules: [GRANDMA], library: [{ name: "Mystery curry", slot: "Lunch", contains: [], contains_read: [] }] });
    const f = fakeModel({ slot: (u) => u.slot === "Lunch" ? { days: { ...(rotateDays(u) as any).days, [MON]: ["Mystery curry"] } } : rotateDays(u),
      fix: (u) => ({ days: Object.fromEntries(u.fix.map((x: any) => [x.date, ["Mystery curry"]])) }) });
    await k.plan(f.model);
    const fix = f.fixes()[0].user.fix;
    expect(fix[0].date).toBe(MON);
    expect(fix[0].wrong.join(" ")).toContain(`Nani has nothing to eat on ${MON} Lunch`);
    expect(fix[0].wrong.join(" ")).toContain("not known whether it has meat");
    const mon = k.at(MON, "Lunch")!.dishes;
    expect(mon.find((d) => d.dish === "Mystery curry")!.not_for).toEqual(["Nani"]);
    expect(mon.some((d) => d.dish !== "Mystery curry" && !d.not_for.includes("Nani"))).toBe(true);
  });

  it("a person with their own add-on that day is fed there: the main slot is not sent back for them, and the call is told", async () => {
    const k = await home({ people, rules: [GRANDMA], slots: [...MAIN, { name: "Nani's lunch", kind: "addon", addon_of: "Lunch", order: 60, usual_people: ["Nani"] }],
      lib: { ...LIB, Lunch: ["Fish curry", "Prawn curry", "Chicken curry", "Egg curry"], "Nani's lunch": ["Lauki", "Tinda", "Turai"] },
      library: ["Fish curry", "Prawn curry", "Chicken curry", "Egg curry"].map((name) => ({ name, slot: "Lunch", contains: ["fish"], contains_read: READ })) });
    const f = fakeModel();
    await k.plan(f.model);
    expect(f.fixes().filter((c) => c.user.slot === "Lunch")).toHaveLength(0);
    expect(reqOf(f, "Lunch").days[0].own_slot).toEqual(["Nani"]);
    expect(k.dishesAt(MON, "Nani's lunch").length).toBeGreaterThan(0);
  });

  it("a slot too thin for its week is filled with the least bad by code, never left with a dish on the wrong day", async () => {
    const k = await home({ slots: [...MAIN, { name: "Ravi's breakfast", kind: "addon", addon_of: "Breakfast", order: 60, usual_people: ["Ravi"] }],
      lib: { ...LIB, "Ravi's breakfast": ["Ragi dosa", "Ragi malt"] }, library: [{ name: "Thalipeeth", slot: "Ravi's breakfast", days: ["Sun"], contains: [], contains_read: READ }], newPerWeek: 0 });
    const f = fakeModel({ slot: (u) => u.slot === "Ravi's breakfast" ? { days: Object.fromEntries(u.days.map((d: any) => [d.date, ["Thalipeeth"]])) } : rotateDays(u),
      fix: (u) => u.slot === "Ravi's breakfast" ? { days: Object.fromEntries(u.fix.map((x: any) => [x.date, ["Thalipeeth"]])) } : rotateDays(u) });
    const r = await k.plan(f.model);
    for (const date of WEEK.slice(0, 6)) {
      const ds = k.dishesAt(date, "Ravi's breakfast");
      expect(ds).not.toContain("Thalipeeth");
      expect(ds.length).toBe(1);
    }
    if (r.ok) expect(r.relaxed).toEqual({ "Ravi's breakfast": 2 });
  });

  it("a new dish gets a contains read before the check, for the rules' tags and the base ones; what it has is saved on its library row", async () => {
    const k = await home({ people, rules: [{ hard: true, what: "avoid", who: "Nani", items: ["sugar"], quote: "no sugar for Nani" }],
      library: Object.entries(LIB).flatMap(([slot, names]) => names.map((name) => ({ name, slot, contains: [], contains_read: [...READ, "sugar"] }))) });
    const f = fakeModel({
      slot: (u) => u.slot === "Breakfast" ? { days: { ...(rotateDays(u) as any).days, [MON]: ["Poha", "Sheera"] }, new: [{ dish: "Sheera", why: "a sweet like their halwa" }] } : rotateDays(u),
      contains: (u) => ({ dishes: u.dishes.map((d: string) => ({ dish: d, has: ["sugar"], not: ["egg", "meat", "fish", "onion_garlic"] })) }),
    });
    const r = await k.plan(f.model);
    const read = f.contains().find((c) => c.user.dishes.includes("Sheera"))!;
    expect(read.req.system).toBe(CONTAINS_SYSTEM);
    expect(read.user.tags).toEqual(["egg", "meat", "fish", "onion_garlic", "nuts", "peanut", "sugar", "white_rice", "dairy"]);
    expect(k.at(MON, "Breakfast")!.dishes.map((d) => [d.dish, d.not_for, d.new])).toEqual([["Poha", [], false], ["Sheera", ["Nani"], true]]);
    const row = getLibraryDish(k.kit.db, "Sheera", "Breakfast")!;
    expect(row).toMatchObject({ origin: "planner_suggested", suggested: true, untried: true, offers: 1, contains: ["sugar"] });
    expect(row.contains_read.sort()).toEqual(["egg", "fish", "meat", "onion_garlic", "sugar"]);
    if (r.ok) expect(r.message).toContain("New this week: Sheera (a sweet like their halwa)");
  });
});

describe("make_plan v2: ordered slot calls", () => {
  it("in planning order, never more than 3 at once; an add-on starts after its main slot and gets that slot's dishes", async () => {
    const k = await home({
      slots: [...MAIN, { name: "Kabir's tiffin", kind: "custom", order: 20, usual_people: ["Kabir"], days: ["Mon", "Tue", "Wed", "Thu", "Fri"] },
        { name: "Snack", kind: "custom", order: 40 }, { name: "Ravi's dinner", kind: "addon", addon_of: "Dinner", order: 60, usual_people: ["Ravi"] }],
      lib: { ...LIB, "Kabir's tiffin": ["Sandwich", "Paratha roll", "Poha cutlet", "Idli fry"], Snack: ["Chana", "Makhana", "Fruit chaat", "Sprouts"], "Ravi's dinner": ["Phulka", "Bajra roti", "Jowar roti", "Ragi roti"] },
    });
    const f = fakeModel({ wait: (u) => (u.slot === "Dinner" ? 30 : 10) });
    const r = await k.plan(f.model);
    expect(r.ok).toBe(true);
    expect(f.most()).toBe(3);
    expect(f.slots().map((c) => c.user.slot)).toEqual(["Breakfast", "Kabir's tiffin", "Lunch", "Snack", "Dinner", "Ravi's dinner"]);
    const addon = reqOf(f, "Ravi's dinner");
    expect(addon.main_slot[MON]).toEqual(k.dishesAt(MON, "Dinner"));
    expect(addon.days.every((d: any) => JSON.stringify(d.for) === '["Ravi"]')).toBe(true);
    expect(reqOf(f, "Kabir's tiffin").days.map((d: any) => d.date)).toEqual(WEEK.slice(0, 5));
  });

  it("no same main twice a day across main slots: a lunch that repeats breakfast's main is sent back", async () => {
    const k = await home({ lib: { Breakfast: ["Poha", "Upma", "Idli", "Dosa"], Lunch: ["Poha", "Rajma", "Kadhi", "Chole", "Sambar"], Dinner: LIB.Dinner } });
    const f = fakeModel({ slot: (u) => u.slot === "Lunch" ? { days: { ...(rotateDays(u) as any).days, [MON]: ["Dosa"] }, new: [{ dish: "Dosa" }] } : rotateDays(u),
      wait: (u) => (u.slot === "Lunch" ? 10 : 0) });
    await k.plan(f.model);
    expect(f.fixes()[0].user.fix[0].wrong).toContain("Dosa is already at Breakfast that day");
  });
});

describe("make_plan v2: who eats (spec §5.1)", () => {
  it("household.weekly: away at weekday lunch is left out Mon to Fri, home on the weekend; the fresh household wins over the payload", async () => {
    const k = await home();
    const weekly = [{ person: "Ravi", where: "office", weekdays: ["Mon", "Tue", "Wed", "Thu", "Fri"], from: "09:00", to: "18:00" }];
    const f = fakeModel();
    await k.plan(f.model, { household: { "household.weekly": [] }, peers: { household: async () => ({ "household.weekly": weekly }) } });
    const u = reqOf(f, "Lunch");
    expect(u.days[0]).toEqual({ date: MON, for: ["Asha", "Kabir"], why: "Ravi: office on Mon" });
    expect(u.days[5].for).toEqual(["Asha", "Ravi", "Kabir"]);
    // The pattern's hours cover lunch, not breakfast or dinner.
    expect(reqOf(f, "Dinner").days[0].for).toEqual(["Asha", "Ravi", "Kabir"]);
    expect(reqOf(f, "Breakfast").days[0].for).toEqual(["Asha", "Ravi", "Kabir"]);
    // A day out covering breakfast's or dinner's whole span is away; leaving for school at 7:30 or back at 9 is not.
    const h = fakeModel();
    await k.plan(h.model, { household: { "household.weekly": [{ person: "Kabir", where: "school", weekdays: ["Mon"], from: "07:30", to: "13:30", lunch: "home" },
      { person: "Ravi", where: "office", weekdays: ["Mon"], from: "09:00", to: "21:00" }, { person: "Asha", where: "night shift", weekdays: ["Mon"], from: "18:00", to: "23:00" }] } });
    expect(reqOf(h, "Breakfast").days[0].for).toEqual(["Asha", "Ravi", "Kabir"]);
    expect(reqOf(h, "Lunch").days[0].for).toEqual(["Asha", "Kabir"]);
    expect(reqOf(h, "Dinner").days[0].for).toEqual(["Ravi", "Kabir"]);
    // Not a list: unknown, planned with the usual people.
    const g = fakeModel();
    await k.plan(g.model, { household: { "household.weekly": "office" } });
    expect(reqOf(g, "Lunch").days[0].for).toEqual(["Asha", "Ravi", "Kabir"]);
  });

  it("what setup read of weekday lunch (house.setup_state) wins over household.weekly; read tolerantly", async () => {
    const h = readHousehold({ "household.weekly": [{ person: "Ravi", where: "office", weekdays: ["Mon"], lunch: "away" }] });
    expect(withLunchSaid(h, [{ person: "Ravi", lunch: "home" }, { person: "Asha", lunch: "carries" }]).weekly).toEqual([
      { person: "Ravi", where: "office", weekdays: ["Mon"], lunch: "home" }, { person: "Asha", where: "", weekdays: ["Mon", "Tue", "Wed", "Thu", "Fri"], lunch: "carries" }]);
    const k = await home();
    expect(lunchSaid(k.kit.sqlite)).toEqual([]);   // no setup_state column on this branch: none
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
    expect(r.ok && r.asked).toEqual(['"Thing", Thu: does it change who eats at home?']);
    if (r.ok) expect(r.message).toContain('"Thing", Thu: does it change who eats at home?');
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
      lib: { ...LIB, "Ravi's dinner": ["Phulka", "Jowar roti"] },
      rules: [{ hard: true, what: "fasting", who: "Asha", days: ["Thu"], slots: ["Breakfast", "Lunch"], quote: "I fast Thursdays till evening" },
        { hard: true, what: "fasting", who: "Ravi", days: ["Mon"], fasting_food: ["fruit", "sabudana"], quote: "Monday fast, only fruit" }],
    });
    const f = fakeModel();
    const r = await k.plan(f.model);
    expect(k.at("2026-12-03", "Lunch")!.people).toEqual(["Ravi", "Kabir"]);
    expect(reqOf(f, "Lunch").days[3].why).toBe("Asha fasts (I fast Thursdays till evening)");
    expect(reqOf(f, "Lunch").days[0].fasting).toEqual(["Ravi fasts: only fruit, sabudana (Monday fast, only fruit)"]);
    expect(k.at(MON, "Lunch")!.people).toContain("Ravi");
    expect(reqOf(f, "Dinner").days[6]).toEqual({ date: "2026-12-06", skip: "eaten_out" });
    expect(k.at("2026-12-06", "Dinner")).toMatchObject({ skip: "eaten_out", dishes: [] });
    // An add-on goes with its main slot: eaten out too.
    expect(k.at("2026-12-06", "Ravi's dinner")).toMatchObject({ skip: "eaten_out", dishes: [] });
    expect(k.dishesAt("2026-12-05", "Ravi's dinner").length).toBeGreaterThan(0);
    if (r.ok) expect(r.message).toContain("Dinner: eating out");
  });

  it("an edited slot-day is kept: with dishes it is not asked again; without, its people, guests and occasion stay as the family set them", async () => {
    const k = await home();
    commit(k.kit.db, k.kit.emitChange, (tx, ch) => {
      saveSlotDay(tx, { date: "2026-12-02", slot: "Lunch", people: ["Asha"], edited: true, dishes: [{ dish: "Biryani" }] }, "user:x", ch);
      saveSlotDay(tx, { date: "2026-12-03", slot: "Dinner", people: ["Asha", "Ravi", "Kabir"], guests: [{ count: 4 }], occasion: "dinner party", edited: true }, "user:x", ch);
    });
    const f = fakeModel();
    await k.plan(f.model);
    await k.plan(fakeModel().model);
    expect(reqOf(f, "Lunch").days.map((d: any) => d.date)).not.toContain("2026-12-02");
    expect(k.at("2026-12-02", "Lunch")).toMatchObject({ people: ["Asha"], edited: true });
    expect(k.dishesAt("2026-12-02", "Lunch")).toEqual(["Biryani"]);
    expect(reqOf(f, "Dinner").days[3]).toMatchObject({ date: "2026-12-03", guests: [{ count: 4 }], occasion: "dinner party" });
    expect(k.at("2026-12-03", "Dinner")).toMatchObject({ edited: true, guests: [{ count: 4 }], occasion: "dinner party" });
    expect(k.dishesAt("2026-12-03", "Dinner").length).toBeGreaterThan(0);
    expect(k.week()).toHaveLength(21);
  });
});

describe("make_plan v2: budgets and offers", () => {
  it("new dishes past the week's setting are sent back; within it they are saved untried, each placement an offer, not counted twice on a re-plan", async () => {
    const k = await home({ newPerWeek: 2 });
    const f = fakeModel({ slot: (u) => u.slot === "Dinner"
      ? { days: { ...(rotateDays(u) as any).days, [MON]: ["Thai curry"], "2026-12-01": ["Ramen"], "2026-12-02": ["Tacos"] }, new: [{ dish: "Thai curry" }, { dish: "Ramen" }, { dish: "Tacos" }] }
      : rotateDays(u) });
    await k.plan(f.model);
    // The week's budget is shared: each slot may use it, the week's check keeps the total.
    expect(reqOf(f, "Dinner").new_dishes_allowed).toBe(2);
    expect(f.fixes()).toHaveLength(1);
    expect(f.fixes()[0].user.fix.flatMap((x: any) => x.wrong).join(" ")).toMatch(/too many new dishes|not one of this slot's dishes/);
    const news = k.week().flatMap((d) => d.dishes.filter((x) => x.new).map((x) => x.dish));
    expect(new Set(news).size).toBeLessThanOrEqual(2);
    const untried = () => k.rows("library").filter((r: any) => r.untried === 1);
    for (const r of untried()) expect(r.offers).toBe(k.week().filter((d) => d.dishes.some((x) => x.dish === r.name)).length);
    const before = untried().map((r: any) => [r.name, r.offers]);
    await k.plan(f.model);
    expect(untried().map((r: any) => [r.name, r.offers])).toEqual(before);
  });

  it("feasibility: a thin library gets more new dishes first, then a 2-day window, then a line in unmet; logged in that order", async () => {
    const k = await home({ lib: { ...LIB, Breakfast: ["Poha"] }, newPerWeek: 2 });
    const lines: string[] = [];
    const r = await k.plan(fakeModel().model, { log: (l) => lines.push(l) });
    const line = lines.find((l) => l.startsWith("feasibility Breakfast"))!;
    expect(line).toContain("relaxed: 2 more new dishes, then repeat window 2 days, then noted in unmet");
    expect(r.ok && r.unmet).toContain("only 1 Breakfast dish known, so some come back more often than usual");
    expect(lines.find((l) => l.startsWith("feasibility Lunch"))).not.toContain("relaxed");
  });
});

describe("make_plan v2: failures", () => {
  it("out of credits on a slot call stops at once: a plain line, nothing saved, nothing more asked", async () => {
    const k = await home();
    const f = fakeModel({ slot: () => ({ ok: false, code: "out_of_credits", message: "no credits" }) });
    const r = await k.plan(f.model);
    expect(r).toEqual({ ok: false, reason: "out_of_credits", say: expect.stringContaining("credits have run out") });
    expect(k.week()).toHaveLength(0);
    expect(f.days()).toHaveLength(0);
    expect(f.fixes()).toHaveLength(0);
  });

  it("the day's budget spent while the ingredients are asked stops too, nothing saved", async () => {
    const k = await home();
    const r = await k.plan(fakeModel({ day: () => ({ ok: false, code: "daily_budget", message: "spent" }) }).model);
    expect(r).toMatchObject({ ok: false, reason: "daily_budget" });
    expect(k.week()).toHaveLength(0);
  });

  it("an unreadable answer gets the one fix call; failing again, code fills from the library; a model never answering plans no week", async () => {
    const k = await home();
    const f = fakeModel({ slot: (u) => (u.slot === "Lunch" ? { nonsense: true } : rotateDays(u)), fix: () => ({ ok: false, code: "invalid_output", message: "bad" }) });
    const r = await k.plan(f.model);
    expect(r.ok).toBe(true);
    expect(f.fixes().map((c) => c.user.slot)).toEqual(["Lunch"]);
    for (const date of WEEK) expect(k.dishesAt(date, "Lunch").length).toBeGreaterThan(0);
    const down = await home();
    const g = fakeModel({ slot: () => ({ ok: false, code: "unavailable", message: "down" }), fix: () => ({ ok: false, code: "unavailable", message: "down" }) });
    expect(await down.plan(g.model)).toMatchObject({ ok: false, reason: "unavailable" });
    expect(down.week()).toHaveLength(0);
  });

  it("a day's ingredients are asked once more for what was left out, then saved without them and named", async () => {
    const k = await home();
    const f = fakeModel({ day: (u) => (u.date === MON ? { dishes: [] } : ingredients(u)) });
    const r = await k.plan(f.model);
    expect(f.days().filter((c) => c.user.date === MON)).toHaveLength(2);
    expect(r.ok && r.no_ingredients).toEqual(["Mon Breakfast: Dosa", "Mon Lunch: Chole", "Mon Dinner: Aloo gobi"]);
  });

  it("an ingredient tagged with what a person at the slot-day avoids is taken out, and a shared dish says so", async () => {
    const k = await home({ rules: [{ hard: true, what: "avoid", who: "Asha", items: ["sugar"], quote: "no sugar for me" }],
      library: Object.entries(LIB).flatMap(([slot, ns]) => ns.map((name) => ({ name, slot, contains: [], contains_read: [...READ, "sugar"] }))) });
    const f = fakeModel({ day: (u) => ({ dishes: u.dishes.map((d: any) => ({ slot: d.slot, name: d.name, ingredients: [{ item: "rice", amount: 100, unit: "g", tags: [] },
      ...(d.slot === "Breakfast" ? [{ item: "jaggery", amount: 10, unit: "g", tags: ["sugar"] }] : [])] })) }) });
    await k.plan(f.model);
    expect(f.days()[0].user.dishes[0].tags).toEqual(["sugar"]);
    const first = k.at(MON, "Breakfast")!.dishes[0];
    expect(first.ingredients.map((i) => i.item)).toEqual(["rice"]);
    expect(first.note).toBe("no jaggery for Asha");
  });

  it("make_plan needs a Monday, a family and the slots; two runs for one week at once are one run", async () => {
    const k = await home();
    expect((await k.op("make_plan", { week_start: "2026-12-01" })).error).toContain("must be a Monday");
    const bare = await boot({ now: () => new Date(2026, 10, 29, 11, 0) });
    expect(await bare.op("make_plan", { week_start: MON })).toMatchObject({ ok: false, reason: "no_family" });
    await bare.op("set_person", { name: "Asha", group: "adult" });
    expect(await bare.op("make_plan", { week_start: MON })).toMatchObject({ ok: false, reason: "no_slots" });
    const f = fakeModel({ wait: () => 5 });
    const [a, b] = await Promise.all([k.plan(f.model), k.plan(f.model)]);
    expect(a).toEqual(b);
    expect(f.slots()).toHaveLength(3);
  });

  it("make_plan takes the household Flock sends", async () => {
    const k = await home();
    const r = await k.op("make_plan", { week_start: MON, household: { "household.weekly": [] } });
    // No model on this boot: the plan stops with a plain line; the household was taken, not refused as a field.
    expect(r).toMatchObject({ ok: false, reason: "unavailable" });
  });
});

describe("make_plan v2: guards", () => {
  // Eval households (tuned h1–h8 and held-out h9–h12) and the sim family: no name of theirs in any model-facing text.
  const NAMES = ["Sharma", "Iyer", "Shiva", "Reddy", "Agarwal", "Kulkarni", "Menon", "Banerjee", "Ankita", "Agastya", "Gowri", "Lakshmi", "Mehta", "Qureshi",
    "Dsouza", "D'souza", "Gita", "Geeta", "Vihaan", "Reyansh", "Zayan", "Farah", "Shabana", "Debjani", "Sourav", "Rituparna", "Kantaben", "Selvi", "Srinivas"];
  it("no eval household name in any text a plan's model reads", () => {
    for (const t of [SLOT_SYSTEM, FIX_SYSTEM, CONTAINS_SYSTEM, INGREDIENT_SYSTEM, EVENTS_SYSTEM, DELIVER_PROMPT(true), FESTIVAL_PROMPT(MON)])
      for (const n of NAMES) expect(t.toLowerCase(), n).not.toContain(n.toLowerCase());
  });
  it("no word lists for meaning in the plan's code: no regex of day names, kinship words or less/more", () => {
    for (const file of ["makePlan.ts", "planDays.ts", "planChecks.ts"]) {
      const src = readFileSync(join(import.meta.dir, file), "utf8");
      for (const r of src.match(/\/\^?\(?[^/\n*][^/\n]*\/[gimsuy]*\.test|new RegExp\([^)]*\)|\/[^/\n]+\/[gimsuy]*(?=\.test|,\s*"|\))/g) ?? [])
        expect(r, `${file}: ${r}`).not.toMatch(/monday|tuesday|\bmon\b|\bsun\b|weekend|amma|papa|nani|mother|father|\bless\b|\bmore\b/i);
    }
  });
});
