// 11 (held out). A young couple with no cook: his office days alternate weeks (Mon+Wed / Tue+Thu, canteen lunch), so his
// weekday lunch can't be told from a weekly pattern; non-veg and eggs only on weekends; she is lactose intolerant; he wants
// millets (a count, corrected); Friday dinner ordered in; his brother stays the weekend. Not used for tuning: --heldout.
import { avoid, dish, mains, SCHOOL, WEEK, type Household } from "../../lib/truth";

export const h11: Household = {
  id: "h11-dsouza", title: "Couple, alternate-week office days, non-veg weekends only, lactose intolerant",
  owner: "Kabir", intro: "You are Kabir D'Souza, 31, a product designer in Bengaluru",
  household: {
    "household.people": [{ name: "Kabir", relation: "self", age: 31, group: "adult" }, { name: "Meera", relation: "wife", age: 30, group: "adult" }],
    "household.children": [], "household.elders": [], "household.schoolAge": false,
    "household.help": [{ role: "maid", name: "Lalitha", days: "daily", times: "9am" }],
    "household.weekday": "Kabir goes to office on alternate weeks: Monday and Wednesday one week, Tuesday and Thursday the next, and eats in the cafeteria then. Meera at the office Monday to Friday, 9 to 6, takes a lunch box.",
    "household.mealsBy": "Meera", "household.groceriesBy": "Kabir",
    "household.weekly": [{ person: "Meera", where: "office", weekdays: SCHOOL, from: "09:00", to: "18:00", lunch: "carries" },
      { person: "Kabir", where: "office, alternate weeks: Mon+Wed, then Tue+Thu", weekdays: [], lunch: "away" }],
  },
  groceryApps: ["Zepto"],
  facts: [
    { id: "pain", text: "Hardest part: we both cook and keep making the same three things." },
    { id: "apps", text: "Zepto only." },
    { id: "people", text: "Just me and my wife Meera (30)." },
    { id: "cookingDays", text: "No cook. Meera makes breakfast and her lunch box; I cook dinner on weekdays; weekends we cook together. Friday dinner we order in." },
    { id: "adultsBreakfast", text: "Breakfast: poha, upma, ragi dosa, besan chilla; overnight oats for Meera on busy days." },
    { id: "adultsLunch", text: "Lunch: dal, rice, a sabzi and salad. Rajma or chole once a week." },
    { id: "adultsDinner", text: "Dinner: roti, dal and a sabzi. On weekends chicken curry or egg curry, and fish fry on Sunday." },
    { id: "diet", text: "Meera is lactose intolerant: no milk, curd, paneer or ghee for her. I'm trying to eat millets twice a week." },
    { id: "rules", text: "Non-veg and eggs only on weekends. Weekdays fully veg." },
    { id: "orderIn", text: "Friday dinner, every week." },
    { id: "subscriptions", text: "Nothing." },
  ],
  correction: { after: "adultsLunch", line: "actually make the millets three times a week for me", fact: "diet",
    corrected: "Meera is lactose intolerant: no milk, curd, paneer or ghee for her. I'm trying to eat millets three times a week." },
  truth: {
    people: [{ name: "Kabir", group: "adult" }, { name: "Meera", group: "adult" }],
    cook: null,
    familyCooks: [{ person: "Meera", days: WEEK }, { person: "Kabir", days: WEEK }],
    slots: [
      ...mains({ Dinner: [{ day: "Fri", skip: "ordered_in" }] }),
      { name: "Meera's breakfast", kind: "addon", addon_of: "Breakfast", usual_people: ["Meera"], match: /meera/i, optional: true },
    ],
    // His office days change week to week: his weekday lunch is unclear (one question), planned with the usual people.
    away: [],
    lunchUnclear: ["Kabir"],
    library: [
      ...dish("Poha", ["Breakfast"]), ...dish("Upma", ["Breakfast"]), ...dish("Ragi dosa", ["Breakfast"]), ...dish("Besan chilla", ["Breakfast"]),
      ...dish("Overnight oats", ["Breakfast"], { frequency: "sometimes", alsoSlots: ["Meera's breakfast"] }),
      ...dish("Dal", ["Lunch", "Dinner"]), ...dish("Rice", ["Lunch"]), ...dish("Sabzi", ["Lunch", "Dinner"]), ...dish("Salad", ["Lunch"]),
      ...dish("Rajma", ["Lunch"], { frequency: "rarely" }), ...dish("Chole", ["Lunch"], { frequency: "rarely" }),
      ...dish("Roti", ["Dinner"]), ...dish("Chicken curry", ["Dinner"], { days: ["Sat", "Sun"] }), ...dish("Egg curry", ["Dinner"], { days: ["Sat", "Sun"] }),
      ...dish("Fish fry", ["Dinner"], { days: ["Sun"] }),
    ],
    rules: [
      avoid("nonveg_weekends", "Non-veg and eggs only on Saturday and Sunday", ["meat", "fish", "egg"], /weekend|weekday/i, { days: SCHOOL, also: ["only"] }),
      avoid("no_dairy_meera", "Meera: no dairy (lactose intolerant)", ["dairy"], /lactose|milk|curd|paneer/i, { who: "Meera" }),
      { id: "millets_kabir", title: "millets three times a week for Kabir", hard: false, what: "require", who: "Kabir", items: ["millet"], frequency: "3/week", quote: /millet/i, also: ["swap"] },
    ],
    seed: [
      { slot: "Breakfast", dishes: ["Poha"] }, { slot: "Breakfast", dishes: ["Upma"] }, { slot: "Breakfast", dishes: ["Ragi dosa"] }, { slot: "Breakfast", dishes: ["Besan chilla"] },
      { slot: "Lunch", dishes: ["Dal", "Rice", "Sabzi", "Salad"] }, { slot: "Lunch", dishes: ["Dal", "Rice", "Sabzi", "Salad"] }, { slot: "Lunch", dishes: ["Rajma", "Rice", "Salad"] },
      { slot: "Dinner", dishes: ["Roti", "Dal", "Sabzi"] }, { slot: "Dinner", dishes: ["Roti", "Dal", "Sabzi"] }, { slot: "Dinner", dishes: ["Roti", "Chicken curry"] },
    ],
    week: [{ kind: "stay", person: "Rohan", days: ["Sat", "Sun"], dated: { person: "Rohan", what: "Kabir's brother staying the weekend", from: "2026-12-05", to: "2026-12-06" } }],
    judgeNotes: ["Non-veg and eggs only Saturday and Sunday; weekdays fully veg.", "Meera: no dairy at all (lactose intolerant).", "Kabir: millets three times a week.",
      "Friday dinner ordered in.", "Kabir's brother Rohan stays Saturday and Sunday this week."],
  },
};
