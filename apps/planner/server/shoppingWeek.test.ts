// A week of shopping, Monday 30 Nov to Sunday 6 Dec 2026, on a planned week (shoppingWeek.fixture.json): each day the 15:00
// and 19:00 reminders run as the routines run them (routines/reminders.ts builds a dry run and wakes the agent; the agent then
// calls get_reminder with the wake's date, and once more as its guide says), and the family answers as families do: ordering
// some days, ignoring the asks on others, changing Thursday's dinner, and switching on Order without asking on Sunday. No
// model: the one re-plan (its own test) runs on a fake that answers by the call's purpose.
//
// The order history the reminders learn from, dated back from Sunday 29 Nov: milk 2 × 500 ml every day, curd every 2 days,
// bread every 3 days (all last bought on the 29th), atta every 20 days (last 18 Nov: out 8 Dec), and tea, sugar, toor dal,
// oil, ghee and rice once a month (out 29 Nov to 4 Dec). Paneer comes from the dairy on a subscription.
// SHOPPING_WEEK_TABLE=1 prints the week's reminders as a table.
import { describe, it, expect } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";
import { boot } from "./testkit";
import { reminder as routineReminder } from "./routines/reminders";
import { ESTIMATE } from "./db/constants";
import { normItem } from "./products";
import { reminderText } from "./messages";
import { addRule, commit, listSlotDays, saveSlotDay, upsertLibrary, upsertSlot } from "./slotStore";
import type { ModelRequest, ModelResult } from "./model";
import type { Which } from "./reminder";

const F = JSON.parse(readFileSync(join(import.meta.dir, "shoppingWeek.fixture.json"), "utf8"));
const WEEK: string[] = ["2026-11-30", "2026-12-01", "2026-12-02", "2026-12-03", "2026-12-04", "2026-12-05", "2026-12-06"];
const [MON, TUE, WED, THU, FRI, SAT, SUN] = WEEK;
const NEXT_MON = "2026-12-07";
const at = (date: string, hour: number) => { const [y, m, d] = date.split("-").map(Number); return new Date(y, m - 1, d, hour); };
const nextDay = (date: string) => { const d = at(date, 12); d.setDate(d.getDate() + 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const ONION_GARLIC = ["onion", "garlic"];
/** The everyday items and their usual packs (milk 1 l = 2 × 500 ml; curd and bread one pack). */
const PACKS: Record<string, number> = { milk: 2, curd: 1, bread: 1 };

/** The family on a real kit: the fixture's week saved as make_plan saves it, the apps, products, history and subscription. */
async function family(model?: (r: ModelRequest) => Promise<ModelResult>) {
  let t = at("2026-11-29", 18);
  const k = await boot({ now: () => new Date(t), model });
  for (const p of F.people) await k.op("set_person", p);
  commit(k.kit.db, k.kit.emitChange, (tx, ch) => {
    for (const s of F.slots) upsertSlot(tx, s, "app", ch);
    for (const r of F.rules) addRule(tx, r, "app", ch);
    for (const l of F.library) upsertLibrary(tx, l, "app", ch);
    for (const d of F.slot_days) saveSlotDay(tx, { date: d.date, slot: d.slot, people: d.people ?? F.everyone, skip: d.skip ?? null,
      dishes: (d.dishes ?? []).map((x: any) => ({ dish: x.dish, new: !!x.new, note: x.note ?? null, not_for: x.not_for ?? [], ingredients: x.ingredients })) }, "app", ch);
  });
  await k.op("set_shopping_apps", { main: "zepto", fallback: null, connected: ["zepto"] });
  for (const p of F.products) await k.op("remember_product", p);
  const byDate = new Map<string, object[]>();
  for (const [item, h] of Object.entries<any>(F.history)) for (const date of h.dates)
    byDate.set(date, [...(byDate.get(date) ?? []), { item, group: h.group, pack: h.pack, ...(h.count ? { count: h.count } : {}) }]);
  await k.op("import_order_history", { app: "zepto", orders: [...byDate].sort(([a], [b]) => a.localeCompare(b)).map(([date, items]) => ({ date, order_ref: `Z-${date}`, items })) });
  for (const s of F.subscriptions) await k.op("set_subscription", { ...s, active: true });

  const clock = (date: string, hour: number) => { t = at(date, hour); };
  const wakes: any[] = [];
  const ctx = { kit: { db: k.kit.db, sqlite: k.kit.sqlite, emitChange: k.kit.emitChange }, routine: { trigger: null },
    wakeAgent: async (_m: string, data?: unknown) => { wakes.push(data); return { ok: true }; } };
  /** One reminder as it really runs: the routine's dry run at 15:00 or 19:00 (null when it wakes nobody), then the agent's
   *  get_reminder with the wake's date, and the same call again (its guide's step 4). */
  const run = async (which: Which, day: string) => {
    clock(day, which === "afternoon" ? 15 : 19);
    const n = wakes.length;
    await routineReminder(ctx as any, which, new Date(t));
    if (wakes.length === n) return null;
    const wake = wakes[n];
    const first = await k.op("get_reminder", { which, date: wake.date });
    const again = await k.op("get_reminder", { which, date: wake.date });
    return { wake, first, again };
  };
  return Object.assign(k, { clock, run });
}
type K = Awaited<ReturnType<typeof family>>;

const item = (k: K, name: string) => k.rows("items").find((i) => i.item === name);
const statusOf = (k: K, orderId: string) => k.rows("orders").find((o) => o.id === orderId)?.status;
/** Items (normalised) with a line of qty above 0 on an open or ordering cart. */
const onOpenCarts = (k: K) => new Set(k.rows("order_lines").filter((l) => (l.qty ?? 0) > 0 && ["open", "ordering"].includes(statusOf(k, l.order_id)))
  .map((l) => normItem(l.item)));
/** The meals a reminder must cover, read straight from the stored slot-days: tonight's Dinner cooked at home (15:00), or
 *  every slot-day of tomorrow with dishes or not cooked at home (19:00). */
function mealsDue(k: K, which: Which, date: string) {
  return listSlotDays(k.kit.db as any, { from: date, to: date })
    .filter((d) => (which === "afternoon" ? (d.slot === "Dinner" || d.slot === "Gopal's dinner") && !d.skip && d.dishes.length > 0 : !!d.skip || d.dishes.length > 0));
}
/** The ingredients a reminder must ask about: its meals' ingredients in order, each once, but not an everyday item with a
 *  cycle, a monthly or subscribed item, or one already on an open cart (`cart`: as it was before the reminder). */
function ingredientsDue(k: K, meals: ReturnType<typeof mealsDue>, cart: Set<string>): string[] {
  const out: string[] = [], seen = new Set<string>();
  for (const d of meals) for (const x of d.dishes) for (const i of x.ingredients) {
    const key = normItem(i.item), it = item(k, key);
    if (seen.has(key)) continue;
    seen.add(key);
    if ((it?.group === "daily" && it.lasts_days != null) || it?.group === "monthly" || it?.subscription || cart.has(key)) continue;
    out.push(i.item);
  }
  return out;
}

describe("a week of shopping on the slot model", () => {
  it("the week as stored: Gopal's dishes have no onion or garlic, the chole that is not for him keeps them, the meals not cooked at home have no dishes", async () => {
    const k = await family();
    const week = listSlotDays(k.kit.db as any, { from: MON, to: SUN });
    expect(week).toHaveLength(F.slot_days.length);
    const his = week.filter((d) => d.people.includes("Gopal")).flatMap((d) => d.dishes.filter((x) => !x.not_for.includes("Gopal"))
      .map((x) => ({ at: `${d.date} ${d.slot} ${x.dish}`, bad: x.ingredients.map((i) => i.item).filter((i) => ONION_GARLIC.includes(i)) })));
    expect(his.length).toBeGreaterThan(20);
    expect(his.filter((x) => x.bad.length)).toEqual([]);
    const chole = week.find((d) => d.date === TUE && d.slot === "Dinner")!.dishes.find((x) => x.dish === "Chole")!;
    expect(chole.not_for).toEqual(["Gopal"]);
    expect(chole.ingredients.map((i) => i.item)).toEqual(expect.arrayContaining(ONION_GARLIC));
    expect(week.filter((d) => d.skip).map((d) => [d.date, d.slot, d.skip, d.dishes.length])).toEqual([[SAT, "Dinner", "ordered_in", 0], [SUN, "Lunch", "eaten_out", 0]]);
    // The history taught each item its cycle.
    expect(["milk", "curd", "bread", "atta", "toor dal"].map((n) => [n, item(k, n).lasts_days, item(k, n).run_out])).toEqual([
      ["milk", 1, MON], ["curd", 2, TUE], ["bread", 3, WED], ["atta", 20, "2026-12-08"], ["toor dal", 30, TUE]]);
    expect(item(k, "milk").usual_amount).toBe(1000);
    expect(item(k, "paneer")).toMatchObject({ subscription: "the dairy" });
  });

  it("Monday to Sunday: the 15:00 and 19:00 reminders, with the family ordering some days and not others", async () => {
    const k = await family();
    let yeses = 0;
    /** Her yes to the Zepto cart, and the agent recording it placed. */
    const order = async (day: string, hour: number) => {
      k.clock(day, hour);
      const o = await k.op("order_cart", { app: "zepto" });
      expect(o.order_id).toBeString();
      yeses++;
      await k.op("record_order", { order_id: o.order_id, placed: true, app_order_ref: `ZO-${day}-${hour}` });
    };
    const before: Record<string, () => Promise<void>> = {
      // Tuesday noon she puts kabuli chana on the cart herself, for the chole.
      [`${TUE}:afternoon`]: async () => { k.clock(TUE, 12); await k.op("set_cart_line", { item: "kabuli chana", qty: 1 }); },
      // Sunday afternoon she switches on Order without asking.
      [`${SUN}:evening`]: async () => { k.clock(SUN, 17); expect((await k.owner("PATCH", "/api/_app/settings", { order_without_asking: true })).status).toBe(200); },
    };
    const after: Record<string, (r: any) => Promise<void>> = {
      // Monday night: toor dal is low, oil is fine for two weeks; she orders the cart.
      [`${MON}:evening`]: async () => {
        k.clock(MON, 20);
        await k.op("answer_running_low", { answers: [{ item: "toor dal", answer: "low" }, { item: "oil", answer: "in_stock", days: 14 }] });
        await order(MON, 20);
      },
      // Wednesday afternoon: Kabir loved yesterday's besan cheela; she orders the cart.
      [`${WED}:afternoon`]: async () => {
        k.clock(WED, 16);
        await k.op("record_feedback", { date: TUE, slot: "Kabir's tiffin", dish: "Besan cheela", made: true, liked: true, again: true });
        await order(WED, 16);
      },
      // Wednesday night: Thursday's dinner becomes chapati and palak paneer (the dishes given, with what they need: no model).
      [`${WED}:evening`]: async () => {
        k.clock(WED, 20);
        const r = await k.op("set_slot_day", { date: THU, slot: "Dinner", dishes: [
          { dish: "Chapati", ingredients: [{ item: "atta", amount: 400, unit: "g" }] },
          { dish: "Palak paneer", ingredients: [{ item: "palak", amount: 500, unit: "g" }, { item: "paneer", amount: 200, unit: "g" }, { item: "tomato", amount: 150, unit: "g" }, { item: "ginger", amount: 10, unit: "g" }] }] });
        expect(r).toMatchObject({ ok: true, replanned: [], slot_day: { edited: true } });
      },
      [`${THU}:evening`]: async () => { await order(THU, 20); },
      [`${SAT}:evening`]: async () => { await order(SAT, 20); },
      // Sunday night: the agent checks out the order the reminder made by itself, and records it placed.
      [`${SUN}:evening`]: async (r) => { k.clock(SUN, 20); await k.op("record_order", { order_id: r.ordered[0].order_id, placed: true, app_order_ref: "ZO-auto" }); },
    };

    type Row = { day: string; which: Which; meals: string[]; ask: string[]; added: string[]; asks: string[]; ordered: string[]; feedback: string[] };
    const table: Row[] = [];
    for (const day of WEEK) for (const which of ["afternoon", "evening"] as Which[]) {
      const key = `${day}:${which}`;
      await before[key]?.();
      const date = which === "afternoon" ? day : nextDay(day);
      const cart = onOpenCarts(k);
      const asksBefore = k.rows("item_events").filter((e) => e.kind === "ask").length;
      const outOfOpen = k.rows("orders").filter((o) => o.status !== "open").length;
      const ran = await k.run(which, day);
      // Every reminder this week has something to say (and the evening one always wakes the agent: Zepto is connected).
      expect(ran).not.toBeNull();
      const { wake, first: r, again } = ran!;
      expect(wake).toMatchObject({ which, date, connected: ["zepto"] });

      // 2. The meals are exactly the right slot-days; the ingredients asked are theirs, less everyday, monthly, subscribed and on-cart items.
      const due = mealsDue(k, which, date);
      expect(r.meals.map((m: any) => `${m.date} ${m.slot}`)).toEqual(due.map((d) => `${d.date} ${d.slot}`));
      expect(r.ask_ingredients).toEqual(ingredientsDue(k, due, cart));
      // 3. A meal eaten out or ordered in has no dishes, so nothing of it is asked.
      for (const m of r.meals.filter((x: any) => x.skip)) expect(m.dishes).toEqual([]);
      // The second call (the agent's step 4, the text it sends) is the same reminder: nothing asked or added twice. What the
      // first call put on reads as the cart then ("Your cart: milk and curd." for "I've added milk and curd to your cart.").
      expect(again.text).toBe(reminderText({ ...r, added: [] }));
      expect(again.ask_ingredients).toEqual(r.ask_ingredients);
      expect(again.asks).toEqual(r.asks);
      expect(again.added).toEqual([]);
      // 4. At most ESTIMATE.maxAsks running-low items, each once, each counted once for this reminder (the retry counts none).
      expect(r.asks.length).toBeLessThanOrEqual(ESTIMATE.maxAsks);
      expect(new Set(r.asks.map((a: any) => a.item)).size).toBe(r.asks.length);
      expect(k.rows("item_events").filter((e) => e.kind === "ask").length - asksBefore).toBe(r.asks.length);
      // 1. Everyday items go on for tomorrow at the usual packs; one line per item and date across every cart, ever.
      const tomorrow = nextDay(day);
      for (const a of r.added.filter((x: any) => PACKS[x.item]))
        expect(k.rows("order_lines").find((l) => l.item === a.item && l.for_date === tomorrow && l.source === "everyday")).toMatchObject({ qty: PACKS[a.item] });
      const everyday = k.rows("order_lines").filter((l) => l.source === "everyday" && l.qty > 0);
      for (const l of everyday) expect(everyday.filter((x) => x.item === l.item && x.for_date === l.for_date)).toHaveLength(1);
      // 6. Nothing leaves an open cart without her yes, but on Sunday night, with Order without asking on.
      expect(k.rows("orders").filter((o) => o.status !== "open").length - outOfOpen).toBe(key === `${SUN}:evening` ? 1 : 0);
      if (key !== `${SUN}:evening`) expect(r.ordered).toEqual([]);
      // 7. The next-day question is the afternoon's only, and leaves the shopping part of the text as it would be without it.
      if (which === "evening") expect(r.feedback).toEqual([]);
      if (r.feedback.length) expect(r.text.startsWith(`${reminderText({ ...r, feedback: [] })}\n\n`)).toBe(true);

      table.push({ day, which, meals: r.meals.map((m: any) => `${m.slot}${m.skip ? ` (${m.skip.replace("_", " ")})` : ""}`), ask: r.ask_ingredients,
        added: r.added.map((a: any) => a.item), asks: r.asks.map((a: any) => a.item), ordered: r.ordered.map((o: any) => o.message), feedback: r.feedback.map((f: any) => `${f.dish} (${f.from})`) });
      await after[key]?.(r);
    }
    if (process.env.SHOPPING_WEEK_TABLE) console.log(table.map((x) => [x.day.slice(5), x.which === "afternoon" ? "15:00" : "19:00", x.meals.join(", ") || "-",
      x.ask.join(", ") || "-", x.added.join(", ") || "-", x.asks.join(", ") || "-", x.feedback.join(", ") || "-", x.ordered.join(" ") || "-"].join(" | ")).join("\n"));

    const row = (day: string, which: Which) => table.find((x) => x.day === day && x.which === which)!;
    const ALL = ["Breakfast", "Kabir's tiffin", "Lunch", "Dinner", "Gopal's dinner"];
    // The whole week, as the family saw it: meals covered, ingredients asked, items put on, running-low asks, next-day question.
    expect(table.map((x) => [x.day, x.which, x.meals, x.ask, x.added, x.asks, x.feedback])).toEqual([
      [MON, "afternoon", ["Dinner", "Gopal's dinner"], ["palak", "moong dal", "tomato", "bhindi"], ["milk", "curd"], ["tea", "sugar", "toor dal", "oil", "ghee"], []],
      [MON, "evening", ALL, ["dosa batter", "coconut", "roasted chana", "besan", "tomato", "rajma", "kabuli chana", "onion", "garlic", "chole masala"], [], ["tea", "sugar", "toor dal", "oil", "ghee"], []],
      [TUE, "afternoon", ["Dinner", "Gopal's dinner"], ["onion", "garlic", "tomato", "chole masala"], ["milk", "bread"], ["rice"], []],
      [TUE, "evening", ALL, ["poha", "peanuts", "curry leaves", "idli batter", "tomato", "potato", "cauliflower"], [], ["rice"], []],
      [WED, "afternoon", ["Dinner", "Gopal's dinner"], ["tomato", "potato", "cauliflower"], ["milk", "curd", "bread"], [], ["Besan cheela (reel)"]],
      [WED, "evening", ALL, ["rava", "carrot", "peas", "coconut", "roasted chana", "cucumber", "palak", "moong dal", "tomato", "bhindi"], [], [], []],
      [THU, "afternoon", ["Dinner", "Gopal's dinner"], ["palak", "tomato", "ginger"], ["milk"], [], []],
      [THU, "evening", ALL, ["idli batter", "coconut", "roasted chana", "lemon", "peanuts", "drumstick", "tomato", "sambar powder", "tamarind", "rajma"], [], [], []],
      [FRI, "afternoon", ["Dinner", "Gopal's dinner"], [], ["milk", "curd"], [], []],
      [FRI, "evening", ["Breakfast", "Lunch", "Dinner (ordered in)", "Gopal's dinner"], ["potato", "coconut", "roasted chana", "mixed vegetables", "bisi bele bath powder"], [], ["atta"], []],
      [SAT, "afternoon", ["Gopal's dinner"], [], ["milk", "curd", "bread"], ["atta"], []],
      [SAT, "evening", ["Breakfast", "Lunch (eaten out)", "Dinner", "Gopal's dinner"], ["ragi flour", "coconut", "roasted chana", "tomato", "potato", "cauliflower"], [], [], []],
      [SUN, "afternoon", ["Dinner", "Gopal's dinner"], ["tomato", "potato", "cauliflower"], ["milk"], [], ["Bisi bele bath (suggestion)"]],
      [SUN, "evening", [], [], ["tea", "sugar", "ghee"], [], []],
    ]);

    // 1. Each everyday item went on the day before the day it runs out: milk every day; curd every 2 days and bread every 3
    //    from the day of the order she placed. A line she did not order moved on to the next day (one line, never two); a day
    //    an order she said yes to already covers is never put on again.
    const placedFor = (n: string) => k.rows("order_lines").filter((l) => l.item === n && l.qty > 0 && statusOf(k, l.order_id) === "placed").map((l) => l.for_date).sort();
    expect(placedFor("milk")).toEqual([TUE, THU, FRI, SUN, NEXT_MON]);
    expect(placedFor("curd")).toEqual([TUE, THU, SUN]);
    expect(placedFor("bread")).toEqual([THU, SUN]);
    // Curd ordered Monday for Tuesday lasts Wednesday too, so Tuesday's reminders leave it off; ordered Wednesday for Thursday,
    // Thursday's leave it off; ordered Saturday for Sunday, Sunday's leave it off. Bread ordered Wednesday for Thursday lasts to Saturday.
    for (const d of [TUE, THU, SUN]) expect(row(d, "afternoon").added).not.toContain("curd");
    for (const d of [THU, FRI]) expect(row(d, "afternoon").added).not.toContain("bread");
    // The cycles learned stay the family's: the orders placed through the app did not shorten them.
    expect(["milk", "curd", "bread"].map((n) => item(k, n).lasts_days)).toEqual([1, 2, 3]);

    // 4. Two unanswered asks snooze an item for its group's default (monthly: 5 days), not counted; asked again once it ends.
    const asked = (n: string) => k.rows("item_events").filter((e) => e.item_id === item(k, n).id && e.kind !== "purchase").map((e) => [e.date, e.kind]);
    expect(asked("tea")).toEqual([[MON, "ask"], [MON, "ask"], [TUE, "unanswered"]]);
    expect(asked("rice")).toEqual([[TUE, "ask"], [TUE, "ask"], [WED, "unanswered"]]);
    expect(asked("atta")).toEqual([[FRI, "ask"], [SAT, "ask"], [SAT, "unanswered"]]);
    expect(item(k, "atta")).toMatchObject({ snoozed_until: "2026-12-10", asks_unanswered: 0 });
    // Her answers end the asks: toor dal (low) was ordered Monday, oil sleeps for the 14 days she said.
    expect(item(k, "toor dal").last_bought).toBe(MON);
    expect(item(k, "oil").snoozed_until).toBe("2026-12-14");

    // 5. Thursday's dinner as changed: its 15:00 asks palak, tomato and ginger; paneer comes from the dairy, so never on a cart.
    expect(k.rows("order_lines").map((l) => l.item)).not.toContain("paneer");
    // 2. Kabuli chana she put on the cart is not asked on Tuesday afternoon.
    expect(row(TUE, "afternoon").ask).not.toContain("kabuli chana");

    // 6. Sunday 19:00, Order without asking on: the confident running-low items (their snooze over) went on with tomorrow's
    //    milk and the cart was ordered, nothing asked; the agent placed it.
    const auto = k.rows("orders").find((o) => o.reminder_key === `${NEXT_MON}:evening`);
    expect(auto).toMatchObject({ status: "placed", app_order_ref: "ZO-auto" });
    expect(k.rows("order_lines").filter((l) => l.order_id === auto.id).map((l) => [l.item, l.qty, l.source])).toEqual([["milk", 2, "everyday"], ["tea", 1, "low"], ["sugar", 1, "low"], ["ghee", 1, "low"]]);
    expect(table.at(-1)!).toMatchObject({ asks: [], ordered: ["Ordering this now: Amul Taaza toned milk ×2, tea, sugar, ghee on Zepto"] });
    // Every other order was her yes.
    expect(k.rows("orders").filter((o) => o.status !== "open")).toHaveLength(yeses + 1);

    // 7. The next-day question: Wednesday for Tuesday's besan cheela (a reel she sent), Sunday for Saturday's bisi bele bath
    //    (the planner's suggestion); never a dish the family named, never in the evening. Her answer is kept.
    expect(table.filter((x) => x.feedback.length).map((x) => [x.day, x.which])).toEqual([[WED, "afternoon"], [SUN, "afternoon"]]);
    expect(k.rows("library").find((l) => l.name === "Besan cheela")).toMatchObject({ untried: 0 });
  });

  it("a re-plan takes onion and garlic out of what Gopal eats, as stored, and the reminder for that day never asks for them", async () => {
    // The fake model: the slot call answers kadhi for Friday's dinner; the day's ingredients read puts onion and garlic in it.
    const purposes: string[] = [];
    const model = async (req: ModelRequest): Promise<ModelResult> => {
      const u = JSON.parse(req.user), p = req.purpose ?? "";
      purposes.push(p);
      const ok = (json: unknown): ModelResult => ({ ok: true, json, model: "fake" });
      if (p.startsWith("meal plan: the week's") || p.startsWith("meal plan: fix the"))
        return ok({ days: Object.fromEntries(u.days.filter((d: any) => !d.skip).map((d: any) => [d.date, ["Kadhi"]])) });
      if (p.includes("contain")) return ok({ dishes: [] });
      if (p.includes("calendar")) return ok({ changes: [] });
      return ok({ dishes: u.dishes.map((d: any) => ({ slot: d.slot, name: d.name, ingredients: [
        { item: "besan", amount: 100, unit: "g", tags: [] }, { item: "curd", amount: 500, unit: "g", tags: ["dairy"] },
        { item: "onion", amount: 100, unit: "g", tags: ["onion_garlic"] }, { item: "garlic", amount: 10, unit: "g", tags: ["onion_garlic"] },
        { item: "curry leaves", amount: 1, unit: "pc", tags: [] }, { item: "ghee", amount: 20, unit: "g", tags: ["dairy"] }] })) });
    };
    const k = await family(model);
    k.clock(THU, 10);
    // Friday's dinner is for Arjun's promotion: planned again (no dishes given), by the plan's own steps on the fake.
    const r = await k.op("set_slot_day", { date: FRI, slot: "Dinner", occasion: "Arjun's promotion" });
    expect(r).toMatchObject({ ok: true, replanned: [{ date: FRI, slot: "Dinner" }] });
    expect(purposes).toContain("meal plan: a day's ingredients");
    const fri = listSlotDays(k.kit.db as any, { from: FRI, to: FRI }).find((d) => d.slot === "Dinner")!;
    expect(fri.people).toContain("Gopal");
    const kadhi = fri.dishes.find((x) => x.dish === "Kadhi")!;
    expect(kadhi.not_for).toEqual([]);
    expect(kadhi.ingredients.map((i) => i.item)).toEqual(["besan", "curd", "curry leaves", "ghee"]);
    expect(kadhi.note).toBe("no onion and garlic for Gopal");
    // Thursday 19:00 covers Friday: it asks besan and curry leaves (curd is everyday, ghee monthly), never onion or garlic.
    const ran = await k.run("evening", THU);
    expect(ran!.first.meals.find((m: any) => m.slot === "Dinner").dishes.map((d: any) => d.name)).toContain("Kadhi");
    expect(ran!.first.ask_ingredients).toEqual(expect.arrayContaining(["besan", "curry leaves"]));
    for (const x of ONION_GARLIC) expect(ran!.first.ask_ingredients).not.toContain(x);
  });
});
