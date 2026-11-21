import { describe, expect, it } from "bun:test";
import { APP_NAMES, SUBSCRIPTION_UNNAMED, TAG_TEXT } from "../../server/db/constants";
import { agentName, cartNote, cookingDaysText, cartTitle, debouncePicks, dishNote, eventRows, forText, itemCallout, itemSubtitle, orderLabel, orderRow, outsideText, pantryTabs,
  mealLines, patternFields, patternSource, pickerItems, profileWaiting, recipeSourceLabel, statusTone, subscriptionTag, syncPicker, TAG_TONES, textList, weekTitle,
  cookDetails, cookVisitsText, linkWeek, plannedText, ruleChip, weekToOpen } from "./format";

describe("mealLines", () => {
  const everyone = ["Shiva", "Agastya", "Meera"];
  it("names each dish once, and under them only what differs from everyone eating it", () => {
    // The live week of 21 Nov, as it is now kept: one idli for the two who eat it, with Shiva's eggs as its note, and Meera's milk.
    expect(mealLines({ dishes: [{ name: "Idli", for_people: ["Agastya", "Shiva"], portion_note: "two eggs for Shiva" }, { name: "Milk", for_people: ["Meera"], portion_note: null }] }, everyone))
      .toEqual({ title: "Idli · Milk", secondary: "Idli: two eggs for Shiva · Milk for Meera" });
    expect(mealLines({ dishes: [{ name: "Dal", for_people: null, portion_note: null }, { name: "Rice" }] }, everyone)).toEqual({ title: "Dal · Rice", secondary: undefined });
  });
  it("a dish for everyone at home by name is for everyone; a dish still kept twice is named once", () => {
    expect(mealLines({ dishes: [{ name: "Aloo paratha", for_people: ["shiva", "Agastya", "Meera"] }] }, everyone)).toEqual({ title: "Aloo paratha", secondary: undefined });
    expect(mealLines({ dishes: [{ name: "Aloo paratha", for_people: ["Agastya"] }, { name: "aloo paratha", for_people: ["Shiva"] }, { name: "Milk", for_people: ["Meera"] }] }, everyone))
      .toEqual({ title: "Aloo paratha · Milk", secondary: "Aloo paratha for Agastya · aloo paratha for Shiva · Milk for Meera" });
  });
  it("says how a dish went last time in one line, only when there is something to say", () => {
    const last = (rating: string, note: string | null) => ({ rating, note, date: "2026-11-16", by: "Ankita" });
    expect(mealLines({ dishes: [{ name: "Bhindi", last_time: last("didnt_work", "too oily") }, { name: "Dal", last_time: last("good", null) },
      { name: "Rajma", last_time: last("didnt_work", null) }] }, everyone))
      .toEqual({ title: "Bhindi · Dal · Rajma", secondary: "Bhindi, last time: too oily · Rajma, last time: didn't work" });
  });
  it("carries the meal's note, and an ordered-in meal says so", () => {
    expect(mealLines({ note: "cook comes late", dishes: [{ name: "Poha" }] }, everyone)).toEqual({ title: "Poha", secondary: "cook comes late" });
    expect(mealLines({ ordered_in: true, note: "pizza night", dishes: [] })).toEqual({ title: "Ordered in", secondary: "pizza night" });
  });
});

describe("profileWaiting", () => {
  it("is true while a profile from the old Meal Planner waits to be turned into the Family page", () => {
    expect(profileWaiting({ profile_to_structure: "2 adults and Agastya (6). Veg on Tuesdays." })).toBe(true);
    expect(profileWaiting({ profile_to_structure: null })).toBe(false);
    expect(profileWaiting({ profile_to_structure: "  " })).toBe(false);
    expect(profileWaiting({})).toBe(false);
  });
});

describe("recipeSourceLabel", () => {
  it("names where a recipe is from", () => {
    expect(recipeSourceLabel({ source: "instagram" })).toBe("Instagram");
    expect(recipeSourceLabel({ source: "youtube" })).toBe("YouTube");
    expect(recipeSourceLabel({ source: "other" })).toBe("Link");
    expect(recipeSourceLabel({ source: null })).toBe("Link");
  });
});

describe("textList", () => {
  it("reads a list kept as text, or already read", () => {
    expect(textList('["a","b"]')).toEqual(["a", "b"]);
    expect(textList(["a"])).toEqual(["a"]);
    expect(textList(null)).toEqual([]);
    expect(textList("{")).toEqual([]);
  });
});

describe("forText", () => {
  it("is the server's own line for a dish", () => {
    expect(forText({ name: "Parathas", for_people: ["Dad"], portion_note: null })).toBe("Parathas (for Dad)");
    expect(forText({ name: "Boiled eggs", for_people: null, portion_note: "4 for me, 1 for wife" })).toBe("Boiled eggs (4 for me, 1 for wife)");
  });

  it("dishNote is what follows the name in it", () => {
    expect(dishNote({ name: "Parathas", for_people: ["Dad"], portion_note: null })).toBe("(for Dad)");
    expect(dishNote({ name: "Boiled eggs", for_people: ["me"], portion_note: "4 for me, 1 for wife" })).toBe("(4 for me, 1 for wife)");
    expect(dishNote({ name: "Rice", for_people: null, portion_note: null })).toBe("");
  });
});

// ── Shopping: the cart per app ──

const line = (o: Record<string, unknown>) => ({ id: "l1", item: "atta", name_on_app: null, pack: null, for_note: null, image: null, price: null, qty: 1, source: "added", ...o }) as any;
const cart = (o: Record<string, unknown> = {}) => ({ order_id: "o1", app: "zepto", app_name: "Zepto", status: "open", lines: [], total: null, delivery_gap: null,
  sync_state: "in_step", synced_at: "2026-11-20T10:00:00.000Z", sync_asked_at: "2026-11-20T09:59:00.000Z", outside_lines: [], building_at_order: false, ...o }) as any;
const NOW = new Date("2026-11-20T10:05:00.000Z");

describe("pickerItems", () => {
  it("is each line as the picker shows it, with the cart's qty, and keeps a running-low line at 0", () => {
    const out = pickerItems([
      line({ id: "a", item: "curd", name_on_app: "Mother Dairy curd", pack: "400 g", for_note: "everyday", image: "https://x/c.jpg", price: 45, qty: 2 }),
      line({ id: "b", item: "atta", name_on_app: "Aashirvaad atta", pack: "10 kg", price: 520, qty: 0, source: "low" }),
      line({ id: "c", item: "bhindi", qty: null }),
    ]);
    expect(out).toEqual([
      { id: "a", name: "Mother Dairy curd", meta: "400 g · everyday", image: "https://x/c.jpg", price: 45, qty: 2 },
      { id: "b", name: "Aashirvaad atta", meta: "10 kg · might be running low", image: undefined, price: 520, qty: 0 },
      { id: "c", name: "bhindi", meta: undefined, image: undefined, price: undefined, qty: 0 },
    ]);
  });
});

describe("orderLabel", () => {
  const lines = [line({ id: "a", price: 45, qty: 2 }), line({ id: "b", price: 520, qty: 0 })];
  it("uses the app's own total when the cart is in step with it", () => {
    expect(orderLabel(cart({ lines, total: 751 }))).toBe("Order on Zepto · ₹751");
  });
  it("adds up the lines when there is no total, or the total is from before an edit", () => {
    expect(orderLabel(cart({ lines }))).toBe("Order on Zepto · ₹90");
    expect(orderLabel(cart({ lines, total: 751, sync_state: "pending" }))).toBe("Order on Zepto · ₹90");
    expect(orderLabel(cart({ app: "bigbasket", app_name: "BigBasket", lines: [line({ price: 1680, qty: 1 })] }))).toBe("Order on BigBasket · ₹1,680");
  });
  it("names no price when what is picked is not all priced", () => {
    expect(orderLabel(cart({ lines: [line({ price: null, qty: 1 })] }))).toBe("Order on Zepto");
    expect(orderLabel(cart({ lines: [line({ price: 40, qty: 1 }), line({ id: "b", price: null, qty: 1 })] }))).toBe("Order on Zepto");
    expect(orderLabel(cart({ lines: [] }))).toBe("Order on Zepto");
  });
});

describe("cartNote", () => {
  it("says how far the cart is from free delivery", () => {
    expect(cartNote(cart({ delivery_gap: 35 }), { now: NOW })).toBe("₹35 short of free delivery");
    expect(cartNote(cart({ delivery_gap: 0 }), { now: NOW })).toBeNull();
    expect(cartNote(cart(), { now: NOW })).toBeNull();
  });
  it("goes by precedence: ordering, waiting, building at order, updating, checking, then the gap", () => {
    const asked = { sync_asked_at: "2026-11-20T10:04:00.000Z" };
    expect(cartNote(cart({ status: "ordering", sync_state: "pending", delivery_gap: 35 }), { now: NOW })).toBe("Ordering…");
    expect(cartNote(cart({ status: "placed", sync_state: "pending", delivery_gap: 35 }), { now: NOW })).toBe("Waiting for payment");
    expect(cartNote(cart({ app: "amazon", app_name: "Amazon Fresh", building_at_order: true, sync_state: "building_at_order", delivery_gap: 35 }), { now: NOW }))
      .toBe("Putting this on Amazon Fresh takes a minute when you order");
    expect(cartNote(cart({ sync_state: "pending", ...asked, delivery_gap: 35 }), { now: NOW })).toBe("Updating your Zepto cart…");
    // An app not signed in to has nothing copied to it: never "updating".
    expect(cartNote(cart({ connected: false, sync_state: "pending", delivery_gap: 35 }), { now: NOW })).toBe("You haven't signed in to Zepto yet");
    expect(cartNote(cart({ ...asked, delivery_gap: 35 }), { now: NOW })).toBe("Checking your Zepto cart…");
  });
  it("stops saying it is checking once the ask is long lost", () => {
    expect(cartNote(cart({ sync_asked_at: "2026-11-20T09:30:00.000Z", synced_at: "2026-11-20T09:00:00.000Z" }), { now: NOW })).toBeNull();
  });
  it("says when the app is still ordering the last cart, and when there is no chat to order from", () => {
    expect(cartNote(cart({ delivery_gap: 35 }), { now: NOW, already: true })).toBe("Zepto is still ordering your last cart");
    expect(cartNote(cart({ delivery_gap: 35 }), { now: NOW, chat: false, agent: "Butler" })).toBe("Ask Butler on WhatsApp to order");
    expect(cartNote(cart({ status: "ordering" }), { now: NOW, chat: false, agent: "Butler" })).toBe("Ordering…");
  });
});

describe("cartTitle and outsideText", () => {
  const shopping = { main: "zepto", fallback: "bigbasket" } as any;
  it("names the fallback app's cart by what it is for", () => {
    expect(cartTitle(cart(), shopping)).toBe("Zepto");
    expect(cartTitle(cart({ app: "bigbasket", app_name: "BigBasket" }), shopping)).toBe("BigBasket · when Zepto doesn't have it");
    expect(cartTitle(cart({ app: "bigbasket", app_name: "BigBasket" }), null)).toBe("BigBasket");
  });
  it("lists what she put in the app's cart herself", () => {
    expect(outsideText([{ name: "Maggi", qty: 2 }, { name: "Lays" }])).toBe("Already in your cart: Maggi ×2, Lays");
    expect(outsideText([])).toBeNull();
  });
});

describe("debouncePicks", () => {
  // A stand-in for setTimeout: runs nothing until told.
  function clock() {
    let n = 0;
    const waiting = new Map<number, { fn: () => void; ms: number }>();
    return { waiting, set: (fn: () => void, ms: number) => { waiting.set(++n, { fn, ms }); return n; }, clear: (h: unknown) => { waiting.delete(h as number); },
      fire: () => { const all = [...waiting.values()]; waiting.clear(); for (const w of all) w.fn(); } };
  }
  it("sends only the last picks of a burst, once per app, after the wait", () => {
    const t = clock(), sent: [string, unknown][] = [];
    const d = debouncePicks((app, picks) => { sent.push([app, picks]); }, 800, t);
    d.change("zepto", [{ line_id: "a", qty: 1 }]);
    d.change("zepto", [{ line_id: "a", qty: 2 }]);
    d.change("bigbasket", [{ line_id: "b", qty: 1 }]);
    d.change("zepto", [{ line_id: "a", qty: 3 }]);
    expect(sent).toEqual([]);
    expect([...t.waiting.values()].map((w) => w.ms)).toEqual([800, 800]);
    t.fire();
    expect(sent).toEqual([["bigbasket", [{ line_id: "b", qty: 1 }]], ["zepto", [{ line_id: "a", qty: 3 }]]]);
  });
  it("flush sends what is waiting at once, and nothing when nothing is", async () => {
    const t = clock(), sent: [string, unknown][] = [];
    const d = debouncePicks((app, picks) => { sent.push([app, picks]); return Promise.resolve("ok"); }, 800, t);
    expect(d.flush("zepto")).toBeUndefined();
    d.change("zepto", [{ line_id: "a", qty: 2 }]);
    expect(await d.flush("zepto")).toBe("ok");
    expect(sent).toEqual([["zepto", [{ line_id: "a", qty: 2 }]]]);
    t.fire();
    expect(sent.length).toBe(1);
    d.change("zepto", [{ line_id: "a", qty: 1 }]);
    d.change("bigbasket", []);
    d.flushAll();
    expect(sent.slice(1)).toEqual([["zepto", [{ line_id: "a", qty: 1 }]], ["bigbasket", []]]);
  });
});

// Final review I2: a qty changed elsewhere reaches the picker; her own taps and their echo never make it again.
describe("syncPicker", () => {
  it("the first read is what the page knows, and makes nothing again", () => {
    expect(syncPicker([{ id: "curd", qty: 1 }, { id: "atta", qty: null }], {}, {})).toEqual({ rekey: false, known: { curd: 1, atta: 0 } });
  });

  it("a qty changed elsewhere (the agent made the curd 2) makes the picker again, once", () => {
    const first = syncPicker([{ id: "curd", qty: 1 }, { id: "bread", qty: 1 }], {}, {});
    const agent = syncPicker([{ id: "curd", qty: 2 }, { id: "bread", qty: 1 }], first.known, {});
    expect(agent).toEqual({ rekey: true, known: { curd: 2, bread: 1 } });
    // Read again (another render): nothing new.
    expect(syncPicker([{ id: "curd", qty: 2 }, { id: "bread", qty: 1 }], agent.known, {}).rekey).toBe(false);
  });

  it("her taps waiting or being saved are left alone; the echo of her save matches what was saved", () => {
    const known = { curd: 1, bread: 1 };
    // She tapped curd to 3: while it waits, an older read of curd at 1 or a server qty of 2 changes nothing.
    expect(syncPicker([{ id: "curd", qty: 1 }, { id: "bread", qty: 1 }], known, { curd: 3 })).toEqual({ rekey: false, known });
    expect(syncPicker([{ id: "curd", qty: 2 }, { id: "bread", qty: 1 }], known, { curd: 3 }).rekey).toBe(false);
    // Saved: the page knows 3, and the server's echo of 3 makes nothing again.
    expect(syncPicker([{ id: "curd", qty: 3 }, { id: "bread", qty: 1 }], { ...known, curd: 3 }, {})).toEqual({ rekey: false, known: { curd: 3, bread: 1 } });
    // Another line changed elsewhere while her tap waits still shows.
    expect(syncPicker([{ id: "curd", qty: 1 }, { id: "bread", qty: 4 }], known, { curd: 3 })).toEqual({ rekey: true, known: { curd: 1, bread: 4 } });
  });

  it("a new line is learned without making the picker again (its line set does that), and known is not changed in place", () => {
    const known = { curd: 1 };
    expect(syncPicker([{ id: "curd", qty: 1 }, { id: "eggs", qty: 2 }], known, {})).toEqual({ rekey: false, known: { curd: 1, eggs: 2 } });
    expect(known).toEqual({ curd: 1 });
  });
});

describe("orderRow", () => {
  it("names the app, the day it was placed, its items and its money, and how it stands", () => {
    const o = cart({ status: "placed", placed_at: "2026-11-21T12:30:00.000Z", total: 751, lines: [line({ qty: 2, price: 45 }), line({ id: "b", qty: 0, price: 9 })] });
    const r = orderRow(o);
    expect(r.title).toBe("Zepto");
    expect(r.meta).toMatch(/^Sat 21 Nov, .+ · 1 item · ₹751$/);
    expect(r.status).toBe("Waiting for payment");
    expect(orderRow(cart({ status: "paid", placed_at: null, updated_at: "2026-11-21T12:30:00.000Z", lines: [line({ qty: 1, price: 40 }), line({ id: "b", qty: 1, price: 10 })] })).meta)
      .toMatch(/^Sat 21 Nov, .+ · 2 items · ₹50$/);
    expect(orderRow(cart({ status: "not_paid" })).status).toBe("Not paid");
    expect(orderRow(cart({ status: "cancelled" })).status).toBe("Cancelled");
  });
});

describe("agentName", () => {
  it("is the agent's name the app was given, else Butler", () => {
    expect(agentName({ agent_name: "Asha" })).toBe("Asha");
    expect(agentName({ agent_name: "  " })).toBe("Butler");
    expect(agentName({})).toBe("Butler");
  });
});

// ── Pantry and the item page ──

describe("pantryTabs and tones", () => {
  it("is All, In stock, Low and Snoozed with their counts", () => {
    expect(pantryTabs({ all: 86, in_stock: 71, low: 3, snoozed: 12 })).toEqual([
      { id: "all", label: "All", count: 86 }, { id: "in_stock", label: "In stock", count: 71 }, { id: "low", label: "Low", count: 3 }, { id: "snoozed", label: "Snoozed", count: 12 }]);
  });
  it("tones each status", () => {
    expect(statusTone("In stock")).toBe("success");
    expect(statusTone("Low")).toBe("warning");
    expect(statusTone("Snoozed")).toBe("info");
    expect(statusTone("Subscription")).toBe("muted");
  });
  it("reads each event's tag, and tones it", () => {
    expect([TAG_TEXT.counted, TAG_TEXT.early_buy, TAG_TEXT.your_answer, TAG_TEXT.one_off]).toEqual(["counted", "early buy", "your answer", "one-off, not counted"]);
    for (const t of Object.values(TAG_TEXT)) expect(TAG_TONES[t]).toBeDefined();
  });
});

describe("the item page", () => {
  const item = { id: "i1", name: "Atta", group: "monthly", status: "Low", run_out: "2026-11-24", snoozed_until: null, product: "Aashirvaad Select Sharbati",
    usual: "10 kg", price: 520, lasts_days: 24, uses: "0.4 kg a day", follows_plan: false } as any;
  it("says its group and usual amount, and why it is low or snoozed", () => {
    expect(itemSubtitle(item)).toBe("Monthly · 10 kg");
    expect(itemSubtitle({ ...item, cycle: "10 kg about every 3 weeks" })).toBe("Monthly · 10 kg about every 3 weeks");
    expect([patternSource(item, 2), patternSource(item, 1), patternSource(item, 0), patternSource({ ...item, cycle_stated: true }, 0)])
      .toEqual(["from the last 2 purchases", "from the last 1 purchase", "nothing counted yet", "as you said"]);
    expect(itemSubtitle({ ...item, group: "few_days", usual: null })).toBe("Every few days");
    expect(itemSubtitle({ ...item, group: null, usual: null })).toBe("");
    expect(itemCallout(item)?.title).toBe("Low · about to run out around Tue 24 Nov");
    expect(itemCallout({ ...item, run_out: null })?.title).toBe("Low");
    expect(itemCallout({ ...item, status: "Snoozed", snoozed_until: "2026-11-27" })?.title).toBe("Snoozed until Fri 27 Nov");
    expect(itemCallout({ ...item, status: "In stock" })).toBeNull();
  });
  it("a subscribed item says who delivers it, and that it is never put in a cart or asked about", () => {
    expect(subscriptionTag("the milkman")).toBe("Subscription · the milkman");
    expect([subscriptionTag(SUBSCRIPTION_UNNAMED), subscriptionTag(null)]).toEqual(["Subscription", "Subscription"]);
    expect(itemCallout({ ...item, status: "Subscription", subscription: "Country Delight" }))
      .toEqual({ tone: "info", icon: "repeat", title: "Subscription · Country Delight", body: "Delivered outside the apps: never put in a cart or asked about." });
  });
  it("lays out her pattern", () => {
    expect(patternFields(item)).toEqual([
      { label: "Usually buys", value: "Aashirvaad Select Sharbati" },
      { label: "Usual amount", value: "10 kg" },
      { label: "Price last time", value: 520, kind: "money" },
      { label: "Lasts about", value: "24 days" },
      { label: "Uses about", value: "0.4 kg a day" },
    ]);
    expect(patternFields({ ...item, lasts_days: 1, follows_plan: true }).slice(3).map((f) => f.value)).toEqual(["1 day", "0.4 kg a day, going by the plan"]);
    expect(patternFields({ ...item, product: null, usual: null, price: null, lasts_days: null, uses: null }).map((f) => f.value)).toEqual([null, null, null, null, null]);
  });
  it("lists the events it learned from by day", () => {
    expect(eventRows([{ what: "Aashirvaad atta, 10 kg", when: "2026-11-01", tag: "counted" }])).toEqual([{ id: "0", what: "Aashirvaad atta, 10 kg", when: "Sun 1 Nov", tag: "counted" }]);
  });
  it("never names the app an item is bought on", () => {
    const names = Object.values(APP_NAMES);
    const texts = [itemSubtitle(item), itemCallout(item)?.title, itemCallout(item)?.body, itemCallout({ ...item, status: "Snoozed", snoozed_until: "2026-11-27" })?.body,
      ...patternFields(item).map((f) => `${f.label} ${f.value}`), ...pantryTabs({ all: 1, in_stock: 1, low: 0, snoozed: 0 }).map((t) => t.label),
      ...eventRows([{ what: "Atta, 10 kg, bought outside the apps", when: "2026-11-01", tag: "your answer" }]).flatMap((r) => [r.what, r.when, r.tag])];
    for (const t of texts) for (const n of names) expect(String(t ?? "")).not.toContain(n);
  });
});

describe("weekTitle", () => {
  it("is the week's dates, Monday to Saturday", () => {
    expect(weekTitle("2026-11-23")).toBe("23 – 28 Nov");
  });
  it("names both months when the week crosses one", () => {
    expect(weekTitle("2026-11-30")).toBe("30 Nov – 5 Dec");
  });
  it("ends on Sunday when Sunday is a cooking day", () => {
    expect(weekTitle("2026-11-23", true)).toBe("23 – 29 Nov");
    expect(weekTitle("2026-11-30", true)).toBe("30 Nov – 6 Dec");
    expect(weekTitle("2026-11-23", false)).toBe("23 – 28 Nov");
  });
});

describe("cookingDaysText", () => {
  it("reads a run of days as a range, with the days off", () => {
    expect(cookingDaysText(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"])).toBe("Mon – Sat (Sunday off)");
    expect(cookingDaysText(["Mon", "Tue", "Wed", "Thu", "Fri"])).toBe("Mon – Fri (Saturday and Sunday off)");
  });
  it("is every day when no day is off", () => {
    expect(cookingDaysText(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"])).toBe("Every day");
  });
  it("lists days that are not a run, in week order", () => {
    expect(cookingDaysText(["Fri", "Mon", "Wed"])).toBe("Mon, Wed, Fri");
    expect(cookingDaysText(["Sat", "Sun"])).toBe("Sat, Sun");
    expect(cookingDaysText([])).toBe("No days");
  });
});

describe("ruleChip", () => {
  it("reads what the rule says, never its opposite; a rule with no days holds in general; an other rule is its note", () => {
    expect(ruleChip({ kind: "no_eggs", days: ["Tue"] })).toEqual({ label: "Tue", value: "No eggs" });
    expect(ruleChip({ kind: "egg", days: ["Thu"] })).toEqual({ label: "Thu", value: "Eggs but no meat" });
    expect(ruleChip({ kind: "veg", days: ["Tue", "Thu"], note: "Nani only" })).toEqual({ label: "Tue, Thu", value: "Vegetarian: Nani only" });
    expect(ruleChip({ kind: "other", days: [], note: "Mostly vegetarian" })).toEqual({ label: "In general", value: "Mostly vegetarian" });
  });
});

describe("cookDetails", () => {
  it("lists only what was said about the cook", () => {
    expect(cookDetails({ cook_makes_well: "dosa", cook_wont_make: "non-veg", cook_time_limit: "a dish or two in the morning", cook_new_recipes: "set_menu" })).toEqual([
      { label: "Makes well", value: "dosa" }, { label: "Doesn't make", value: "non-veg" }, { label: "Cook's time", value: "a dish or two in the morning" },
      { label: "New recipes", value: "Better with familiar dishes" }]);
    expect(cookDetails({ cook_makes_well: null, cook_wont_make: null, cook_time_limit: null, cook_new_recipes: "open" })).toEqual([{ label: "New recipes", value: "Open to new recipes" }]);
  });
});

describe("cookVisitsText", () => {
  it("says each visit, with its meals when they were said", () => {
    expect(cookVisitsText([])).toBeNull();
    expect(cookVisitsText([{ at: "07:30" }])).toBe("comes at 7:30 am");
    expect(cookVisitsText([{ at: "06:00", meals: ["Breakfast", "Lunch"] }, { at: "16:30", meals: ["Dinner"] }])).toBe("comes at 6 am (Breakfast, Lunch) and 4:30 pm (Dinner)");
  });
});

describe("the Week page's week", () => {
  it("says when the week was really planned", () => {
    const at = new Date(2026, 10, 19, 16, 5).toISOString();   // Thursday 19 Nov, 4:05 pm local
    expect(plannedText(at)).toBe("Planned Thu 19 Nov, 4:05 pm");
  });

  it("reads the week a link names, a Monday only", () => {
    expect(linkWeek("#/week?week=2026-11-23")).toBe("2026-11-23");
    expect(linkWeek("#/week")).toBeNull();
    expect(linkWeek("#/week?week=2026-11-24")).toBeNull();
    expect(linkWeek("#/week?week=2026-02-30")).toBeNull();
  });

  it("opens this week, unless nothing is planned in it from today on and the planned week has meals", () => {
    const wk = (dates: Record<string, number>) => ({ days: Object.entries(dates).map(([date, n]) => ({ date, meals: Array(n).fill({}) })) });
    const base = { thisWeek: "2026-11-16", today: "2026-11-22", planned: "2026-11-23" };
    // Sunday: this week's meals are behind, next week's plan is there.
    expect(weekToOpen({ ...base, current: wk({ "2026-11-20": 2, "2026-11-22": 0 }), other: wk({ "2026-11-23": 3 }) })).toBe("2026-11-23");
    // Something still to come this week: this week.
    expect(weekToOpen({ ...base, current: wk({ "2026-11-22": 1 }), other: wk({ "2026-11-23": 3 }) })).toBe("2026-11-16");
    // Nothing planned anywhere: this week. Still loading: wait.
    expect(weekToOpen({ ...base, current: wk({}), other: wk({ "2026-11-23": 0 }) })).toBe("2026-11-16");
    expect(weekToOpen({ ...base, current: null, other: null })).toBeNull();
    expect(weekToOpen({ ...base, current: wk({}), other: null })).toBeNull();
    expect(weekToOpen({ ...base, planned: "2026-11-16", current: null, other: null })).toBe("2026-11-16");
  });
});
