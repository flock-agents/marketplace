// Later changes (changes.ts; docs/slot-model-spec.md §6) and the next-day question about an untried dish (§5.7), with a fake
// model answering by the call's purpose: each operation's checks and writes, what a change re-plans (only the slot-days it
// touches, never one the family edited or said was made), every outcome of the next-day answer, and the reminder's line.
import { describe, it, expect } from "bun:test";
import { boot } from "./testkit";
import { feedbackLine } from "./messages";
import { buildReminder } from "./reminder";
import { REMINDER_PROMPT } from "./routines/reminders";
import type { ModelRequest, ModelResult } from "./model";
import { plannerTags } from "./kinds";
import { addRule, commit, getLibraryDish, listSlotDays, newDishesPerWeek, upsertLibrary, upsertSlot, type LibraryInput, type SlotInput } from "./slotStore";

const SUN = "2026-11-29", MON = "2026-11-30", TUE = "2026-12-01", WED = "2026-12-02", SAT = "2026-12-05";
const WEEK = ["2026-11-30", "2026-12-01", "2026-12-02", "2026-12-03", "2026-12-04", "2026-12-05", "2026-12-06"];
const MAIN: SlotInput[] = [{ name: "Breakfast", kind: "main", order: 10 }, { name: "Lunch", kind: "main", order: 30 }, { name: "Dinner", kind: "main", order: 50 }];
const LIB: Record<string, string[]> = { Breakfast: ["Poha", "Upma", "Idli", "Dosa"], Lunch: ["Sambar", "Rajma", "Kadhi", "Chole"], Dinner: ["Palak paneer", "Aloo gobi", "Bhindi", "Dal makhani"] };
const READ = ["egg", "meat", "fish", "onion_garlic", "nuts", "peanut", "sugar", "white_rice", "dairy"];

type Call = { req: ModelRequest; user: any };
/** A fake model by purpose: slot calls rotate the library (or `slot`), setup's contains read answers from `has` (dish → its
 *  tags; every tag asked is answered), ingredients one line a dish. */
function fake(o: { slot?: (u: any) => unknown; has?: Record<string, string[]> } = {}) {
  const calls: Call[] = [];
  const model = async (req: ModelRequest): Promise<ModelResult> => {
    const user = JSON.parse(req.user);
    calls.push({ req, user });
    const p = req.purpose ?? "";
    const ok = (json: unknown): ModelResult => ({ ok: true, json, model: "fake" });
    if (p.startsWith("meal plan: the week's") || p.startsWith("meal plan: fix the")) return ok((o.slot ?? rotate)(user));
    if (p.startsWith("setup: contains")) return ok(Object.fromEntries(user.dishes.map((d: string) => [d, Object.fromEntries(user.tags.map((t: string) => [t, (o.has?.[d] ?? []).includes(t)]))])));
    if (p.includes("contain")) return ok({ dishes: user.dishes.map((d: string) => ({ dish: d, has: o.has?.[d] ?? [], not: user.tags.filter((t: string) => !(o.has?.[d] ?? []).includes(t)) })) });
    if (p.includes("calendar")) return ok({ changes: [] });
    return ok({ dishes: user.dishes.map((d: any) => ({ slot: d.slot, name: d.name, ingredients: [{ item: d.name.toLowerCase(), amount: 100 * (d.people ?? 1), unit: "g", tags: [] }] })) });
  };
  const of = (s: string) => calls.filter((c) => (c.req.purpose ?? "").includes(s));
  return { model, calls, slots: () => of("the week's "), contains: () => of("contains"), days: () => of("ingredients"), reset: () => { calls.length = 0; } };
}
/** Each date asked: the library's dishes in turn. */
function rotate(u: any): unknown {
  const lib = u.library.map((d: any) => d.dish);
  const all = u.days.filter((d: any) => !d.skip).map((d: any) => d.date);
  const dates = (u.fix ? u.fix.map((f: any) => f.date) : all) as string[];
  return { days: Object.fromEntries(dates.map((date) => [date, [...u.staples, lib[(WEEK.indexOf(date) + 7) % lib.length]]])) };
}

/** A family of three, three main slots, four dishes a slot; the week of 30 Nov planned on Sunday 29 Nov at 11:00. */
async function home(o: { library?: LibraryInput[]; has?: Record<string, string[]>; now?: Date } = {}) {
  let f = fake({ has: o.has });
  const k = await boot({ now: () => o.now ?? new Date(2026, 10, 29, 11, 0), model: (req) => f.model(req) });
  for (const [name, group] of [["Asha", "adult"], ["Ravi", "adult"], ["Kabir", "child"]]) await k.op("set_person", { name, group });
  commit(k.kit.db, k.kit.emitChange, (tx, ch) => {
    for (const s of MAIN) upsertSlot(tx, s, "app", ch);
    for (const [slot, names] of Object.entries(LIB)) for (const name of names) upsertLibrary(tx, { name, slot, origin: "setup_named", contains: [], contains_read: READ }, "app", ch);
    for (const d of o.library ?? []) upsertLibrary(tx, { contains_read: READ, ...d }, "app", ch);
  });
  const use = (g: ReturnType<typeof fake>) => { f = g; return g; };
  const week = () => listSlotDays(k.kit.db, { from: MON, to: WEEK[6] });
  const at = (date: string, slot: string) => week().find((d) => d.date === date && d.slot === slot);
  const dishesAt = (date: string, slot: string) => at(date, slot)?.dishes.map((d) => d.dish) ?? [];
  /** Each slot-day's id and dishes, to tell what a change touched. */
  const snapshot = () => Object.fromEntries(week().map((d) => [`${d.date}|${d.slot}`, `${d.id}:${d.dishes.map((x) => x.id).join(",")}`]));
  return { ...k, f: () => f, use, week, at, dishesAt, snapshot };
}
async function planned(o: Parameters<typeof home>[0] = {}) {
  const k = await home(o);
  const r = await k.op("make_plan", { week_start: MON });
  expect(r.ok).toBe(true);
  k.f().reset();
  return k;
}
/** The keys of a snapshot whose slot-day or dishes changed. */
const changed = (a: Record<string, string>, b: Record<string, string>) => Object.keys({ ...a, ...b }).filter((x) => a[x] !== b[x]).sort();

describe("set_slot_day: a one-off change", () => {
  it("guests: marks the slot-day edited and re-plans only it, with its guests and occasion, by code (no plan call)", async () => {
    const k = await planned();
    const before = k.snapshot();
    const r = await k.op("set_slot_day", { date: SAT, slot: "Dinner", guests: [{ count: 4, rules: ["vegetarian"] }], occasion: "dinner party" });
    expect(r.ok).toBe(true);
    expect(r.replanned).toEqual([{ date: SAT, slot: "Dinner" }]);
    expect(k.f().slots()).toHaveLength(0);
    expect(k.at(SAT, "Dinner")).toMatchObject({ people: ["Asha", "Ravi", "Kabir"], guests: [{ count: 4, rules: ["vegetarian"] }], occasion: "dinner party" });
    // The rest of the week is read for the checks, not planned: only Saturday's dinner changed.
    expect(changed(before, k.snapshot())).toEqual([`${SAT}|Dinner`]);
    const d = k.at(SAT, "Dinner")!;
    expect(d.edited).toBe(true);
    expect(d.guests).toEqual([{ count: 4, rules: ["vegetarian"] }]);
    expect(d.occasion).toBe("dinner party");
    expect(d.dishes.length).toBeGreaterThan(0);
    expect(d.dishes[0].ingredients[0].amount).toBe(700);   // seven eating: three at home and four guests
    expect(r.message).toContain("Updated the plan:\nSaturday Dinner: ");
    expect(r.message).not.toContain("How it works");
  });

  it("someone away: remove_people takes them off that meal and plans it for the rest", async () => {
    const k = await planned();
    const r = await k.op("set_slot_day", { date: TUE, slot: "Lunch", remove_people: ["ravi"] });
    expect(r.ok).toBe(true);
    expect(k.at(TUE, "Lunch")!.people).toEqual(["Asha", "Kabir"]);
    const r2 = await k.op("set_slot_day", { date: TUE, slot: "Lunch", add_people: ["Nani"] });
    expect(r2.slot_day.people).toEqual(["Asha", "Kabir", "Nani"]);
  });

  it("dishes given: saved as the family said, edited, no slot call; their ingredients read in one fast call", async () => {
    const k = await planned();
    const before = k.snapshot();
    const r = await k.op("set_slot_day", { date: WED, slot: "Lunch", dishes: ["Pongal", "Coconut chutney"] });
    expect(r.ok).toBe(true);
    expect(r.replanned).toEqual([]);
    expect(k.f().slots()).toHaveLength(0);
    expect(k.f().days()).toHaveLength(1);
    expect(k.dishesAt(WED, "Lunch")).toEqual(["Pongal", "Coconut chutney"]);
    expect(k.at(WED, "Lunch")!.dishes[0].ingredients.map((i) => i.item)).toEqual(["pongal"]);
    expect(k.at(WED, "Lunch")!.edited).toBe(true);
    expect(changed(before, k.snapshot())).toEqual([`${WED}|Lunch`]);
  });

  it("eating out: no dishes and no re-plan; cooked at home again (skip null): planned again", async () => {
    const k = await planned();
    const r = await k.op("set_slot_day", { date: SAT, slot: "Lunch", skip: "eaten_out" });
    expect(r.replanned).toEqual([]);
    expect(k.at(SAT, "Lunch")!.skip).toBe("eaten_out");
    expect(k.dishesAt(SAT, "Lunch")).toEqual([]);
    expect(k.f().slots()).toHaveLength(0);
    const r2 = await k.op("set_slot_day", { date: SAT, slot: "Lunch", skip: null });
    expect(r2.replanned).toEqual([{ date: SAT, slot: "Lunch" }]);
    expect(k.dishesAt(SAT, "Lunch").length).toBeGreaterThan(0);
  });

  it("refuses an unknown slot, a person not at home, skip with dishes, and nothing to change", async () => {
    const k = await planned();
    expect((await k.op("set_slot_day", { date: TUE, slot: "Brunch", guests: [{ count: 1 }] })).error).toContain("Brunch is not one of the meals");
    expect((await k.op("set_slot_day", { date: TUE, slot: "Lunch", people: [] })).error).toBeUndefined();
    expect((await k.op("set_slot_day", { date: TUE, slot: "Lunch", skip: "ordered_in", dishes: ["Pizza"] })).error).toContain("not both");
    expect((await k.op("set_slot_day", { date: TUE, slot: "Lunch" })).error).toContain("nothing to change");
    expect((await k.op("set_slot_day", { date: TUE, slot: "Lunch", guests: [{ count: 0 }] })).error).toContain("guests must be");
  });

  it("a week not planned yet: the change is kept, nothing planned, and the week's plan later keeps it", async () => {
    const k = await home();
    const r = await k.op("set_slot_day", { date: TUE, slot: "Dinner", guests: [{ count: 2 }] });
    expect(r.replanned).toEqual([]);
    expect(k.f().slots()).toHaveLength(0);
    await k.op("make_plan", { week_start: MON });
    expect(k.at(TUE, "Dinner")!.guests).toEqual([{ count: 2 }]);
    expect(k.dishesAt(TUE, "Dinner").length).toBeGreaterThan(0);
    expect(k.at(TUE, "Dinner")!.edited).toBe(true);
  });
});

describe("a re-plan never overwrites an edited slot-day", () => {
  it("set_rule re-plans the failing slot-days only; the family's own meal with the dish stays as they set it", async () => {
    const k = await planned({ has: { Rajma: ["dairy"], Chole: ["dairy"] } });
    // The family set Wednesday's lunch themselves, with chole.
    await k.op("set_slot_day", { date: WED, slot: "Lunch", dishes: ["Chole", "Rice"] });
    const before = k.snapshot();
    // Rajma and Chole were read for dairy (READ), as having none: say they do now. (Onion and garlic never block a dish:
    // kinds model rule 7.)
    commit(k.kit.db, k.kit.emitChange, (tx, ch) => { for (const n of ["Rajma", "Chole"]) upsertLibrary(tx, { name: n, slot: "Lunch", contains: ["dairy"] }, "app", ch); });
    // The slot-days with a dish that has dairy (the family's Rajma and Chole, and any new dish the catalog says has it), but
    // not one whose dairy is only an ingredient it can be made without (ghee on top: a note, decided 21).
    const dairy = (name: string, slot: string) => { const rows = k.rows("library").filter((r: any) => r.name === name);
      const row = rows.find((r: any) => r.slot === slot) ?? rows[0];
      const cat = plannerTags(row?.catalog_item ?? name);
      if (cat && cat.contains.includes("dairy") && !cat.main.includes("dairy")) return false;
      return !!row && JSON.parse(row.contains ?? "[]").includes("dairy"); };
    const failing = k.week().filter((d) => !(d.date === WED && d.slot === "Lunch") && d.dishes.some((x) => dairy(x.dish, d.slot))).map((d) => `${d.date}|${d.slot}`).sort();
    expect(failing.filter((x) => x.endsWith("|Lunch")).length).toBeGreaterThan(0);
    k.f().reset();
    const r = await k.op("set_rule", { hard: true, what: "avoid", items: ["dairy"], quote: "no dairy at home now" });
    expect(r.ok).toBe(true);
    expect(r.replanned.map((x: any) => `${x.date}|${x.slot}`).sort()).toEqual(failing);
    expect(changed(before, k.snapshot())).toEqual(failing);
    expect(k.dishesAt(WED, "Lunch")).toEqual(["Chole", "Rice"]);
    for (const key of failing) { const [d, slot] = key.split("|"); for (const x of ["Rajma", "Chole"]) expect(k.dishesAt(d, slot)).not.toContain(x); }
  });
});

describe("set_rule", () => {
  it("a rule with a tag no dish was read for: every library dish is read for it first, then only the dishes that have it re-planned", async () => {
    const k = await planned({ has: { "Palak paneer": ["mushroom"] } });
    const before = k.snapshot();
    const days = WEEK.filter((d) => k.dishesAt(d, "Dinner").includes("Palak paneer"));
    const r = await k.op("set_rule", { hard: true, what: "avoid", who: "kabir", items: ["Mushroom"], quote: "Kabir can't have mushrooms" });
    expect(r.rule.who).toBe("Kabir");
    expect(r.rule.items).toEqual(["mushroom"]);
    expect(k.f().contains()).toHaveLength(1);
    expect(k.f().contains()[0].user.tags).toEqual(["mushroom"]);
    expect(getLibraryDish(k.kit.db, "Palak paneer", "Dinner")!.contains).toContain("mushroom");
    expect(getLibraryDish(k.kit.db, "Poha", "Breakfast")!.contains_read).toContain("mushroom");
    expect(changed(before, k.snapshot())).toEqual(days.map((d) => `${d}|Dinner`).sort());
  });

  it("a soft rule changes nothing that holds; a removed rule re-plans nothing; a change keeps the rule's id", async () => {
    const k = await planned();
    const before = k.snapshot();
    const r = await k.op("set_rule", { hard: false, what: "note", who: "Kabir", quote: "less spicy for Kabir" });
    expect(r.replanned).toEqual([]);
    const c = await k.op("set_rule", { id: r.rule.id, quote: "not spicy for Kabir" });
    expect(c.rule.id).toBe(r.rule.id);
    expect(c.rule.quote).toBe("not spicy for Kabir");
    const gone = await k.op("set_rule", { id: r.rule.id, remove: true });
    expect(gone.replanned).toEqual([]);
    expect(k.rows("rules")).toHaveLength(0);
    expect(changed(before, k.snapshot())).toEqual([]);
  });

  it("a fast with nothing to eat takes the person off the slot-days it holds on, re-planned", async () => {
    const k = await planned();
    const r = await k.op("set_rule", { hard: true, what: "fasting", who: "Asha", days: ["Thu"], slots: ["Lunch"], fasting_food: [], quote: "Asha fasts on Thursday till evening" });
    expect(r.replanned).toEqual([{ date: "2026-12-03", slot: "Lunch" }]);
    expect(k.at("2026-12-03", "Lunch")!.people).toEqual(["Ravi", "Kabir"]);
  });

  it("refuses a hard rule with a frequency, a new rule without its quote, an unknown person, a swap without to, and an unknown id", async () => {
    const k = await planned();
    expect((await k.op("set_rule", { hard: true, what: "avoid", items: ["sugar"], frequency: "rarely", quote: "no sugar" })).error).toContain("a hard rule has no frequency");
    expect((await k.op("set_rule", { hard: true, what: "avoid", items: ["sugar"] })).error).toContain("quote");
    expect((await k.op("set_rule", { hard: true, what: "veg", who: "Meera", quote: "Meera is veg" })).error).toContain("Meera is not one of the people at home");
    expect((await k.op("set_rule", { hard: false, what: "swap", items: ["white_rice"], frequency: "sometimes", quote: "millets sometimes" })).error).toContain("a swap needs to");
    expect((await k.op("set_rule", { id: "nope", quote: "x" })).status).toBe(404);
  });
});

describe("set_slot", () => {
  it("a new slot: its slot-days in the planned week from today on are planned, nothing else changes", async () => {
    const k = await planned({ library: ["Sandwich", "Poha roll", "Paratha"].map((name) => ({ name, slot: "Kabir's tiffin", origin: "setup_named" as const })) });
    const before = k.snapshot();
    const r = await k.op("set_slot", { name: "Kabir's tiffin", kind: "custom", usual_people: ["Kabir"], days: ["Mon", "Tue", "Wed", "Thu", "Fri"], order: 20 });
    expect(r.ok).toBe(true);
    expect(r.replanned.map((x: any) => x.date)).toEqual(WEEK.slice(0, 5));
    expect(k.f().slots()).toHaveLength(0);
    for (const d of WEEK.slice(0, 5)) expect(k.at(d, "Kabir's tiffin")!.people).toEqual(["Kabir"]);
    expect(changed(before, k.snapshot())).toEqual(WEEK.slice(0, 5).map((d) => `${d}|Kabir's tiffin`));
    for (const d of WEEK.slice(0, 5)) expect(k.dishesAt(d, "Kabir's tiffin").length).toBe(1);
  });

  it("a slot's days changed: its slot-days on the dropped days go; remove takes its future slot-days away", async () => {
    const k = await planned();
    const r = await k.op("set_slot", { name: "breakfast", days: ["Sat", "Sun"] });
    expect(r.slot.name).toBe("Breakfast");
    expect(k.week().filter((d) => d.slot === "Breakfast").map((d) => d.date)).toEqual(["2026-12-05", "2026-12-06"]);
    const g = await k.op("set_slot", { name: "Breakfast", remove: true });
    expect(g.slot_days_removed).toBe(2);
    expect(k.week().filter((d) => d.slot === "Breakfast")).toHaveLength(0);
    expect((await k.op("set_slot", { name: "Elevenses" })).error).toContain("send its kind");
    expect((await k.op("set_slot", { name: "Papa's dinner", kind: "addon" })).error).toContain("addon_of");
  });
});

describe("add_dish", () => {
  it("a dish the family has: family_added, eaten (not untried), what it contains read before it answers", async () => {
    const k = await home({ has: { "Egg curry": ["egg"] } });
    commit(k.kit.db, k.kit.emitChange, (tx, ch) => { addRule(tx, { hard: true, what: "avoid", items: ["mushroom"], quote: "no mushrooms" }, "app", ch); });
    const r = await k.op("add_dish", { name: "Egg curry", slot: "lunch", frequency: "2 a week", days: ["Tue", "Fri"] });
    expect(r.ok).toBe(true);
    expect(r.dish).toMatchObject({ name: "Egg curry", slot: "Lunch", origin: "family_added", untried: false, suggested: false, frequency: "2/week", days: ["Tue", "Fri"], contains: ["egg"] });
    expect([...r.dish.contains_read].sort()).toEqual([...READ, "mushroom"].sort());
    expect(k.f().contains()).toHaveLength(1);
  });

  it("from a reel: untried, the link its video; a dish they already eat stays eaten", async () => {
    const k = await home();
    const r = await k.op("add_dish", { name: "Korean paneer", slot: "Dinner", link: "https://www.instagram.com/reel/abc" });
    expect(r.dish).toMatchObject({ origin: "family_added", untried: true, video_url: "https://www.instagram.com/reel/abc" });
    const r2 = await k.op("add_dish", { name: "Bhindi", slot: "Dinner", link: "https://youtu.be/x" });
    expect(r2.dish).toMatchObject({ origin: "setup_named", untried: false, video_url: "https://youtu.be/x" });
    expect((await k.op("add_dish", { name: "X", slot: "Dinner", link: "a reel" })).error).toContain("link");
    expect((await k.op("add_dish", { name: "X", slot: "Supper" })).error).toContain("Supper is not one of the meals");
  });
});

describe("set_setting", () => {
  it("new_dishes_per_week: one of the choices, through the kit's settings", async () => {
    const k = await home();
    expect((await k.op("set_setting", { new_dishes_per_week: 4 })).new_dishes_per_week).toBe(4);
    expect(newDishesPerWeek(k.kit.db)).toBe(4);
    expect((await k.op("set_setting", { new_dishes_per_week: 3 })).error).toContain("one of: 0, 2, 4, 7");
  });
});

describe("record_made: a correction the family volunteers", () => {
  it("the slot-day's dishes replaced, confirmed and edited; a later plan of the week keeps it; a day to come is refused", async () => {
    const k = await planned();
    const r = await k.op("record_made", { date: SUN, slot: "Lunch", dishes: ["Khichdi"] });
    expect(r.slot_day).toMatchObject({ date: SUN, status: "confirmed", edited: true });
    expect(r.slot_day.dishes.map((d: any) => d.dish)).toEqual(["Khichdi"]);
    expect((await k.op("record_made", { date: MON, slot: "Lunch", dishes: ["Khichdi"] })).error).toContain("still to come");
    // Made today (Monday's lunch, the day after): a re-plan of Monday leaves it.
    const k2 = await planned({ now: new Date(2026, 10, 30, 14, 0) });
    await k2.op("record_made", { date: MON, slot: "Lunch", dishes: ["Khichdi"] });
    await k2.op("set_rule", { hard: true, what: "avoid", items: ["dairy"], quote: "no dairy" });
    expect(k2.dishesAt(MON, "Lunch")).toEqual(["Khichdi"]);
    expect((await k2.op("set_slot_day", { date: MON, slot: "Lunch", guests: [{ count: 1 }] })).status).toBe(409);
  });
});

// ── §5.7: the next-day question and its answer ──

/** Tuesday 1 Dec, 15:00: Monday's plan had a planner suggestion, a reel dish, an interview dish and a disliked one. */
async function yesterday(at = new Date(2026, 11, 1, 15, 0)) {
  const k = await home({ now: at, library: [
    { name: "Cabbage poriyal", slot: "Lunch", origin: "planner_suggested", suggested: true, untried: true, offers: 1 },
    { name: "Korean paneer", slot: "Dinner", origin: "family_added", untried: true, offers: 1, video_url: "https://www.instagram.com/reel/abc" },
    { name: "Karela", slot: "Dinner", origin: "planner_suggested", untried: true, disliked: true } ] });
  k.plan([
    { date: MON, slot: "Breakfast", dishes: [{ name: "Poha" }] },
    { date: MON, slot: "Lunch", dishes: [{ name: "Sambar" }, { name: "Cabbage poriyal", new: true }] },
    { date: MON, slot: "Dinner", dishes: [{ name: "Korean paneer" }, { name: "Karela" }, { name: "Bhindi" }] },
    { date: TUE, slot: "Dinner", dishes: [{ name: "Cabbage poriyal" }] },
  ]);
  return k;
}
const SUGGESTION = "Yesterday's plan had Cabbage poriyal, which was new. Did you make it, did you like it, and should I suggest it again?";
const REEL = "Yesterday's plan had Korean paneer from the reel you sent. Did you make it, did you like it, and should I keep suggesting it?";

describe("the next-day question (§5.7)", () => {
  it("the afternoon reminder asks one line per untried dish of yesterday, in the spec's words, never an interview or disliked dish", async () => {
    const k = await yesterday();
    const r = await k.op("get_reminder", { which: "afternoon" });
    expect(r.feedback).toEqual([{ date: MON, slot: "Lunch", dish: "Cabbage poriyal", from: "suggestion" }, { date: MON, slot: "Dinner", dish: "Korean paneer", from: "reel" }]);
    expect(r.text.split("\n\n").at(-1)).toBe(`${SUGGESTION}\n${REEL}`);
    expect(r.app_text).toContain(REEL);
    expect(r.text).not.toContain("Bhindi");
    expect(r.text).not.toContain("Karela");
    expect(r.empty).toBe(false);
    expect(feedbackLine({ dish: "X", from: "suggestion" })).toBe("Yesterday's plan had X, which was new. Did you make it, did you like it, and should I suggest it again?");
    expect(REMINDER_PROMPT("afternoon")).toContain("record_feedback");
  });

  it("once per placement: marked asked when built for real, the agent's second get_reminder says the same, and no later reminder asks again", async () => {
    const k = await yesterday();
    const dry = buildReminder(k.kit.db, "afternoon", new Date(2026, 11, 1, 15, 0), { dryRun: true });
    expect(dry.feedback).toHaveLength(2);
    expect(k.rows("slot_dishes").filter((x) => x.feedback_asked).length).toBe(0);
    await k.op("get_reminder", { which: "afternoon" });
    expect(k.rows("slot_dishes").filter((x) => x.feedback_asked === 1).map((x) => x.dish).sort()).toEqual(["Cabbage poriyal", "Korean paneer"]);
    expect((await k.op("get_reminder", { which: "afternoon" })).feedback).toHaveLength(2);
    // The evening never asks; tomorrow's afternoon asks about Tuesday only (Cabbage poriyal's Tuesday placement, its own).
    expect((await k.op("get_reminder", { which: "evening" })).feedback).toEqual([]);
    const next = buildReminder(k.kit.db, "afternoon", new Date(2026, 11, 2, 15, 0), { dryRun: false });
    expect(next.feedback).toEqual([{ date: TUE, slot: "Dinner", dish: "Cabbage poriyal", from: "suggestion" }]);
  });

  it("more than 3 untried dishes from one day: the 3 most recent are asked in one block, the rest wait for the next day's reminder (owner 24 Nov)", async () => {
    const news = ["Ragi idli", "Methi thepla", "Turai sabzi", "Moong dal", "Gawar sabzi"];
    const k = await home({ now: new Date(2026, 11, 1, 15, 0), library: news.map((name, i) => ({ name, slot: i < 2 ? "Breakfast" : i < 3 ? "Lunch" : "Dinner",
      origin: "planner_suggested" as const, suggested: true, untried: true, offers: 1 })) });
    k.plan([
      { date: MON, slot: "Breakfast", dishes: [{ name: "Ragi idli", new: true }, { name: "Methi thepla", new: true }] },
      { date: MON, slot: "Lunch", dishes: [{ name: "Sambar" }, { name: "Turai sabzi", new: true }] },
      { date: MON, slot: "Dinner", dishes: [{ name: "Moong dal", new: true }, { name: "Gawar sabzi", new: true }] },
    ]);
    const r = await k.op("get_reminder", { which: "afternoon" });
    expect(r.feedback.map((x: any) => x.dish)).toEqual(["Turai sabzi", "Moong dal", "Gawar sabzi"]);
    expect(r.text.split("\n\n").at(-1).split("\n")).toHaveLength(3);
    const asked = () => k.rows("slot_dishes").filter((x) => x.feedback_asked === 1).map((x) => x.dish).sort();
    expect(asked()).toEqual(["Gawar sabzi", "Moong dal", "Turai sabzi"]);
    // The same reminder again says the same.
    expect((await k.op("get_reminder", { which: "afternoon" })).feedback.map((x: any) => x.dish)).toEqual(["Turai sabzi", "Moong dal", "Gawar sabzi"]);
    // Wednesday's reminder (Tuesday had nothing new) asks the two left, by their day.
    const next = buildReminder(k.kit.db, "afternoon", new Date(2026, 11, 2, 15, 0), { dryRun: false });
    expect(next.feedback).toEqual([{ date: MON, slot: "Breakfast", dish: "Ragi idli", from: "suggestion", day: "Monday" }, { date: MON, slot: "Breakfast", dish: "Methi thepla", from: "suggestion", day: "Monday" }]);
    expect(next.text).toContain("Monday's plan had Ragi idli, which was new.");
    expect(asked()).toHaveLength(5);
  });

  it("an answered placement is not asked again, even by the same reminder built again", async () => {
    const k = await yesterday();
    await k.op("get_reminder", { which: "afternoon" });
    await k.op("record_feedback", { date: MON, slot: "Dinner", dish: "Korean paneer", made: false });
    expect((await k.op("get_reminder", { which: "afternoon" })).feedback.map((x: any) => x.dish)).toEqual(["Cabbage poriyal"]);
  });

  it("made, liked, again: a regular library dish, the slot-day confirmed", async () => {
    const k = await yesterday();
    const r = await k.op("record_feedback", { date: MON, slot: "Lunch", dish: "cabbage poriyal", made: true, liked: true, again: true });
    expect(r.outcome).toBe("kept");
    expect(getLibraryDish(k.kit.db, "Cabbage poriyal", "Lunch")).toMatchObject({ untried: false, suggested: false, disliked: false });
    expect(listSlotDays(k.kit.db, { from: MON, to: MON, slot: "Lunch" })[0].status).toBe("confirmed");
  });

  it("made, not liked: disliked, never planned again; confirmed", async () => {
    const k = await yesterday();
    expect((await k.op("record_feedback", { date: MON, slot: "Dinner", dish: "Korean paneer", made: true, liked: false })).outcome).toBe("disliked");
    expect(getLibraryDish(k.kit.db, "Korean paneer", "Dinner")).toMatchObject({ disliked: true });
    expect(listSlotDays(k.kit.db, { from: MON, to: MON, slot: "Dinner" })[0].status).toBe("confirmed");
  });

  it("made, liked, not again: dropped (offers 2), still untried; confirmed", async () => {
    const k = await yesterday();
    expect((await k.op("record_feedback", { date: MON, slot: "Lunch", dish: "Cabbage poriyal", made: true, liked: true, again: false })).outcome).toBe("not_again");
    expect(getLibraryDish(k.kit.db, "Cabbage poriyal", "Lunch")).toMatchObject({ untried: true, offers: 2 });
    expect(listSlotDays(k.kit.db, { from: MON, to: MON, slot: "Lunch" })[0].status).toBe("confirmed");
  });

  it("not made: stays untried with its offers, the slot-day stays planned; no reply: nothing changes", async () => {
    const k = await yesterday();
    expect((await k.op("record_feedback", { date: MON, slot: "Lunch", dish: "Cabbage poriyal", made: false })).outcome).toBe("not_made");
    expect(getLibraryDish(k.kit.db, "Cabbage poriyal", "Lunch")).toMatchObject({ untried: true, offers: 1, disliked: false });
    expect(listSlotDays(k.kit.db, { from: MON, to: MON, slot: "Lunch" })[0].status).toBe("planned");
    const k2 = await yesterday();
    await k2.op("get_reminder", { which: "afternoon" });
    expect(getLibraryDish(k2.kit.db, "Korean paneer", "Dinner")).toMatchObject({ untried: true, offers: 1 });
    expect(listSlotDays(k2.kit.db, { from: MON, to: MON, slot: "Dinner" })[0].status).toBe("planned");
  });

  it("asks for what it needs: liked when made, again when liked; a dish not on that day is not found", async () => {
    const k = await yesterday();
    expect((await k.op("record_feedback", { date: MON, slot: "Lunch", dish: "Cabbage poriyal", made: true })).error).toContain("liked is needed");
    expect((await k.op("record_feedback", { date: MON, slot: "Lunch", dish: "Cabbage poriyal", made: true, liked: true })).error).toContain("again is needed");
    expect((await k.op("record_feedback", { date: MON, slot: "Lunch", dish: "Pasta", made: false })).status).toBe(404);
    // The slot misnamed: the one dish of that name that day.
    expect((await k.op("record_feedback", { date: MON, slot: "Dinner", dish: "Cabbage poriyal", made: false })).ok).toBe(true);
  });
});

// ── Brand-new variants (owner, 25 Nov): asked about the evening before, and the three answers ──

/** Monday 30 Nov, 19:00: Tuesday has a brand-new Ragi puttu at breakfast (like their Puttu) and a new Beetroot poriyal at
 *  lunch (like their Beans poriyal), beside a family dish, a reel dish and a staple. */
async function tomorrowNew(at = new Date(2026, 10, 30, 19, 0)) {
  const k = await home({ now: at, library: [
    { name: "Puttu", slot: "Breakfast", origin: "setup_named", kind: "Puttu" },
    { name: "Ragi puttu", slot: "Breakfast", origin: "planner_suggested", suggested: true, untried: true, offers: 1, kind: "Puttu" },
    { name: "Beans poriyal", slot: "Lunch", origin: "setup_named", kind: "Sabzi", sub: "Poriyal/Thoran" },
    { name: "Cabbage sabzi", slot: "Lunch", origin: "setup_named", kind: "Sabzi", sub: "Sabzi" },
    { name: "Beetroot poriyal", slot: "Lunch", origin: "planner_suggested", suggested: true, untried: true, offers: 1, kind: "Sabzi", sub: "Poriyal/Thoran" },
    { name: "Korean paneer", slot: "Dinner", origin: "family_added", untried: true, offers: 1 } ] });
  k.plan([
    { date: MON, slot: "Breakfast", dishes: [{ name: "Poha" }] },
    { date: TUE, slot: "Breakfast", dishes: [{ name: "Ragi puttu", new: true }] },
    { date: TUE, slot: "Lunch", dishes: [{ name: "Sambar" }, { name: "Beetroot poriyal", new: true }] },
    { date: TUE, slot: "Dinner", dishes: [{ name: "Korean paneer" }, { name: "Bhindi" }] },
    { date: WED, slot: "Breakfast", dishes: [{ name: "Upma" }] },
  ]);
  return k;
}
const TOMORROW_NEW = "Tomorrow's new dishes: Ragi puttu at breakfast (like your Puttu) and Beetroot poriyal at lunch (like your Beans poriyal). OK to make them, or swap any?";

describe("a brand-new dish, the evening before it is cooked", () => {
  it("the evening reminder names tomorrow's new dishes with the family's dish each is like, and asks OK or swap once", async () => {
    const k = await tomorrowNew();
    const r = await k.op("get_reminder", { which: "evening" });
    expect(r.new_dishes).toEqual([{ date: TUE, slot: "Breakfast", dish: "Ragi puttu", meal: "breakfast", like: "Puttu" },
      { date: TUE, slot: "Lunch", dish: "Beetroot poriyal", meal: "lunch", like: "Beans poriyal" }]);
    expect(r.text).toContain(TOMORROW_NEW);
    expect(r.app_text).toContain(TOMORROW_NEW);
    // Never a family dish, a reel dish or a staple.
    expect(r.text).not.toContain("new dish: Korean");
    // The agent's second get_reminder says the same; a dry run too.
    expect((await k.op("get_reminder", { which: "evening" })).text).toContain(TOMORROW_NEW);
    expect(buildReminder(k.kit.db, "evening", new Date(2026, 10, 30, 19, 0), { dryRun: true }).new_dishes).toHaveLength(2);
    // The afternoon (tonight's dinner) never asks it.
    expect(buildReminder(k.kit.db, "afternoon", new Date(2026, 11, 1, 15, 0), { dryRun: true }).new_dishes).toEqual([]);
    expect(REMINDER_PROMPT("evening")).toContain("answer: \"ok\"");
  });

  it("ok: it becomes theirs; not asked again the evening before, nor the next day", async () => {
    const k = await tomorrowNew();
    const r = await k.op("record_feedback", { date: TUE, slot: "Breakfast", dish: "Ragi puttu", answer: "ok" });
    expect(r.outcome).toBe("accepted");
    expect(getLibraryDish(k.kit.db, "Ragi puttu", "Breakfast")).toMatchObject({ untried: false, suggested: false, disliked: false });
    // Still planned, as it was.
    expect(k.dishesAt(TUE, "Breakfast")).toEqual(["Ragi puttu"]);
    const again = await k.op("get_reminder", { which: "evening" });
    expect(again.new_dishes.map((x: any) => x.dish)).toEqual(["Beetroot poriyal"]);
    expect(again.text).toContain("Tomorrow's new dish: Beetroot poriyal at lunch (like your Beans poriyal). OK to make it, or swap?");
    const next = buildReminder(k.kit.db, "afternoon", new Date(2026, 11, 2, 15, 0), { dryRun: true });
    expect(next.feedback.map((x) => x.dish)).toEqual(["Beetroot poriyal", "Korean paneer"]);
  });

  it("don't like: never suggested again, and that day's dish is planned again without it", async () => {
    const k = await tomorrowNew();
    const r = await k.op("record_feedback", { date: TUE, slot: "Lunch", dish: "Beetroot poriyal", answer: "dont_like" });
    expect(r.outcome).toBe("disliked");
    expect(r.replanned).toEqual([{ date: TUE, slot: "Lunch" }]);
    expect(getLibraryDish(k.kit.db, "Beetroot poriyal", "Lunch")).toMatchObject({ disliked: true });
    expect(k.dishesAt(TUE, "Lunch")).not.toContain("Beetroot poriyal");
    expect((await k.op("get_reminder", { which: "evening" })).new_dishes.map((x: any) => x.dish)).toEqual(["Ragi puttu"]);
  });

  it("swap: only that day's dish is planned again, with nothing new; the dish itself is not disliked", async () => {
    const k = await tomorrowNew();
    const before = k.snapshot();
    const r = await k.op("record_feedback", { date: TUE, slot: "Breakfast", dish: "Ragi puttu", answer: "swap" });
    expect(r.outcome).toBe("swapped");
    expect(r.replanned).toEqual([{ date: TUE, slot: "Breakfast" }]);
    expect(changed(before, k.snapshot())).toEqual([`${TUE}|Breakfast`]);
    expect(k.dishesAt(TUE, "Breakfast")).not.toContain("Ragi puttu");
    expect(k.at(TUE, "Breakfast")!.new_dishes_allowed).toBe(0);
    expect(k.at(TUE, "Breakfast")!.dishes.every((d) => !d.new)).toBe(true);
    expect(getLibraryDish(k.kit.db, "Ragi puttu", "Breakfast")).toMatchObject({ untried: true, disliked: false });
  });

  it("an answer needs made or answer; swap is only for a day still to come; made with answer is refused", async () => {
    const k = await tomorrowNew();
    expect((await k.op("record_feedback", { date: TUE, slot: "Breakfast", dish: "Ragi puttu" })).error).toContain("made or answer");
    expect((await k.op("record_feedback", { date: TUE, slot: "Breakfast", dish: "Ragi puttu", answer: "maybe" })).error).toContain("answer must be one of");
    expect((await k.op("record_feedback", { date: TUE, slot: "Breakfast", dish: "Ragi puttu", answer: "ok", made: true, liked: true, again: true })).error).toContain("not both");
    k.plan([{ date: SUN, slot: "Breakfast", dishes: [{ name: "Ragi puttu", new: true }] }]);
    expect((await k.op("record_feedback", { date: SUN, slot: "Breakfast", dish: "Ragi puttu", answer: "swap" })).error).toContain("has passed");
  });
});

describe("the Week page's edits go through the same change", () => {
  it("a dish edited on the page: the meal's whole list with its items, saved edited; ordered in and back", async () => {
    const k = await planned();
    const lunch = k.at(TUE, "Lunch")!;
    const list = [...lunch.dishes.map((d) => ({ dish: d.dish, note: d.note, ingredients: d.ingredients.map(({ item, amount, unit }) => ({ item, amount, unit })) })),
      { dish: "Papad", note: "for Kabir", ingredients: [{ item: "papad", amount: 4, unit: "pc" }] }];
    const r = await k.owner("POST", "/api/slot-days", { date: TUE, slot: "Lunch", dishes: list });
    expect(r.status).toBe(200);
    expect(k.f().days()).toHaveLength(0);   // every dish came with its items
    const after = k.at(TUE, "Lunch")!;
    expect(after.edited).toBe(true);
    expect(after.dishes.map((d) => [d.dish, d.note])).toEqual([...lunch.dishes.map((d) => [d.dish, d.note]), ["Papad", "for Kabir"]]);
    expect(after.dishes[0].ingredients.map((i) => i.item)).toEqual(lunch.dishes[0].ingredients.map((i) => i.item));
    expect((await k.owner("POST", "/api/slot-days", { date: TUE, slot: "Dinner", skip: "ordered_in" })).body.slot_day.skip).toBe("ordered_in");
    expect(k.dishesAt(TUE, "Dinner")).toEqual([]);
    const back = await k.owner("POST", "/api/slot-days", { date: TUE, slot: "Dinner", skip: null });
    expect(back.body.replanned).toEqual([{ date: TUE, slot: "Dinner" }]);
    expect((await k.owner("POST", "/api/slot-days", { date: TUE, slot: "Lunch", dishes: [{ dish: "Papad", ingredients: [{ item: "papad", amount: -1 }] }] })).body.reason).toContain("above 0");
  });

  it("with no model answering: the change is kept and planned by code, its ingredients named as missing", async () => {
    const k = await planned();
    k.use({ ...fake(), model: async () => ({ ok: false, code: "unavailable", message: "none" }) } as any);
    const r = await k.op("set_slot_day", { date: TUE, slot: "Dinner", guests: [{ count: 2 }] });
    expect(r.ok).toBe(true);
    expect(r.planned).not.toBe(false);
    expect(k.at(TUE, "Dinner")!.guests).toEqual([{ count: 2 }]);
    expect(k.dishesAt(TUE, "Dinner").length).toBeGreaterThan(0);
  });
});
