import { describe, it, expect } from "bun:test";
import { cycleText, dailyDue, isDue, median, pantryStatus, pattern, pickAsks, quantityText, runOut, tagEvents, type DailyState, type Ev, type ItemState, type Pattern } from "./estimate";

let n = 0;
const ev = (mmdd: string, e: Partial<Ev>): Ev => ({
  id: `e${++n}`, date: `2026-${mmdd}`, kind: "purchase", amount: null, unit: "g", product: null, app: null, days: null, ...e,
});
/** A purchase of `count` packs of `amount` g of Aashirvaad Select on Zepto. */
const buy = (mmdd: string, amount: number, count = 1, e: Partial<Ev> = {}): Ev =>
  ev(mmdd, { amount: amount * count, product: "Aashirvaad Select", app: "zepto", ...e });
const ask = (mmdd: string) => ev(mmdd, { kind: "ask", unit: null });
const answer = (mmdd: string, days: number | null) => ev(mmdd, { kind: "answer", unit: null, days });
const unanswered = (mmdd: string) => ev(mmdd, { kind: "unanswered", unit: null });
/** Four 10 kg purchases 24 days apart: lasts-about 24. */
const history = () => [buy("07-28", 10000), buy("08-21", 10000), buy("09-14", 10000), buy("10-08", 10000)];
const tagOf = (tagged: ReturnType<typeof tagEvents>, date: string) => tagged.find((t) => t.date === `2026-${date}`)!;

const item = (o: Partial<ItemState>): ItemState => ({
  id: "i", name: "Atta", group: "monthly", subscription: null, dont_ask: false, snoozed_until: null, wait_factor: 1,
  run_out: "2026-11-25", confident: true, last_bought: "2026-11-01", cycles: 2, ...o,
});

describe("estimate", () => {
  it("median takes the middle, or the mean of the two middles", () => {
    expect(median([25, 24, 24, 24])).toBe(24);
    expect(median([3, 1, 2])).toBe(2);
    expect(median([24, 28])).toBe(26);
    expect(median([])).toBe(0);
  });

  it("the median of the last 5 cycles and amounts makes the pattern: 2 × 5 kg is 10 kg", () => {
    const p = pattern(tagEvents([buy("07-27", 10000), buy("08-21", 10000), buy("09-14", 10000), buy("10-08", 10000), buy("11-01", 5000, 2) /* 2 × 5 kg */], "g"));
    expect(p).toMatchObject({ usual_amount: 10000, lasts_days: 24, last_bought: "2026-11-01", confident: true });   // gaps 25, 24, 24, 24
    expect(p).toMatchObject({ anchor_amount: 10000, cycles: 4, product: "Aashirvaad Select", app: "zepto" });
  });

  it("a 5 kg pack beside the usual 10 kg is a one-off and does not move the anchor", () => {
    const t = tagEvents([buy("07-27", 10000), buy("08-21", 10000), buy("09-02", 5000), buy("09-14", 10000)], "g");
    expect(tagOf(t, "09-02").tag).toBe("one_off");
    expect(tagOf(t, "09-02").cycle_days).toBeNull();
    expect(tagOf(t, "09-14").cycle_days).toBe(24);   // from 21 Aug, not from the 5 kg top-up
    const p = pattern(t);
    expect(p).toMatchObject({ usual_amount: 10000, last_bought: "2026-09-14", cycles: 2 });
  });

  it("two one-offs in a row in the same direction become the pattern", () => {
    const t = tagEvents([...history(), buy("11-01", 20000), buy("11-25", 20000)], "g");
    expect(tagOf(t, "11-01").tag).toBe("counted");
    expect(tagOf(t, "11-25").tag).toBe("counted");
    expect(tagOf(t, "11-01").cycle_days).toBe(24);
    expect(tagOf(t, "11-25").cycle_days).toBe(24);
    const p = pattern(t);
    expect(p.usual_amount).toBe(median([10000, 10000, 10000, 20000, 20000]));
    expect(p).toMatchObject({ anchor_amount: 20000, last_bought: "2026-11-25", cycles: 5 });
    // One alone stays a one-off.
    const lone = tagEvents([...history(), buy("11-01", 20000)], "g");
    expect(tagOf(lone, "11-01").tag).toBe("one_off");
    // A one-off above the usual still restocked: it is the anchor, though not in the pattern.
    expect(pattern(lone)).toMatchObject({ usual_amount: 10000, last_bought: "2026-11-01", anchor_amount: 20000, cycles: 3 });
  });

  it("an early buy restarts the item and enters as one cycle; one early buy barely moves lasts-about", () => {
    const t = tagEvents([...history(), buy("10-30", 10000)], "g");   // gap 22 vs 24
    expect(tagOf(t, "10-30")).toMatchObject({ tag: "early_buy", cycle_days: 22 });
    expect(pattern(t)).toMatchObject({ lasts_days: 24, last_bought: "2026-10-30", cycles: 4 });
  });

  it("a buy after an ask is counted, not early", () => {
    const t = tagEvents([...history(), ask("10-28"), buy("10-30", 10000)], "g");
    expect(tagOf(t, "10-30")).toMatchObject({ tag: "counted", cycle_days: 22 });
    expect(tagOf(t, "10-28").tag).toBeNull();
  });

  it("'enough for a week' is one cycle of days-since-purchase + 7; the next purchase adds no second gap", () => {
    const t = tagEvents([buy("10-01", 10000), buy("10-25", 10000), answer("11-15", 7), buy("11-22", 10000)], "g");
    expect(tagOf(t, "11-15")).toMatchObject({ tag: "your_answer", cycle_days: 21 + 7 });
    expect(tagOf(t, "11-22")).toMatchObject({ tag: "counted", cycle_days: null });
    expect(pattern(t)).toMatchObject({ lasts_days: median([24, 28]), cycles: 2, last_bought: "2026-11-22" });
  });

  it("'still have it' without a number and an unanswered ask are not counted and leave lasts-about as it was", () => {
    const t = tagEvents([...history(), answer("11-03", null), unanswered("11-05")], "g");
    expect(tagOf(t, "11-03")).toMatchObject({ tag: "not_counted", cycle_days: null });
    expect(tagOf(t, "11-05")).toMatchObject({ tag: "not_counted", cycle_days: null });
    expect(pattern(t)).toMatchObject({ lasts_days: 24, cycles: 3 });
  });

  // Amounts arrive in base units (Task 4 converts "1 kg" to 1000 g); the estimate only compares them.
  it("1 kg and 500 g compare in g; a 'pack' with no size for a g item is a one-off, never a cycle", () => {
    const g = tagEvents([buy("10-01", 1000), buy("10-11", 1000), buy("10-21", 600)], "g");   // 600 g vs the usual 1000 g: 0.6, counted
    expect(tagOf(g, "10-21").tag).not.toBe("one_off");
    expect(tagOf(tagEvents([buy("10-01", 1000), buy("10-11", 1000), buy("10-21", 500)], "g"), "10-21").tag).toBe("one_off");   // 500 g is half
    const t = tagEvents([buy("10-01", 1000), buy("10-11", 1000), buy("10-15", 1, 1, { unit: "pack" }), buy("10-16", 1, 1, { amount: null }), buy("10-21", 1000)], "g");
    expect(tagOf(t, "10-15")).toMatchObject({ tag: "one_off", cycle_days: null, restocked: true });
    expect(tagOf(t, "10-16")).toMatchObject({ tag: "one_off", cycle_days: null, restocked: true });   // two in a row stay one-offs: no direction
    expect(tagOf(t, "10-21")).toMatchObject({ tag: "early_buy", cycle_days: 5 });   // the packs reset the item: the gap runs from 16 Oct
    expect(pattern(t)).toMatchObject({ usual_amount: 1000, cycles: 2, last_bought: "2026-10-21" });
    // An unsized purchase last: it is the anchor, counted as the usual amount.
    const p = pattern(tagEvents([buy("10-01", 1000), buy("10-11", 1000), buy("10-15", 1, 1, { unit: "pack" })], "g"));
    expect(p).toMatchObject({ last_bought: "2026-10-15", anchor_amount: 1000, usual_amount: 1000, lasts_days: 10 });
    expect(runOut(p, 1)).toBe("2026-10-25");
  });

  it("an item never bought with a size is estimated from gaps alone", () => {
    const unsized = (d: string) => buy(d, 1, 1, { amount: null });
    const t = tagEvents([unsized("10-01"), unsized("10-11"), unsized("10-21")], "g");
    expect(t.map((x) => x.tag)).toEqual(["counted", "counted", "counted"]);
    const p = pattern(t);
    expect(p).toMatchObject({ usual_amount: null, anchor_amount: null, lasts_days: 10, cycles: 2, confident: true, last_bought: "2026-10-21" });
    expect(runOut(p, 1)).toBe("2026-10-31");
    expect(runOut(p, 1.5)).toBe("2026-11-05");
    // Gap rules still apply: 2 days after a 10-day rhythm is a one-off.
    expect(tagOf(tagEvents([unsized("10-01"), unsized("10-11"), unsized("10-21"), unsized("10-23")], "g"), "10-23").tag).toBe("one_off");
    // Once a sized purchase is in the pattern, the normal rules apply: a later unsized buy is a one-off.
    const mixed = tagEvents([unsized("10-01"), buy("10-11", 1000), unsized("10-21")], "g");
    expect(tagOf(mixed, "10-11")).toMatchObject({ tag: "counted", cycle_days: 10 });
    expect(tagOf(mixed, "10-21")).toMatchObject({ tag: "one_off", restocked: true });
  });

  it("the same new brand twice in a row becomes the product", () => {
    const base = [buy("07-28", 10000), buy("08-21", 10000), buy("09-14", 10000)];
    const fortune = (d: string) => buy(d, 10000, 1, { product: "Fortune Chakki Fresh" });
    expect(pattern(tagEvents([...base, fortune("10-08")], "g")).product).toBe("Aashirvaad Select");
    expect(pattern(tagEvents([...base, fortune("10-08"), fortune("11-01")], "g")).product).toBe("Fortune Chakki Fresh");
  });

  it("the app is the one bought on most, never outside", () => {
    const t = tagEvents([buy("08-21", 10000, 1, { app: "outside" }), buy("09-14", 10000, 1, { app: "outside" }), buy("10-08", 10000, 1, { app: "bigbasket" })], "g");
    expect(pattern(t).app).toBe("bigbasket");
  });

  it("not confident with one purchase; confident after two, or after one answer with days", () => {
    expect(pattern(tagEvents([buy("10-01", 10000)], "g"))).toMatchObject({ confident: false, cycles: 0, lasts_days: null });
    expect(pattern(tagEvents([buy("10-01", 10000), buy("10-25", 10000)], "g"))).toMatchObject({ confident: true, cycles: 1, lasts_days: 24 });
    expect(pattern(tagEvents([buy("10-01", 10000), answer("10-20", 7)], "g"))).toMatchObject({ confident: true, cycles: 1, lasts_days: 26 });
    expect(pattern(tagEvents([buy("10-01", 10000), answer("10-20", null)], "g")).confident).toBe(false);
  });

  it("void events are dropped", () => {
    const t = tagEvents([buy("10-01", 10000), buy("10-25", 10000, 1, { void: true })], "g");
    expect(t).toHaveLength(1);
    expect(pattern(t).confident).toBe(false);
  });

  it("run-out = anchor + lasts × (anchor amount ÷ usual) × wait factor", () => {
    const p: Pattern = { usual_amount: 10000, lasts_days: 24, product: null, app: null, last_bought: "2026-11-01", anchor_amount: 10000, cycles: 4, confident: true };
    expect(runOut(p, 1)).toBe("2026-11-25");
    expect(runOut(p, 1.25)).toBe("2026-12-01");
    expect(runOut({ ...p, anchor_amount: 5000 }, 1)).toBe("2026-11-13");   // half the usual lasts half as long
    expect(runOut({ ...p, lasts_days: null }, 1)).toBeNull();
  });

  it("a dish-specific item runs out when the plan uses it up, if that is sooner", () => {
    const p: Pattern = { usual_amount: 400, lasts_days: 14, product: null, app: null, last_bought: "2026-11-20", anchor_amount: 400, cycles: 2, confident: true };
    const plan = [{ date: "2026-11-23", amount: 200 }, { date: "2026-11-21", amount: 200 }, { date: "2026-11-19", amount: 200 }];   // 19 Nov is before the anchor
    expect(runOut(p, 1, plan)).toBe("2026-11-23");
    expect(runOut(p, 1, [{ date: "2026-11-21", amount: 200 }])).toBe("2026-12-04");   // the plan does not use it up: history decides
    expect(runOut({ ...p, lasts_days: null, confident: false, cycles: 0 }, 1, plan)).toBe("2026-11-23");   // no cycle yet: the plan alone
  });

  it("isDue: monthly 3 days ahead, few-days 1 day ahead; never daily, subscribed, don't-ask or snoozed items", () => {
    expect(isDue(item({}), "2026-11-22")).toBe(true);
    expect(isDue(item({}), "2026-11-21")).toBe(false);
    expect(isDue(item({ group: "few_days" }), "2026-11-24")).toBe(true);
    expect(isDue(item({ group: "few_days" }), "2026-11-23")).toBe(false);
    expect(isDue(item({ group: "daily" }), "2026-11-30")).toBe(false);
    expect(isDue(item({ subscription: "milkbasket" }), "2026-11-30")).toBe(false);
    expect(isDue(item({ dont_ask: true }), "2026-11-30")).toBe(false);
    expect(isDue(item({ snoozed_until: "2026-11-30" }), "2026-11-30")).toBe(false);
    expect(isDue(item({ snoozed_until: "2026-11-29" }), "2026-11-30")).toBe(true);
    expect(isDue(item({ confident: false }), "2026-11-30")).toBe(false);
    expect(isDue(item({ run_out: null }), "2026-11-30")).toBe(false);
  });

  it("pickAsks keeps the 5 that run out first", () => {
    const due = ["11-20", "11-18", "11-22", "11-19", "11-21", "11-17", "11-16"].map((d, k) => item({ id: `i${k}`, run_out: `2026-${d}` }));
    const picked = pickAsks([...due, item({ id: "daily", group: "daily", run_out: "2026-11-01" })], "2026-11-22");
    expect(picked.map((i) => i.run_out)).toEqual(["2026-11-16", "2026-11-17", "2026-11-18", "2026-11-19", "2026-11-20"]);
    // Same run-out: more cycles first.
    const tie = pickAsks([item({ id: "a", cycles: 1 }), item({ id: "b", cycles: 4 })], "2026-11-25");
    expect(tie.map((i) => i.id)).toEqual(["b", "a"]);
  });

  it("pantryStatus: Snoozed while snoozed, Low when due or on a cart as low, else In stock", () => {
    expect(pantryStatus(item({ snoozed_until: "2026-11-30" }), "2026-11-24", true)).toBe("Snoozed");
    expect(pantryStatus(item({}), "2026-11-24", false)).toBe("Low");
    expect(pantryStatus(item({}), "2026-11-10", true)).toBe("Low");
    expect(pantryStatus(item({}), "2026-11-10", false)).toBe("In stock");
    expect(pantryStatus(item({ confident: false }), "2026-11-24", false)).toBe("In stock");
  });
});

describe("an item's cycle in words", () => {
  const c = (usual_amount: number | null, unit: string | null, lasts_days: number | null, stated = false) => cycleText({ usual_amount, unit, lasts_days }, stated);
  it("says how much and how often: every day as it is, anything longer as about", () => {
    expect(c(500, "ml", 1)).toBe("500 ml every day");
    expect(c(30, "pc", 7)).toBe("30 pc about once a week");
    expect(c(10000, "g", 24)).toBe("10 kg about every 3 weeks");
    expect(c(1000, "g", 30)).toBe("1 kg about once a month");
    expect(c(400, "g", 2)).toBe("400 g about every 2 days");
    expect(c(400, "g", 3.5)).toBe("400 g about twice a week");
    expect(c(5000, "ml", 14)).toBe("5 l about every 2 weeks");
    expect(c(1, "pc", 60)).toBe("1 pc about every 2 months");
    expect(c(1, "pc", 10)).toBe("1 pc about every 10 days");
  });
  it("a cycle the family stated is said as they said it; with no amount it is how often alone; with no cycle there is none", () => {
    expect(c(30, "pc", 7, true)).toBe("30 pc once a week");
    expect(c(null, null, 7)).toBe("About once a week");
    expect(c(null, "g", 1)).toBe("Every day");
    expect(c(500, "g", null)).toBeNull();
    expect(quantityText(1500, "ml")).toBe("1.5 l");
  });
});

describe("a daily item on the cart by itself", () => {
  const d = (o: Partial<DailyState>): DailyState => ({ group: "daily", lasts_days: 1, run_out: "2026-11-23", last_bought: "2026-11-22", subscription: null, dont_ask: false,
    snoozed_until: null, stated: false, ...o });
  const TODAY = "2026-11-23", TOMORROW = "2026-11-24";
  it("goes on when it runs out by the day, and only a daily item with a cycle", () => {
    expect(dailyDue(d({}), TOMORROW, TODAY)).toBe(true);
    expect(dailyDue(d({ run_out: "2026-11-25" }), TOMORROW, TODAY)).toBe(false);
    expect(dailyDue(d({ group: "few_days" }), TOMORROW, TODAY)).toBe(false);
    expect(dailyDue(d({ lasts_days: null }), TOMORROW, TODAY)).toBe(false);
  });
  it("never a subscribed, left-alone or snoozed one; a snooze holds up to and including its day", () => {
    expect(dailyDue(d({ subscription: "the milkman" }), TOMORROW, TODAY)).toBe(false);
    expect(dailyDue(d({ dont_ask: true }), TOMORROW, TODAY)).toBe(false);
    expect(dailyDue(d({ snoozed_until: TOMORROW }), TOMORROW, TODAY)).toBe(false);
    expect(dailyDue(d({ snoozed_until: TODAY }), TOMORROW, TODAY)).toBe(true);
  });
  it("one never bought goes on only by a stated cycle; a learned cycle stops two weeks after the last purchase, a stated one does not", () => {
    expect(dailyDue(d({ last_bought: null, run_out: null }), TOMORROW, TODAY)).toBe(false);
    expect(dailyDue(d({ last_bought: null, run_out: null, stated: true }), TOMORROW, TODAY)).toBe(true);
    expect(dailyDue(d({ last_bought: "2026-11-09", run_out: "2026-11-10" }), TOMORROW, TODAY)).toBe(true);
    expect(dailyDue(d({ last_bought: "2026-11-08", run_out: "2026-11-09" }), TOMORROW, TODAY)).toBe(false);
    expect(dailyDue(d({ last_bought: "2026-11-08", run_out: "2026-11-09", stated: true }), TOMORROW, TODAY)).toBe(true);
  });
});
