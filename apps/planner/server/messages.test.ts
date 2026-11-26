// The messages the app writes for the agent to send, word for word: the order going out, the reminder, the
// how-to-use intro, the unpaid line; and what a recipe link says about itself.
import { describe, it, expect } from "bun:test";
import { andList, changeMessage, CHECKS_NAMED, clockText, dishText, introText, linkSource, NEW_DISH_TEXT_MAX, newDishText, orderingNowText, planMessage, planQuestion,
  reminderText, unpaidText, weekLink, weekMessage, youtubeThumb, type PlanText, type ReminderText } from "./messages";
import type { DishView, MealView } from "./meals";

const dish = (name: string, d: Partial<DishView> = {}): DishView =>
  ({ id: name, name, for_people: null, portion_note: null, recipe_id: null, video_url: null, video: null, last_time: null, ingredients: [], new: false, ...d });
const meal = (date: string, slot: string, dishes: DishView[], m: Partial<MealView> = {}): MealView =>
  ({ id: `${date} ${slot}`, date, slot, ordered_in: false, skip: null, note: null, people: [], status: "planned", dishes, ...m });

const TUE = "2026-11-24";

describe("dishText", () => {
  it("is the name, with the portions when noted, else who it is for", () => {
    expect(dishText({ name: "Boiled eggs", for_people: ["me", "wife"], portion_note: "4 for me, 1 for wife" })).toBe("Boiled eggs (4 for me, 1 for wife)");
    expect(dishText({ name: "Parathas", for_people: ["Dad"] })).toBe("Parathas (for Dad)");
    expect(dishText({ name: "Khichdi", for_people: ["Dad", "Agastya"], portion_note: null })).toBe("Khichdi (for Dad, Agastya)");
    expect(dishText({ name: "Sambar" })).toBe("Sambar");
    expect(dishText({ name: "Sambar", for_people: [], portion_note: "  " })).toBe("Sambar");
    expect(dishText({ name: "Sambar", for_people: ["everyone"] })).toBe("Sambar");
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
      "How it works:",
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

// The plan's message (owner, 25 Nov): at most one question in it, calendar entries folded into that one, and a new dish's
// reason never more than the dish of theirs it stands in for. The bad cases are the base-minimum eval's and run 31's.
describe("the plan's message", () => {
  const questions = (msg: string) => msg.split("\n").filter((l) => l.trim().endsWith("?"));
  const plan = (t: Partial<PlanText>): string => planMessage({ days: [{ label: "Monday", meals: [{ slot: "Dinner", skip: null, note: null, dishes: [{ name: "Dal", note: null }] }] }],
    standing: [], unmet: [], new_dishes: [], question: null, link: "/a/t/#/week", ...t });

  it("names every meal short of dishes in one question, in the owner's words", () => {
    // Was two lines: "I only know 5 dishes for dinner, so I've added a few new ones like Vegetable curry. What else do you have for
    // dinner?" and "I only know 4 dishes for Vihaan's tiffin, so I've added a few new ones like Aloo paratha. What else does Vihaan
    // have for Vihaan's tiffin?"
    expect(planQuestion({ short: [{ meal: "dinner", added: true }, { meal: "Vihaan's tiffin", added: true }], events: [] }))
      .toBe("I know only a few dishes for dinner and Vihaan's tiffin, so I've added some new ones. What else do you make for these?");
    expect(planQuestion({ short: [{ meal: "dinner", added: true }], events: [] }))
      .toBe("I know only a few dishes for dinner, so I've added some new ones. What else do you make for dinner?");
    // Nothing new placed somewhere: whether to suggest some, in the same question.
    expect(planQuestion({ short: [{ meal: "Vihaan's tiffin", added: true }, { meal: "breakfast", added: false }], events: [] }))
      .toBe("I know only a few dishes for Vihaan's tiffin and breakfast, so I've added some new ones for Vihaan's tiffin. What else do you make for these, or should I suggest a few?");
    expect(planQuestion({ short: [], events: [] })).toBeNull();
  });

  it("folds the calendar entries it could not read into the same question: each entry once with its days, at most 3 named", () => {
    expect(planQuestion({ short: [], events: [{ title: "Thing", who: null, when: "Thu" }] })).toBe('Does "Thing" (Thu) change who eats at home?');
    expect(planQuestion({ short: [{ meal: "dinner", added: true }], events: [{ title: "Party", who: "Shiva", when: "Sat" }] }))
      .toBe('I know only a few dishes for dinner, so I\'ve added some new ones. What else do you make for dinner, and does "Party" (Shiva, Sat) change who eats at home?');
    // Run 31: a repeating entry came once a day, a question each. Now each entry once, its days together; past 3, counted.
    const run31 = [["Office", "Shiva"], ["School", "Agastya"], ["Football", "Agastya"], ["Swimming", "Agastya"], ["Yoga", "Ankita"]]
      .flatMap(([title, who]) => ["Mon", "Tue"].map((when) => ({ title, who, when })));
    expect(planQuestion({ short: [], events: run31 }))
      .toBe('Do "Office" (Shiva, Mon, Tue), "School" (Agastya, Mon, Tue), "Football" (Agastya, Mon, Tue) and 2 more change who eats at home?');
    // A title with a question mark or a line break in it cannot make a second question line.
    expect(planQuestion({ short: [], events: [{ title: "Who comes?\nMaybe", who: null, when: "Fri" }] })).toBe('Does "Who comes Maybe" (Fri) change who eats at home?');
  });

  it("plan-and-ask checks: three named, allergies first, the rest counted", () => {
    const GS = "Gowri Shankar";
    const checks = [{ dish: "Kadhi", who: GS, tag: "egg", allergy: false }, { dish: "Kootu", who: GS, tag: "egg", allergy: false },
      { dish: "Pesarattu", who: "Agastya", tag: "peanut", allergy: true }, { dish: "Rasam", who: GS, tag: "egg", allergy: false }, { dish: "Dal", who: GS, tag: "egg", allergy: false }];
    expect(planQuestion({ short: [], events: [], checks }))
      .toBe("Is the Pesarattu OK for Agastya, no peanut, is the Kadhi OK for Gowri Shankar, no egg, is the Kootu OK for Gowri Shankar, no egg and 2 more to check on the week page?");
    expect(planQuestion({ short: [], events: [], checks: [checks[0]] })).toBe("Is the Kadhi OK for Gowri Shankar, no egg?");
    // A tag's underscore is a space; the asks in order: short meals, checks, events; one question mark.
    expect(planQuestion({ short: [{ meal: "dinner", added: true }], events: [{ title: "Party", who: null, when: "Sat" }],
      checks: [{ dish: "Bhindi", who: "Nani", tag: "onion_garlic", allergy: false }] }))
      .toBe('I know only a few dishes for dinner, so I\'ve added some new ones. What else do you make for dinner, and is the Bhindi OK for Nani, no onion garlic, and does "Party" (Sat) change who eats at home?');
    expect(CHECKS_NAMED).toBe(3);
  });

  it("never ends with more than one question line, whatever the notes say", () => {
    const q = planQuestion({ short: [{ meal: "dinner", added: true }, { meal: "Vihaan's tiffin", added: true }], events: [{ title: "Thing", who: null, when: "Thu" }] });
    const msg = plan({ question: q, days: [{ label: "Monday", meals: [{ slot: "Dinner", skip: null, note: "Is this too spicy for Nani?", dishes: [{ name: "Dal", note: null }] }] }] });
    expect(questions(msg)).toEqual([q!]);
    expect(msg).toContain("Dinner: Dal. Is this too spicy for Nani.");
    expect(questions(plan({}))).toEqual([]);
  });

  it("a new dish is said with the dish of theirs it stands in for, never the model's reason, and under 60 characters", () => {
    expect(newDishText({ name: "Palak paneer", like: "Sabzi" })).toBe("Palak paneer (like your Sabzi)");
    expect(newDishText({ name: "Kadhi" })).toBe("Kadhi");
    expect(newDishText({ name: "Ragi dosa", like: "ragi dosa" })).toBe("Ragi dosa");
    // Too long with its reason: the name alone.
    expect(newDishText({ name: "Mini idlis with coconut chutney", like: "Idli with chutney and podi" })).toBe("Mini idlis with coconut chutney");
    // The eval's new dishes, which pasted the model's paragraph ("Aloo jeera (Ramesh and Kamla cannot eat dal, sabzi, kadhi, or dal
    // baati. This simple potato dish ...)"; "Daliya (Another name for dalia ... ? Actually, ...)").
    const msg = plan({ new_dishes: [{ name: "Aloo jeera", like: "Sabzi" }, { name: "Daliya", like: "Dalia" }, { name: "Upma" }] });
    expect(msg).toContain("New this week: Aloo jeera (like your Sabzi), Daliya (like your Dalia), Upma. OK to try these, or should I swap any?");
    const reasons = [...(/New this week:([^\n]*)/.exec(msg)![1].matchAll(/\(([^)]*)\)/g))].map((m) => m[1]);
    expect(reasons.every((r) => r.length <= NEW_DISH_TEXT_MAX)).toBe(true);
    expect(changeMessage({ meals: [], unmet: [], new_dishes: [{ name: "Palak paneer", like: "Sabzi" }], link: "/w" })).toContain("New: Palak paneer (like your Sabzi)");
  });
});

describe("a change's reply asks its checks right away (Task 10b)", () => {
  it("the checks question sits after what could not be kept and before the Week page; none: no question", () => {
    const meals = [{ label: "Tuesday Dinner", skip: null, dishes: [{ name: "Bhindi masala", note: null }] }];
    const q = planQuestion({ short: [], events: [], checks: [{ dish: "Bhindi masala", who: "Gowri Shankar", tag: "egg", allergy: false }] });
    expect(changeMessage({ meals, unmet: ["x"], new_dishes: [], question: q, link: "/w" })).toBe(
      "Updated the plan:\nTuesday Dinner: Bhindi masala\n\nI couldn't keep everything: x. Tell me what to change.\n\nIs the Bhindi masala OK for Gowri Shankar, no egg?\n\nThe whole week: [Week page](/w)");
    expect(changeMessage({ meals, unmet: [], new_dishes: [], question: null, link: "/w" })).toBe("Updated the plan:\nTuesday Dinner: Bhindi masala\n\nThe whole week: [Week page](/w)");
  });
});

// Brand-new variants (owner, 25 Nov): a dish the family never had is named in the week's message as its one question, each
// with its day and the dish of theirs it is like, and again in the evening before the day it is cooked.
describe("the question about the week's brand-new dishes", () => {
  const questions = (msg: string) => msg.split("\n").filter((l) => l.trim().endsWith("?"));
  const plan = (t: Partial<PlanText>): string => planMessage({ days: [{ label: "Monday", meals: [{ slot: "Dinner", skip: null, note: null, dishes: [{ name: "Dal", note: null }] }] }],
    standing: [], unmet: [], new_dishes: [], question: null, link: "/a/t/#/week", ...t });
  const TUE = "2026-12-01", THU = "2026-12-03", FRI = "2026-12-04";
  const puttu = { dish: "Ragi puttu", date: TUE, slot: "Breakfast", like: "Puttu" };
  const poriyal = { dish: "Beetroot poriyal", date: THU, slot: "Lunch", like: "Beans poriyal" };

  it("is the message's one question: each dish, its short weekday and the family's dish it is like", () => {
    expect(questions(plan({ new_dishes: [poriyal, puttu] }))).toEqual([
      "New this week: Ragi puttu on Tue (like your Puttu), Beetroot poriyal on Thu (like your Beans poriyal). OK to try these, or should I swap any?"]);
    expect(questions(plan({ new_dishes: [puttu] }))).toEqual(["New this week: Ragi puttu on Tue (like your Puttu). OK to try it, or should I swap it?"]);
  });

  it("one dish on two days is named once with both days; one with no dish of theirs to compare is named alone", () => {
    expect(questions(plan({ new_dishes: [puttu, { ...puttu, date: FRI }] })))
      .toEqual(["New this week: Ragi puttu on Tue and Fri (like your Puttu). OK to try it, or should I swap it?"]);
    expect(questions(plan({ new_dishes: [{ dish: "Kambu koozh", date: THU, slot: "Breakfast", like: null }] })))
      .toEqual(["New this week: Kambu koozh on Thu. OK to try it, or should I swap it?"]);
  });

  it("sits where the one question goes: after what could not be kept, before the Week page", () => {
    const msg = plan({ new_dishes: [puttu], unmet: ["Tue Dinner: Rajma comes back sooner than usual"] });
    const lines = msg.split("\n");
    const at = lines.findIndex((l) => l.startsWith("New this week:"));
    expect(at).toBeGreaterThan(lines.findIndex((l) => l.startsWith("I couldn't keep everything")));
    expect(at).toBeLessThan(lines.findIndex((l) => l.startsWith("The whole week:")));
  });

  it("with a more urgent question (meals short of dishes, calendar entries), the new dishes are only named and that question is the one", () => {
    const q = planQuestion({ short: [{ meal: "dinner", added: true }], events: [] })!;
    const msg = plan({ new_dishes: [puttu, poriyal], question: q });
    expect(questions(msg)).toEqual([q]);
    expect(msg).toContain("New this week: Ragi puttu on Tue (like your Puttu), Beetroot poriyal on Thu (like your Beans poriyal).\n\n" + q);
  });

  it("the evening before: tomorrow's new dishes named at their meal with the same question", () => {
    const base: ReminderText = { which: "evening", meals: [meal(TUE, "Breakfast", [dish("Ragi puttu", { new: true })])], ask_ingredients: ["ragi flour"], added: [],
      cart_items: [], asks: [], delivery_gap: null, ordered: [], carts: [], empty: false };
    expect(reminderText({ ...base, new_dishes: [{ dish: "Ragi puttu", meal: "breakfast", like: "Puttu" }] }))
      .toBe("Tomorrow: Ragi puttu\nTomorrow's new dish: Ragi puttu at breakfast (like your Puttu). OK to make it, or swap?\nDo you have ragi flour?");
    expect(reminderText({ ...base, new_dishes: [{ dish: "Ragi puttu", meal: "breakfast", like: "Puttu" }, { dish: "Beetroot poriyal", meal: "lunch", like: "Beans poriyal" }] }))
      .toContain("Tomorrow's new dishes: Ragi puttu at breakfast (like your Puttu) and Beetroot poriyal at lunch (like your Beans poriyal). OK to make them, or swap any?");
    expect(reminderText({ ...base, new_dishes: [{ dish: "Ragi puttu", meal: "Kabir's tiffin", like: null }] })).toContain("Tomorrow's new dish: Ragi puttu at Kabir's tiffin. OK to make it, or swap?");
    expect(reminderText(base)).not.toContain("new dish");
  });
});
