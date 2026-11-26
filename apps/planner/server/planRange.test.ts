// make_plan from a date (planRange.ts): some days planned, across a Monday when the range crosses one, the defaults for a
// household that named no meals, the family's own picks kept unless keep_edited is false, and the whole-week call as before.
// Also rules kept only while someone is there (when_present). No model: NO_MODEL, so ingredients stay empty.
import { describe, it, expect } from "bun:test";
import { boot } from "./testkit";
import { weekChunks } from "./planRange";
import { catalogContains, type MealTemplate } from "./kinds";
import { commit, listSlotDays, upsertLibrary, upsertSlot } from "./slotStore";

const SAT = "2026-11-28", SUN = "2026-11-29", MON = "2026-11-30";
const now = () => new Date(2026, 10, 28, 11, 0);
const dates = (k: { kit: any }) => [...new Set(listSlotDays(k.kit.db).map((d) => d.date))].sort();

async function household() {
  const k = await boot({ now });
  await k.op("set_person", { name: "Asha", group: "adult", diet: "veg", allergies: "none" });
  await k.op("set_person", { name: "Ravi", group: "adult", diet: "eggs ok" });
  return k;
}

describe("weekChunks", () => {
  it("splits a range at each Monday", () => {
    expect(weekChunks(SAT, MON)).toEqual([{ weekStart: "2026-11-23", from: SAT, to: SUN }, { weekStart: MON, from: MON, to: MON }]);
    expect(weekChunks(MON, "2026-12-02")).toEqual([{ weekStart: MON, from: MON, to: "2026-12-02" }]);
  });
});

describe("make_plan from a date", () => {
  it("the first plan: 3 days from today across a Monday, lunch and dinner by default, nothing outside the range", async () => {
    const k = await household();
    const r = await k.op("make_plan", { from: SAT, days: 3 });
    expect(r.ok).toBe(true);
    expect(r.defaults).toEqual(["meals: lunch and dinner"]);
    expect(dates(k)).toEqual([SAT, SUN, MON]);
    const days = listSlotDays(k.kit.db);
    expect(days.map((d) => d.slot).sort()).toEqual(["Dinner", "Dinner", "Dinner", "Lunch", "Lunch", "Lunch"]);
    for (const d of days) expect(d.dishes.length, `${d.date} ${d.slot}`).toBeGreaterThan(0);
    expect(r.message.startsWith("Here's the plan for the next 3 days.")).toBe(true);
    for (const day of ["*Saturday*", "*Sunday*", "*Monday*"]) expect(r.message).toContain(day);
    expect(r.message).not.toContain("*Tuesday*");
    // Short for WhatsApp (rerun b, 27 Nov): the days, one line on swaps, the Week page; the how-to waits for the setup's end.
    expect(r.intro).toBeUndefined();
    for (const gone of ["How it works", "The whole week", "Tell me anything to change", "New this week"]) expect(r.message).not.toContain(gone);
    expect(r.message).toContain("Suggestions for now: tell me what to swap.");
    expect(r.message.trimEnd().split("\n").at(-1)).toMatch(/^\[Week page\]\(.+\)$/);
    expect(r.message.length).toBeLessThan(700);
    expect(k.rows("house")[0].intro_sent_at).toBeNull();
    expect(r.text).toBeUndefined();
  });

  it("the next 4 days after the first 3 make the week, keeping the first days as they were", async () => {
    const k = await household();
    await k.op("make_plan", { from: SAT, days: 3 });
    const before = listSlotDays(k.kit.db, { from: SAT, to: MON }).map((d) => `${d.date}|${d.slot}|${d.dishes.map((x) => x.dish).join(",")}`);
    const r = await k.op("make_plan", { from: "2026-12-01", days: 4 });
    expect(r.ok).toBe(true);
    expect(r.defaults).toBeUndefined();
    expect(r.intro).toBeUndefined();
    expect(dates(k)).toEqual([SAT, SUN, MON, "2026-12-01", "2026-12-02", "2026-12-03", "2026-12-04"]);
    expect(listSlotDays(k.kit.db, { from: SAT, to: MON }).map((d) => `${d.date}|${d.slot}|${d.dishes.map((x) => x.dish).join(",")}`)).toEqual(before);
    expect(r.message.startsWith("Here's the plan from Tuesday to Friday.")).toBe(true);
  });

  it("keeps the family's own picks unless keep_edited is false", async () => {
    const k = await household();
    await k.op("make_plan", { from: SAT, days: 2 });
    await k.op("set_slot_day", { date: SUN, slot: "Lunch", dishes: ["Kadhi chawal"] });
    await k.op("make_plan", { from: SAT, days: 2 });
    expect(listSlotDays(k.kit.db, { from: SUN, to: SUN, slot: "Lunch" })[0].dishes.map((d) => d.dish)).toEqual(["Kadhi chawal"]);
    await k.op("make_plan", { from: SAT, days: 2, keep_edited: false });
    const lunch = listSlotDays(k.kit.db, { from: SUN, to: SUN, slot: "Lunch" })[0];
    expect(lunch.dishes.map((d) => d.dish)).not.toContain("Kadhi chawal");
    expect(lunch.dishes.length).toBeGreaterThan(0);
  });

  it("the whole-week call works as before", async () => {
    const k = await household();
    await k.op("set_slot", { name: "Lunch", kind: "main" });
    const r = await k.op("make_plan", { week_start: MON, suggest_new: true });
    expect(r.ok).toBe(true);
    expect(r.week_start).toBe(MON);
    expect(r.message.startsWith("Your week is planned.")).toBe(true);
    expect(r.text).toBeUndefined();
  });

  it("refuses a range it cannot plan, and a call with neither from nor week_start", async () => {
    const k = await household();
    expect((await k.op("make_plan", { from: SAT, days: 0 })).error).toContain("days must be a whole number from 1 to 14");
    expect((await k.op("make_plan", { from: SAT, days: 15 })).error).toContain("days must be a whole number from 1 to 14");
    expect((await k.op("make_plan", { from: "2026-11-20", days: 3 })).error).toContain("is over");
    expect((await k.op("make_plan", {})).error).toContain("from and days are needed");
  });

  it("from a day already past starts today", async () => {
    const k = await household();
    const r = await k.op("make_plan", { from: "2026-11-27", days: 3 });
    expect(r.from).toBe(SAT);
    expect(dates(k)).toEqual([SAT, SUN]);
  });
});

describe("a rule kept only while someone is there (when_present)", () => {
  const T = (...parts: MealTemplate["parts"]): MealTemplate => ({ parts });
  const hasEgg = (dish: string) => (catalogContains(dish) ?? []).includes("egg");
  /** A house whose breakfast is eggs or poha, and whose parents visit now and then. */
  async function visited(rule: Record<string, unknown>) {
    const k = await boot({ now });
    await k.op("set_person", { name: "Riya", group: "adult", diet: "eggs ok" });
    await k.op("set_person", { name: "Arjun", group: "adult", diet: "eggs ok" });
    for (const name of ["Mummy", "Papa"]) await k.op("set_person", { name, group: "elder", relationship: "parent", diet: "veg, no eggs", usually_home: false });
    commit(k.kit.db, k.kit.emitChange, (tx, ch) => {
      upsertSlot(tx, { name: "Breakfast", kind: "main", order: 10, kinds: [{ name: "Egg" }, { name: "Poha" }], templates: [T({ kind: "Egg" }), T({ kind: "Poha" })] }, "app", ch);
      for (const [name, kind] of [["Egg bhurji", "Egg"], ["Masala omelette", "Egg"], ["Boiled eggs", "Egg"], ["Akuri", "Egg"], ["Kanda poha", "Poha"], ["Batata poha", "Poha"], ["Matar poha", "Poha"], ["Indori poha", "Poha"]])
        upsertLibrary(tx, { name, slot: "Breakfast", kind, origin: "setup_named", catalog_item: name }, "app", ch);
    });
    await k.op("set_rule", { hard: true, what: "no_eggs", quote: "no eggs when my parents are here", ...rule });
    return k;
  }
  const breakfast = (k: { kit: any }, date: string) => listSlotDays(k.kit.db, { from: date, to: date, slot: "Breakfast" })[0];

  it("holds only on the days the parents are added; the rest of the week keeps its eggs", async () => {
    const k = await visited({ when_present: ["mummy", "Papa"] });
    expect(k.rows("rules")[0].when_present).toBe(JSON.stringify(["Mummy", "Papa"]));
    for (const date of [MON, "2026-12-01"]) await k.op("set_slot_day", { date, slot: "Breakfast", add_people: ["Mummy", "Papa"] });
    await k.op("set_slot_day", { date: "2026-12-02", slot: "Breakfast", guests: [{ count: 2, as: ["Mummy", "Papa"] }] });
    const r = await k.op("make_plan", { week_start: MON });
    expect(r.ok).toBe(true);
    for (const date of [MON, "2026-12-01", "2026-12-02"]) {
      const d = breakfast(k, date);
      expect(d.dishes.length, date).toBeGreaterThan(0);
      expect(d.dishes.filter((x) => hasEgg(x.dish)), date).toEqual([]);
    }
    expect(breakfast(k, MON).people).toEqual(expect.arrayContaining(["Riya", "Arjun", "Mummy", "Papa"]));
    // The parents are not usually home: the days they were not added are planned for the two, with eggs on some.
    const rest = ["2026-12-03", "2026-12-04", "2026-12-05", "2026-12-06"].map((date) => breakfast(k, date));
    for (const d of rest) expect(d.people).toEqual(["Riya", "Arjun"]);
    expect(rest.some((d) => d.dishes.some((x) => hasEgg(x.dish)))).toBe(true);
  });

  it("the same rule without when_present holds every day", async () => {
    const k = await visited({});
    await k.op("make_plan", { week_start: MON });
    for (const d of listSlotDays(k.kit.db, { slot: "Breakfast" })) expect(d.dishes.filter((x) => hasEgg(x.dish)), d.date!).toEqual([]);
  });
});
