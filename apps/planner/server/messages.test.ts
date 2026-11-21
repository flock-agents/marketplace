// The messages the app writes for the agent to send, word for word: the order going out, the reminder, the
// how-to-use intro, the unpaid line; and what a recipe link says about itself.
import { describe, it, expect } from "bun:test";
import { andList, clockText, dishText, introText, linkSource, orderingNowText, reminderText, unpaidText, weekLink, weekMessage, youtubeThumb,
  type ReminderText } from "./messages";
import type { DishView, MealView } from "./meals";

const dish = (name: string, d: Partial<DishView> = {}): DishView =>
  ({ id: name, name, for_people: null, portion_note: null, recipe_id: null, video_url: null, video: null, last_time: null, ingredients: [], ...d });
const meal = (date: string, slot: string, dishes: DishView[], m: Partial<MealView> = {}): MealView =>
  ({ id: `${date} ${slot}`, date, slot, ordered_in: false, note: null, dishes, ...m });

const TUE = "2026-11-24";

describe("dishText", () => {
  it("is the name, with the portions when noted, else who it is for", () => {
    expect(dishText({ name: "Boiled eggs", for_people: ["me", "wife"], portion_note: "4 for me, 1 for wife" })).toBe("Boiled eggs (4 for me, 1 for wife)");
    expect(dishText({ name: "Parathas", for_people: ["Dad"] })).toBe("Parathas (for Dad)");
    expect(dishText({ name: "Khichdi", for_people: ["Dad", "Agastya"], portion_note: null })).toBe("Khichdi (for Dad, Agastya)");
    expect(dishText({ name: "Sambar" })).toBe("Sambar");
    expect(dishText({ name: "Sambar", for_people: [], portion_note: "  " })).toBe("Sambar");
  });
});

describe("orderingNowText", () => {
  it("names each product, its count above one, the estimate and the grocery app", () => {
    expect(orderingNowText({ app: "zepto", lines: [{ item: "atta", name_on_app: "Aashirvaad Atta 5 kg", qty: 1, price: 289 }, { item: "milk", name_on_app: "Amul Taaza 500 ml", qty: 4, price: 29 }] }))
      .toBe("Ordering this now: Aashirvaad Atta 5 kg, Amul Taaza 500 ml ×4, ~₹405 on Zepto");
  });

  it("uses the family's word for an item with no product yet, and leaves the estimate out when nothing is priced", () => {
    expect(orderingNowText({ app: "zomato-blinkit", lines: [{ item: "coriander" }, { item: "eggs", qty: 2 }] }))
      .toBe("Ordering this now: coriander, eggs ×2 on Blinkit");
  });

  it("adds up every line, with thousands grouped; leaves the estimate out when any line has no price", () => {
    expect(orderingNowText({ app: "bigbasket", lines: [{ item: "ghee", name_on_app: "Amul Ghee 1 l", qty: 2, price: 625 }, { item: "salt", price: 28.4 }] }))
      .toBe("Ordering this now: Amul Ghee 1 l ×2, salt, ~₹1,278 on BigBasket");
    expect(orderingNowText({ app: "bigbasket", lines: [{ item: "ghee", name_on_app: "Amul Ghee 1 l", qty: 2, price: 625 }, { item: "coriander", qty: 1 }, { item: "salt", price: 28.4 }] }))
      .toBe("Ordering this now: Amul Ghee 1 l ×2, coriander, salt on BigBasket");
  });

  it("shows eight lines and counts the rest, the estimate still over all of them", () => {
    const lines = Array.from({ length: 11 }, (_, i) => ({ item: `item ${i + 1}`, qty: 1, price: 10 }));
    expect(orderingNowText({ app: "zepto", lines }))
      .toBe("Ordering this now: item 1, item 2, item 3, item 4, item 5, item 6, item 7, item 8 and 3 more, ~₹110 on Zepto");
    expect(orderingNowText({ app: "zepto", lines: lines.slice(0, 8) })).not.toContain("more");
  });
});

const TIMES = { plan: "11:00", afternoon: "15:00", evening: "19:00" };
describe("weekMessage", () => {
  it("is Monday's meals and the Week link", () => {
    expect(weekLink("/a/t")).toBe("/a/t/?flock_scope=app#/week");
    expect(weekLink("/a/t", "2026-11-23")).toBe("/a/t/?flock_scope=app#/week?week=2026-11-23");   // opens the week planned
    const monday = [meal("2026-11-23", "Breakfast", [dish("poha")]), { ...meal("2026-11-23", "Lunch", [dish("rajma chawal"), dish("bhindi")]) },
      meal("2026-11-23", "Dinner", [dish("palak paneer"), dish("rotis")])];
    expect(weekMessage({ monday, link: weekLink("/a/t") })).toBe([
      "Next week is planned.", "Monday: poha · rajma chawal, bhindi · palak paneer, rotis", "",
      "The whole week: [Week page](/a/t/?flock_scope=app#/week)", "Tell me anything to change."].join("\n"));
  });
  it("says nothing planned without meals, and ordering in for an ordered-in meal", () => {
    expect(weekMessage({ monday: [], link: "L" }).split("\n")[1]).toBe("Monday: nothing planned");
    expect(weekMessage({ monday: [{ ...meal("2026-11-23", "Dinner", []), ordered_in: true }], link: "L" }).split("\n")[1]).toBe("Monday: ordering in");
  });
});

describe("introText", () => {
  it("is the how-to-use message with the real times and the real everyday items", () => {
    expect(introText(TIMES, ["milk", "curd"])).toBe([
      "Your week is planned. How it works:",
      "• Every Sunday morning I plan the week. Change any meal by telling me, or in the app (Week).",
      "• Every day at 3 I check tonight's dinner and at 7 tomorrow's meals; each time I put what is due in the cart, like your milk and curd, and mention anything that may be running low. Reply and I order it together. Nothing is ordered until you reply.",
      "• Saw a recipe on Instagram or YouTube? Share it here and say \"save this\"; I'll keep it and can plan it in.",
      "• Times can be changed, and you can tell me to order without asking."].join("\n"));
  });
  it("follows the times and names the first two everyday items", () => {
    const text = introText({ plan: "18:00", afternoon: "15:30", evening: "19:30" }, ["eggs", "bread", "curd"]);
    expect(text).toContain("Every Sunday evening");
    expect(text).toContain("at 3:30 I check tonight's dinner and at 7:30 tomorrow's meals;");
    expect(text).toContain("put what is due in the cart, like your eggs and bread, and mention");
    expect(introText(TIMES, ["milk"])).toContain("put what is due in the cart, like your milk, and mention");
  });
  it("with nothing bought every day known yet it names none", () => {
    const text = introText(TIMES, []);
    expect(text).not.toMatch(/milk|curd/);
    expect(text).toContain("each time I put what is due in the cart and mention anything that may be running low. Reply and I order it together.");
    expect(text).not.toContain("everyday items");
  });
});

describe("reminderText", () => {
  const tue = [meal(TUE, "Breakfast", [dish("poha")]), meal(TUE, "Lunch", [dish("rajma chawal"), dish("bhindi")])];
  const base: ReminderText = { which: "evening", meals: tue, ask_ingredients: ["rajma", "bhindi"], added: [{ item: "curd" }, { item: "bread" }],
    cart_items: ["curd", "bread"], asks: [{ item: "atta", days_ago: 31 }, { item: "toor dal", days_ago: 26 }], delivery_gap: { app: "Zepto", rupees: 35 },
    ordered: [], carts: [], empty: false };
  const SAMPLE = "Tomorrow: poha · rajma chawal, bhindi\nDo you have rajma and bhindi?\n\nI've added curd and bread to your cart.\nA few things were bought a while ago:\n"
    + "1. Atta, 31 days ago\n2. Toor dal, 26 days ago\nStill in stock? If yes, when should I remind you?\n₹35 short of free delivery on Zepto.";

  it("is the evening sample word for word, and the app chat's is the same without the numbered lines", () => {
    expect(reminderText(base)).toBe(SAMPLE);
    expect(reminderText(base, { app: true })).toBe(SAMPLE.replace("1. Atta, 31 days ago\n2. Toor dal, 26 days ago\n", ""));
  });

  it("the afternoon asks about tonight; no meals, no meal lines", () => {
    const dinner = meal("2026-11-23", "Dinner", [dish("methi thepla"), dish("curd")]);
    expect(reminderText({ ...base, which: "afternoon", meals: [dinner], ask_ingredients: [], asks: [], delivery_gap: null }))
      .toBe("Tonight: methi thepla, curd. Anything to change?\n\nI've added curd and bread to your cart.");
    expect(reminderText({ ...base, meals: [], ask_ingredients: [], asks: [], delivery_gap: null })).toBe("I've added curd and bread to your cart.");
  });

  it("nothing newly added but a cart says the cart; ordered without asking says what and where", () => {
    expect(reminderText({ ...base, meals: [], added: [], asks: [], delivery_gap: null })).toBe("Your cart: curd and bread.");
    const lines = [{ item: "curd", qty: 1, price: 50 }, { item: "bread", qty: 1, price: 45 }, { item: "salt", qty: 0, price: 20 }];
    expect(reminderText({ ...base, meals: [], asks: [], delivery_gap: null, cart_items: [], ordered: [{ order_id: "o1", app: "zepto" }], carts: [{ order_id: "o1", lines }] }))
      .toBe("I've ordered curd and bread on Zepto, about ₹95.");
    // A line ordered with no price: no total, since a part total would read as the whole.
    const unpriced = [...lines, { item: "atta", qty: 1, price: null }];
    expect(reminderText({ ...base, meals: [], asks: [], delivery_gap: null, cart_items: [], ordered: [{ order_id: "o1", app: "zepto" }], carts: [{ order_id: "o1", lines: unpriced }] }))
      .toBe("I've ordered curd, bread and atta on Zepto.");
  });

  it("one item running low is one sentence", () => {
    const one = { ...base, meals: [], added: [], cart_items: [], delivery_gap: null, asks: [{ item: "atta", days_ago: 31 }] };
    expect(reminderText(one)).toBe("Atta, bought 31 days ago.\nStill in stock? If yes, when should I remind you?");
    expect(reminderText(one, { app: true })).toBe("Still in stock? If yes, when should I remind you?");
  });

  it("lists join with commas and a last and; empty is nothing", () => {
    expect([andList(["a"]), andList(["a", "b"]), andList(["a", "b", "c"])]).toEqual(["a", "a and b", "a, b and c"]);
    expect(reminderText({ ...base, empty: true })).toBe("");
  });
});

describe("no em dashes", () => {
  it("none of the texts has one", () => {
    const texts = [weekMessage({ monday: [], link: "L" }), introText(TIMES, ["milk"]), unpaidText("Zepto", "Monday"),
      reminderText({ which: "afternoon", meals: [meal(TUE, "Dinner", [dish("Dal")])], ask_ingredients: ["methi"], added: [{ item: "curd" }], cart_items: ["curd"],
        asks: [{ item: "atta", days_ago: 3 }, { item: "rice", days_ago: 1 }], delivery_gap: { app: "Zepto", rupees: 10 }, ordered: [], carts: [], empty: false })];
    for (const t of texts) expect(t).not.toContain("\u2014");
  });
});

describe("unpaidText", () => {
  it("is one line: which app's order of which day was not paid, and that its items are back in the cart", () => {
    const text = unpaidText("Zepto", "Monday");
    expect(text).toBe("Monday's Zepto order wasn't paid, so its items are back in your cart.");
    expect(text).not.toContain("\n");
    expect(text).not.toContain("\u2014");
  });
});

describe("clockText", () => {
  it("reads a time of day the way the family says it", () => {
    expect(clockText("15:00")).toBe("3 pm");
    expect(clockText("19:30")).toBe("7:30 pm");
    expect(clockText("08:00")).toBe("8 am");
    expect(clockText("00:05")).toBe("12:05 am");
    expect(clockText("12:00")).toBe("12 pm");
    expect(clockText("18:00")).toBe("6 pm");
  });
});

describe("recipe links", () => {
  it("knows where a link is from", () => {
    expect(linkSource("https://www.instagram.com/reel/abc")).toBe("instagram");
    expect(linkSource("https://instagr.am/p/abc")).toBe("instagram");
    expect(linkSource("https://youtube.com/shorts/XyZ_123")).toBe("youtube");
    expect(linkSource("https://m.youtube.com/watch?v=abc")).toBe("youtube");
    expect(linkSource("https://youtu.be/abc")).toBe("youtube");
    expect(linkSource("https://www.hebbarskitchen.com/poha")).toBe("other");
    expect(linkSource("https://notyoutube.com/watch?v=abc")).toBe("other");
    expect(linkSource("not a link")).toBe("other");
  });

  it("gives a YouTube video's thumbnail, and none for anything else", () => {
    expect(youtubeThumb("https://youtube.com/shorts/XyZ_123")).toBe("https://i.ytimg.com/vi/XyZ_123/hqdefault.jpg");
    expect(youtubeThumb("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10s")).toBe("https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg");
    expect(youtubeThumb("https://youtu.be/dQw4w9WgXcQ?si=abc")).toBe("https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg");
    expect(youtubeThumb("https://www.youtube.com/shorts/XyZ_123?feature=share")).toBe("https://i.ytimg.com/vi/XyZ_123/hqdefault.jpg");
    expect(youtubeThumb("https://www.instagram.com/reel/abc")).toBeNull();
    expect(youtubeThumb("https://www.youtube.com/@somechannel")).toBeNull();
    expect(youtubeThumb("not a link")).toBeNull();
  });
});
