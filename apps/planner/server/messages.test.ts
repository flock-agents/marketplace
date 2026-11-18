// The messages the app writes for the agent to send, word for word: the order going out, the two daily check-ins, the
// how-to-use intro; and what a recipe link says about itself.
import { describe, it, expect } from "bun:test";
import { clockText, dinnerCheckText, dishText, introText, linkSource, orderingNowText, tomorrowCheckText, youtubeThumb } from "./messages";
import type { DishView, MealView } from "./meals";

const dish = (name: string, d: Partial<DishView> = {}): DishView =>
  ({ id: name, name, for_people: null, portion_note: null, recipe_id: null, video_url: null, ingredients: [], ...d });
const meal = (date: string, slot: string, dishes: DishView[], m: Partial<MealView> = {}): MealView =>
  ({ id: `${date} ${slot}`, date, slot, ordered_in: false, note: null, dishes, ...m });

const TUE = "2026-11-24";
const dinner = meal("2026-11-23", "Dinner", [
  dish("Matar paneer"),
  dish("Rotis", { portion_note: "wife 2, me 3, Agastya 2" }),
  dish("Parathas", { for_people: ["Dad"] }) ]);
const breakfast = meal(TUE, "Breakfast", [dish("Poha", { video_url: "https://www.instagram.com/reel/abc" })]);
const lunch = meal(TUE, "Lunch", [dish("Rice"), dish("Aloo gobi"), dish("Sambar"),
  dish("Boiled eggs", { for_people: ["me", "wife"], portion_note: "4 for me, 1 for wife" })]);
const tiffin = meal(TUE, "Agastya's tiffin", [dish("Idli")]);
const lakshmi = { name: "Lakshmi", arrival: "07:30", today: true };
const pohaVideo = { dish: "Poha", url: "https://www.instagram.com/reel/abc" };

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

  it("adds up the priced lines only, with thousands grouped", () => {
    expect(orderingNowText({ app: "bigbasket", lines: [{ item: "ghee", name_on_app: "Amul Ghee 1 l", qty: 2, price: 625 }, { item: "coriander", qty: 1 }, { item: "salt", price: 28.4 }] }))
      .toBe("Ordering this now: Amul Ghee 1 l ×2, coriander, salt, ~₹1,278 on BigBasket");
  });

  it("shows eight lines and counts the rest, the estimate still over all of them", () => {
    const lines = Array.from({ length: 11 }, (_, i) => ({ item: `item ${i + 1}`, qty: 1, price: 10 }));
    expect(orderingNowText({ app: "zepto", lines }))
      .toBe("Ordering this now: item 1, item 2, item 3, item 4, item 5, item 6, item 7, item 8 and 3 more, ~₹110 on Zepto");
    expect(orderingNowText({ app: "zepto", lines: lines.slice(0, 8) })).not.toContain("more");
  });
});

describe("dinnerCheckText", () => {
  it("says tonight's dishes, the fresh items on an order and the ones on none", () => {
    expect(dinnerCheckText({ meal: dinner, covered: ["paneer", "peas"], missing: ["coriander"] }))
      .toBe("Tonight's dinner: Matar paneer, Rotis (wife 2, me 3, Agastya 2), Parathas (for Dad).\nFresh items on an order: paneer, peas.\nNot on any order yet: coriander.\nAnything to change?");
  });

  it("leaves out a line with nothing to say", () => {
    expect(dinnerCheckText({ meal: dinner, covered: [], missing: [] }))
      .toBe("Tonight's dinner: Matar paneer, Rotis (wife 2, me 3, Agastya 2), Parathas (for Dad).\nAnything to change?");
    expect(dinnerCheckText({ meal: dinner, covered: [], missing: ["coriander"] }))
      .toBe("Tonight's dinner: Matar paneer, Rotis (wife 2, me 3, Agastya 2), Parathas (for Dad).\nNot on any order yet: coriander.\nAnything to change?");
  });

  it("has nothing to send with no dinner, a dinner ordered in, or one with no dishes", () => {
    expect(dinnerCheckText({ meal: null, covered: [], missing: [] })).toBeNull();
    expect(dinnerCheckText({ meal: meal("2026-11-23", "Dinner", [], { ordered_in: true }), covered: [], missing: [] })).toBeNull();
    expect(dinnerCheckText({ meal: meal("2026-11-23", "Dinner", []), covered: [], missing: ["coriander"] })).toBeNull();
  });
});

describe("tomorrowCheckText", () => {
  it("lists tomorrow's meals and the cook's videos", () => {
    expect(tomorrowCheckText({ date: TUE, meals: [breakfast, lunch, tiffin], cook: lakshmi, videos: [pohaVideo], missing: [] }))
      .toBe("Tomorrow, Tue 24 Nov:\nBreakfast: Poha\nLunch: Rice, Aloo gobi, Sambar, Boiled eggs (4 for me, 1 for wife)\nAgastya's tiffin: Idli\nFor Lakshmi (comes 7:30): Poha https://www.instagram.com/reel/abc\nAnything to change?");
  });

  it("a meal ordered in reads as ordering in", () => {
    expect(tomorrowCheckText({ date: TUE, meals: [breakfast, meal(TUE, "Dinner", [], { ordered_in: true })], videos: [], missing: [] }))
      .toBe("Tomorrow, Tue 24 Nov:\nBreakfast: Poha\nDinner: ordering in\nAnything to change?");
  });

  it("says what is on no order yet", () => {
    expect(tomorrowCheckText({ date: TUE, meals: [breakfast], videos: [], missing: ["poha", "peanuts"] }))
      .toBe("Tomorrow, Tue 24 Nov:\nBreakfast: Poha\nNot on any order yet: poha, peanuts.\nAnything to change?");
  });

  it("keeps the videos when the cook is not coming, and has no cook line without a video", () => {
    const videos = [pohaVideo, { dish: "Sambar", url: "https://youtu.be/s4mb4r" }];
    expect(tomorrowCheckText({ date: TUE, meals: [breakfast, lunch], cook: { ...lakshmi, today: false }, videos, missing: [] }))
      .toBe("Tomorrow, Tue 24 Nov:\nBreakfast: Poha\nLunch: Rice, Aloo gobi, Sambar, Boiled eggs (4 for me, 1 for wife)\nVideos: Poha https://www.instagram.com/reel/abc, Sambar https://youtu.be/s4mb4r\nAnything to change?");
    expect(tomorrowCheckText({ date: TUE, meals: [breakfast, lunch], cook: { ...lakshmi, arrival: "11:00" }, videos, missing: [] }))
      .toContain("\nFor Lakshmi (comes 11:00): Poha https://www.instagram.com/reel/abc, Sambar https://youtu.be/s4mb4r\n");
    expect(tomorrowCheckText({ date: TUE, meals: [breakfast], cook: lakshmi, videos: [], missing: [] }))
      .toBe("Tomorrow, Tue 24 Nov:\nBreakfast: Poha\nAnything to change?");
  });

  it("has nothing to send when no meal is planned", () => {
    expect(tomorrowCheckText({ date: TUE, meals: [], cook: lakshmi, videos: [], missing: [] })).toBeNull();
    expect(tomorrowCheckText({ date: TUE, meals: [meal(TUE, "Lunch", [])], videos: [], missing: [] })).toBeNull();
  });
});

describe("introText", () => {
  it("is the how-to-use message, with the order's day and the real check-in times", () => {
    expect(introText("Saturday", { dinner: "15:00", tomorrow: "19:00" })).toBe([
      "Your week is planned and Saturday's order is placed. How it works:",
      "• Change any meal by telling me, or in the app (Week).",
      "• I check in at 3 pm about dinner and 7 pm about tomorrow; reply to change anything. Times can be changed.",
      "• Orders go out on their own; I message you just before. Tell me to add anything.",
      "• Saw a recipe on Instagram or YouTube? Share it here and say \"save this\"; I'll keep it and can plan it in.",
      "• Everyday items (milk, curd, eggs) are ordered automatically; tell me to change them."].join("\n"));
  });

  it("follows check-in times the family changed", () => {
    const text = introText("Sunday", { dinner: "16:30", tomorrow: "20:00" });
    expect(text.split("\n")[0]).toBe("Your week is planned and Sunday's order is placed. How it works:");
    expect(text.split("\n")[2]).toBe("• I check in at 4:30 pm about dinner and 8 pm about tomorrow; reply to change anything. Times can be changed.");
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
