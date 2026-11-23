// The week planned in steps (makePlan.ts) with a fake model: the menu from one call per meal of the day, all at once, checked
// in code, only the failing meals sent back, code's own swap when the model never fixes them, and each day's ingredients.
import { describe, it, expect } from "bun:test";
import { boot } from "./testkit";
import { makePlan, MENU_ROUNDS, OP_BUDGET_MS } from "./makePlan";
import type { ModelRequest, ModelResult } from "./model";
import { weeklyPlan, DELIVER_PROMPT } from "./routines/weekly-plan";

const MON = "2026-11-23";
const SUN = new Date(2026, 10, 22, 11, 0);   // the day before the week
const DISHES: Record<string, string[]> = { Breakfast: ["Poha", "Upma", "Idli"], Lunch: ["Rajma", "Chole", "Kadhi"], Dinner: ["Palak paneer", "Aloo gobi", "Bhindi masala"] };
const EXTRA = ["Sandwich", "Paratha roll", "Fruit"];
const quiet = () => {};

type Asked = { req: ModelRequest; user: any };
/** A fake model: `menu` answers each balanced call with `n`, how many times that meal of the day was asked (1: its first menu,
 *  then each fix); `day` each fast call (a day's ingredients). `wait`: how long a balanced call takes, by its slot. */
function fakeModel(h: { menu?: (u: any, n: number) => ModelResult | unknown; day?: (u: any, n: number) => ModelResult | unknown; wait?: (u: any, n: number) => number } = {}) {
  const asked: Asked[] = [];
  const perSlot = new Map<string, number>(), perDay = new Map<string, number>();
  let running = 0, most = 0;
  const model = async (req: ModelRequest): Promise<ModelResult> => {
    const user = JSON.parse(req.user);
    asked.push({ req, user });
    const wrap = (v: unknown): ModelResult => (v && typeof v === "object" && "ok" in (v as object) ? v as ModelResult : { ok: true, json: v, model: "fake" });
    if (req.tier === "balanced") {
      const n = (perSlot.get(user.slot) ?? 0) + 1;
      perSlot.set(user.slot, n);
      running++; most = Math.max(most, running);
      try {
        const ms = h.wait?.(user, n) ?? 0;
        if (ms) await Bun.sleep(ms);
        return wrap((h.menu ?? rotate)(user, n));
      } finally { running--; }
    }
    const n = (perDay.get(user.date) ?? 0) + 1;
    perDay.set(user.date, n);
    return wrap((h.day ?? ingredients)(user, n));
  };
  const menus = () => asked.filter((a) => a.req.tier === "balanced");
  return { model, asked, menus, firsts: () => menus().filter((a) => a.user.meals), fixes: () => menus().filter((a) => a.user.fix),
    days: () => asked.filter((a) => a.req.tier === "fast"), most: () => most };
}

/** A good first menu: each meal's dishes in turn, so each comes back on two days at most. A fix round answers its `fix`. */
function rotate(u: any): unknown {
  const meals = u.meals ?? u.fix;
  const seen = new Map<string, number>();
  return { meals: meals.map((m: any) => {
    const list = u.fix ? (m.family_dishes.length ? m.family_dishes : DISHES[m.slot] ?? EXTRA) : DISHES[m.slot] ?? EXTRA;
    const i = seen.get(m.slot) ?? 0; seen.set(m.slot, i + 1);
    return { date: m.date, slot: m.slot, dishes: [{ name: list[i % list.length], for: ["everyone"] }] };
  }) };
}
/** Every dish of the day gets one ingredient. */
const ingredients = (u: any) => ({ dishes: u.dishes.map((d: any) => ({ slot: d.slot, name: d.name, ingredients: [{ item: d.name.toLowerCase(), amount: 200, unit: "g" }] })) });

async function family(model: (req: ModelRequest) => Promise<ModelResult>, opts: { dishes?: Record<string, string[]>; people?: [string, string][]; sunday?: boolean } = {}) {
  const k = await boot({ model, now: () => SUN });
  for (const [name, group] of opts.people ?? [["Asha", "adult"], ["Ravi", "adult"], ["Agastya", "child"]]) await k.op("set_person", { name, group });
  const dishes = opts.dishes ?? DISHES;
  await k.op("set_family_dishes", { dishes: Object.entries(dishes).flatMap(([slot, names]) => names.map((name) => ({ name, slots: [slot] }))) });
  // Every day is planned; this family says nothing is cooked at home on Sunday, so the week's arithmetic is Mon to Sat (three
  // dishes a meal, each on two days at most). `sunday: true`: Sunday is cooked too.
  if (!opts.sunday) await k.op("set_cooking_days", { days: ["mon", "tue", "wed", "thu", "fri", "sat"] });
  const week = async () => (await k.owner("GET", `/api/weeks/${MON}`)).body;
  const meal = async (date: string, slot: string) => (await week()).days.find((d: any) => d.date === date).meals.find((m: any) => m.slot === slot);
  /** makePlan called straight, with its log kept. */
  const plan = (o: { model?: (req: ModelRequest) => Promise<ModelResult>; budgetMs?: number; log?: (l: string) => void } = {}) =>
    makePlan({ db: k.kit.db, emit: k.kit.emitChange, model: o.model ?? model, weekStart: MON, today: "2026-11-22", basePath: "/a/t", budgetMs: o.budgetMs, log: o.log ?? quiet });
  return { ...k, week, meal, plan };
}
const daysOn = (week: any, dish: string) => week.days.filter((d: any) => d.meals.some((m: any) => m.dishes.some((x: any) => x.name === dish))).length;
/** The meals cooked at home (Sunday, not cooked at home in `family`, is ordered in). */
const allMeals = (week: any) => week.days.flatMap((d: any) => d.meals).filter((m: any) => !m.ordered_in);
const names = (m: any) => m.dishes.map((d: any) => [d.name, d.for_people]);

describe("make_plan: the week in steps", () => {
  it("a menu that passes the first time: one menu call per meal of the day, one call a day for ingredients, the week saved final with the closing call's message and intro", async () => {
    const f = fakeModel();
    const k = await family(f.model);
    const r = await k.op("make_plan", { week_start: MON });
    expect(r.ok).toBe(true);
    expect(f.menus().map((a) => a.user.slot)).toEqual(["Breakfast", "Lunch", "Dinner"]);
    expect(f.menus()[0].req.schema).toBeDefined();
    for (const a of f.menus()) {
      expect(a.user.meals).toHaveLength(6);   // Mon to Sat
      expect(a.user.meals.every((m: any) => m.slot === a.user.slot)).toBe(true);
      expect(a.user.family_dishes.map((d: any) => d.dish).sort()).toEqual([...DISHES[a.user.slot]].sort());
    }
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
    expect(f.menus()).toHaveLength(4);
    expect(f.fixes()).toHaveLength(1);
    expect(f.fixes()[0].user.slot).toBe("Breakfast");
    const fix = f.fixes()[0].user.fix;
    expect(fix.map((m: any) => `${m.day} ${m.slot}`)).toEqual(["Wed Breakfast", "Thu Breakfast", "Fri Breakfast", "Sat Breakfast"]);
    expect(fix[0].wrong[0]).toContain("Poha is already on Mon and Tue");
    expect(f.fixes()[0].user.rest_of_week.some((m: any) => m.slot === "Breakfast" && m.date === MON)).toBe(true);
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
    expect(f.menus()).toHaveLength(3 + MENU_ROUNDS - 1);   // the three first menus, then breakfast alone each round
    expect(f.fixes().every((a) => a.user.slot === "Breakfast")).toBe(true);
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
    const tiffin = f.firsts().find((a) => a.user.slot === "Agastya's tiffin")!;
    expect(tiffin.user.meals.map((m: any) => m.day)).toEqual(["Mon", "Tue", "Wed", "Thu", "Fri"]);
    expect(tiffin.req.maxTokens!).toBeLessThan(f.firsts()[0].req.maxTokens!);   // 5 meals asked, not 6
    expect(f.fixes()).toHaveLength(1);
    const fix = f.fixes()[0].user.fix;
    expect(fix.map((m: any) => `${m.day} ${m.slot}`)).toEqual(["Mon Agastya's tiffin", "Tue Agastya's tiffin", "Wed Agastya's tiffin", "Thu Agastya's tiffin", "Fri Agastya's tiffin"]);
    expect(fix[0].wrong).toEqual(["no dish: every meal needs at least one dish"]);
    expect(fix[0].who).toEqual(["Agastya"]);
    expect((await k.meal("2026-11-27", "Agastya's tiffin")).dishes[0].for_people).toEqual(["Agastya"]); // the slot's eaters, not the whole family
    expect(await k.meal("2026-11-28", "Agastya's tiffin")).toBeUndefined();
  });

  it("a meal the family orders in every week is ordered in, and not asked of the model", async () => {
    const f = fakeModel();
    const k = await family(f.model);
    await k.op("set_cooking_days", { days: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] });
    await k.op("set_slots", { order_in: [{ day: "Sun", slot: "Dinner", note: "pizza night" }] });
    const r = await k.op("make_plan", { week_start: MON });
    expect(r.ok).toBe(true);
    expect(f.menus().some((a) => (a.user.meals ?? a.user.fix).some((m: any) => m.day === "Sun" && m.slot === "Dinner"))).toBe(false);
    expect(await k.meal("2026-11-29", "Dinner")).toMatchObject({ ordered_in: true, note: "pizza night", dishes: [] });
  });

  it("out of credits: stops at once with a plain line to say, nothing saved, the model not asked again", async () => {
    const f = fakeModel({ menu: () => ({ ok: false, code: "out_of_credits", message: "no credits" }) });
    const k = await family(f.model);
    const r = await k.op("make_plan", { week_start: MON });
    expect(r).toEqual({ ok: false, reason: "out_of_credits", say: expect.stringContaining("credits have run out") });
    expect(f.asked).toHaveLength(3);   // the first round's calls, all at once; none after
    expect((await k.week()).status).toBeNull();
  });

  it("a stop while the ingredients are asked stops too: daily_budget, nothing saved", async () => {
    const f = fakeModel({ day: () => ({ ok: false, code: "daily_budget", message: "spent" }) });
    const k = await family(f.model);
    const r = await k.op("make_plan", { week_start: MON });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("daily_budget");
    expect(f.days()).toHaveLength(6);   // every day is asked at once; none is asked a second time
    expect((await k.week()).status).toBeNull();
  });

  it("a bad answer for the menu uses up a round and is asked again; rate_limited never is", async () => {
    const f = fakeModel({ menu: (u, round) => (round === 1 ? { ok: false, code: "invalid_output", message: "not JSON" } : rotate(u)) });
    const k = await family(f.model);
    expect((await k.op("make_plan", { week_start: MON })).ok).toBe(true);
    expect(f.menus()).toHaveLength(6);
    expect(f.menus().slice(3).every((a) => a.user.meals?.length === 6)).toBe(true);   // still the first menus: nothing came back to fix
    const g = fakeModel({ menu: () => ({ ok: false, code: "rate_limited", message: "slow down" }) });
    const k2 = await family(g.model);
    expect((await k2.op("make_plan", { week_start: MON })).reason).toBe("rate_limited");
    expect(g.asked).toHaveLength(3);
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
      if (u.slot !== "Breakfast") return r;
      if (round === 1) {
        r.meals[0].dishes = [{ name: "Plain idli", for: ["Agasthya"] }, { name: "Poha", for: ["everyone"], except: ["Agastya"] }];
      } else for (const m of r.meals) m.dishes = [{ name: "Plain idli", for: ["Agastya"] }, { name: "Poha", for: ["everyone"], except: ["Agastya"] }];
      return r;
    } });
    const k = await family(f.model);
    const r = await k.op("make_plan", { week_start: MON });
    expect(r.ok).toBe(true);
    expect(f.fixes()).toHaveLength(1);
    const fix = f.fixes()[0].user.fix;
    expect(fix.map((m: any) => `${m.day} ${m.slot}`)).toEqual(["Mon Breakfast"]);
    expect(fix[0].wrong[0]).toContain('"Agasthya" is not on the Family page (did you mean Agastya?)');
    const mon = await k.meal(MON, "Breakfast");
    expect(mon.dishes.map((d: any) => [d.name, d.for_people])).toEqual([["Plain idli", ["Agastya"]], ["Poha", ["Asha", "Ravi"]]]);
  });

  it("the model never answering (down every round) plans no week: the last failure's plain line, nothing saved", async () => {
    const f = fakeModel({ menu: () => ({ ok: false, code: "unavailable", message: "down" }) });
    const k = await family(f.model);
    const r = await k.op("make_plan", { week_start: MON });
    expect(r).toMatchObject({ ok: false, reason: "unavailable" });
    expect(f.menus()).toHaveLength(3 * MENU_ROUNDS);
    expect(f.fixes()).toHaveLength(0);
    expect(f.days()).toHaveLength(0);
    expect((await k.week()).status).toBeNull();
  });

  it("bad_request is a bug, never asked again", async () => {
    const f = fakeModel({ menu: () => ({ ok: false, code: "bad_request", message: "schema" }) });
    const k = await family(f.model);
    expect(await k.op("make_plan", { week_start: MON })).toMatchObject({ ok: false, reason: "bad_request" });
    expect(f.asked).toHaveLength(3);
  });

  it("inside Flock's 6 minutes: no menu round starts once the time left is the ingredients', code fixes the rest, and late days go without ingredients", async () => {
    let t = 0;
    // Each menu call takes 110 s: the first round (three at once, on this clock one after the other) leaves no time for another.
    const f = fakeModel({ menu: (u) => { t += 110_000; const r = rotate(u) as any; for (const m of r.meals) if (m.slot === "Breakfast") m.dishes = [{ name: "Poha", for: ["everyone"] }]; return r; } });
    const k = await family(f.model);
    const r = await makePlan({ db: k.kit.db, emit: k.kit.emitChange, model: f.model, weekStart: MON, today: "2026-11-22", basePath: "/a/t", budgetMs: OP_BUDGET_MS, clock: () => t });
    expect(r.ok).toBe(true);
    expect(f.menus()).toHaveLength(3);
    expect(f.days()).toHaveLength(0);
    const week = await k.week();
    for (const d of ["Poha", "Upma", "Idli"]) expect(daysOn(week, d)).toBeLessThanOrEqual(2);
    expect((r as any).no_ingredients).toHaveLength(18);
  });

  it("a fasting person given breakfast on their fast day is refused, and the fix round says why", async () => {
    const f = fakeModel();
    const k = await family(f.model);
    await k.op("set_house_rules", { add: true, rules: [{ kind: "fasting", who: "Ravi", days: ["Thu"], slots: ["Breakfast", "Lunch"], note: "fast till evening" }] });
    await k.op("make_plan", { week_start: MON });
    const fix = f.fixes().slice(0, 2).flatMap((a) => a.user.fix);
    expect(fix.map((m: any) => `${m.day} ${m.slot}`)).toEqual(["Thu Breakfast", "Thu Lunch"]);
    expect(fix[0].fasts).toEqual(["Ravi"]);
    expect(fix[0].wrong[0]).toContain("Poha is for everyone, which includes Ravi, who fasts at Breakfast and Lunch on Thursday");
    expect(fix[0].rules).toContain("Ravi fasts at Breakfast, Lunch on Thu");
    // The fake model never fixes it; code takes Ravi off the shared dish.
    const thu = await k.meal("2026-11-26", "Breakfast");
    expect(thu.dishes.every((d: any) => !d.for_people.includes("Ravi") && !d.for_people.includes("everyone"))).toBe(true);
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
    expect(f.menus()).toHaveLength(3);
    expect(wakes[0].message).toBe(DELIVER_PROMPT(true));
  });
});

describe("make_plan: every day is planned", () => {
  // Owner, 23 Nov: "There are a lot of households where family member only cooks daily. Our app is for both. Needs to have a
  // plan for Sunday."
  it("a day the cook does not come is cooked by the family, every meal of it; only a meal the family eats out is not", async () => {
    const f = fakeModel();
    const k = await family(f.model, { sunday: true, dishes: { Breakfast: ["Poha", "Upma", "Idli", "Dosa"], Lunch: ["Rajma", "Chole", "Kadhi", "Sambar"], Dinner: ["Aloo gobi", "Bhindi", "Palak paneer", "Dal fry"] } });
    await k.op("set_cook", { name: "Rani", days: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] });
    await k.op("set_slots", { add: true, order_in: [{ day: "Sun", slot: "Lunch", note: "eaten out" }] });
    const r = await k.op("make_plan", { week_start: MON });
    expect(r.ok).toBe(true);
    const daysAsked = (slot: string) => f.firsts().find((a) => a.user.slot === slot)!.user.meals.map((m: any) => m.day);
    expect(daysAsked("Breakfast")).toEqual(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]);
    expect(daysAsked("Lunch")).toEqual(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]);
    const sun = (await k.week()).days.find((d: any) => d.date === "2026-11-29").meals;
    expect(sun.map((m: any) => [m.slot, m.ordered_in, m.dishes.length > 0])).toEqual([["Breakfast", false, true], ["Lunch", true, false], ["Dinner", false, true]]);
    // The menu is told the family cooks that day.
    const sunBreakfast = f.firsts().find((a) => a.user.slot === "Breakfast")!.user.meals.find((m: any) => m.day === "Sun");
    expect(sunBreakfast.cook).toContain("the family cooks");
    // A meal is made simpler only by a rule the family said (live run 2026-11-23: "quick and simple" on every meal of a family
    // that cooks every day gave one light dish a lunch).
    expect(JSON.stringify(f.firsts().map((a) => a.user))).not.toMatch(/quick|simple/i);
  });

  it("the family's own words for what a meal looks like go with that meal's menu call and its fixes, and no other", async () => {
    const f = fakeModel({ menu: (u, n) => {
      if (u.slot !== "Lunch" || n > 1) return rotate(u);
      const r = rotate(u) as any;
      r.meals[0].dishes = [];
      return r;
    } });
    const k = await family(f.model);
    await k.owner("POST", "/api/family/meal-examples", { examples: [{ slot: "lunch", group: "adults", words: "Rajma with rice and a salad" }, { slot: "Lunch", group: "children", words: "Kadhi chawal" }] });
    const r = await k.plan();
    expect(r.ok).toBe(true);
    const lunch = f.firsts().find((a) => a.user.slot === "Lunch")!.user;
    expect(lunch.typical_meal).toEqual([{ for: "adults", words: "Rajma with rice and a salad" }, { for: "children", words: "Kadhi chawal" }]);
    expect(f.fixes().find((a) => a.user.slot === "Lunch")!.user.typical_meal).toEqual(lunch.typical_meal);
    expect(f.firsts().find((a) => a.user.slot === "Dinner")!.user.typical_meal).toBeUndefined();
    expect(f.menus()[0].req.system).toContain("typical_meal, when given");
  });
});

describe("make_plan: one call per meal of the day, everyone fed, one run at a time", () => {
  it("the first menus are asked all at once, one per meal of the day (extra slots too), each with only its own meals; the log has a line a round", async () => {
    const f = fakeModel({ wait: () => 20 });
    const k = await family(f.model);
    await k.op("set_slots", { extra_slots: [{ name: "Agastya's tiffin", days: ["Mon", "Tue", "Wed", "Thu", "Fri"], for: ["Agastya"] }, { name: "Evening snack", for: ["Asha", "Ravi"] }] });
    const lines: string[] = [];
    const r = await k.plan({ log: (l) => lines.push(l) });
    expect(r.ok).toBe(true);
    const first = f.firsts();
    expect(first.map((a) => a.user.slot)).toEqual(["Breakfast", "Lunch", "Dinner", "Agastya's tiffin", "Evening snack"]);
    expect(f.most()).toBe(5);   // all five running together
    for (const a of first) expect(a.user.meals.every((m: any) => m.slot === a.user.slot)).toBe(true);
    expect(first[3].user.meals.every((m: any) => m.who.join() === "Agastya")).toBe(true);
    // The snack came after Sunday was left out, so it is still planned on Sunday: 7.
    expect(lines[0]).toMatch(/^round 1: 5 calls \(Breakfast 6: ok, Lunch 6: ok, Dinner 6: ok, Agastya's tiffin 5: ok, Evening snack 7: ok\) in \d+ ms; problems: /);
    expect(lines.at(-1)).toMatch(/^planned in \d+ ms/);
    for (const m of allMeals(await k.week())) expect(m.dishes.length).toBeGreaterThan(0);
  });

  it("a meal of the day whose call fails is asked for whole again in the next round, alone", async () => {
    const f = fakeModel({ menu: (u, n) => (u.slot === "Lunch" && n === 1 ? { ok: false, code: "unavailable", message: "down" } : rotate(u)) });
    const k = await family(f.model);
    const r = await k.plan();
    expect(r.ok).toBe(true);
    expect(f.menus()).toHaveLength(4);
    expect(f.menus()[3].user.slot).toBe("Lunch");
    expect(f.menus()[3].user.meals).toHaveLength(6);   // its whole week again, not a fix
    expect((await k.meal(MON, "Lunch")).dishes[0].name).toBe("Rajma");
  });

  it("a main dish for one person, the rest given only sides: sent back naming who has no main, and the round's fix is kept", async () => {
    const f = fakeModel({ menu: (u, n) => {
      if (u.slot !== "Lunch") return rotate(u);
      if (n > 1) return { meals: u.fix.map((m: any) => ({ date: m.date, slot: m.slot, dishes: [{ name: "Rajma", for: ["everyone"] }, { name: "Steamed rice", for: ["everyone"] }] })) };
      const r = rotate(u) as any;
      r.meals[0].dishes = [{ name: "Rajma", for: ["Asha"] }, { name: "Steamed rice", for: ["everyone"] }, { name: "Curd", for: ["everyone"] }];
      return r;
    } });
    const k = await family(f.model);
    const r = await k.plan();
    expect(r.ok).toBe(true);
    expect(f.fixes()).toHaveLength(1);
    const fix = f.fixes()[0].user.fix;
    expect(fix.map((m: any) => `${m.day} ${m.slot}`)).toEqual(["Mon Lunch"]);
    expect(fix[0].wrong).toEqual(["Ravi and Agastya have no main dish at Mon Lunch: give them one (a shared dish for everyone, except who has their own)"]);
    expect(names(await k.meal(MON, "Lunch"))).toEqual([["Rajma", ["everyone"]], ["Steamed rice", ["everyone"]]]);
  });

  it("everyone without a main when the model never fixes it: code makes the one person's main the shared one", async () => {
    const f = fakeModel({ menu: (u) => {
      const r = rotate(u) as any;
      for (const m of r.meals) if (m.slot === "Lunch" && m.date === MON) m.dishes = [{ name: "Rajma", for: ["Asha"] }, { name: "Steamed rice", for: ["everyone"] }, { name: "Curd", for: ["everyone"] }];
      return r;
    } });
    const k = await family(f.model);
    const r = await k.plan();
    expect(r.ok).toBe(true);
    expect(f.fixes()).toHaveLength(MENU_ROUNDS - 1);
    expect(r.ok && r.unmet).toBeUndefined();
    expect(names(await k.meal(MON, "Lunch"))).toEqual([["Rajma", ["everyone"]], ["Steamed rice", ["everyone"]], ["Curd", ["everyone"]]]);
  });

  it("a fasting person's own dish at their fast is dropped by code; the others keep theirs", async () => {
    const f = fakeModel({ menu: (u) => {
      const r = rotate(u) as any;
      for (const m of r.meals) if (m.slot === "Breakfast" && m.date === "2026-11-26") m.dishes = [{ name: "Ragi dosa", for: ["Ravi"] }, { name: "Upma", for: ["everyone"], except: ["Ravi"] }];
      return r;
    } });
    const k = await family(f.model);
    await k.op("set_house_rules", { add: true, rules: [{ kind: "fasting", who: "Ravi", days: ["Thu"], slots: ["Breakfast"] }] });
    const r = await k.plan();
    expect(r.ok).toBe(true);
    expect(r.ok && r.unmet).toBeUndefined();
    expect(names(await k.meal("2026-11-26", "Breakfast"))).toEqual([["Upma", ["Asha", "Agastya"]]]);
  });

  it("the live run's family (2026-11-23): the father alone at home fasts Thursday breakfast and lunch; those meals are not planned, every other meal is, never no_dishes", async () => {
    // The dish book, rules and slots of run seed16-tiffin-snack: only Gowri Shankar was on the Family page.
    const book: Record<string, string[]> = {
      Breakfast: ["idli", "dosa", "poha", "upma", "aloo paratha", "ragi dosa", "oats", "parathas"],
      Lunch: ["paratha rolls", "besan cheela", "mini idlis", "vegetable sandwich", "lemon rice", "dal rice", "sabzi", "rice", "sambar", "dal", "curd", "rajma chawal", "bisi bele bath"],
      Dinner: ["palak dal", "bhindi", "aloo gobi", "chole"] };
    // The model gives every meal a dish for everyone, Thursday's too, and never fixes anything.
    const f = fakeModel({ menu: (u) => ({ meals: (u.meals ?? u.fix).map((m: any, i: number) => {
      const list = book[m.slot] ?? ["Banana chips", "Sandwich"];
      return { date: m.date, slot: m.slot, dishes: [{ name: list[i % list.length], for: ["everyone"] }] };
    }) }) });
    const k = await family(f.model, { dishes: book, people: [["Gowri Shankar", "elder"]] });
    await k.op("set_cooking_days", { days: ["mon", "tue", "wed", "thu", "fri", "sat"] });
    await k.op("set_house_rules", { add: true, rules: [
      { kind: "cap", days: [], slots: ["Lunch"], per_meal: 2 },
      { kind: "swap", days: [], who: "Gowri Shankar", items: ["white rice"], to: "millets" },
      { kind: "avoid", days: [], who: "Gowri Shankar", items: ["sugar", "jaggery"] },
      { kind: "fasting", days: ["Thu"], who: "Gowri Shankar", slots: ["Breakfast", "Lunch"], note: "light dinner after" },
      { kind: "avoid", days: [], items: ["mushrooms"] }] });
    await k.op("set_slots", { order_in: [{ day: "Sat", slot: "Dinner", note: "Swiggy" }] });
    const r = await k.plan();
    expect(r).toMatchObject({ ok: true });
    expect(f.menus().some((a) => (a.user.meals ?? a.user.fix).some((m: any) => m.day === "Thu" && m.slot !== "Dinner"))).toBe(false);
    expect(await k.meal("2026-11-26", "Breakfast")).toBeUndefined();
    expect(await k.meal("2026-11-26", "Lunch")).toBeUndefined();
    expect((await k.meal("2026-11-26", "Dinner")).dishes.length).toBeGreaterThan(0);
    for (const m of allMeals(await k.week())) if (!m.ordered_in) expect(m.dishes.length).toBeGreaterThan(0);
    expect(JSON.stringify((r.ok && r.unmet) || [])).not.toContain("fasts");
  });

  it("a meal left empty that only a rule-breaking dish can fill is filled with the least bad and said, not left empty (no_dishes)", async () => {
    const paneer = { Breakfast: ["Paneer paratha"], Lunch: ["Paneer tikka"], Dinner: ["Palak paneer"] };
    const f = fakeModel({ menu: (u) => ({ meals: (u.meals ?? u.fix).map((m: any) => ({ date: m.date, slot: m.slot,
      dishes: m.slot === "Dinner" ? [] : [{ name: paneer[m.slot as "Breakfast"][0], for: ["everyone"] }] })) }) });
    const k = await family(f.model, { dishes: paneer });
    await k.op("set_house_rules", { add: true, rules: [{ kind: "avoid", days: [], items: ["paneer"] }] });
    const r = await k.plan();
    expect(r.ok).toBe(true);
    for (const m of allMeals(await k.week())) expect(m.dishes.length).toBeGreaterThan(0);
    expect(r.ok && r.unmet?.some((u) => u.startsWith("Mon Dinner has"))).toBe(true);
  });

  it("two make_plan calls for the same week at once: one run, one sequence of model calls, the same answer", async () => {
    const f = fakeModel({ wait: () => 20 });
    const k = await family(f.model);
    const lines: string[] = [];
    const [a, b] = await Promise.all([k.plan({ log: (l) => lines.push(l) }), k.plan({ log: (l) => lines.push(l) })]);
    expect(b).toBe(a);
    expect(a.ok).toBe(true);
    expect(f.menus()).toHaveLength(3);
    expect(f.days()).toHaveLength(6);
    expect(lines).toContain("joined the run already going for this week");
    // Once it is over, the next call plans again.
    await k.plan();
    expect(f.menus()).toHaveLength(6);
  });

  it("a call still running when a run's time is spent: the next run waits for it before asking anything again", async () => {
    let lunchDone = 0;
    const starts: number[] = [];
    const f = fakeModel({ wait: (u, n) => (u.slot === "Lunch" && n === 1 ? 300 : 0), menu: (u, n) => {
      if (u.slot === "Lunch" && n === 1) lunchDone = Date.now();
      return rotate(u);
    } });
    const model = (req: ModelRequest) => { if (req.tier === "balanced") starts.push(Date.now()); return f.model(req); };
    const k = await family(f.model);
    // 60 ms for the menu (the rest is the ingredients' reserve): the lunch call outlives it; code fills lunch.
    const first = await k.plan({ model, budgetMs: 90_000 + 60 });
    expect(first.ok).toBe(true);
    expect(lunchDone).toBe(0);   // still running
    const before = starts.length;
    const lines: string[] = [];
    const second = await k.plan({ model, log: (l) => lines.push(l) });
    expect(second.ok).toBe(true);
    expect(lunchDone).toBeGreaterThan(0);
    expect(starts[before]).toBeGreaterThanOrEqual(lunchDone);
    expect(lines[0]).toBe("waiting for 1 model call still running before asking again");
  });

  it("an ingredient a person avoids is taken out of the dishes they eat, @categories too, and a shared dish says so", async () => {
    const f = fakeModel({ day: (u) => ({ dishes: u.dishes.map((d: any) => ({ slot: d.slot, name: d.name,
      ingredients: d.name === "Poha" ? [{ item: "poha", amount: 300, unit: "g" }, { item: "sugar", amount: 10, unit: "g" }, { item: "peanuts", amount: 30, unit: "g" }]
        : [{ item: d.name.toLowerCase(), amount: 200, unit: "g" }] })) }) });
    const k = await family(f.model);
    await k.op("set_house_rules", { add: true, rules: [{ kind: "avoid", days: [], who: "Ravi", items: ["sugar", "jaggery"] }, { kind: "avoid", days: [], who: "Asha", items: ["@nuts"] }] });
    const lines: string[] = [];
    const r = await k.plan({ log: (l) => lines.push(l) });
    expect(r.ok).toBe(true);
    const poha = (await k.meal(MON, "Breakfast")).dishes[0];
    expect(poha.name).toBe("Poha");
    expect(poha.ingredients.map((i: any) => i.item)).toEqual(["poha"]);
    expect(poha.portion_note).toBe("no sugar for Ravi; no peanuts for Asha");
    expect(lines.some((l) => l.startsWith("ingredients taken out for an avoid rule: Mon Breakfast Poha: sugar (Ravi)"))).toBe(true);
    // A dish no one avoids anything in keeps its ingredients and has no note.
    const upma = (await k.meal("2026-11-24", "Breakfast")).dishes[0];
    expect(upma.ingredients.map((i: any) => i.item)).toEqual(["upma"]);
    expect(upma.portion_note).toBeNull();
  });
});
