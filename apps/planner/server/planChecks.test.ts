// planChecks.ts on a hand-made week, no database and no model: the walk of a slot's week (walkSlot: days kept, the
// two-day cap across slots, the rice or bread a plate must have, spares, gaps, nobody without food, add-on days), the
// feasibility check's shared dishes and new dish for a person with nothing of their own, a short slot's own new dishes,
// and the allergy rules (a family dish vouched for by the family's own plates).
import { describe, expect, it } from "bun:test";
import { allergyNotes, applyParts, carefulTags, checkSlot, feasibility, ruleBreaks, settingUsed, slotFacts, vouched, walkSlot, type Part, type Proposal, type Week } from "./planChecks";
import { dishKey } from "./dishText";
import type { PlanDay } from "./planDays";
import type { HistoryRow, LibraryDish, Rule, Slot } from "./slotStore";

const WEEK = ["2026-11-30", "2026-12-01", "2026-12-02", "2026-12-03", "2026-12-04", "2026-12-05", "2026-12-06"];
const READ = ["egg", "meat", "fish", "onion_garlic"];
const slot = (name: string, o: Partial<Slot> = {}): Slot => ({ id: name, name, kind: "main", addon_of: null, usual_people: [], days: [], skip_days: [], order: 30, active: true, ...o });
const dish = (name: string, slotName: string, o: Partial<LibraryDish> = {}): LibraryDish => ({ id: `${slotName}|${name}`, key: dishKey(name), slot: slotName, name, frequency: null, days: null,
  contains: [], contains_read: READ, origin: "setup_named", suggested: false, untried: false, offers: 0, disliked: false, prep: null, video_url: null, video_title: null,
  video_thumbnail: null, rating: null, rating_note: null, rated_on: null, rated_by: null, ratings: [], ...o });
const day = (date: string, slotName: string, people = ["Asha", "Ravi"]): PlanDay => ({ date, slot: slotName, people, guests: [], occasion: null, new_dishes_allowed: null, skip: null,
  edited: false, fixed: false, why: [], fasting: [], dishes: [], note: null });
const seed = (slotName: string, rows: string[][]): HistoryRow[] => rows.map((r) => ({ date: null, status: "confirmed", skip: null, dishes: r.map((d) => ({ dish: d })) }) as HistoryRow);
const rule = (o: Partial<Rule>): Rule => ({ id: "r", hard: true, what: "avoid", who: null, slots: null, days: null, items: null, to: null, frequency: null, per_meal: null, fasting_food: null, quote: "", ...o });

/** A week of the given slots, every day for Asha and Ravi. `parts`: dish → [part, kind], applied to every slot (as the
 *  plates' parts read would). */
function week(o: { slots: Slot[]; library: LibraryDish[]; rules?: Rule[]; history?: Record<string, HistoryRow[]>; newBudget?: number; parts?: Record<string, [string, Part["kind"]]> }): Week {
  const w: Week = { days: o.slots.flatMap((s) => WEEK.map((d) => day(d, s.name))), slots: new Map(), rules: o.rules ?? [], library: o.library, facts: new Map(), done: new Set(),
    newBudget: o.newBudget ?? 0, newDishes: new Map() };
  for (const s of o.slots) {
    const sf = slotFacts(s, o.library, o.history?.[s.name] ?? [], {});
    applyParts(sf, new Map(Object.entries(o.parts ?? {}).map(([k, [part, kind]]) => [dishKey(k), { part, kind }])));
    w.slots.set(s.name.toLowerCase(), sf);
  }
  return w;
}
const plan = (rows: string[][]): Proposal => ({ days: new Map(WEEK.map((d, i) => [d, rows[i % rows.length]])), newNames: new Map() });
const daysWith = (p: Proposal, name: string) => WEEK.filter((d) => (p.days.get(d) ?? []).includes(name));

describe("the walk: days kept and the two-day cap (owner 25 Nov)", () => {
  const PARTS: Record<string, [string, Part["kind"]]> = { Roti: ["rice or bread", "rice_or_bread"], Rice: ["rice or bread", "rice_or_bread"], Curd: ["side", "side"],
    "Aloo paratha": ["breakfast dish", "complete"], Poha: ["breakfast dish", "complete"], Upma: ["breakfast dish", "complete"], Idli: ["breakfast dish", "complete"], Dosa: ["breakfast dish", "complete"],
    Rajma: ["curry", "main"], Chole: ["curry", "main"], Kadhi: ["curry", "main"], Sambar: ["curry", "main"], "Dal": ["dal", "main"], "Moong dal": ["dal", "main"], "Toor dal": ["dal", "main"],
    Bhindi: ["sabzi", "main"], Lauki: ["sabzi", "main"], Tinda: ["sabzi", "main"], Karela: ["sabzi", "main"], Gobi: ["sabzi", "main"] };

  it("a dish off its days is replaced on each other day by one of its part; on its own days it stays", () => {
    const lib = ["Poha", "Upma", "Idli", "Dosa"].map((n) => dish(n, "Breakfast")).concat(dish("Aloo paratha", "Breakfast", { days: ["Sat", "Sun"] }));
    const w = week({ slots: [slot("Breakfast", { order: 10 })], library: lib, parts: PARTS });
    const p = plan([["Aloo paratha"]]);
    const r = walkSlot(w, "Breakfast", p, { final: true });
    expect(daysWith(p, "Aloo paratha")).toEqual([WEEK[5], WEEK[6]]);
    for (const d of WEEK.slice(0, 5)) expect(["Poha", "Upma", "Idli", "Dosa"]).toContain(p.days.get(d)![0]);
    expect(r.changed[0]).toContain("Aloo paratha is had on Sat, Sun only");
    expect(r.gaps).toEqual([]);
  });

  it("a main comes at most twice a week, counted across slots: a third day takes another dish of its part; a dish the family has more often keeps its days", () => {
    const lib = [...["Rajma", "Chole", "Kadhi", "Sambar"].map((n) => dish(n, "Lunch")), dish("Rajma", "Dinner"), ...["Bhindi", "Lauki", "Tinda", "Karela", "Gobi"].map((n) => dish(n, "Dinner")),
      dish("Dal", "Dinner", { frequency: "usually" })];
    const w = week({ slots: [slot("Lunch"), slot("Dinner", { order: 50 })], library: lib, parts: PARTS });
    // Lunch is planned: Rajma on Monday already.
    for (const d of w.days.filter((x) => x.slot === "Lunch")) d.dishes = [["Rajma", "Chole", "Kadhi", "Sambar", "Chole", "Kadhi", "Sambar"][WEEK.indexOf(d.date)]];
    w.done.add("lunch");
    // Dinner asks Rajma every day, and Dal every day.
    const p = plan([["Rajma", "Dal"]]);
    const r = walkSlot(w, "Dinner", p, { final: true });
    expect(r.unmet).toEqual([]);
    // Monday's lunch counts: Rajma at dinner on one more day only (not Monday: the same main at lunch that day).
    expect(daysWith(p, "Rajma")).toEqual([WEEK[1]]);
    // Dal is had usually (5 days at most): kept on its first 5 days, then another dish of its part where one fits.
    expect(daysWith(p, "Dal")).toHaveLength(5);
    for (const d of WEEK) expect(p.days.get(d)).toHaveLength(2);
  });

  it("the rice or bread the family's plates have at lunch and dinner is added to a day without it; a complete dish needs none", () => {
    const lib = ["Rajma", "Chole", "Kadhi", "Sambar", "Dal", "Bhindi", "Lauki", "Tinda"].map((n) => dish(n, "Lunch")).concat(dish("Khichdi", "Lunch"));
    const w = week({ slots: [slot("Lunch")], library: lib, history: { Lunch: seed("Lunch", [["Roti", "Bhindi"], ["Dal", "Rice", "Lauki", "Curd"]]) },
      parts: { ...PARTS, Khichdi: ["one-pot", "complete"] } });
    expect(w.slots.get("lunch")!.mustHave).toEqual(["Roti", "Rice"]);
    expect(w.slots.get("lunch")!.staples).toEqual(expect.arrayContaining(["Roti", "Rice", "Curd"]));
    const p = plan([["Dal", "Lauki"], ["Khichdi"], ["Rice", "Rajma"], ["Chole", "Bhindi"], ["Kadhi", "Tinda"], ["Sambar", "Dal"], ["Moong dal", "Lauki"]]);
    walkSlot(w, "Lunch", p, { final: true });
    expect(p.days.get(WEEK[0])![0]).toMatch(/^(Roti|Rice)$/);
    expect(p.days.get(WEEK[1])).toEqual(["Khichdi"]);
    expect(p.days.get(WEEK[2])).toEqual(["Rice", "Rajma"]);
    // Dal and Lauki, as on their plate with rice: rice; Bhindi, as on their plate with roti: roti.
    expect(p.days.get(WEEK[0])).toEqual(["Rice", "Dal", "Lauki"]);
    expect(p.days.get(WEEK[3])).toEqual(["Roti", "Chole", "Bhindi"]);
    for (const d of WEEK) expect(p.days.get(d)!.some((x) => ["Roti", "Rice", "Khichdi"].includes(x))).toBe(true);
  });

  it("no must-have at breakfast unless every plate of theirs has one", () => {
    const lib = ["Poha", "Upma"].map((n) => dish(n, "Breakfast"));
    const w = week({ slots: [slot("Breakfast", { order: 10 })], library: lib, history: { Breakfast: seed("Breakfast", [["Fruit bowl"], ["Upma", "Roti"]]) }, parts: PARTS });
    expect(w.slots.get("breakfast")!.mustHave).toEqual([]);
    // Every plate with its rice or bread, or a complete dish (Poha): the roti is a must.
    const v = week({ slots: [slot("Breakfast", { order: 10 })], library: lib, history: { Breakfast: seed("Breakfast", [["Poha"], ["Upma", "Roti"]]) }, parts: PARTS });
    expect(v.slots.get("breakfast")!.mustHave).toEqual(["Roti"]);
  });
});

describe("the walk: what the family said, and staples only beside a main (owner 25 Nov)", () => {
  const K: Record<string, [string, Part["kind"]]> = { Luchi: ["bread", "rice_or_bread"], Roti: ["bread", "rice_or_bread"], Rice: ["rice", "rice_or_bread"], Paratha: ["breakfast dish", "rice_or_bread"],
    "Alur dom": ["curry", "main"], "Cholar dal": ["dal", "main"], Sabzi: ["sabzi", "main"], Dal: ["dal", "main"], Rajma: ["curry", "main"], Chole: ["curry", "main"], Kadhi: ["curry", "main"],
    Idli: ["breakfast dish", "complete"], Dosa: ["breakfast dish", "complete"], Upma: ["breakfast dish", "complete"], Poha: ["breakfast dish", "complete"], Sambar: ["sambar", "main"],
    Chutney: ["side", "side"], Curd: ["side", "side"] };

  it("a bread the family has on its days stays on them, though it is their bread and every plate has one: never added on other days", () => {
    const lib = [dish("Luchi", "Breakfast", { days: ["Sun"] }), dish("Roti", "Breakfast"), dish("Alur dom", "Breakfast"), dish("Cholar dal", "Breakfast"), dish("Sabzi", "Breakfast")];
    const w = week({ slots: [slot("Breakfast", { order: 10 })], library: lib, parts: K, history: { Breakfast: seed("Breakfast", [["Luchi", "Alur dom"], ["Roti", "Sabzi"]]) } });
    expect(w.slots.get("breakfast")!.staples).toEqual(["Roti"]);
    const p = plan([["Alur dom"], ["Cholar dal"], ["Sabzi"], ["Luchi", "Alur dom"], ["Cholar dal"], ["Sabzi"], ["Luchi", "Alur dom"]]);
    walkSlot(w, "Breakfast", p, { final: true });
    expect(daysWith(p, "Luchi")).toEqual([WEEK[6]]);
    for (const d of WEEK.slice(0, 6)) expect(p.days.get(d)![0]).toBe("Roti");
  });

  it("a dish said once a week comes once; a frequency is kept whatever its part", () => {
    const lib = ["Rajma", "Chole", "Kadhi", "Dal", "Sabzi"].map((n) => dish(n, "Dinner", { frequency: n === "Rajma" || n === "Chole" ? "1/week" as any : null })).concat(dish("Roti", "Dinner"));
    const w = week({ slots: [slot("Dinner", { order: 50 })], library: lib, parts: K, history: { Dinner: seed("Dinner", [["Roti", "Rajma"], ["Roti", "Dal"]]) } });
    const p = plan([["Roti", "Rajma"], ["Roti", "Chole"], ["Roti", "Rajma"], ["Roti", "Chole"], ["Roti", "Kadhi"], ["Roti", "Dal"], ["Roti", "Sabzi"]]);
    walkSlot(w, "Dinner", p, { final: true });
    expect(daysWith(p, "Rajma")).toEqual([WEEK[0]]);
    expect(daysWith(p, "Chole")).toEqual([WEEK[1]]);
    expect(daysWith(p, "Roti")).toHaveLength(7);   // the bread beside a main: no count
  });

  it("a bread alone as the plate (a paratha breakfast) is a dish like any other: twice a week; an idli breakfast too", () => {
    const lib = ["Paratha", "Idli", "Upma", "Poha", "Dosa"].map((n) => dish(n, "Breakfast"));
    const w = week({ slots: [slot("Breakfast", { order: 10 })], library: lib, parts: K, history: { Breakfast: seed("Breakfast", [["Paratha"], ["Idli"], ["Poha"]]) } });
    expect(w.slots.get("breakfast")!.staples).toEqual([]);
    const p = plan([["Paratha"], ["Paratha"], ["Idli"], ["Paratha"], ["Idli"], ["Idli"], ["Paratha"]]);
    walkSlot(w, "Breakfast", p, { final: true });
    expect(daysWith(p, "Paratha").length).toBeLessThanOrEqual(2);
    expect(daysWith(p, "Idli").length).toBeLessThanOrEqual(2);
    for (const d of WEEK) expect(p.days.get(d)).toHaveLength(1);
  });

  it("sambar beside idli or dosa is a side, no count; near rice it is a main, twice a week (owner: \"sambar is a main when it comes near rice\")", () => {
    const lib = ["Idli", "Dosa", "Upma", "Poha", "Sambar", "Chutney"].map((n) => dish(n, "Breakfast"));
    const w = week({ slots: [slot("Breakfast", { order: 10 })], library: lib, parts: K, history: { Breakfast: seed("Breakfast", [["Idli", "Sambar", "Chutney"], ["Dosa", "Sambar", "Chutney"]]) } });
    const p = plan([["Idli", "Sambar"], ["Dosa", "Sambar"], ["Upma", "Sambar"], ["Poha", "Sambar"], ["Idli", "Sambar"], ["Dosa", "Sambar"], ["Upma", "Sambar"]]);
    walkSlot(w, "Breakfast", p, { final: true });
    expect(daysWith(p, "Sambar")).toHaveLength(7);
    const lunch = [dish("Rice", "Lunch"), ...["Sambar", "Dal", "Kadhi", "Rajma", "Chole"].map((n) => dish(n, "Lunch"))];
    const v = week({ slots: [slot("Lunch")], library: lunch, parts: K, history: { Lunch: seed("Lunch", [["Rice", "Sambar"], ["Rice", "Dal"]]) } });
    const q = plan([["Rice", "Sambar"]]);
    walkSlot(v, "Lunch", q, { final: true });
    expect(daysWith(q, "Sambar")).toHaveLength(2);
  });
});

describe("the walk: a person's own dish and a person fed past the budget (onboarding e2e, 25 Nov)", () => {
  const noOnion = rule({ who: "Gita", items: ["onion_garlic"], quote: "Gita never eats onion or garlic" });
  it("a dish of a slot that is only theirs is made for them: their rule holds for it by the family's word", () => {
    const lib = [dish("Veg torkari", "Gita's dinner", { contains: ["onion_garlic"], contains_read: [...READ] }), dish("Fish", "Dinner")];
    const w = week({ slots: [slot("Dinner", { order: 50 }), slot("Gita's dinner", { kind: "addon", addon_of: "Dinner", order: 60, usual_people: ["Gita"] })], library: lib, rules: [noOnion] });
    const d = { ...w.days.find((x) => x.slot === "Gita's dinner")!, people: ["Gita"] };
    expect(ruleBreaks(w, d, "Veg torkari")).toEqual([]);
    const m = { ...w.days.find((x) => x.slot === "Dinner")!, people: ["Gita"] };
    expect(ruleBreaks(w, m, "Alur dom")).not.toEqual([]);   // any other dish still by what it contains
  });
  it("a person with nothing of their own takes a dish made for them though the week's new dishes are used up", () => {
    const papa = rule({ who: "Ravi", items: ["onion_garlic"], quote: "Papa never eats onion or garlic" });
    const lib = [dish("Roti", "Lunch"), dish("Dal", "Lunch", { contains: ["onion_garlic"], frequency: "daily" }), dish("Sabzi", "Lunch", { contains: ["onion_garlic"], frequency: "daily" })];
    const w = week({ slots: [slot("Lunch")], library: lib, rules: [papa], newBudget: 0, parts: { Roti: ["bread", "rice_or_bread"], Dal: ["dal", "main"], Sabzi: ["sabzi", "main"] },
      history: { Lunch: seed("Lunch", [["Roti", "Dal", "Sabzi"]]) } });
    const p = plan([["Roti", "Dal", "Sabzi"]]);
    const first = walkSlot(w, "Lunch", p);
    expect(first.gaps.filter((g) => !g.place && g.for.join() === "Ravi")).toHaveLength(7);
    // The targeted call's answer: their dal made for him, read as having no onion or garlic, and a new dish.
    w.facts.set(dishKey("Dal without onion and garlic"), { tags: new Set(), read: new Set(READ) });
    w.facts.set(dishKey("Lauki"), { tags: new Set(), read: new Set(READ) });
    const extra = new Map(WEEK.map((d, i) => [d, [i < 2 ? "Dal without onion and garlic" : "Lauki"]]));
    const last = walkSlot(w, "Lunch", p, { final: true, gaps: first.gaps, extra });
    for (const d of WEEK) expect(p.days.get(d)!.some((x) => x === "Dal without onion and garlic" || x === "Lauki")).toBe(true);
    expect(last.unmet.some((u) => u.includes("Ravi"))).toBe(false);
  });
});

describe("the walk: spares, gaps and nobody without food (owner 25 Nov)", () => {
  const PARTS: Record<string, [string, Part["kind"]]> = { Roti: ["rice or bread", "rice_or_bread"], "Toor dal": ["dal", "main"], Lauki: ["sabzi", "main"], Bhindi: ["sabzi", "main"] };
  const thin = (newBudget = 0) => week({ slots: [slot("Dinner", { order: 50 })], library: ["Roti", "Toor dal", "Lauki", "Bhindi"].map((n) => dish(n, "Dinner")), newBudget,
    history: { Dinner: seed("Dinner", [["Roti", "Toor dal", "Lauki"], ["Roti", "Toor dal", "Bhindi"]]) }, parts: PARTS });

  it("a dish past its days takes a spare of its part; a spare not of theirs is new, used within the budget only", () => {
    const w = thin(1);
    w.slots.get("dinner")!.newAllowed = 1;
    const p = plan([["Roti", "Toor dal", "Lauki"]]);
    p.spares = new Map([["dal", ["Moong dal", "Chana dal"]], ["sabzi", ["Turai sabzi", "Gawar sabzi"]]]);
    const r = walkSlot(w, "Dinner", p, { final: true });
    // Toor dal on Monday, then Moong dal (not back the next day), Toor dal's second day, Moong dal's second.
    expect(WEEK.slice(0, 4).map((d) => p.days.get(d)![1])).toEqual(["Toor dal", "Moong dal", "Toor dal", "Moong dal"]);
    expect(daysWith(p, "Moong dal")).toHaveLength(2);
    expect(daysWith(p, "Chana dal")).toEqual([]);   // a second new dish: past the budget of 1
    for (const d of WEEK) { expect(p.days.get(d)![0]).toBe("Roti"); expect(p.days.get(d)).toHaveLength(3); }
    // The week runs out of their dishes on Friday: the closest stays, said.
    expect(r.unmet).toContain("Fri Dinner: Toor dal comes back sooner than usual");
  });

  it("a spare that is a particular way of a family dish is theirs: not new, so used past the budget", () => {
    const w = week({ slots: [slot("Dinner", { order: 50 })], library: ["Roti", "Dal", "Sabzi"].map((n) => dish(n, "Dinner")),
      history: { Dinner: seed("Dinner", [["Roti", "Dal", "Sabzi"]]) }, parts: { Roti: ["rice or bread", "rice_or_bread"], Dal: ["dal", "main"], Sabzi: ["sabzi", "main"] } });
    const p = plan([["Roti", "Dal", "Sabzi"]]);
    p.spares = new Map([["dal", ["Moong dal", "Masoor dal", "Toor dal", "Chana dal", "Urad dal"]], ["sabzi", ["Bhindi sabzi", "Lauki sabzi", "Aloo gobi sabzi", "Beans sabzi", "Tinda sabzi"]]]);
    const r = walkSlot(w, "Dinner", p, { final: true });
    expect(r.unmet).toEqual([]);
    for (const d of WEEK) expect(p.days.get(d)).toHaveLength(3);
    expect(daysWith(p, "Dal")).toHaveLength(2);
    expect(WEEK.filter((d) => p.days.get(d)![1].endsWith(" dal")).length).toBe(5);
    // Each a variant row of theirs in the week's library, not new.
    expect(w.library.some((x) => x.name === "Moong dal" && x.id.startsWith("variant:"))).toBe(true);
  });

  it("a day with nothing that fits is a gap on the first walk (its part, who eats, why); the targeted call's dish fills it on the last", () => {
    const w = thin(0);
    const p = plan([["Roti", "Toor dal", "Lauki"]]);
    const first = walkSlot(w, "Dinner", p);
    // Toor dal has 2 days and no other dal is known: 5 gaps for a dal; Lauki and Bhindi share the sabzi days (4), 3 more gaps.
    expect(first.gaps.filter((g) => g.part === "dal")).toHaveLength(5);
    expect(first.gaps[0]).toMatchObject({ for: ["Asha", "Ravi"], place: true });
    expect(first.gaps.find((g) => g.part === "dal")!.why).toContain("Toor dal has had its 2 days this week");
    const extra = new Map(first.gaps.map((g) => [g.date, g.part === "dal" ? ["Moong dal"] : ["Turai sabzi"]]));
    // No new dishes allowed: the targeted call's Moong dal and Turai sabzi are new, so they do not fit; the closest stays, said.
    const last = walkSlot(w, "Dinner", p, { final: true, gaps: first.gaps, extra });
    for (const d of WEEK) expect(p.days.get(d)).toHaveLength(3);
    expect(last.unmet.some((u) => u.endsWith("comes back sooner than usual"))).toBe(true);
    // With room for new dishes, the call's dishes fill the gaps (each its two days), fewer closest dishes said.
    const v = thin(0); v.slots.get("dinner")!.shortNew = 2;
    const q = plan([["Roti", "Toor dal", "Lauki"]]);
    const g = walkSlot(v, "Dinner", q);
    const done = walkSlot(v, "Dinner", q, { final: true, gaps: g.gaps, extra });
    expect(daysWith(q, "Moong dal")).toHaveLength(2);
    expect(daysWith(q, "Turai sabzi").length).toBeGreaterThan(0);
    expect(done.unmet.length).toBeLessThan(last.unmet.length);
  });

  it("nobody is left without food: a person with nothing of their own gets a dish beside; none that fits, the closest they can eat", () => {
    const veg = rule({ what: "veg", who: "Asha", quote: "Asha is vegetarian" });
    const lib = [dish("Rice", "Lunch"), dish("Fish curry", "Lunch", { contains: ["fish"], frequency: "7/week" as any }), dish("Dal", "Lunch")];
    const w = week({ slots: [slot("Lunch")], library: lib, rules: [veg], parts: { Rice: ["rice or bread", "rice_or_bread"], "Fish curry": ["curry", "main"], Dal: ["dal", "main"] } });
    const p = plan([["Rice", "Fish curry"]]);
    const first = walkSlot(w, "Lunch", p);
    // Dal on 2 days beside the fish for Asha; the other days a gap for her.
    expect(daysWith(p, "Dal")).toHaveLength(2);
    expect(first.gaps.filter((g) => !g.place && g.for.join() === "Asha")).toHaveLength(5);
    const last = walkSlot(w, "Lunch", p, { final: true, gaps: first.gaps });
    for (const d of WEEK) expect(p.days.get(d)).toContain("Dal");
    expect(last.unmet.filter((u) => u.includes("Dal comes back sooner than usual"))).toHaveLength(5);
    expect(last.unmet.some((u) => u.includes("nothing to eat"))).toBe(false);
  });

  it("a gap's place with no dish anyone there can eat at all: said plainly, never a dish against everyone's rule", () => {
    const veg = rule({ what: "veg", quote: "we are vegetarian" });
    const w = week({ slots: [slot("Lunch")], library: [dish("Fish curry", "Lunch", { contains: ["fish"] })], rules: [veg] });
    const p = plan([["Fish curry"]]);
    const r = walkSlot(w, "Lunch", p, { final: true });
    for (const d of WEEK) expect(p.days.get(d)).not.toContain("Fish curry");
    expect(r.unmet).toEqual([]);   // an empty day: makePlan's own check says it (no dishes known)
  });
});

describe("the walk: add-on days (owner 23 Nov)", () => {
  it("an add-on dish had twice a week stays on 2 days spread apart; the rest are empty, nothing said", () => {
    const lib = [dish("Roti", "Dinner"), dish("Dal", "Dinner"), dish("Fish curry", "Fish", { frequency: "2/week" as any })];
    const w = week({ slots: [slot("Dinner", { order: 50 }), slot("Fish", { kind: "addon", addon_of: "Dinner", order: 60, usual_people: ["Ravi"] })], library: lib });
    for (const d of w.days.filter((x) => x.slot === "Dinner")) d.dishes = ["Roti", "Dal"];
    for (const d of w.days.filter((x) => x.slot === "Fish")) d.people = ["Ravi"];
    w.done.add("dinner");
    const p = plan([["Fish curry"]]);
    const r = walkSlot(w, "Fish", p);
    expect(WEEK.filter((d) => p.days.get(d)!.length)).toEqual([WEEK[0], WEEK[3]]);
    expect(r.unmet).toEqual([]);
    expect(r.gaps).toEqual([]);
  });
  it("an add-on dish with no how-often said is the person's standing difference: kept every day", () => {
    const lib = [dish("Roti", "Dinner"), dish("Dal", "Dinner"), dish("Phulka", "Papa's dinner")];
    const w = week({ slots: [slot("Dinner", { order: 50 }), slot("Papa's dinner", { kind: "addon", addon_of: "Dinner", order: 60, usual_people: ["Ravi"] })], library: lib });
    for (const d of w.days.filter((x) => x.slot === "Dinner")) d.dishes = ["Roti", "Dal"];
    for (const d of w.days.filter((x) => x.slot === "Papa's dinner")) d.people = ["Ravi"];
    w.done.add("dinner");
    const p = plan([["Phulka"]]);
    walkSlot(w, "Papa's dinner", p);
    expect(WEEK.filter((d) => p.days.get(d)!.length)).toHaveLength(7);
  });
});

describe("the walk: a dish the family has on its days", () => {
  it("is put on its day in the place of a dish of its part when the call left it out", () => {
    const lib = [dish("Khichdi", "Dinner", { days: ["Sat"] }), ...["Lauki", "Bhindi", "Tinda", "Turai"].map((n) => dish(n, "Dinner"))];
    const w = week({ slots: [slot("Dinner", { order: 50 })], library: lib, parts: Object.fromEntries(["Khichdi", "Lauki", "Bhindi", "Tinda", "Turai"].map((n) => [n, ["main", "main"]])) });
    const p = plan([["Lauki"], ["Bhindi"], ["Tinda"], ["Turai"], ["Lauki"], ["Bhindi"], ["Tinda"]]);
    walkSlot(w, "Dinner", p, { final: true });
    expect(daysWith(p, "Khichdi")).toEqual([WEEK[5]]);
  });

  it("one the family has on its days takes the place of any main when no dish of its part is there; one they have often is not pushed up to a least (owner 25 Nov)", () => {
    const PARTS: Record<string, [string, Part["kind"]]> = { Rice: ["rice or bread", "rice_or_bread"], Curd: ["side", "side"], Sambar: ["sambar", "main"], Rasam: ["rasam", "main"],
      Poriyal: ["dry vegetable", "main"], Avial: ["dry vegetable", "main"], Thoran: ["dry vegetable", "main"], Kootu: ["kootu", "main"], Bisibele: ["one-pot", "complete"] };
    const lib = [...["Sambar", "Rasam", "Poriyal", "Avial", "Thoran"].map((n) => dish(n, "Lunch", { frequency: n === "Sambar" || n === "Rasam" ? "usually" as any : null })),
      dish("Kootu", "Lunch", { frequency: "sometimes" }), dish("Bisibele", "Lunch", { days: ["Sun"] })];
    const w = week({ slots: [slot("Lunch")], library: lib, parts: PARTS, history: { Lunch: seed("Lunch", [["Rice", "Sambar", "Poriyal", "Curd"], ["Rice", "Rasam", "Avial", "Curd"]]) } });
    const p = plan([["Rice", "Sambar", "Poriyal", "Curd"], ["Rice", "Rasam", "Avial", "Curd"], ["Rice", "Sambar", "Thoran", "Curd"], ["Rice", "Rasam", "Poriyal", "Curd"],
      ["Rice", "Sambar", "Avial", "Curd"], ["Rice", "Rasam", "Thoran", "Curd"], ["Rice", "Sambar", "Poriyal", "Curd"]]);
    walkSlot(w, "Lunch", p, { final: true });
    // Kootu comes only where a dish had to be replaced (Sunday's third Poriyal), never pushed up to its "sometimes".
    expect(daysWith(p, "Kootu").length).toBeLessThan(2);
    expect(daysWith(p, "Bisibele")).toEqual([WEEK[6]]);
    for (const d of WEEK) { expect(p.days.get(d)).toContain("Rice"); expect(p.days.get(d)).toHaveLength(4); }
  });

  it("never takes the place of the dish that brings the day's rice or bread", () => {
    const PARTS: Record<string, [string, Part["kind"]]> = { Roti: ["rice or bread", "rice_or_bread"], Khichdi: ["one-pot", "complete"], Kootu: ["kootu", "main"] };
    const lib = [dish("Khichdi", "Dinner", { frequency: "7/week" as any }), dish("Kootu", "Dinner", { frequency: "sometimes" })];
    const w = week({ slots: [slot("Dinner", { order: 50 })], library: lib, parts: PARTS, history: { Dinner: seed("Dinner", [["Roti", "Kootu"], ["Khichdi"]]) } });
    const p = plan([["Khichdi"]]);
    walkSlot(w, "Dinner", p, { final: true });
    for (const d of WEEK) expect(p.days.get(d)!.some((x) => x === "Khichdi" || x === "Roti")).toBe(true);
  });
});

describe("the walk: a particular way of a family dish keeps its own days a week (owner 25 Nov)", () => {
  it("each variant has its own two days, not a share of the family dish's", () => {
    const w = week({ slots: [slot("Breakfast", { order: 10 })], library: [dish("Dosa", "Breakfast")], parts: { Dosa: ["breakfast dish", "complete"] } });
    const p = plan([["Dosa"], ["Dosa"], ["Rava dosa"], ["Rava dosa"], ["Masala dosa"], ["Masala dosa"], ["Set dosa"]]);
    const r = walkSlot(w, "Breakfast", p, { final: true });
    expect(WEEK.map((d) => p.days.get(d)![0])).toEqual(["Dosa", "Dosa", "Rava dosa", "Rava dosa", "Masala dosa", "Masala dosa", "Set dosa"]);
    expect(r.unmet).toEqual([]);
    expect(w.library.filter((x) => x.id.startsWith("variant:")).map((x) => x.name)).toEqual(["Rava dosa", "Masala dosa", "Set dosa"]);
  });
});

describe("feasibility", () => {
  const veg: Rule = { id: "r", hard: true, what: "veg", who: "Asha", slots: null, days: null, items: null, to: null, frequency: null, per_meal: null, fasting_food: null, quote: "Asha is vegetarian" };
  const keep = (w: Week, dates: string[]) => { for (const d of w.days.filter((x) => !dates.includes(x.date))) d.skip = "eaten_out"; };

  it("a dish two slots share has one count: what the earlier slot will take is set aside, and the later slot is short", () => {
    const lib = ["Lauki", "Bhindi"].flatMap((n) => [dish(n, "Lunch"), dish(n, "Dinner")]);
    const w = week({ slots: [slot("Lunch"), slot("Dinner", { order: 50 })], library: lib });
    keep(w, [WEEK[0], WEEK[1], WEEK[3], WEEK[6]]);
    const r = feasibility(w, ["Lunch", "Dinner"]);
    expect(r.log[0]).toBe("feasibility Lunch: 4 places (4 × 1), 4 from the library");
    expect([...w.slots.get("lunch")!.takes]).toEqual([["lauki", 2], ["bhindi", 2]]);
    expect(r.log[1]).toStartWith("feasibility Dinner: 4 places (4 × 1), 0 from the library");
    expect(r.short).toEqual([{ slot: "Dinner", known: 2, supply: 0, places: 4, newDishes: 2 }]);
  });

  it("a person who can eat none of a slot's dishes beside the staples on some day gets a new dish there first", () => {
    const lib = [dish("Rice", "Lunch"), dish("Fish curry", "Lunch", { contains: ["fish"], days: ["Sun"] }), dish("Mutton curry", "Lunch", { contains: ["meat"], days: ["Sun"] })];
    const w = week({ slots: [slot("Lunch")], library: lib, rules: [veg], newBudget: 2, history: { Lunch: seed("Lunch", [["Rice", "Fish curry"], ["Rice", "Mutton curry"], ["Rice", "Fish curry"]]) },
      parts: { Rice: ["rice or bread", "rice_or_bread"], "Fish curry": ["curry", "main"], "Mutton curry": ["curry", "main"] } });
    const r = feasibility(w, ["Lunch"]);
    expect(r.log[0]).toBe("feasibility Lunch: 1 new dish for Asha (none of its dishes beside the staples is theirs on some day)");
    expect(w.slots.get("lunch")!.newAllowed).toBe(2);
  });
});

describe("a short slot's own new dishes (owner, 24 Nov)", () => {
  // Dinner: 7 days of two non-staple dishes (Roti is every plate's staple), and only two dishes known: 14 places, 4 at most
  // from the library (each 2 days); short by 10 places, 5 new dishes at 2 days each.
  const thinDinner = (newBudget: number) => week({ slots: [slot("Lunch"), slot("Dinner", { order: 50 })], newBudget,
    library: [...["Sambar", "Rasam", "Kootu", "Poriyal", "Avial", "Thoran", "Kadhi"].map((n) => dish(n, "Lunch")), ...["Roti", "Lauki", "Toor dal"].map((n) => dish(n, "Dinner"))],
    history: { Dinner: seed("Dinner", [["Roti", "Toor dal", "Lauki"], ["Roti", "Chana dal", "Bhindi"], ["Roti", "Urad dal", "Tinda"], ["Roti", "Toor dal", "Karela"]]),
      Lunch: seed("Lunch", [["Sambar"], ["Rasam"]]) } });

  it("a short slot gets new dishes equal to its shortfall, not limited by the week's setting; a slot that is not short gets none of its own", () => {
    for (const budget of [0, 1]) {
      const w = thinDinner(budget);
      const r = feasibility(w, ["Lunch", "Dinner"]);
      expect(w.slots.get("dinner")!.shortNew).toBe(5);
      expect(w.slots.get("dinner")!.short).toBe(true);
      expect(w.slots.get("lunch")!.shortNew).toBe(0);
      expect(w.slots.get("lunch")!.newAllowed).toBe(budget);   // the setting, shared, untouched by Dinner's shortfall
      expect(r.short).toEqual([{ slot: "Dinner", known: 2, supply: 4, places: 14, newDishes: 5 }]);
      expect(r.log[1]).toContain("relaxed: repeat window 2 days, then 5 new dishes of their kind for the shortfall (beside the week's setting), then asked");
    }
  });


  it("the walk keeps a short slot's own new dishes beside the setting; a slot that is not short stays within the setting", () => {
    const w = thinDinner(0);
    feasibility(w, ["Lunch", "Dinner"]);
    const news = ["Methi thepla", "Turai sabzi", "Moong dal", "Gawar sabzi", "Masoor dal"];
    const p = plan(WEEK.map((_, i) => ["Roti", news[i % 5], i % 2 ? "Lauki" : "Toor dal"]));
    walkSlot(w, "Dinner", p, { final: true });
    expect(news.every((n) => daysWith(p, n).length > 0)).toBe(true);
    // Lunch is not short and the setting is 0: a new dish there is replaced by one of theirs.
    const q = plan([["Rava upma"], ["Sambar"], ["Rasam"], ["Kootu"], ["Poriyal"], ["Avial"], ["Thoran"]]);
    walkSlot(w, "Lunch", q, { final: true });
    expect(daysWith(q, "Rava upma")).toEqual([]);
    // Dinner's own new dishes do not use the setting.
    w.newDishes = new Map(news.map((n) => [dishKey(n), { name: n, slot: "Dinner", why: "" }]));
    expect(settingUsed(w)).toBe(0);
    w.newDishes.set("rava upma", { name: "Rava upma", slot: "Lunch", why: "" });
    expect(settingUsed(w)).toBe(1);
  });
});

describe("allergies (owner 25 Nov)", () => {
  const peanut = rule({ who: "Ravi", items: ["peanut"], quote: "Ravi is allergic to peanuts" });
  const lib = [dish("Poha", "Breakfast", { contains: ["peanut"], contains_read: [...READ, "peanut"] }), dish("Upma", "Breakfast", { contains_read: READ }),
    dish("Peanut chikki", "Snack", { contains: ["peanut"], contains_read: [...READ, "peanut"] })];
  const make = (r: Rule) => {
    const w = week({ slots: [slot("Breakfast", { order: 10 }), slot("Snack", { kind: "custom", order: 40, usual_people: ["Asha"] })], library: lib, rules: [r],
      history: { Breakfast: seed("Breakfast", [["Poha"], ["Upma"]]), Snack: seed("Snack", [["Peanut chikki"]]) } });
    for (const d of w.days.filter((x) => x.slot === "Snack")) d.people = ["Asha"];
    w.careful = new Map();
    return w;
  };
  it("a family dish on the plates of a slot the allergic person eats is safe by the family's word, no read; its note keeps his portion aside", () => {
    const w = make(peanut);
    const d = w.days.find((x) => x.slot === "Breakfast")!;
    expect(vouched(w, peanut, "Poha")).toBe(true);
    expect(carefulTags(w, "Poha")).toEqual([]);
    expect(ruleBreaks(w, d, "Poha")).toEqual([]);
    expect(allergyNotes(w, d, "Poha")).toEqual(["Ravi's Poha without peanut"]);
    expect(allergyNotes(w, d, "Upma")).toEqual([]);
  });
  it("a family dish only others eat, a new dish and a variant are read carefully; not read, or read as maybe having it, is not his", () => {
    const w = make(peanut);
    const d = w.days.find((x) => x.slot === "Breakfast")!;
    expect(vouched(w, peanut, "Peanut chikki")).toBe(false);   // on Asha's snack plates only
    expect(carefulTags(w, "Peanut chikki")).toEqual(["peanut"]);
    expect(carefulTags(w, "Sabudana khichdi")).toEqual(["peanut"]);
    expect(ruleBreaks(w, d, "Sabudana khichdi")[0]).toContain("not read carefully for peanut");
    w.careful!.set(dishKey("Sabudana khichdi"), new Set(["peanut"]));
    expect(ruleBreaks(w, d, "Sabudana khichdi")[0]).toContain("may have peanut");
    w.careful!.set(dishKey("Rava idli"), new Set());
    expect(ruleBreaks(w, d, "Rava idli")).toEqual([]);
  });
  it("a house-wide allergy makes every family dish safe; new dishes still read carefully", () => {
    const house = rule({ who: null, items: ["peanut"], quote: "nobody here eats peanuts, an allergy" });
    const w = make(house);
    const d = w.days.find((x) => x.slot === "Breakfast")!;
    expect(ruleBreaks(w, d, "Peanut chikki")).toEqual([]);
    expect(allergyNotes(w, d, "Poha")).toEqual([]);
    expect(carefulTags(w, "Sabudana khichdi")).toEqual(["peanut"]);
  });
});

describe("checkSlot (a saved week against the rules, changes.ts)", () => {
  it("says a person left with nothing of their own, and nothing else", () => {
    const veg = rule({ what: "veg", who: "Asha", quote: "Asha is vegetarian" });
    const w = week({ slots: [slot("Lunch")], library: [dish("Fish curry", "Lunch", { contains: ["fish"] }), dish("Dal", "Lunch")], rules: [veg] });
    const ps = checkSlot(w, "Lunch", plan([["Fish curry"], ["Dal"]]));
    expect(ps.get(WEEK[0])!.map((x) => x.kind)).toEqual(["rule"]);
    expect(ps.get(WEEK[0])![0].text).toStartWith(`Asha has nothing to eat on ${WEEK[0]} Lunch`);
    expect(ps.get(WEEK[1])).toBeUndefined();
  });
});
