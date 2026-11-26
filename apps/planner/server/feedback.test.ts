// What the family says about planned dishes (feedback.ts, plan_feedback): every record_feedback answer, rating and swap is
// kept; a dish turned down twice comes back once as `proposed_rule`, and its call keeps the dish out of the plan.
import { describe, it, expect } from "bun:test";
import { boot } from "./testkit";
import { listLibrary } from "./slotStore";

const now = () => new Date(2026, 10, 28, 11, 0);
const SAT = "2026-11-28", SUN = "2026-11-29";
/** A dish of the plate that is not its staple (the roti or rice that comes every day). */
const notStaple = (x: string) => !["Phulka", "Steamed rice"].includes(x);

async function planned() {
  const k = await boot({ now });
  await k.op("set_person", { name: "Riya", group: "adult", diet: "veg", allergies: "none" });
  await k.op("set_person", { name: "Arjun", group: "adult", diet: "veg" });
  await k.op("make_plan", { from: SAT, days: 2 });
  const day = (date: string, slot: string) => (k.rows("slot_days") as any[]).find((d) => d.date === date && d.slot === slot);
  const dishesAt = (date: string, slot: string) => (k.rows("slot_dishes") as any[]).filter((x) => x.slot_day_id === day(date, slot)?.id).map((x) => x.dish as string);
  return { ...k, dishesAt };
}

describe("plan_feedback", () => {
  it("record_feedback, rate_dishes and a swap with set_slot_day each keep a row", async () => {
    const k = await planned();
    const [lunch] = k.dishesAt(SAT, "Lunch").filter(notStaple);
    const [dinner] = k.dishesAt(SAT, "Dinner").filter(notStaple);
    await k.op("record_feedback", { date: SAT, slot: "Lunch", dish: lunch, made: true, liked: true, again: true, who: "Riya", quote: "loved it" });
    await k.op("rate_dishes", { ratings: [{ dish: dinner, rating: "didnt_work", note: "too oily", said_by: "Arjun" }] });
    const sunday = k.dishesAt(SUN, "Lunch");
    await k.op("set_slot_day", { date: SUN, slot: "Lunch", dishes: ["Rajma chawal"] });
    const rows = (k.rows("plan_feedback") as any[]).map((r) => ({ date: r.date, slot: r.slot, dish: r.dish, action: r.action, to: r.to, who: r.who, quote: r.quote }));
    expect(rows).toEqual([
      { date: SAT, slot: "Lunch", dish: lunch, action: "liked", to: null, who: "Riya", quote: "loved it" },
      { date: SAT, slot: null, dish: dinner, action: "disliked", to: null, who: "Arjun", quote: "too oily" },
      ...sunday.map((dish) => ({ date: SUN, slot: "Lunch", dish, action: "swapped_to", to: "Rajma chawal", who: null, quote: null })),
    ]);
  });

  it("an okay rating says neither way and keeps no row", async () => {
    const k = await planned();
    await k.op("rate_dishes", { ratings: [{ dish: k.dishesAt(SAT, "Lunch")[0], rating: "okay" }] });
    expect(k.rows("plan_feedback")).toEqual([]);
  });

  it("a dish turned down twice is proposed once, and its call keeps it out of the plan", async () => {
    const k = await planned();
    const dish = k.dishesAt(SAT, "Dinner").find(notStaple)!;
    const first = await k.op("rate_dishes", { ratings: [{ dish, rating: "didnt_work", said_by: "Arjun" }] });
    expect(first.proposed_rule).toBeUndefined();
    const second = await k.op("rate_dishes", { date: "2026-11-27", ratings: [{ dish, rating: "didnt_work", said_by: "Arjun" }] });
    expect(second.proposed_rule).toEqual({ dish, times: 2, who: "Arjun", say: `Arjun didn't like ${dish} twice. Should I stop planning it?`, op: "rate_dishes",
      body: { ratings: [{ dish, rating: "didnt_work", again: false, said_by: "Arjun" }] } });
    // Asked once: a third time does not propose it again.
    const third = await k.op("rate_dishes", { date: "2026-11-26", ratings: [{ dish, rating: "didnt_work", said_by: "Arjun" }] });
    expect(third.proposed_rule).toBeUndefined();
    // The family said yes: the proposal's own call.
    const yes = await k.op(second.proposed_rule.op, second.proposed_rule.body);
    expect(yes.dishes[0].name).toBe(dish);
    expect(listLibrary(k.kit.db, { names: [dish] }).every((r) => r.disliked)).toBe(true);
    expect((k.rows("plan_feedback") as any[]).at(-1).action).toBe("never");
    await k.op("make_plan", { from: SAT, days: 7, keep_edited: false });
    expect((k.rows("slot_dishes") as any[]).map((x) => x.dish)).not.toContain(dish);
  });

  it("two swaps of the same dish by different people are proposed for the whole family", async () => {
    const k = await planned();
    const dish = k.dishesAt(SAT, "Lunch").find(notStaple)!;
    await k.op("record_feedback", { date: SAT, slot: "Lunch", dish, answer: "dont_like", who: "Riya" });
    expect((k.rows("plan_feedback") as any[]).map((r) => r.action)).toEqual(["never"]);
    const k2 = await planned();
    const d2 = k2.dishesAt(SAT, "Dinner").find(notStaple)!;
    await k2.op("set_slot_day", { date: SAT, slot: "Dinner", dishes: ["Khichdi"] });
    const r = await k2.op("rate_dishes", { ratings: [{ dish: d2, rating: "didnt_work", said_by: "Riya" }] });
    expect(r.proposed_rule).toMatchObject({ dish: d2, times: 2, who: null, say: `You turned down ${d2} twice. Should I stop planning it?` });
  });
});
