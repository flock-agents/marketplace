// Live run 2 (2026-11-24, issue #29): a member's rich past-week answers ended in an empty library and a week of invented,
// repeated dishes. Root cause: the setup never got her replies (the agent called apply_setup with one line of its own), the
// dishes read rightly found none, the setup saved with a quiet note, and make_plan invented 4 dishes a meal for 7 days.
// Here: her exact answers as Flock's transcript reach every reader; what a model answers is saved as her dishes; a setup
// with none of her replies is refused; a meal the planner knows no dish for is asked about, never planned from nothing.
import { describe, it, expect } from "bun:test";
import { boot } from "./testkit";
import { DISHES_ASK } from "./setup";
import type { ModelRequest, ModelResult } from "./model";

// Her household as Flock holds it (household.* facts, sent in full) and her replies word for word. The Q lines are the approved
// question texts (docs/2026-11-26-meal-questions-approved.md, placeholders filled): setup reads by content, never by id.
const HOUSEHOLD = {
  "household.people": [{ name: "Shiva", group: "adult", relation: "self" }, { name: "Ankita", group: "adult", relation: "wife" },
    { name: "Agastya", group: "child", relation: "kid", age: "6" }, { name: "Gowri Shankar", group: "elder", relation: "dad" }],
  "household.help": [{ role: "cook", days: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"], times: ["twice a day"] }],
  "household.weekly": [{ person: "Ankita", where: "office", weekdays: ["Mon", "Tue", "Wed", "Thu", "Fri"], lunch: null },
    { person: "Shiva", where: "office", weekdays: ["Mon", "Tue", "Wed", "Thu", "Fri"], lunch: null },
    { person: "Agastya", where: "school", weekdays: ["Mon", "Tue", "Wed", "Thu", "Fri"], to: "15:00", lunch: null }],
  "household.speaker": "Ankita",
};
const ANSWERS = {
  cookTime: "yes, 1 hour she has",
  otherDays: "Sunday cook doesnt come. So dinner is ordered in. Sometimes, even lunch is ordered in",
  childSame: "breakfast is same as what we have - idli, dosa, poha, upma. Sometimes for his breakfast I make pancakes or sandwiches",
  familyBreakfast: "same as what I described - idli, poha, dosa, rava idli, upma, etc. Pancakes is just for agastya",
  familyLunch: "south indian based items. Rice + dry sabji + sambar/rasam/kerala style coconut sambar/vatha kozhambu. Somtimes we make biryani or pulao instead of full south indian.",
  familyDinner: "Same as what we eat - roti & some north indian sabji",
  childMeals: "he takes paratha & the dry sabji that we make in the house made into a roll, one fruit, 5 almonds",
  differently: "mostly vegetarian with eggs. Egg curry on weekends. Those days we make some dal or thogayal for appa.",
};
const TRANSCRIPT = [
  "Q: Is your cook short of time, so only a few dishes?", `A: ${ANSWERS.cookTime}`,
  "Q: On Sunday, when your cook doesn't come, who cooks, and is any meal eaten out or ordered in?", `A: ${ANSWERS.otherDays}`,
  "Q: Does Agastya eat what the family eats, or something else at some meals? Does Agastya carry a box to school?", `A: ${ANSWERS.childSame}`,
  "Q: What did the family have for breakfast over the past week? Tell me the dishes.", `A: ${ANSWERS.familyBreakfast}`,
  "Q: What did the family have for lunch over the past week? Tell me the dishes.", `A: ${ANSWERS.familyLunch}`,
  "Q: What did the family have for dinner over the past week? Tell me the dishes.", `A: ${ANSWERS.familyDinner}`,
  "Q: What does Agastya have at those meals, and what goes in the box?", `A: ${ANSWERS.childMeals}`,
  "Q: Does anyone eat differently: something they don't eat, an allergy, less spice or salt, a fasting day, or something extra on their plate?", `A: ${ANSWERS.differently}`,
];

// What a model answers for her (the shape the prompts ask for: rows [name, slot, quote]; quotes copied from her lines).
const HOME = { slots: [{ name: "Breakfast", kind: "main" }, { name: "Lunch", kind: "main" },
  { name: "Dinner", kind: "main", skip_days: [{ day: "Sun", skip: "ordered_in" }], quote: "So dinner is ordered in" },
  { name: "Agastya's tiffin", kind: "custom", after: "Breakfast", usual_people: ["Agastya"], days: ["Mon", "Tue", "Wed", "Thu", "Fri"], quote: "he takes paratha & the dry sabji" }] };
const RULES = { rules: [{ hard: true, what: "egg", quote: "mostly vegetarian with eggs" }] };
const row = (name: string, slot: string, quote: string) => [name, slot, quote];
const DISHES = {
  library: [row("Idli", "Breakfast", "idli, dosa, poha, upma"), row("Dosa", "Breakfast", "idli, dosa, poha, upma"), row("Poha", "Breakfast", "idli, dosa, poha, upma"),
    row("Upma", "Breakfast", "idli, dosa, poha, upma"), row("Rava idli", "Breakfast", "rava idli"), row("Pancakes", "Breakfast", "I make pancakes or sandwiches"),
    row("Sandwich", "Breakfast", "I make pancakes or sandwiches"), row("Paratha roll", "Agastya's tiffin", "paratha & the dry sabji that we make in the house made into a roll"),
    row("Rice", "Lunch", "Rice + dry sabji"), row("Dry sabji", "Lunch", "Rice + dry sabji"), row("Sambar", "Lunch", "sambar/rasam"), row("Rasam", "Lunch", "sambar/rasam"),
    row("Kerala coconut sambar", "Lunch", "kerala style coconut sambar"), row("Vatha kozhambu", "Lunch", "vatha kozhambu"), row("Biryani", "Lunch", "biryani or pulao"),
    row("Pulao", "Lunch", "biryani or pulao"), row("Roti", "Dinner", "roti & some north indian sabji"), row("North Indian sabji", "Dinner", "roti & some north indian sabji"),
    row("Egg curry", "Dinner", "Egg curry on weekends")],
  seed: [["Lunch", "Rice, Dry sabji, Sambar", "Rice + dry sabji + sambar/rasam"], ["Dinner", "Roti, North Indian sabji", "roti & some north indian sabji"],
    ["Breakfast", "Idli", "idli, dosa, poha, upma"], ["Agastya's tiffin", "Paratha roll", "made into a roll"]],
};

type Part = "home" | "rules" | "dishes" | "often" | "contains" | "lint" | "plan";
const partOf = (r: ModelRequest): Part => {
  const p = r.purpose ?? "";
  return /contains/.test(p) ? "contains" : /lint/.test(p) ? "lint" : /often/.test(p) ? "often" : /rules/.test(p) ? "rules" : /dishes/.test(p) ? "dishes"
    : /setup/.test(p) ? "home" : "plan";
};
function fake(over: Partial<Record<Part, unknown>> = {}) {
  const answers: Record<Part, unknown> = { home: HOME, rules: RULES, dishes: DISHES, often: { often: [] }, lint: { dishes: [] }, plan: { days: {} },
    contains: (r: ModelRequest) => { const { dishes, tags } = JSON.parse(r.user); return Object.fromEntries(dishes.map((d: string) => [d, Object.fromEntries(tags.map((t: string) => [t, d === "Egg curry" && t === "egg"]))])); },
    ...over };
  const asked: ModelRequest[] = [];
  const model = async (r: ModelRequest): Promise<ModelResult> => {
    asked.push(r);
    const a = answers[partOf(r)];
    const v = typeof a === "function" ? a(r) : a;
    return v && typeof v === "object" && "ok" in v ? v as ModelResult : { ok: true, json: v, model: "fake" };
  };
  return { model, asked, of: (p: Part) => asked.filter((r) => partOf(r) === p) };
}
const NOW = () => new Date(2026, 10, 29, 11, 0);

describe("live run 2, #29: her past week's dishes reach the setup and the plan", () => {
  it("every reader gets her replies word for word; her dishes are saved as her library, her category words on her meals' parts, with Sunday dinner ordered in", async () => {
    const f = fake();
    const k = await boot({ model: f.model, now: NOW });
    const r = await k.op("apply_setup", { household: HOUSEHOLD, transcript: TRANSCRIPT });
    expect(r.ok).toBe(true);
    const d = f.of("dishes")[0];
    const user = JSON.parse(d.user);
    expect(user.household).toEqual(HOUSEHOLD);
    for (const a of Object.values(ANSWERS)) expect(user.transcript).toContain(a);
    expect(user.transcript).toMatch(/^A\d+: /m);
    expect(d.system).toContain("library");
    const lib = k.rows("library").map((x) => `${x.name}@${x.slot}`);
    for (const n of ["Idli@Breakfast", "Rava idli@Breakfast", "Pancakes@Breakfast", "Paratha roll@Agastya's tiffin", "Vatha kozhambu@Lunch",
      "Kerala coconut sambar@Lunch", "Roti@Dinner", "North Indian sabji@Dinner"]) expect(lib).toContain(n);
    // A bare "dosa" is her Plain dosa (§5.1); "biryani" is a category word: on Lunch's parts in her words, never a library row (§5.3).
    expect(lib).toContain("Plain dosa@Breakfast");
    expect(lib).not.toContain("Biryani@Lunch");
    expect(r.asks).not.toContain(DISHES_ASK);
    const fam = (await k.owner("GET", "/api/family")).body;
    expect(fam.slots.find((s: any) => s.name === "Dinner").skip_days).toEqual([{ day: "Sun", skip: "ordered_in" }]);
    expect(fam.slots.map((s: any) => s.name)).toContain("Agastya's tiffin");
    expect(fam.slots.find((s: any) => s.name === "Lunch").templates.flatMap((t: any) => t.parts)).toContainEqual({ kind: "Biryani", words: "biryani" });
  });

  it("the agent's own one-line summary (what the live run sent) is refused before any model call", async () => {
    const f = fake();
    const k = await boot({ model: f.model, now: NOW });
    const r = await k.op("apply_setup", { transcript: "Ankita is the only person eating at home.", household: { people: [{ name: "Ankita", group: "adult", relationship: "self" }] } });
    expect(r.ok).not.toBe(true);
    expect(JSON.stringify(r)).toContain("no family replies");
    expect(f.asked).toHaveLength(0);
  });

  it("dishes not read: the setup asks for them, and make_plan asks too instead of planning from an empty library", async () => {
    const f = fake({ dishes: { ok: false, code: "invalid_output", message: "no dishes in the answer" } });
    const k = await boot({ model: f.model, now: NOW });
    const s = await k.op("apply_setup", { household: HOUSEHOLD, transcript: TRANSCRIPT });
    expect(s.ok).toBe(true);
    expect(s.asks).toContain(DISHES_ASK);
    expect(s.said).toContain(DISHES_ASK);
    const p = await k.op("make_plan", { week_start: "2026-11-30" });
    expect(p).toMatchObject({ ok: false, reason: "no_dishes" });
    expect(p.say).toContain("breakfast, Agastya's tiffin, lunch and dinner");
    expect(f.of("plan").filter((r) => /meal plan: the week/.test(r.purpose ?? ""))).toHaveLength(0);
    expect(k.rows("slot_days").filter((x) => x.date)).toHaveLength(0);
  });

  it("\"suggest some\": every meal is planned with new dishes where none of theirs is known, by code, with no budget", async () => {
    const f = fake({ dishes: { ok: false, code: "invalid_output", message: "no dishes in the answer" } });
    const k = await boot({ model: f.model, now: NOW });
    await k.op("apply_setup", { household: HOUSEHOLD, transcript: TRANSCRIPT });
    const p = await k.op("make_plan", { week_start: "2026-11-30", suggest_new: true });
    // The week is filled by code (kinds model): no model call plans a meal; every meal cooked at home has new dishes.
    expect(f.of("plan").filter((r) => /meal plan: the week/.test(r.purpose ?? ""))).toHaveLength(0);
    expect(p.ok).toBe(true);
    const days = k.rows("slot_days").filter((x) => x.date && !x.skip);
    expect(days.length).toBeGreaterThan(0);
    const dishes = k.rows("slot_dishes");
    for (const d of days) expect(dishes.filter((x) => x.slot_day_id === d.id).length).toBeGreaterThan(0);
    expect(dishes.filter((x) => x.new === 1).length).toBeGreaterThan(dishes.length / 2);
  });

});
