import { describe, expect, it } from "bun:test";
import { APP_NAMES, TAG_TEXT } from "../../server/db/constants";
import { agentName, cartNote, cookingDaysText, cartTitle, debouncePicks, dishNote, eventRows, forText, itemCallout, itemSubtitle, orderLabel, orderRow, outsideText, pantryTabs,
  patternFields, pausedNow, pickerItems, profileWaiting, recipeSourceLabel, regularText, statusTone, TAG_TONES, textList, weekTitle } from "./format";

describe("regularText", () => {
  it("says how much and how often", () => {
    expect(regularText({ amount: 1, unit: "l", every: "day" } as any)).toBe("1 l a day");
    expect(regularText({ amount: 1, unit: "pack", every: "week", times_per_week: 2 } as any)).toBe("1 pack twice a week");
    expect(regularText({ amount: 6, unit: null, every: "week", times_per_week: 1 } as any)).toBe("6 a week");
    expect(regularText({ amount: 2, unit: "pc", every: "week", times_per_week: 3 } as any)).toBe("2 pc 3 times a week");
    expect(regularText({ amount: 1, unit: "pack", every: "week" } as any)).toBe("1 pack a week");
  });

  it("names the weekdays, and the day a pause ends", () => {
    expect(regularText({ amount: 500, unit: "g", every: "weekdays", weekdays: '["Mon","Wed","Fri"]', paused_until: "2026-11-29" } as any)).toBe("500 g on Mon, Wed, Fri · paused until Sun 29 Nov");
    expect(regularText({ amount: 500, unit: "g", every: "weekdays", weekdays: ["Mon"] } as any)).toBe("500 g on Mon");
  });

  it("leaves out a pause that is over", () => {
    const r = { amount: 1, unit: "l", every: "day", paused_until: "2026-11-29" } as any;
    expect(regularText(r, "2026-11-29")).toBe("1 l a day · paused until Sun 29 Nov");
    expect(regularText(r, "2026-11-30")).toBe("1 l a day");
    expect(pausedNow(r, "2026-11-29")).toBe(true);
    expect(pausedNow(r, "2026-11-30")).toBe(false);
    expect(pausedNow({ paused_until: null }, "2026-11-30")).toBe(false);
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
    expect(itemSubtitle({ ...item, group: "few_days", usual: null })).toBe("Every few days");
    expect(itemSubtitle({ ...item, group: null, usual: null })).toBe("");
    expect(itemCallout(item)?.title).toBe("Low · about to run out around Tue 24 Nov");
    expect(itemCallout({ ...item, run_out: null })?.title).toBe("Low");
    expect(itemCallout({ ...item, status: "Snoozed", snoozed_until: "2026-11-27" })?.title).toBe("Snoozed until Fri 27 Nov");
    expect(itemCallout({ ...item, status: "In stock" })).toBeNull();
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
