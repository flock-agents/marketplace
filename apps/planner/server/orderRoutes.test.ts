// The orders through the agent's operations and the family's edits on the pages: built from a final plan, rebuilt when it
// changes, asked about once (low or out), added to, placed, recorded and cancelled.
import { describe, it, expect, spyOn } from "bun:test";
import { boot } from "./testkit";
import { rebuildScheduledOrders } from "./orders";

const MON = "2026-11-23", SUN = "2026-11-22", TUE = "2026-11-24", WED = "2026-11-25";
const SAT_EVENING = new Date(2026, 10, 21, 18, 5);   // Sat 21 Nov, 18:05: the weekly run
const NOW = "2026-11-21T18:05";

const lunch = { date: MON, slot: "Lunch", dishes: [
  { name: "Rice", ingredients: [{ item: "rice", amount: 400, unit: "g", keeps: "long" }] },
  { name: "Aloo gobi", ingredients: [{ item: "cauliflower", amount: 1, unit: "pc" }, { item: "potato", amount: 500, unit: "g" }] },
  { name: "Sambar", ingredients: [{ item: "toor dal", amount: 200, unit: "g", keeps: "long" }] },
  { name: "Boiled eggs", for: ["me", "wife"], ingredients: [{ item: "eggs", amount: 5, unit: "pc" }] } ] };
const dinner = { date: MON, slot: "Dinner", dishes: [{ name: "Rotis", ingredients: [{ item: "atta", amount: 300, unit: "g", keeps: "long" }] }] };
const tueLunch = { date: TUE, slot: "Lunch", dishes: [
  { name: "Rice", ingredients: [{ item: "Rice", amount: 300, unit: "g", keeps: "long" }] },
  { name: "Onion sabzi", ingredients: [{ item: "onion", amount: 2, unit: "pc" }] } ] };

/** A family with milk every day and two remembered Zepto products, at a time the test can move. */
async function home(at = SAT_EVENING) {
  const clock = { now: at };
  const k = await boot({ now: () => clock.now });
  await k.op("set_regular", { item: "milk", amount: 1, unit: "l", every: "day" });
  await k.op("remember_product", { item: "atta", app: "zepto", product_id: "z-atta", name_on_app: "Aashirvaad Atta 5 kg", pack: "5 kg", pack_amount: 5, pack_unit: "kg", price: 289 });
  await k.op("remember_product", { item: "milk", app: "zepto", product_id: "z-milk", name_on_app: "Amul Taaza 500 ml", pack: "500 ml", price: 29 });
  k.settle();
  const items = (orderId: string): string[] => k.rows("order_lines").filter((l) => l.order_id === orderId).map((l) => l.item);
  const line = (orderId: string, item: string) => k.rows("order_lines").find((l) => l.order_id === orderId && l.item === item);
  const order = (id: string) => k.rows("orders").find((o) => o.id === id);
  return { ...k, clock, items, line, order };
}

/** The same family with the week of Mon 23 Nov planned final on Saturday evening: four orders. */
async function plannedWeek(meals: object[] = [lunch, dinner]) {
  const k = await home();
  const r = await k.op("plan_week", { week_start: MON, mode: "final", meals });
  const [first, second, third, fourth] = r.orders as any[];
  return { ...k, orders: r.orders as any[], first, second, third, fourth };
}

describe("a final plan builds the week's orders", () => {
  it("a final week makes orders: long-life all in the first, fresh by pair, milk per covered day", async () => {
    const { orders, first, second, rows } = await plannedWeek();
    expect(orders.map((o) => [o.covers_from, o.covers_to, o.place_at, o.status])).toEqual([
      [SUN, MON, NOW, "scheduled"], [TUE, WED, `${MON}T18:00`, "scheduled"],
      ["2026-11-26", "2026-11-27", `${WED}T18:00`, "scheduled"], ["2026-11-28", "2026-11-29", "2026-11-27T18:00", "scheduled"]]);
    expect(orders.every((o) => o.app === "zepto" && o.week_start === MON)).toBe(true);
    expect(first.lines.map((l: any) => l.item).sort()).toEqual(["atta", "cauliflower", "eggs", "milk", "potato", "rice", "toor dal"]);
    expect(first.lines.find((l: any) => l.item === "rice")).toMatchObject({ amount: 400, unit: "g", source: "dish", product_id: null, qty: 1, qty_checked: 0 });
    expect(JSON.parse(first.lines.find((l: any) => l.item === "cauliflower").sources)).toMatchObject([{ kind: "dish", label: "Mon 23 Nov lunch: Aloo gobi" }]);
    // 300 g of atta is one 5 kg pack; milk for the two days covered is 2 l, four 500 ml packs.
    expect(first.lines.find((l: any) => l.item === "atta")).toMatchObject({ product_id: "z-atta", name_on_app: "Aashirvaad Atta 5 kg", pack: "5 kg", price: 289, qty: 1, qty_checked: 1 });
    const milk = first.lines.find((l: any) => l.item === "milk");
    expect(milk).toMatchObject({ amount: 2, unit: "l", source: "regular", product_id: "z-milk", qty: 4, qty_checked: 1 });
    expect(JSON.parse(milk.sources)).toMatchObject([{ kind: "regular", label: "Everyday: milk" }]);
    expect(first.total).toBe(289 + 4 * 29);
    // The later orders hold only what their own days need.
    expect(second.lines.map((l: any) => [l.item, l.amount])).toEqual([["milk", 2]]);
    // No order covers a date twice, and at most one order is placed on a date.
    const covered = orders.flatMap((o) => (o.covers_from === o.covers_to ? [o.covers_from] : [o.covers_from, o.covers_to]));
    expect(new Set(covered).size).toBe(covered.length);
    expect(new Set(orders.map((o) => o.place_at.slice(0, 10))).size).toBe(orders.length);
    expect(rows("orders")).toHaveLength(4);
  });

  it("a long-life item needed later in the week is bought once, in the first order; a fresh one in the order covering its day", async () => {
    const { first, second } = await plannedWeek([lunch, dinner, tueLunch]);
    const rice = first.lines.find((l: any) => l.item === "rice");
    expect(rice.amount).toBe(700);
    expect(JSON.parse(rice.sources).map((s: any) => s.label)).toEqual(["Mon 23 Nov lunch: Rice", "Tue 24 Nov lunch: Rice"]);
    expect(first.lines.map((l: any) => l.item)).not.toContain("onion");
    expect(second.lines.map((l: any) => l.item).sort()).toEqual(["milk", "onion"]);
  });

  it("a draft builds nothing, an ordered-in meal needs nothing, and a paused everyday item is left out", async () => {
    const { op, rows } = await home();
    await op("set_regular", { item: "milk", paused_until: MON });
    expect((await op("plan_week", { week_start: MON, mode: "draft", meals: [lunch] })).orders).toBeUndefined();
    expect(rows("orders")).toHaveLength(0);
    const r = await op("plan_week", { week_start: MON, mode: "final", meals: [{ date: MON, slot: "Lunch", ordered_in: true }, dinner] });
    expect(r.orders[0].lines.map((l: any) => l.item)).toEqual(["atta"]);
    expect(r.orders[1].lines.map((l: any) => [l.item, l.amount])).toEqual([["milk", 2]]);
  });

  it("planning again covers nothing twice: a not-paid order keeps its days, a cancelled one gives them back", async () => {
    const { op, first, second, rows } = await plannedWeek();
    expect((await op("plan_week", { week_start: MON, mode: "final", meals: [lunch, dinner] })).orders.map((o: any) => o.id)).toEqual(rows("orders").map((o) => o.id));
    await op("record_order", { order_id: first.id, placed: true, paid: false });
    await op("cancel_order", { order_id: second.id });
    const again = (await op("plan_week", { week_start: MON, mode: "final", meals: [lunch, dinner] })).orders as any[];
    expect(again.map((o) => [o.covers_from, o.covers_to, o.status])).toEqual([
      [SUN, MON, "not_paid"], [TUE, WED, "scheduled"], ["2026-11-26", "2026-11-27", "scheduled"], ["2026-11-28", "2026-11-29", "scheduled"]]);
    // Today's order went out, so the new one for Tue and Wed is placed on Tuesday morning.
    expect(again[1].place_at).toBe(`${TUE}T08:00`);
    expect(again[1].id).not.toBe(second.id);
    expect(rows("orders").find((o) => o.id === second.id).status).toBe("cancelled");
  });

  it("the first order joins a scheduled order placed today, unless the agent was already woken to place it", async () => {
    const { op, rows } = await home();
    const extra = (await op("add_to_order", { item: "paneer" })).order;
    expect(extra).toMatchObject({ place_at: NOW, week_start: null, status: "scheduled" });
    const r = await op("plan_week", { week_start: MON, mode: "final", meals: [lunch, dinner] });
    expect(rows("orders")).toHaveLength(4);
    expect(r.orders[0]).toMatchObject({ id: extra.id, covers_from: SUN, covers_to: MON, week_start: MON });
    expect(r.orders[0].lines.map((l: any) => l.item)).toContain("paneer");
    expect(r.orders[0].lines.map((l: any) => l.item)).toContain("rice");

    const b = await home();
    const woken = (await b.op("add_to_order", { item: "paneer" })).order;
    await b.op("place_order", { order_id: woken.id });
    const s = await b.op("plan_week", { week_start: MON, mode: "final", meals: [lunch, dinner] });
    expect(b.rows("orders")).toHaveLength(5);
    expect(s.orders[0]).toMatchObject({ covers_from: SUN, covers_to: MON, place_at: `${SUN}T08:00` });
    expect(b.items(woken.id)).toEqual(["paneer"]);
  });

  it("when the orders cannot be built the plan stays, the answer is an error, and no order is half made", async () => {
    const { op, rows, kit } = await home();
    kit.sqlite.run("ALTER TABLE order_lines RENAME TO order_lines_gone");
    const logged = spyOn(console, "error").mockImplementation(() => {});   // the server logs what it could not do
    const r = await op("plan_week", { week_start: MON, mode: "final", meals: [lunch, dinner] });
    logged.mockRestore();
    expect(r.status).toBe(500);
    expect(rows("orders")).toHaveLength(0);
    expect(rows("plan_meals").map((m) => m.status)).toEqual(["final", "final"]);
    kit.sqlite.run("ALTER TABLE order_lines_gone RENAME TO order_lines");
    expect((await op("plan_week", { week_start: MON, mode: "final", meals: [lunch, dinner] })).orders).toHaveLength(4);
  });
});

describe("the orders follow the plan", () => {
  it("a change by the agent or by the family on a page rebuilds the scheduled orders, once for a burst", async () => {
    const { op, owner, rows, pending, settle, first, second, line } = await plannedWeek();
    // The final plan built its orders itself: the rebuild its own changes asked for finds nothing to do.
    const before = JSON.stringify(rows("order_lines"));
    settle();
    expect(JSON.stringify(rows("order_lines"))).toBe(before);
    expect(pending()).toBe(false);   // the app's own writes ask for no rebuild

    await op("set_dish", { date: TUE, slot: "Lunch", name: "Onion sabzi", ingredients: [{ item: "onion", amount: 2, unit: "pc" }] });
    await op("set_regular", { item: "curd", amount: 400, unit: "g", every: "day" });
    expect(pending()).toBe(true);
    expect(line(second.id, "onion")).toBeUndefined();   // not before the burst is over
    settle();
    expect(line(second.id, "onion")).toMatchObject({ amount: 2, unit: "pc", source: "dish" });
    expect(line(second.id, "curd")).toMatchObject({ amount: 800, unit: "g", source: "regular" });

    // The family changes an amount on the Week page: the kit's data route, not one of the app's.
    const potato = rows("dish_items").find((i) => i.item === "potato");
    expect((await owner("PATCH", `/api/_data/dish_items/${potato.id}`, { amount: 750 })).status).toBe(200);
    expect(pending()).toBe(true);
    settle();
    expect(line(first.id, "potato").amount).toBe(750);
    // ...and takes an everyday item away.
    const curd = rows("regulars").find((r) => r.item === "curd");
    await owner("DELETE", `/api/_data/regulars/${curd.id}`);
    settle();
    expect(rows("order_lines").filter((l) => l.item === "curd")).toHaveLength(0);
  });

  it("a rebuild keeps a line and the packs set on it while its amount stays, and counts the packs again when it changes", async () => {
    const { op, owner, settle, first, line, kit } = await plannedWeek();
    const milk = line(first.id, "milk"), rice = line(first.id, "rice");
    await owner("PATCH", `/api/_data/order_lines/${milk.id}`, { qty: 6 });
    await owner("PATCH", `/api/_data/order_lines/${rice.id}`, { qty: 2, qty_checked: 1 });
    await op("set_dish", { date: MON, slot: "Dinner", name: "Dal", ingredients: [{ item: "moong dal", amount: 150, unit: "g" }] });
    settle();
    expect(line(first.id, "milk")).toMatchObject({ id: milk.id, qty: 6 });
    expect(line(first.id, "rice")).toMatchObject({ id: rice.id, qty: 2, qty_checked: 1 });
    // A product remembered since is put on the line that had none; the packs follow it.
    await op("remember_product", { item: "rice", app: "zepto", product_id: "z-rice", name_on_app: "India Gate 1 kg", pack: "1 kg", price: 120 });
    rebuildScheduledOrders(kit.db, kit.emitChange);
    expect(line(first.id, "rice")).toMatchObject({ id: rice.id, product_id: "z-rice", qty: 1, qty_checked: 1 });
    // More milk a day: the amount changed, so the packs are counted again.
    await op("set_regular", { item: "milk", amount: 2 });
    settle();
    expect(line(first.id, "milk")).toMatchObject({ id: milk.id, amount: 4, qty: 8 });
  });

  it("a line the family removes from a scheduled order does not come back; undoing the removal brings it back for good", async () => {
    const { owner, settle, second, third, items, order, kit } = await plannedWeek([lunch, dinner, tueLunch]);
    const onion = kit.sqlite.query("SELECT id FROM order_lines WHERE order_id = ? AND item = 'onion'").get(second.id) as { id: string };
    const removed = await owner("DELETE", `/api/_data/order_lines/${onion.id}`);
    expect(removed.status).toBe(200);
    expect(JSON.parse(order(second.id).skipped_items)).toEqual(["onion"]);
    rebuildScheduledOrders(kit.db, kit.emitChange);
    expect(items(second.id)).toEqual(["milk"]);
    expect(items(third.id)).toEqual(["milk"]);   // only the order it was removed from skips it
    expect((await owner("POST", `/api/_data/_changes/${removed.body.changeId}/undo`)).status).toBe(200);
    expect(JSON.parse(order(second.id).skipped_items)).toEqual([]);
    settle(); rebuildScheduledOrders(kit.db, kit.emitChange);
    expect(items(second.id).sort()).toEqual(["milk", "onion"]);
  });

  it("removing a line the family added skips nothing", async () => {
    const { op, owner, second, order } = await plannedWeek();
    const added = await op("add_to_order", { order_id: second.id, item: "onion" });
    await owner("DELETE", `/api/_data/order_lines/${added.line.id}`);
    expect(order(second.id).skipped_items).toBeNull();
  });

  it("re-planning after the first order is placed leaves it and rebuilds the rest, keeping added lines and skips (Review Focus 5)", async () => {
    const { op, owner, first, second, items, line, rows, order } = await plannedWeek([lunch, dinner, tueLunch]);
    await op("add_to_order", { order_id: second.id, item: "paneer", qty: 2 });
    await owner("DELETE", `/api/_data/order_lines/${line(second.id, "milk").id}`);
    await op("place_order", { order_id: first.id });
    await op("record_order", { order_id: first.id, placed: true, total: 640 });
    const placedLines = JSON.stringify(rows("order_lines").filter((l) => l.order_id === first.id));

    // Monday loses its aloo gobi and gains a salad; Tuesday swaps onion for tomato; besan (long-life) is new on Wednesday.
    const r = await op("plan_week", { week_start: MON, mode: "final", meals: [
      { ...lunch, dishes: [lunch.dishes[0], { name: "Salad", ingredients: [{ item: "cucumber", amount: 2, unit: "pc" }] }] }, dinner,
      { date: TUE, slot: "Lunch", dishes: [{ name: "Rice", ingredients: [{ item: "rice", amount: 300, unit: "g", keeps: "long" }] }, { name: "Tomato sabzi", ingredients: [{ item: "tomato", amount: 4, unit: "pc" }] }] },
      { date: WED, slot: "Dinner", dishes: [{ name: "Chilla", ingredients: [{ item: "besan", amount: 250, unit: "g", keeps: "long" }] }] } ] });
    expect(r.orders.map((o: any) => o.id)).toEqual([first.id, second.id, r.orders[2].id, r.orders[3].id]);
    expect(rows("orders")).toHaveLength(4);
    // The placed order is as it was: still the cauliflower, no cucumber.
    expect(JSON.stringify(rows("order_lines").filter((l) => l.order_id === first.id))).toBe(placedLines);
    expect(order(first.id)).toMatchObject({ status: "placed", total: 640 });
    // The next one follows the new plan, keeps the added paneer, and still leaves out the milk the family removed.
    expect(items(second.id).sort()).toEqual(["besan", "paneer", "tomato"]);
    expect(line(second.id, "paneer")).toMatchObject({ source: "added", qty: 2 });
    expect(JSON.parse(order(second.id).skipped_items)).toEqual(["milk"]);
    // Rice is already on the placed order, so the extra for Tuesday is not bought a second time.
    expect(rows("order_lines").filter((l) => l.item.toLowerCase() === "rice")).toHaveLength(1);
  });
});

describe("orders that are being placed, drafts over a planned week, and failures on the way", () => {
  it("a draft with meals is refused over a week that has orders, and writes nothing; a week without orders takes it", async () => {
    const { op, rows, settle, pending, first, second, third, fourth } = await plannedWeek();
    const meals = JSON.stringify(rows("plan_meals")), lines = JSON.stringify(rows("order_lines"));
    settle();
    const r = await op("plan_week", { week_start: MON, mode: "draft", meals: [dinner] });
    expect(r.code).toBe("APP_REFUSED");
    expect(r.error).toBe("this week is already planned and has orders: change a meal with set_meal or set_dish, or send plan_week with mode final and the new meals");
    expect(pending()).toBe(false);
    expect(JSON.stringify(rows("plan_meals"))).toBe(meals);
    expect(JSON.stringify(rows("order_lines"))).toBe(lines);
    // Reading the context in draft mode is not a new plan.
    expect((await op("plan_week", { week_start: MON, mode: "draft" })).context.week_start).toBe(MON);
    // A not-paid order is still an order of the week; with every order cancelled the week can be drafted again.
    await op("record_order", { order_id: first.id, placed: true, paid: false });
    for (const o of [third, fourth]) await op("cancel_order", { order_id: o.id });
    expect((await op("plan_week", { week_start: MON, mode: "draft", meals: [dinner] })).code).toBe("APP_REFUSED");
    await op("cancel_order", { order_id: second.id });
    expect((await op("plan_week", { week_start: MON, mode: "draft", meals: [dinner] })).code).toBe("APP_REFUSED");   // the not-paid one
    // Another week, with no orders, takes a draft.
    expect((await op("plan_week", { week_start: "2026-11-30", mode: "draft", meals: [{ ...dinner, date: "2026-11-30" }] })).week.status).toBe("draft");
  });

  it("making a draft final without meals builds the week's orders and answers with them", async () => {
    const { op, rows } = await home();
    expect((await op("plan_week", { week_start: MON, mode: "draft", meals: [lunch, dinner] })).orders).toBeUndefined();
    expect(rows("orders")).toHaveLength(0);
    const r = await op("plan_week", { week_start: MON, mode: "final" });
    expect(r.week.status).toBe("final");
    expect(r.orders).toHaveLength(4);
    expect(r.orders[0].lines.map((l: any) => l.item).sort()).toEqual(["atta", "cauliflower", "eggs", "milk", "potato", "rice", "toor dal"]);
    expect(rows("orders")).toHaveLength(4);
  });

  it("a week planned in parts builds no order until it is made final, then all of them once", async () => {
    const { op, rows } = await home();
    await op("plan_week", { week_start: MON, mode: "draft", meals: [lunch] });
    await op("plan_week", { week_start: MON, mode: "draft", keep_rest: true, meals: [dinner] });
    await op("plan_week", { week_start: MON, mode: "draft", keep_rest: true, meals: [tueLunch] });
    expect(rows("orders")).toHaveLength(0);
    const r = await op("plan_week", { week_start: MON, mode: "final" });
    expect(r.orders).toHaveLength(4);
    expect(r.orders[0].lines.map((l: any) => l.item).sort()).toEqual(["atta", "cauliflower", "eggs", "milk", "potato", "rice", "toor dal"]);
    expect(r.orders[1].lines.map((l: any) => l.item).sort()).toEqual(["milk", "onion"]);
    expect(rows("orders")).toHaveLength(4);
  });

  it("a week that has orders takes a part with mode final and keep_rest, and still refuses a draft part", async () => {
    const { op, rows, second, items } = await plannedWeek();
    expect((await op("plan_week", { week_start: MON, mode: "draft", keep_rest: true, meals: [tueLunch] })).code).toBe("APP_REFUSED");
    const r = await op("plan_week", { week_start: MON, mode: "final", keep_rest: true, meals: [tueLunch] });
    expect(r.week.days.flatMap((d: any) => d.meals).map((m: any) => `${m.date} ${m.slot}`)).toEqual([`${MON} Lunch`, `${MON} Dinner`, `${TUE} Lunch`]);
    expect(rows("orders")).toHaveLength(4);
    expect(items(second.id).sort()).toEqual(["milk", "onion"]);
  });

  it("an order the agent was woken to place is not rebuilt; recorded not placed, it catches up", async () => {
    const { op, settle, first, second, items } = await plannedWeek();
    await op("place_order", { order_id: first.id });
    const placing = items(first.id).sort();
    // Monday gains a fresh item and the week a long-life one while the first order is being placed.
    await op("set_dish", { date: MON, slot: "Dinner", name: "Salad", ingredients: [{ item: "cucumber", amount: 2, unit: "pc" }, { item: "besan", amount: 250, unit: "g", keeps: "long" }] });
    settle();
    expect(items(first.id).sort()).toEqual(placing);
    // The long-life item goes on the next order; what the order being placed has is not bought again.
    expect(items(second.id).sort()).toEqual(["besan", "milk"]);
    // What is added without naming an order goes on the next one too, and low or out is about it.
    expect((await op("add_to_order", { item: "paneer" })).order.id).toBe(second.id);
    expect((await op("ask_low_or_out", { week_start: MON })).order_id).toBe(second.id);
    const r = await op("record_order", { order_id: first.id, placed: false, note: "Zepto was down" });
    expect(r.order.lines.map((l: any) => l.item).sort()).toEqual(["atta", "besan", "cauliflower", "cucumber", "eggs", "milk", "potato", "rice", "toor dal"]);
    expect(items(second.id).sort()).toEqual(["milk", "paneer"]);
  });

  it("place_order answers with the plan as it stands now, not as it was before the last change", async () => {
    const { op, settle, pending, first, rows } = await plannedWeek();
    settle();
    await op("set_dish", { date: MON, slot: "Dinner", name: "Salad", ingredients: [{ item: "cucumber", amount: 2, unit: "pc" }] });
    await op("set_dish", { date: MON, slot: "Lunch", name: "Aloo gobi", remove: true });
    expect(pending()).toBe(true);
    const p = await op("place_order", { order_id: first.id });
    expect(p.order.lines.map((l: any) => l.item).sort()).toEqual(["atta", "cucumber", "eggs", "milk", "rice", "toor dal"]);
    expect(p.needs_product.map((l: any) => l.item)).toContain("cucumber");
    // The rebuild that was waiting has nothing left to do, and does not touch the order being placed.
    const lines = JSON.stringify(rows("order_lines"));
    settle();
    expect(JSON.stringify(rows("order_lines"))).toBe(lines);
  });

  it("an unpaid order's lines roll into the next order of its own week, before an earlier order of another week", async () => {
    const { op, first, second, items } = await plannedWeek();
    await op("record_order", { order_id: first.id, placed: true });
    const next = (await op("plan_week", { week_start: "2026-11-30", mode: "final", meals: [{ ...dinner, date: "2026-11-30" }] })).orders as any[];
    expect(next[0].place_at > second.place_at).toBe(true);   // the other week's order is the sooner one
    await op("record_order", { order_id: next[0].id, placed: true });
    const r = await op("record_order", { order_id: next[0].id, paid: false });
    expect(r.rolled_into.id).toBe(next[1].id);
    expect(items(second.id)).toEqual(["milk"]);
    // With no order of its own week left, the next one of any week takes them.
    await op("record_order", { order_id: next[1].id, placed: true });
    for (const o of next.slice(2)) await op("cancel_order", { order_id: o.id });
    expect((await op("cancel_order", { order_id: next[1].id })).rolled_into.id).toBe(second.id);
    expect(items(second.id)).toContain("atta");
  });

  it("a failure while noting a removed line does not fail the family's removal, and later removals are still noted", async () => {
    const { owner, second, third, line, order, kit } = await plannedWeek();
    const warned = spyOn(console, "warn").mockImplementation(() => {});
    const lost = line(second.id, "milk");
    kit.sqlite.run("ALTER TABLE orders RENAME TO orders_gone");   // the app cannot read the line's order
    const r = await owner("DELETE", `/api/_data/order_lines/${lost.id}`);
    kit.sqlite.run("ALTER TABLE orders_gone RENAME TO orders");
    expect(r.status).toBe(200);
    expect(warned).toHaveBeenCalledTimes(1);
    warned.mockRestore();
    expect(order(second.id).skipped_items).toBeNull();
    await owner("DELETE", `/api/_data/order_lines/${line(third.id, "milk").id}`);
    expect(JSON.parse(order(third.id).skipped_items)).toEqual(["milk"]);
  });
});

describe("ask_low_or_out", () => {
  it("a list names whole items: toor dal is low, moong dal is at home", async () => {
    const khichdi = { date: MON, slot: "Dinner", dishes: [{ name: "Khichdi", ingredients: [{ item: "moong dal", amount: 150, unit: "g", keeps: "long" }] }] };
    const { op, first, items } = await plannedWeek([lunch, khichdi]);
    expect((await op("ask_low_or_out", { week_start: MON })).items).toEqual(["moong dal", "rice", "toor dal"]);
    const r = await op("ask_low_or_out", { week_start: MON, low_or_out: ["Toor dal"] });
    expect(r.order.skipped_items).toEqual(["moong dal", "rice"]);
    expect(items(first.id)).toContain("toor dal");
    expect(items(first.id)).not.toContain("moong dal");
    // The same words as a sentence name both dals.
    const again = await op("ask_low_or_out", { week_start: MON, low_or_out: "toor dal" });
    expect(again.order.skipped_items).toEqual(["rice"]);
  });

  it("ask_low_or_out lists the week's long-life items and removes what is at home (Review Focus 4)", async () => {
    const { op, first, second, items, order, kit } = await plannedWeek();
    const q = await op("ask_low_or_out", { week_start: MON });
    expect(q).toEqual({ order_id: first.id, items: ["atta", "rice", "toor dal"], question: "Atta, rice, toor dal: any low or out?" });
    const r = await op("ask_low_or_out", { week_start: MON, low_or_out: "ATTA is low" });
    expect(r.order.id).toBe(first.id);
    expect(r.order.lines.map((l: any) => l.item)).toContain("atta");
    expect(r.order.lines.map((l: any) => l.item)).not.toContain("rice");
    expect(r.order.lines.map((l: any) => l.item)).not.toContain("toor dal");
    expect(r.order.skipped_items).toEqual(["rice", "toor dal"]);
    // An item that was not asked about (fresh, or everyday) is never removed.
    expect(r.order.lines.map((l: any) => l.item).sort()).toEqual(["atta", "cauliflower", "eggs", "milk", "potato"]);
    expect(items(second.id)).toEqual(["milk"]);
    // What is at home stays off the order through a rebuild.
    rebuildScheduledOrders(kit.db, kit.emitChange);
    expect(items(first.id).sort()).toEqual(["atta", "cauliflower", "eggs", "milk", "potato"]);
    expect(JSON.parse(order(first.id).skipped_items)).toEqual(["rice", "toor dal"]);
    // Asked again, only what is still on an order is listed.
    expect((await op("ask_low_or_out", { week_start: MON })).question).toBe("Atta: any low or out?");
  });

  it("a later answer brings back an item said to be at home, and a word that names nothing is ignored", async () => {
    const { op, first } = await plannedWeek();
    await op("ask_low_or_out", { week_start: MON, low_or_out: ["atta"] });
    const r = await op("ask_low_or_out", { week_start: MON, low_or_out: "Rice is out too, and ghee, atta" });
    expect(r.order.id).toBe(first.id);
    expect(r.order.lines.map((l: any) => l.item).sort()).toEqual(["atta", "cauliflower", "eggs", "milk", "potato", "rice"]);
    expect(r.order.lines.find((l: any) => l.item === "rice")).toMatchObject({ amount: 400, unit: "g", source: "dish" });
    expect(r.order.skipped_items).toEqual(["toor dal"]);
  });

  it("an answer that names nothing means all of it is at home", async () => {
    const { op } = await plannedWeek();
    const r = await op("ask_low_or_out", { week_start: MON, low_or_out: [] });
    expect(r.order.lines.map((l: any) => l.item).sort()).toEqual(["cauliflower", "eggs", "milk", "potato"]);
    expect(r.order.skipped_items).toEqual(["atta", "rice", "toor dal"]);
    expect(await op("ask_low_or_out", { week_start: MON })).toMatchObject({ items: [], question: null });
  });

  it("an answer after the first order is placed leaves that order alone", async () => {
    const { op, first, second, rows, items, order } = await plannedWeek();
    await op("record_order", { order_id: first.id, placed: true });
    const placedLines = JSON.stringify(rows("order_lines").filter((l) => l.order_id === first.id));
    // The items are still asked about: they are on a live order.
    expect(await op("ask_low_or_out", { week_start: MON })).toMatchObject({ order_id: second.id, items: ["atta", "rice", "toor dal"] });
    const r = await op("ask_low_or_out", { week_start: MON, low_or_out: "atta is low" });
    expect(JSON.stringify(rows("order_lines").filter((l) => l.order_id === first.id))).toBe(placedLines);
    expect(order(first.id)).toMatchObject({ status: "placed", skipped_items: null });
    // The next scheduled order is the one the answer is about: atta is already bought, so nothing is added to it.
    expect(r.order.id).toBe(second.id);
    expect(items(second.id)).toEqual(["milk"]);
    expect(r.order.skipped_items).toEqual(["rice", "toor dal"]);
  });

  it("with no scheduled order left, an item that is out and on no order goes on a new order placed now", async () => {
    const { op, first, second, third, fourth, rows, clock } = await plannedWeek();
    await op("ask_low_or_out", { week_start: MON, low_or_out: "atta" });   // rice and toor dal are at home
    await op("record_order", { order_id: first.id, placed: true });
    for (const o of [second, third, fourth]) await op("cancel_order", { order_id: o.id });
    clock.now = new Date(2026, 10, 22, 9, 30);
    // Atta is on the placed order: naming it again adds nothing.
    expect((await op("ask_low_or_out", { week_start: MON, low_or_out: "atta" })).order).toBeNull();
    expect(rows("orders")).toHaveLength(4);
    const r = await op("ask_low_or_out", { week_start: MON, low_or_out: "we are out of rice after all" });
    expect(r.order).toMatchObject({ place_at: "2026-11-22T09:30", status: "scheduled", app: "zepto" });
    expect(r.order.lines.map((l: any) => [l.item, l.amount, l.unit, l.source])).toEqual([["rice", 400, "g", "added"]]);
    expect(JSON.parse(r.order.lines[0].sources)).toMatchObject([{ kind: "dish", label: "Mon 23 Nov lunch: Rice" }]);
    expect(rows("orders")).toHaveLength(5);
  });

  it("refuses a week or an answer it cannot read", async () => {
    const { op } = await plannedWeek();
    expect((await op("ask_low_or_out", {})).code).toBe("APP_REFUSED");
    expect((await op("ask_low_or_out", { week_start: MON, low_or_out: 3 })).code).toBe("APP_REFUSED");
    expect(await op("ask_low_or_out", { week_start: "2026-11-30" })).toEqual({ order_id: null, items: [], question: null });
  });
});

describe("place_order and record_order", () => {
  it("place_order returns the message and refuses a placed order; record_order returns the intro once", async () => {
    const { op, first, second, order, rows } = await plannedWeek();
    const p = await op("place_order", { order_id: first.id });
    expect(p.message).toMatch(/^Ordering this now: .+, ~₹[\d,]+ on Zepto$/);
    expect(p.message).toContain("Aashirvaad Atta 5 kg"); expect(p.message).toContain("Amul Taaza 500 ml ×4"); expect(p.message).toContain("~₹405 on Zepto");
    expect(p.order.wake_sent_at).toBe(NOW);
    expect(p.needs_product.map((l: any) => l.item).sort()).toEqual(["cauliflower", "eggs", "potato", "rice", "toor dal"]);
    expect(p.needs_qty.map((l: any) => l.item).sort()).toEqual(["cauliflower", "eggs", "potato", "rice", "toor dal"]);
    const rec = await op("record_order", { order_id: first.id, placed: true, total: 640, app_order_ref: "ZP-1" });
    expect(rec.intro).toContain("Your week is planned and Saturday's order is placed.");
    expect(rec.intro).toContain("I check in at 3 pm about dinner and 7 pm about tomorrow");
    expect(rec.order).toMatchObject({ status: "placed", placed_at: NOW, recorded_total: 640, app_order_ref: "ZP-1", paid_at: null });
    expect(rows("house")[0].intro_sent_at).toBeTruthy();
    const again = await op("place_order", { order_id: first.id });
    expect(again.status).toBe(409); expect(again.error).toContain("placed, waiting for payment");
    expect((await op("record_order", { order_id: first.id, placed: true })).status).toBe(409);
    expect((await op("record_order", { order_id: second.id, placed: true })).intro).toBeUndefined();
    expect(order(second.id).status).toBe("placed");
  });

  it("the intro names the times the check-ins really run", async () => {
    const { op, owner, first, kit } = await plannedWeek();
    await owner("GET", "/api/family");
    kit.sqlite.run("UPDATE house SET dinner_check_time = '16:30', tomorrow_check_time = '20:00'");
    const rec = await op("record_order", { order_id: first.id, placed: true });
    expect(rec.intro).toContain("I check in at 4:30 pm about dinner and 8 pm about tomorrow");
  });

  it("a stored time that is not a time of day falls back to the default", async () => {
    const { op, owner, first, kit } = await plannedWeek();
    await owner("GET", "/api/family");
    kit.sqlite.run("UPDATE house SET dinner_check_time = 'hourly', tomorrow_check_time = '20:00'");
    expect((await op("record_order", { order_id: first.id, placed: true })).intro).toContain("I check in at 3 pm about dinner and 8 pm about tomorrow");
  });

  it("an order that was not planned from a week brings no intro", async () => {
    const { op, rows } = await home();
    const extra = (await op("add_to_order", { item: "paneer" })).order;
    expect((await op("record_order", { order_id: extra.id, placed: true })).intro).toBeUndefined();
    expect(rows("house")[0]?.intro_sent_at ?? null).toBeNull();
  });

  it("placed: false keeps the order scheduled with the note, to be tried again an hour later", async () => {
    const { op, first, clock } = await plannedWeek();
    await op("place_order", { order_id: first.id });
    clock.now = new Date(2026, 10, 21, 23, 30);
    const r = await op("record_order", { order_id: first.id, placed: false, note: "Zepto was down" });
    expect(r.order).toMatchObject({ status: "scheduled", note: "Zepto was down", wake_sent_at: null, placed_at: null, place_at: "2026-11-22T00:30" });
    expect(r.intro).toBeUndefined();
    expect((await op("place_order", { order_id: first.id })).message).toContain("Ordering this now");
  });

  it("paid: true closes a placed order as paid; only a placed order is paid or not", async () => {
    const { op, first, second, clock } = await plannedWeek();
    expect((await op("record_order", { order_id: first.id, paid: true })).status).toBe(409);
    await op("record_order", { order_id: first.id, placed: true });
    clock.now = new Date(2026, 10, 21, 18, 20);
    const r = await op("record_order", { order_id: first.id, paid: true, total: 655 });
    expect(r.order).toMatchObject({ status: "paid", placed_at: NOW, paid_at: "2026-11-21T18:20", recorded_total: 655 });
    expect(r.rolled_into).toBeUndefined();
    expect((await op("record_order", { order_id: first.id, paid: false })).status).toBe(409);
    expect((await op("place_order", { order_id: first.id })).status).toBe(409);
    // Placed and paid in one call.
    expect((await op("record_order", { order_id: second.id, placed: true, paid: true })).order).toMatchObject({ status: "paid", placed_at: "2026-11-21T18:20", paid_at: "2026-11-21T18:20" });
  });

  it("refuses what it cannot read, an order that is not there, and an empty order", async () => {
    const { op, first, items, owner, rows } = await plannedWeek();
    expect((await op("record_order", { order_id: first.id })).code).toBe("APP_REFUSED");
    expect((await op("record_order", { order_id: first.id, placed: "yes" })).code).toBe("APP_REFUSED");
    expect((await op("record_order", { order_id: first.id, placed: false, paid: false })).code).toBe("APP_REFUSED");
    expect((await op("record_order", { order_id: first.id, placed: true, total: -1 })).code).toBe("APP_REFUSED");
    expect(rows("orders").find((o) => o.id === first.id).status).toBe("scheduled");
    for (const name of ["place_order", "record_order", "cancel_order"]) {
      expect((await op(name, { placed: true })).code).toBe("APP_REFUSED");
      expect((await op(name, { order_id: "nope", placed: true })).status).toBe(404);
    }
    for (const l of rows("order_lines").filter((x) => x.order_id === first.id)) await owner("DELETE", `/api/_data/order_lines/${l.id}`);
    expect(items(first.id)).toEqual([]);
    const empty = await op("place_order", { order_id: first.id });
    expect(empty.status).toBe(409); expect(empty.error).toContain("nothing on it");
  });
});

describe("an order that is not paid, or cancelled", () => {
  it("paid: false closes the order as not paid and rolls its lines into the next scheduled order", async () => {
    const { op, first, second, items, line, rows, order, kit } = await plannedWeek();
    await op("record_order", { order_id: first.id, placed: true });
    const cauliflower = line(first.id, "cauliflower");
    const r = await op("record_order", { order_id: first.id, paid: false });
    expect(r.order).toMatchObject({ status: "not_paid", lines: [] });
    expect(r.rolled_into.id).toBe(second.id);
    expect(items(second.id).sort()).toEqual(["atta", "cauliflower", "eggs", "milk", "milk", "potato", "rice", "toor dal"]);
    // A rolled line is the same line, now an added one, still saying what it is for.
    expect(line(second.id, "cauliflower")).toMatchObject({ id: cauliflower.id, source: "added", sources: cauliflower.sources, amount: 1, unit: "pc" });
    expect(rows("order_lines").filter((l) => l.order_id === second.id && l.item === "milk").map((l) => l.source).sort()).toEqual(["added", "regular"]);
    // The rolled lines survive a rebuild, and the long-life ones are not bought twice.
    rebuildScheduledOrders(kit.db, kit.emitChange);
    expect(items(second.id).sort()).toEqual(["atta", "cauliflower", "eggs", "milk", "milk", "potato", "rice", "toor dal"]);
    expect(order(second.id)).toMatchObject({ covers_from: TUE, covers_to: WED });
    expect(rows("orders")).toHaveLength(4);
  });

  it("with no scheduled order left, nothing is rolled and no order is made: the lines stay on the order that was not paid", async () => {
    const { op, first, second, third, fourth, rows, clock, items, kit, order } = await plannedWeek();
    await op("record_order", { order_id: first.id, placed: true });
    for (const o of [second, third, fourth]) await op("cancel_order", { order_id: o.id });
    clock.now = new Date(2026, 10, 21, 19, 0);
    const r = await op("record_order", { order_id: first.id, paid: false });
    expect(r.rolled_into).toBeNull();
    expect(r.note).toBe("there is no later order: its items were not moved; tell me if you still want them");
    expect(r.order.status).toBe("not_paid");
    expect(r.order.lines.map((l: any) => l.item).sort()).toEqual(["atta", "cauliflower", "eggs", "milk", "potato", "rice", "toor dal"]);
    expect(r.order.lines.every((l: any) => l.source !== "added")).toBe(true);
    expect(rows("orders")).toHaveLength(4);
    expect(rows("orders").filter((o) => o.status === "scheduled")).toEqual([]);
    rebuildScheduledOrders(kit.db, kit.emitChange);
    expect(items(first.id).sort()).toEqual(["atta", "cauliflower", "eggs", "milk", "potato", "rice", "toor dal"]);
    expect(order(first.id).status).toBe("not_paid");
  });

  it("cancelling a placed order with no later order makes none either, and says so; with a later one there is no note", async () => {
    const { op, first, second, third, fourth, rows, items } = await plannedWeek();
    await op("record_order", { order_id: first.id, placed: true });
    await op("record_order", { order_id: second.id, placed: true });
    const rolled = await op("cancel_order", { order_id: first.id });
    expect(rolled.rolled_into.id).toBe(third.id);
    expect(rolled.note).toBeUndefined();
    for (const o of [third, fourth]) await op("cancel_order", { order_id: o.id });
    const r = await op("cancel_order", { order_id: second.id });
    expect(r.order.status).toBe("not_paid");
    expect(r.rolled_into).toBeNull();
    expect(r.note).toBe("there is no later order: its items were not moved; tell me if you still want them");
    expect(items(second.id).sort()).toEqual(["milk"]);
    expect(rows("orders")).toHaveLength(4);
    const again = await op("cancel_order", { order_id: second.id });
    expect(again.status).toBe(409); expect(again.error).toBe("this order is already closed as not paid");
  });

  it("cancel_order cancels a scheduled order; a placed one is not paid and rolls on; the rest are refused", async () => {
    const { op, first, second, third, items, order } = await plannedWeek();
    const c = await op("cancel_order", { order_id: third.id });
    expect(c.order.status).toBe("cancelled"); expect(c.rolled_into).toBeUndefined();
    const twice = await op("cancel_order", { order_id: third.id });
    expect(twice.status).toBe(409); expect(twice.error).toContain("already cancelled");

    await op("record_order", { order_id: first.id, placed: true });
    const r = await op("cancel_order", { order_id: first.id });
    expect(r.order).toMatchObject({ status: "not_paid", lines: [] });
    expect(r.rolled_into.id).toBe(second.id);
    expect(items(second.id)).toContain("cauliflower");
    const notPaid = await op("cancel_order", { order_id: first.id });
    expect(notPaid.status).toBe(409); expect(notPaid.error).toContain("not paid");

    await op("record_order", { order_id: second.id, placed: true, paid: true });
    const paid = await op("cancel_order", { order_id: second.id });
    expect(paid.status).toBe(409); expect(paid.error).toBe("a paid order can't be cancelled here; cancel it in Zepto");
    expect(order(second.id).status).toBe("paid");
  });
});

describe("GET /api/orders", () => {
  it("lists the orders with their lines, the newest first, each with its estimate and the amount recorded", async () => {
    const { op, owner, first, second, third, fourth } = await plannedWeek();
    await op("record_order", { order_id: first.id, placed: true, total: 512 });
    await op("cancel_order", { order_id: third.id });
    const { status, body } = await owner("GET", "/api/orders");
    expect(status).toBe(200);
    expect(body.orders.map((o: any) => o.id)).toEqual([fourth.id, third.id, second.id, first.id]);
    expect(body.orders.map((o: any) => o.status)).toEqual(["scheduled", "cancelled", "scheduled", "placed"]);
    const placed = body.orders[3];
    expect(placed.lines.map((l: any) => l.item).sort()).toEqual(["atta", "cauliflower", "eggs", "milk", "potato", "rice", "toor dal"]);
    // The estimate adds up the lines that have a price; the amount recorded is what the grocery app charged.
    expect(placed.recorded_total).toBe(512);
    expect(placed.total).toBe(placed.lines.reduce((sum: number, l: any) => sum + (l.price == null ? 0 : (l.qty ?? 1) * l.price), 0));
    expect(placed.total).toBeGreaterThan(0);
    expect(body.orders[0].recorded_total).toBeNull();
    expect(Array.isArray(body.orders[0].skipped_items)).toBe(true);
  });

  it("from leaves out the orders placed before that day, and a from that is not a date is refused", async () => {
    const { owner, first, second, third, fourth } = await plannedWeek();
    expect((await owner("GET", `/api/orders?from=${MON}`)).body.orders.map((o: any) => o.id)).toEqual([fourth.id, third.id, second.id]);
    expect((await owner("GET", "/api/orders?from=2026-11-21")).body.orders.map((o: any) => o.id)).toEqual([fourth.id, third.id, second.id, first.id]);
    expect((await owner("GET", "/api/orders?from=2026-12-01")).body.orders).toEqual([]);
    const bad = await owner("GET", "/api/orders?from=last-week");
    expect(bad.status).toBe(400); expect(bad.body.reason).toContain("YYYY-MM-DD");
  });

  it("an owner's change to a line's packs on the page is kept as checked", async () => {
    const { owner, first, line } = await plannedWeek();
    const eggs = line(first.id, "eggs");
    expect(eggs.qty_checked).toBe(0);
    expect((await owner("PATCH", `/api/_data/order_lines/${eggs.id}`, { qty: 2, qty_checked: 1 })).status).toBe(200);
    const read = (await owner("GET", "/api/orders")).body.orders.find((o: any) => o.id === first.id).lines.find((l: any) => l.id === eggs.id);
    expect(read).toMatchObject({ qty: 2, qty_checked: 1 });
  });
});

describe("add_to_order", () => {
  it("an item already on the order has its line set, not a second line: product, packs, checked; what it is for stays", async () => {
    const { op, first, rows, line, items } = await plannedWeek();
    // The order is being placed: this is when the agent fills the lines place_order listed.
    const placing = await op("place_order", { order_id: first.id });
    expect(placing.needs_product.map((l: any) => l.item)).toContain("rice");
    const rice = line(first.id, "rice"), count = items(first.id).length;
    const r = await op("add_to_order", { order_id: first.id, item: " Rice ", qty: 2, product_id: "z-rice", name_on_app: "India Gate Rice 1 kg", pack: "1 kg", price: 120, image: "https://img/r.jpg" });
    expect(r.line).toMatchObject({ id: rice.id, item: "rice", amount: 400, unit: "g", qty: 2, qty_checked: 1, source: "dish", sources: rice.sources,
      product_id: "z-rice", name_on_app: "India Gate Rice 1 kg", pack: "1 kg", price: 120, image: "https://img/r.jpg", updated_by: "agent:meal-agent" });
    expect(items(first.id)).toHaveLength(count);
    expect(rows("products").find((p) => p.item === "rice")).toMatchObject({ app: "zepto", product_id: "z-rice", pack_amount: 1, pack_unit: "kg" });
    // Packs alone: the line keeps its product. Nothing sent but the item: the line is left as it is.
    expect((await op("add_to_order", { order_id: first.id, item: "milk", qty: 5 })).line).toMatchObject({ id: line(first.id, "milk").id, qty: 5, qty_checked: 1, product_id: "z-milk", source: "regular" });
    expect((await op("add_to_order", { order_id: first.id, item: "milk" })).line).toMatchObject({ qty: 5, qty_checked: 1 });
    expect(items(first.id)).toHaveLength(count);
    // A line with no product takes the one remembered for its item, and an item not on the order is still an added line.
    await op("remember_product", { item: "potato", app: "zepto", product_id: "z-aloo", name_on_app: "Potato 1 kg", pack: "1 kg", price: 40 });
    expect((await op("add_to_order", { order_id: first.id, item: "potato" })).line).toMatchObject({ id: line(first.id, "potato").id, product_id: "z-aloo", price: 40, qty: 1, qty_checked: 1 });
    expect((await op("add_to_order", { order_id: first.id, item: "coriander" })).line).toMatchObject({ source: "added", qty: 1 });
    expect(items(first.id)).toHaveLength(count + 1);
  });

  it("a product with no qty: the packs are worked out from its pack size, or the line stays unchecked at the number it had", async () => {
    const { op, first, line } = await plannedWeek();
    expect(line(first.id, "rice")).toMatchObject({ amount: 400, unit: "g", qty: 1, qty_checked: 0 });
    // 400 g of rice in 250 g packs is 2 packs.
    expect((await op("add_to_order", { order_id: first.id, item: "rice", product_id: "z-rice", name_on_app: "Rice 250 g", pack: "250 g" })).line).toMatchObject({ qty: 2, qty_checked: 1, product_id: "z-rice" });
    // 500 g of potato against "1 bag" cannot be worked out: the product is on the line, the packs still to set.
    expect((await op("add_to_order", { order_id: first.id, item: "potato", product_id: "z-aloo", name_on_app: "Potato bag", pack: "1 bag" })).line).toMatchObject({ qty: 1, qty_checked: 0, product_id: "z-aloo" });
    expect((await op("add_to_order", { order_id: first.id, item: "potato", qty: 2 })).line).toMatchObject({ qty: 2, qty_checked: 1, product_id: "z-aloo" });
    // A line checked before stays checked when its product changes and the packs cannot be worked out.
    expect((await op("add_to_order", { order_id: first.id, item: "potato", product_id: "z-aloo2", name_on_app: "Potato sack", pack: "1 sack" })).line).toMatchObject({ qty: 2, qty_checked: 1, product_id: "z-aloo2" });
  });

  it("an order being placed is changed only when it is named", async () => {
    const { op, first, second, line, order } = await plannedWeek([lunch, dinner, tueLunch]);
    await op("place_order", { order_id: first.id });
    // Not named: the item is looked for, and put, on the orders that are not being placed.
    expect((await op("add_to_order", { item: "potato", remove: true })).status).toBe(404);
    expect((await op("add_to_order", { item: "potato", qty: 3 })).order.id).toBe(second.id);
    expect(line(first.id, "potato")).toMatchObject({ qty: 1, source: "dish" });
    // Named: the line comes off the order being placed, and the order remembers they have it.
    const r = await op("add_to_order", { order_id: first.id, item: "potato", remove: true });
    expect(r.removed.order_id).toBe(first.id);
    expect(line(first.id, "potato")).toBeUndefined();
    expect(JSON.parse(order(first.id).skipped_items)).toEqual(["potato"]);
  });

  it("an order that is placed, paid, not paid or cancelled refuses a line set, a removal and a new line, each saying why", async () => {
    const closed: Record<string, (k: any) => Promise<unknown>> = {
      "placed, waiting for payment": (k) => k.op("record_order", { order_id: k.first.id, placed: true }),
      paid: (k) => k.op("record_order", { order_id: k.first.id, placed: true, paid: true }),
      "not paid": async (k) => { await k.op("record_order", { order_id: k.first.id, placed: true }); await k.op("record_order", { order_id: k.first.id, paid: false }); },
      cancelled: (k) => k.op("cancel_order", { order_id: k.first.id }),
    };
    for (const [status, close] of Object.entries(closed)) {
      const k = await plannedWeek();
      await k.op("add_to_order", { order_id: k.first.id, item: "paneer" });
      await close(k);
      const before = JSON.stringify(k.rows("order_lines"));
      const set = await k.op("add_to_order", { order_id: k.first.id, item: "paneer", qty: 3 });
      const remove = await k.op("add_to_order", { order_id: k.first.id, item: "paneer", remove: true });
      const add = await k.op("add_to_order", { order_id: k.first.id, item: "saffron" });
      for (const r of [set, remove, add]) { expect(r.status, status).toBe(409); expect(r.error, status).toContain(`that order is ${status}`); }
      expect(remove.error).toContain("nothing is taken off it");
      expect(remove.error).not.toContain("next order");
      expect(set.error).toContain("its lines no longer change; leave order_id out and paneer goes on the next order");
      expect(add.error).toContain("leave order_id out and saffron goes on the next order");
      expect(JSON.stringify(k.rows("order_lines")), status).toBe(before);
    }
  });

  it("the unit, when given, says which of an item's two lines is meant", async () => {
    const { op, first, rows } = await plannedWeek([{ date: MON, slot: "Lunch", dishes: [
      { name: "Sabzi", ingredients: [{ item: "onion", amount: 2, unit: "pc" }] }, { name: "Raita", ingredients: [{ item: "onion", amount: 100, unit: "g" }] }] }]);
    const grams = rows("order_lines").find((l) => l.order_id === first.id && l.item === "onion" && l.unit === "g");
    const r = await op("add_to_order", { order_id: first.id, item: "onion", unit: "G", qty: 3 });
    expect(r.line).toMatchObject({ id: grams.id, unit: "g", qty: 3 });
    expect(r.order.lines.filter((l: any) => l.item === "onion")).toHaveLength(2);
  });

  it("remove takes the line off a scheduled order and remembers the item as one they have, through a rebuild", async () => {
    const { op, first, second, line, order, kit, settle } = await plannedWeek();
    const r = await op("add_to_order", { order_id: second.id, item: "Milk", remove: true });
    expect(r.removed).toMatchObject({ item: "milk", order_id: second.id });
    expect(r.order.lines.map((l: any) => l.item)).not.toContain("milk");
    expect(JSON.parse(order(second.id).skipped_items)).toEqual(["milk"]);
    settle(); rebuildScheduledOrders(kit.db, kit.emitChange);
    expect(line(second.id, "milk")).toBeUndefined();
    // Without an order named: the soonest scheduled order that has it.
    expect((await op("add_to_order", { item: "potato", remove: true })).order.id).toBe(first.id);
    expect(JSON.parse(order(first.id).skipped_items)).toEqual(["potato"]);
    // A line the family added is just taken off: nothing is remembered about it.
    await op("add_to_order", { order_id: second.id, item: "paneer" });
    await op("add_to_order", { order_id: second.id, item: "paneer", remove: true });
    expect(line(second.id, "paneer")).toBeUndefined();
    expect(JSON.parse(order(second.id).skipped_items)).toEqual(["milk"]);
    // Not there: said so.
    const none = await op("add_to_order", { item: "saffron", remove: true });
    expect(none.status).toBe(404); expect(none.error).toContain("saffron");
    expect((await op("add_to_order", { item: "milk", remove: "yes" })).code).toBe("APP_REFUSED");
  });

  it("a line of an order that is placed is neither set nor removed", async () => {
    const { op, first, rows } = await plannedWeek();
    await op("record_order", { order_id: first.id, placed: true });
    const before = JSON.stringify(rows("order_lines").filter((l) => l.order_id === first.id));
    expect((await op("add_to_order", { order_id: first.id, item: "rice", qty: 3 })).status).toBe(409);
    expect((await op("add_to_order", { order_id: first.id, item: "rice", remove: true })).status).toBe(409);
    expect(JSON.stringify(rows("order_lines").filter((l) => l.order_id === first.id))).toBe(before);
    // With no order named, the item is looked for on the scheduled orders only.
    expect((await op("add_to_order", { item: "rice", remove: true })).status).toBe(404);
  });

  it("add_to_order with no order_id goes to the next scheduled order and remembers the product", async () => {
    const { op, first, second, rows, line } = await plannedWeek();
    const r = await op("add_to_order", { item: "Paneer", qty: 2, product_id: 4411, name_on_app: "Milky Mist Paneer 200 g", pack: "200 g", price: 95, image: "https://img/p.jpg" });
    expect(r.order.id).toBe(first.id);
    expect(r.line).toMatchObject({ order_id: first.id, item: "Paneer", qty: 2, qty_checked: 1, source: "added", sources: null,
      product_id: "4411", name_on_app: "Milky Mist Paneer 200 g", pack: "200 g", price: 95, image: "https://img/p.jpg" });
    expect(r.order.total).toBe(405 + 190);
    // Remembered under the line's item, so the next order that needs paneer has its product.
    expect(rows("products").find((p) => p.item === "paneer")).toMatchObject({ app: "zepto", product_id: "4411", pack_amount: 200, pack_unit: "g", price: 95 });
    // Once the first order is placed, the next scheduled one takes what is added; the remembered product comes with it.
    await op("record_order", { order_id: first.id, placed: true });
    const next = await op("add_to_order", { item: "paneer" });
    expect(next.order.id).toBe(second.id);
    expect(next.line).toMatchObject({ qty: 1, qty_checked: 0, product_id: "4411", price: 95 });
    expect(line(second.id, "paneer")).toBeDefined();
  });

  it("goes on the order named while it is scheduled, and is refused on one that is not", async () => {
    const { op, first, third } = await plannedWeek();
    const r = await op("add_to_order", { order_id: third.id, item: "coriander" });
    expect(r.order.id).toBe(third.id);
    expect(r.line).toMatchObject({ item: "coriander", qty: 1, qty_checked: 0, product_id: null, source: "added" });
    await op("record_order", { order_id: first.id, placed: true });
    const refused = await op("add_to_order", { order_id: first.id, item: "coriander" });
    expect(refused.status).toBe(409); expect(refused.error).toContain("placed, waiting for payment");
    expect((await op("add_to_order", { order_id: "nope", item: "coriander" })).status).toBe(404);
  });

  it("with no order waiting, a new order placed now takes it", async () => {
    const { op, rows } = await home(new Date(2026, 10, 24, 11, 15));
    const r = await op("add_to_order", { item: "coriander" });
    expect(r.order).toMatchObject({ place_at: "2026-11-24T11:15", status: "scheduled", app: "zepto", week_start: null });
    expect(r.order.lines).toHaveLength(1);
    expect((await op("add_to_order", { item: "mint" })).order.id).toBe(r.order.id);
    expect(rows("orders")).toHaveLength(1);
  });

  it("refuses an item with no name, a quantity that is not a whole number, and a product without its name", async () => {
    const { op, rows } = await plannedWeek();
    const lines = rows("order_lines").length;
    expect((await op("add_to_order", {})).code).toBe("APP_REFUSED");
    expect((await op("add_to_order", { item: "paneer", qty: 1.5 })).code).toBe("APP_REFUSED");
    expect((await op("add_to_order", { item: "paneer", qty: 0 })).code).toBe("APP_REFUSED");
    expect((await op("add_to_order", { item: "paneer", product_id: "4411" })).code).toBe("APP_REFUSED");
    expect(rows("order_lines")).toHaveLength(lines);
    expect(rows("products").find((p) => p.item === "paneer")).toBeUndefined();
  });
});

describe("a rebuild that fails", () => {
  it("is logged and leaves the orders as they were; the next change tries again", async () => {
    const { op, settle, second, items, kit } = await plannedWeek();
    const warned = spyOn(console, "warn").mockImplementation(() => {});
    await op("set_dish", { date: TUE, slot: "Lunch", name: "Onion sabzi", ingredients: [{ item: "onion", amount: 2, unit: "pc" }] });
    kit.sqlite.run("ALTER TABLE order_lines RENAME TO order_lines_gone");
    settle();
    expect(warned).toHaveBeenCalledTimes(1);
    warned.mockRestore();
    kit.sqlite.run("ALTER TABLE order_lines_gone RENAME TO order_lines");
    expect(items(second.id)).toEqual(["milk"]);
    await op("set_regular", { item: "curd", amount: 400, unit: "g", every: "day" });
    settle();
    expect(items(second.id).sort()).toEqual(["curd", "milk", "onion"]);
  });
});
