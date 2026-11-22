// The week planned in steps (makePlan.ts) with a fake model: the menu from one call, checked in code, only the failing meals
// sent back, code's own swap when the model never fixes them, and each day's ingredients.
import { describe, it, expect } from "bun:test";
import { boot } from "./testkit";
import { MENU_ROUNDS } from "./makePlan";
import type { ModelRequest, ModelResult } from "./model";
import { weeklyPlan, DELIVER_PROMPT } from "./routines/weekly-plan";

const MON = "2026-11-23";
const SUN = new Date(2026, 10, 22, 11, 0);   // the day before the week
const DISHES: Record<string, string[]> = { Breakfast: ["Poha", "Upma", "Idli"], Lunch: ["Rajma", "Chole", "Kadhi"], Dinner: ["Palak paneer", "Aloo gobi", "Bhindi masala"] };

type Asked = { req: ModelRequest; user: any };
/** A fake model: `menu` answers each balanced call (the first menu, then each fix), `day` each fast call (a day's ingredients). */
function fakeModel(h: { menu?: (u: any, round: number) => ModelResult | unknown; day?: (u: any, n: number) => ModelResult | unknown } = {}) {
  const asked: Asked[] = [];
  let rounds = 0;
  const perDay = new Map<string, number>();
  const model = async (req: ModelRequest): Promise<ModelResult> => {
    const user = JSON.parse(req.user);
    asked.push({ req, user });
    const wrap = (v: unknown): ModelResult => (v && typeof v === "object" && "ok" in (v as object) ? v as ModelResult : { ok: true, json: v, model: "fake" });
    if (req.tier === "balanced") return wrap((h.menu ?? rotate)(user, ++rounds));
    const n = (perDay.get(user.date) ?? 0) + 1;
    perDay.set(user.date, n);
    return wrap((h.day ?? ingredients)(user, n));
  };
  return { model, asked, menus: () => asked.filter((a) => a.req.tier === "balanced"), days: () => asked.filter((a) => a.req.tier === "fast") };
}

/** A good first menu: each meal's dishes in turn, so each comes back on two days at most. A fix round answers its `fix`. */
function rotate(u: any): unknown {
  const meals = u.meals ?? u.fix;
  const seen = new Map<string, number>();
  return { meals: meals.map((m: any) => {
    const list = u.fix ? (m.family_dishes.length ? m.family_dishes : DISHES[m.slot]) : DISHES[m.slot] ?? ["Sandwich", "Paratha roll", "Fruit"];
    const i = seen.get(m.slot) ?? 0; seen.set(m.slot, i + 1);
    return { date: m.date, slot: m.slot, dishes: [{ name: list[i % list.length], for: ["everyone"] }] };
  }) };
}
/** Every dish of the day gets one ingredient. */
const ingredients = (u: any) => ({ dishes: u.dishes.map((d: any) => ({ slot: d.slot, name: d.name, ingredients: [{ item: d.name.toLowerCase(), amount: 200, unit: "g" }] })) });

async function family(model: (req: ModelRequest) => Promise<ModelResult>, opts: { dishes?: Record<string, string[]> } = {}) {
  const k = await boot({ model, now: () => SUN });
  for (const [name, group] of [["Asha", "adult"], ["Ravi", "adult"], ["Agastya", "child"]]) await k.op("set_person", { name, group });
  const dishes = opts.dishes ?? DISHES;
  await k.op("set_family_dishes", { dishes: Object.entries(dishes).flatMap(([slot, names]) => names.map((name) => ({ name, slots: [slot] }))) });
  const week = async () => (await k.owner("GET", `/api/weeks/${MON}`)).body;
  const meal = async (date: string, slot: string) => (await week()).days.find((d: any) => d.date === date).meals.find((m: any) => m.slot === slot);
  return { ...k, week, meal };
}
const daysOn = (week: any, dish: string) => week.days.filter((d: any) => d.meals.some((m: any) => m.dishes.some((x: any) => x.name === dish))).length;
const allMeals = (week: any) => week.days.flatMap((d: any) => d.meals);

describe("make_plan: the week in steps", () => {
  it("a menu that passes the first time: one menu call, one call a day for ingredients, the week saved final with the closing call's message and intro", async () => {
    const f = fakeModel();
    const k = await family(f.model);
    const r = await k.op("make_plan", { week_start: MON });
    expect(r.ok).toBe(true);
    expect(f.menus()).toHaveLength(1);
    expect(f.menus()[0].req.schema).toBeDefined();
    expect(f.menus()[0].user.meals).toHaveLength(18);   // Mon to Sat, three meals
    expect(f.days()).toHaveLength(6);
    expect(f.days().every((d) => d.req.tier === "fast")).toBe(true);
    const week = await k.week();
    expect(week.status).toBe("final");
    expect(allMeals(week)).toHaveLength(18);
    for (const m of allMeals(week)) { expect(m.dishes.length).toBeGreaterThan(0); for (const d of m.dishes) expect(d.ingredients.length).toBeGreaterThan(0); }
    expect(r.message).toContain("Next week is planned.");
    expect(r.message).toContain("Monday: Poha");
    expect(r.intro).toContain("How it works");
    expect(r.unmet).toBeUndefined();
    // The intro is the first plan's only.
    expect((await k.op("make_plan", { week_start: MON })).intro).toBeUndefined();
  });

  it("a menu that repeats a dish is sent back with only the meals that fail, and the reason; the rest stays as it was", async () => {
    const f = fakeModel({ menu: (u, round) => {
      if (round > 1) return { meals: u.fix.map((m: any, i: number) => ({ date: m.date, slot: m.slot, dishes: [{ name: ["Upma", "Upma", "Idli", "Idli"][i], for: ["everyone"] }] })) };
      const r = rotate(u) as any;
      for (const m of r.meals) if (m.slot === "Breakfast") m.dishes = [{ name: "Poha", for: ["everyone"] }];
      return r;
    } });
    const k = await family(f.model);
    const r = await k.op("make_plan", { week_start: MON });
    expect(r.ok).toBe(true);
    expect(f.menus()).toHaveLength(2);
    const fix = f.menus()[1].user.fix;
    expect(fix.map((m: any) => `${m.day} ${m.slot}`)).toEqual(["Wed Breakfast", "Thu Breakfast", "Fri Breakfast", "Sat Breakfast"]);
    expect(fix[0].wrong[0]).toContain("Poha is already on Mon and Tue");
    expect(f.menus()[1].user.rest_of_week.some((m: any) => m.slot === "Breakfast" && m.date === MON)).toBe(true);
    const week = await k.week();
    expect((await k.meal(MON, "Breakfast")).dishes[0].name).toBe("Poha");
    expect((await k.meal("2026-11-24", "Breakfast")).dishes[0].name).toBe("Poha");
    for (const d of ["Poha", "Upma", "Idli"]) expect(daysOn(week, d)).toBeLessThanOrEqual(2);
  });

  it(`a model that never fixes the repeat: ${MENU_ROUNDS} rounds, then code swaps each failing meal for an unused family dish that passes`, async () => {
    const f = fakeModel({ menu: (u) => {
      const r = rotate(u) as any;
      for (const m of r.meals) if (m.slot === "Breakfast") m.dishes = [{ name: "Poha", for: ["everyone"] }];
      return r;
    } });
    const k = await family(f.model, { dishes: { ...DISHES, Breakfast: ["Poha", "Upma", "Idli", "Dosa"] } });
    const r = await k.op("make_plan", { week_start: MON });
    expect(r.ok).toBe(true);
    expect(f.menus()).toHaveLength(MENU_ROUNDS);
    const week = await k.week();
    for (const d of ["Poha", "Upma", "Idli", "Dosa"]) expect(daysOn(week, d)).toBeLessThanOrEqual(2);
    expect(r.unmet).toBeUndefined();
  });

  it("rules that cannot all be kept (2 breakfast dishes, a dish on 2 days at most, 6 days): the least-used dish comes back, said in unmet and the message, never an empty meal", async () => {
    const f = fakeModel({ menu: (u) => {
      const r = rotate(u) as any;
      for (const m of r.meals) if (m.slot === "Breakfast") m.dishes = [];
      return r;
    } });
    const k = await family(f.model, { dishes: { ...DISHES, Breakfast: ["Poha", "Upma"] } });
    const r = await k.op("make_plan", { week_start: MON });
    expect(r.ok).toBe(true);
    const week = await k.week();
    for (const m of allMeals(week)) expect(m.dishes.length).toBeGreaterThan(0);
    expect(daysOn(week, "Poha") + daysOn(week, "Upma")).toBe(6);
    expect(Math.abs(daysOn(week, "Poha") - daysOn(week, "Upma"))).toBeLessThanOrEqual(1);
    expect(r.unmet.length).toBe(2);
    expect(r.unmet.sort()).toEqual(["Poha repeats on 3 days (Mon, Wed, Fri): only 2 breakfast dishes known", "Upma repeats on 3 days (Tue, Thu, Sat): only 2 breakfast dishes known"]);
    expect(r.message).toContain("I couldn't keep everything this week:");
    // Deterministic: the same family and model, the same week.
    const f2 = fakeModel({ menu: (u) => { const x = rotate(u) as any; for (const m of x.meals) if (m.slot === "Breakfast") m.dishes = []; return x; } });
    const k2 = await family(f2.model, { dishes: { ...DISHES, Breakfast: ["Poha", "Upma"] } });
    const r2 = await k2.op("make_plan", { week_start: MON });
    expect(r2.unmet).toEqual(r.unmet);
  });

  it("an extra slot left out of the menu (a child's tiffin) is refused for its days: the fix round names each tiffin meal with no dish", async () => {
    const f = fakeModel({ menu: (u, round) => {
      const r = rotate(u) as any;
      if (round === 1) r.meals = r.meals.filter((m: any) => m.slot !== "Agastya's tiffin");
      return r;
    } });
    const k = await family(f.model);
    await k.op("set_slots", { extra_slots: [{ name: "Agastya's tiffin", days: ["Mon", "Tue", "Wed", "Thu", "Fri"], for: ["Agastya"] }] });
    await k.op("set_family_dishes", { dishes: [{ name: "Veg sandwich", slots: ["Agastya's tiffin"] }, { name: "Paneer roll", slots: ["Agastya's tiffin"] }, { name: "Vegetable poha", slots: ["Agastya's tiffin"] }] });
    const r = await k.op("make_plan", { week_start: MON });
    expect(r.ok).toBe(true);
    expect(f.menus()[0].user.meals.filter((m: any) => m.slot === "Agastya's tiffin").map((m: any) => m.day)).toEqual(["Mon", "Tue", "Wed", "Thu", "Fri"]);
    const fix = f.menus()[1].user.fix;
    expect(fix.map((m: any) => `${m.day} ${m.slot}`)).toEqual(["Mon Agastya's tiffin", "Tue Agastya's tiffin", "Wed Agastya's tiffin", "Thu Agastya's tiffin", "Fri Agastya's tiffin"]);
    expect(fix[0].wrong).toEqual(["no dish: every meal needs at least one dish"]);
    expect(fix[0].who).toEqual(["Agastya"]);
    expect((await k.meal("2026-11-27", "Agastya's tiffin")).dishes[0].for_people).toEqual(["everyone"]);
    expect(await k.meal("2026-11-28", "Agastya's tiffin")).toBeUndefined();
  });

  it("a meal the family orders in every week is ordered in, and not asked of the model", async () => {
    const f = fakeModel();
    const k = await family(f.model);
    await k.op("set_cooking_days", { days: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] });
    await k.op("set_slots", { order_in: [{ day: "Sun", slot: "Dinner", note: "pizza night" }] });
    const r = await k.op("make_plan", { week_start: MON });
    expect(r.ok).toBe(true);
    expect(f.menus()[0].user.meals.some((m: any) => m.day === "Sun" && m.slot === "Dinner")).toBe(false);
    expect(await k.meal("2026-11-29", "Dinner")).toMatchObject({ ordered_in: true, note: "pizza night", dishes: [] });
  });

  it("out of credits: stops at once with a plain line to say, nothing saved, the model not asked again", async () => {
    const f = fakeModel({ menu: () => ({ ok: false, code: "out_of_credits", message: "no credits" }) });
    const k = await family(f.model);
    const r = await k.op("make_plan", { week_start: MON });
    expect(r).toEqual({ ok: false, reason: "out_of_credits", say: expect.stringContaining("credits have run out") });
    expect(f.asked).toHaveLength(1);
    expect((await k.week()).status).toBeNull();
  });

  it("a stop while the ingredients are asked stops too: daily_budget, nothing saved", async () => {
    const f = fakeModel({ day: () => ({ ok: false, code: "daily_budget", message: "spent" }) });
    const k = await family(f.model);
    const r = await k.op("make_plan", { week_start: MON });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("daily_budget");
    expect(f.days()).toHaveLength(1);
    expect((await k.week()).status).toBeNull();
  });

  it("a bad answer for the menu uses up a round and is asked again; rate_limited never is", async () => {
    const f = fakeModel({ menu: (u, round) => (round === 1 ? { ok: false, code: "invalid_output", message: "not JSON" } : rotate(u)) });
    const k = await family(f.model);
    expect((await k.op("make_plan", { week_start: MON })).ok).toBe(true);
    expect(f.menus()).toHaveLength(2);
    expect(f.menus()[1].user.meals).toHaveLength(18);   // still the first menu: nothing came back to fix
    const g = fakeModel({ menu: () => ({ ok: false, code: "rate_limited", message: "slow down" }) });
    const k2 = await family(g.model);
    expect((await k2.op("make_plan", { week_start: MON })).reason).toBe("rate_limited");
    expect(g.asked).toHaveLength(1);
  });

  it("a day's ingredients are asked once more on their own when the call fails or leaves a dish out", async () => {
    const f = fakeModel({ day: (u, n) => {
      if (u.date === MON && n === 1) return { ok: false, code: "timeout", message: "slow" };
      if (u.date === "2026-11-24" && n === 1) return { dishes: ingredients(u).dishes.slice(1) };   // breakfast left out
      return ingredients(u);
    } });
    const k = await family(f.model);
    const r = await k.op("make_plan", { week_start: MON });
    expect(r.ok).toBe(true);
    const calls = (date: string) => f.days().filter((d) => d.user.date === date);
    expect(calls(MON)).toHaveLength(2);
    expect(calls("2026-11-24")).toHaveLength(2);
    expect(calls("2026-11-24")[1].user.dishes.map((d: any) => d.slot)).toEqual(["Breakfast"]);   // only what was missing
    expect(calls("2026-11-25")).toHaveLength(1);
    for (const m of allMeals(await k.week())) for (const d of m.dishes) expect(d.ingredients.length).toBeGreaterThan(0);
    expect(r.no_ingredients).toBeUndefined();
  });

  it("a day whose ingredients fail twice is saved without them and named, never tried a third time", async () => {
    const f = fakeModel({ day: (u) => (u.date === MON ? { ok: false, code: "unavailable", message: "down" } : ingredients(u)) });
    const k = await family(f.model);
    const r = await k.op("make_plan", { week_start: MON });
    expect(r.ok).toBe(true);
    expect(f.days().filter((d) => d.user.date === MON)).toHaveLength(2);
    expect(r.no_ingredients).toEqual(["Mon Breakfast: Poha", "Mon Lunch: Rajma", "Mon Dinner: Palak paneer"]);
  });

  it("each dish's `for` is checked in code: an unknown name is sent back, and `except` keeps everyone else", async () => {
    const f = fakeModel({ menu: (u, round) => {
      const r = rotate(u) as any;
      if (round === 1) {
        r.meals[0].dishes = [{ name: "Plain idli", for: ["Agasthya"] }, { name: "Poha", for: ["everyone"], except: ["Agastya"] }];
      } else for (const m of r.meals) m.dishes = [{ name: "Plain idli", for: ["Agastya"] }, { name: "Poha", for: ["everyone"], except: ["Agastya"] }];
      return r;
    } });
    const k = await family(f.model);
    const r = await k.op("make_plan", { week_start: MON });
    expect(r.ok).toBe(true);
    const fix = f.menus()[1].user.fix;
    expect(fix.map((m: any) => `${m.day} ${m.slot}`)).toEqual(["Mon Breakfast"]);
    expect(fix[0].wrong[0]).toContain('"Agasthya" is not on the Family page (did you mean Agastya?)');
    const mon = await k.meal(MON, "Breakfast");
    expect(mon.dishes.map((d: any) => [d.name, d.for_people])).toEqual([["Plain idli", ["Agastya"]], ["Poha", ["Asha", "Ravi"]]]);
  });

  it("make_plan needs a Monday, and a family", async () => {
    const f = fakeModel();
    const k = await boot({ model: f.model, now: () => SUN });
    expect((await k.op("make_plan", { week_start: "2026-11-24" })).error).toContain("must be a Monday");
    expect((await k.op("make_plan", {})).error).toContain("make_plan needs week_start");
    expect(await k.op("make_plan", { week_start: MON })).toMatchObject({ ok: false, reason: "no_family" });
    expect(f.asked).toHaveLength(0);
  });
});

describe("the Sunday run", () => {
  /** A routine context on the app that records each wake. */
  const ctxOf = (k: Awaited<ReturnType<typeof family>>, wakes: { message: string; data: any }[]) => ({
    kit: { db: k.kit.db, sqlite: k.kit.sqlite, emitChange: k.kit.emitChange }, routine: { trigger: null },
    wakeAgent: async (message: string, data?: unknown) => { wakes.push({ message, data }); return { ok: true }; },
  });

  it("plans the week in code and wakes the agent only to deliver the message and intro, word for word", async () => {
    const f = fakeModel();
    const k = await family(f.model);
    const wakes: { message: string; data: any }[] = [];
    await weeklyPlan(ctxOf(k, wakes), SUN, f.model);
    expect(wakes).toHaveLength(1);
    expect(wakes[0].message).toBe(DELIVER_PROMPT(true));
    expect(wakes[0].message).toContain("Send this message to the family word for word");
    for (const planning of ["plan_menu", "plan_week", "make_plan", "family_dishes", "ingredients"]) expect(wakes[0].message).not.toContain(planning);
    expect(Object.keys(wakes[0].data).sort()).toEqual(["intro", "message", "week_start"]);
    expect(wakes[0].data.message).toContain("Next week is planned.");
    expect((await k.week()).status).toBe("final");
  });

  it("out of credits: the agent is woken only to say so, plainly; no week is planned", async () => {
    const f = fakeModel({ menu: () => ({ ok: false, code: "out_of_credits", message: "none" }) });
    const k = await family(f.model);
    const wakes: { message: string; data: any }[] = [];
    await weeklyPlan(ctxOf(k, wakes), SUN, f.model);
    expect(wakes).toHaveLength(1);
    expect(wakes[0].message).toBe(DELIVER_PROMPT(false));
    expect(wakes[0].data.message).toContain("credits have run out");
    expect((await k.week()).status).toBeNull();
  });

  it("the platform's model call is used when none is handed in (ctx.platform.model.json)", async () => {
    const f = fakeModel();
    const k = await family(f.model);
    const wakes: { message: string; data: any }[] = [];
    await weeklyPlan({ ...ctxOf(k, wakes), platform: { model: { json: f.model } } }, SUN);
    expect(f.menus()).toHaveLength(1);
    expect(wakes[0].message).toBe(DELIVER_PROMPT(true));
  });
});
