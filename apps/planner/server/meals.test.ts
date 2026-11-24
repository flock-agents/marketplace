// The week as the pages, the reminders and the messages read it (meals.ts): the slot-days of a week by date and planning
// order, their dishes with ingredients, and the closing message and intro of a planned week. The plan itself is written by
// make_plan (lane C) and the change operations (lane D); here it is written straight to the store (testkit plan).
import { describe, it, expect } from "bun:test";
import { boot } from "./testkit";
import { closeWeek } from "./meals";
import { commit, upsertSlot } from "./slotStore";

const MON = "2026-11-23";
const SUNDAY = () => new Date(2026, 10, 22, 11);   // Sunday 22 Nov, the weekly run
const food = (name: string) => ({ name, ingredients: [{ item: name.toLowerCase(), amount: 200, unit: "g" }] });
const day = (date: string, slot: string, ...names: string[]) => ({ date, slot, dishes: names.map(food) });
/** The meal of a week view at a date and slot. */
const mealOf = (week: any, date: string, slot: string) => week.days.find((d: any) => d.date === date).meals.find((m: any) => m.slot === slot);

describe("GET /api/weeks/:week_start", () => {
  it("reads a week for the Week page: seven days, its slot-days in planning order with their dishes, one not cooked at home with none", async () => {
    const { owner, plan, kit } = await boot();
    const empty = await owner("GET", `/api/weeks/${MON}`);
    expect(empty.status).toBe(200);
    expect(empty.body).toMatchObject({ week_start: MON, status: null, planned_at: null });
    expect(empty.body.days.map((d: any) => d.date)).toEqual(["2026-11-23", "2026-11-24", "2026-11-25", "2026-11-26", "2026-11-27", "2026-11-28", "2026-11-29"]);
    commit(kit.db, kit.emitChange, (tx, ch) => upsertSlot(tx, { name: "Kabir's tiffin", kind: "custom", order: 20 }, "app", ch));
    plan([day(MON, "Dinner", "Dal", "Roti"), { ...day(MON, "Lunch", "Rice", "Aloo gobi"), status: "confirmed" }, day(MON, "Kabir's tiffin", "Poha"), day(MON, "Breakfast", "Idli"),
      { date: "2026-11-29", slot: "Dinner", ordered_in: true, note: "pizza night" }]);
    const { body } = await owner("GET", `/api/weeks/${MON}`);
    expect(body.status).toBe("final");
    expect(body.days[0].meals.map((m: any) => m.slot)).toEqual(["Breakfast", "Kabir's tiffin", "Lunch", "Dinner"]);
    expect(mealOf(body, MON, "Lunch")).toMatchObject({ status: "confirmed", ordered_in: false, skip: null, people: [],
      dishes: [{ name: "Rice", for_people: null, portion_note: null, new: false, video: null, last_time: null, ingredients: [{ item: "rice", amount: 200, unit: "g" }] }, { name: "Aloo gobi" }] });
    expect(mealOf(body, "2026-11-29", "Dinner")).toMatchObject({ ordered_in: true, skip: "ordered_in", note: "pizza night", dishes: [] });
    // Another week is another read.
    expect((await owner("GET", "/api/weeks/2026-11-30")).body.status).toBeNull();
  });

  it("refuses a week it cannot read", async () => {
    const { owner } = await boot();
    const bad = await owner("GET", "/api/weeks/next");
    expect(bad.status).toBe(400); expect(bad.body.reason).toContain("YYYY-MM-DD");
    const tue = await owner("GET", "/api/weeks/2026-11-24");
    expect(tue.status).toBe(400); expect(tue.body.reason).toContain("Monday");
  });

  it("the week says when it was planned", async () => {
    const { owner, plan } = await boot({ now: SUNDAY });
    expect((await owner("GET", `/api/weeks/${MON}`)).body.planned_at).toBeNull();
    const before = new Date().toISOString();
    plan([day(MON, "Lunch", "Rajma")]);
    expect((await owner("GET", `/api/weeks/${MON}`)).body.planned_at >= before).toBe(true);
  });
});

describe("a planned week's close", () => {
  it("tells the agent to forward the message as it is, with its one link, the intro once, then stop", async () => {
    const { kit, plan } = await boot({ now: SUNDAY, basePath: "/a/xyz" });
    plan([day(MON, "Lunch", "Rajma", "Rice")]);
    const first = closeWeek(kit.db, MON, "/a/xyz");
    expect(first.message.split("\n").slice(0, 2)).toEqual(["Next week is planned.", "Monday: Rajma, Rice"]);
    expect(first.message).toContain("[Week page](/a/xyz/?flock_scope=app#/week?week=2026-11-23)");
    expect(first.intro).toBeString();
    expect(first.instructions).toBe("Forward message to the family verbatim, word for word, as one message. It already holds the only links they need (the Week page, signed in to this app, and a dish's video when it has one): send no other link, no link of your own, and do not reword it. Then send intro verbatim, once, exactly as given: never paraphrase it, and never send it again. After sending them, end your turn.");
    const again = closeWeek(kit.db, MON, "/a/xyz");
    expect(again.intro).toBeUndefined();
    expect(again.instructions).toBe("Forward message to the family verbatim, word for word, as one message. It already holds the only links they need (the Week page, signed in to this app, and a dish's video when it has one): send no other link, no link of your own, and do not reword it. After sending it, end your turn.");
  });

  it("the intro names what is bought every day on the apps: a subscription's is left out, and with none it names nothing", async () => {
    const { kit, op, plan } = await boot({ now: SUNDAY });
    await op("set_regular", { item: "milk", amount: 1, unit: "L", every: "day" });
    await op("set_subscription", { item: "milk", source: "Country Delight", active: true });
    plan([day(MON, "Lunch", "Rajma")]);
    const r = closeWeek(kit.db, MON, "/a/t");
    expect(r.intro).not.toContain("milk");
    expect(r.intro).toContain("each time I put what is due in the cart and mention anything that may be running low.");
  });

  it("what the plan could not keep is said in the message", async () => {
    const { kit, plan } = await boot({ now: SUNDAY });
    plan([day(MON, "Lunch", "Rajma")]);
    expect(closeWeek(kit.db, MON, "/a/t", ["only 2 lunch dishes known"]).message).toContain("I couldn't keep everything this week: only 2 lunch dishes known.");
  });
});
