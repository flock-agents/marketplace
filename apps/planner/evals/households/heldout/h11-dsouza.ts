// 11 (held out). A young couple with no cook: his office days alternate weeks (Mon+Wed / Tue+Thu, canteen lunch), so his
// weekday lunch can't be told from a weekly pattern; non-veg and eggs only on weekends; she is lactose intolerant; he wants
// millets (a count, corrected); Friday dinner ordered in; his brother stays the weekend. Not used for tuning: --heldout.
import { avoid, dish, mains, SCHOOL, WEEK, type Household } from "../../lib/truth";

export const h11: Household = {
  id: "h11-dsouza", title: "Couple, alternate-week office days, non-veg weekends only, lactose intolerant",
  owner: "Vikram", intro: "You are Vikram D'Souza, 31, a product designer in Bengaluru",
  household: {
    "household.people": [{ name: "Vikram", relation: "self", age: 31, group: "adult" }, { name: "Ishita", relation: "wife", age: 30, group: "adult" }],
    "household.children": [], "household.elders": [], "household.schoolAge": false,
    "household.help": [{ role: "maid", name: "Savitri", days: "daily", times: "9am" }],
    "household.weekday": "Vikram goes to office on alternate weeks: Monday and Wednesday one week, Tuesday and Thursday the next, and eats in the cafeteria then. Ishita at the office Monday to Friday, 9 to 6, takes a lunch box.",
    "household.mealsBy": "Ishita", "household.groceriesBy": "Vikram",
    "household.weekly": [{ person: "Ishita", where: "office", weekdays: SCHOOL, from: "09:00", to: "18:00", lunch: "carries" },
      { person: "Vikram", where: "office, alternate weeks: Mon+Wed, then Tue+Thu", weekdays: [], lunch: "away" }],
  },
  groceryApps: ["Zepto"],
  facts: [
    { id: "pain", text: "Hardest part: we both cook and keep making the same three things." },
    { id: "apps", text: "Zepto only." },
    { id: "people", text: "Just me and my wife Ishita (30)." },
    { id: "cookingDays", text: "No cook. Ishita makes breakfast and her lunch box; I cook dinner on weekdays; weekends we cook together. Friday dinner we order in." },
    { id: "adultsBreakfast", text: "Breakfast: poha, upma, ragi dosa, besan chilla; overnight oats for Ishita on busy days." },
    { id: "adultsLunch", text: "Lunch: dal, rice, a sabzi and salad. Rajma or chole once a week." },
    { id: "adultsDinner", text: "Dinner: roti, dal and a sabzi. On weekends chicken curry or egg curry, and fish fry on Sunday." },
    { id: "diet", text: "Ishita is lactose intolerant: no milk, curd, paneer or ghee for her. I'm trying to eat millets twice a week." },
    { id: "rules", text: "Non-veg and eggs only on weekends. Weekdays fully veg." },
    { id: "orderIn", text: "Friday dinner, every week." },
    { id: "subscriptions", text: "Nothing." },
  ],
  correction: { after: "adultsLunch", line: "actually make the millets three times a week for me", fact: "diet",
    corrected: "Ishita is lactose intolerant: no milk, curd, paneer or ghee for her. I'm trying to eat millets three times a week." },
  truth: {
    people: [{ name: "Vikram", group: "adult" }, { name: "Ishita", group: "adult" }],
    cook: null,
    familyCooks: [{ person: "Ishita", days: WEEK }, { person: "Vikram", days: WEEK }],
    slots: [
      ...mains({ Dinner: [{ day: "Fri", skip: "ordered_in" }] }),
      { name: "Ishita's breakfast", kind: "addon", addon_of: "Breakfast", usual_people: ["Ishita"], match: /ishita/i, optional: true },
    ],
    // His office days change week to week: his weekday lunch is unclear (one question), planned with the usual people.
    away: [],
    lunchUnclear: ["Vikram"],
    library: [
      ...dish("Poha", ["Breakfast"]), ...dish("Upma", ["Breakfast"]), ...dish("Ragi dosa", ["Breakfast"]), ...dish("Besan chilla", ["Breakfast"]),
      ...dish("Overnight oats", ["Breakfast"], { frequency: "sometimes", alsoSlots: ["Ishita's breakfast"] }),
      ...dish("Dal", ["Lunch", "Dinner"]), ...dish("Rice", ["Lunch"]), ...dish("Sabzi", ["Lunch", "Dinner"]), ...dish("Salad", ["Lunch"]),
      ...dish("Rajma", ["Lunch"], { frequency: "rarely" }), ...dish("Chole", ["Lunch"], { frequency: "rarely" }),
      ...dish("Roti", ["Dinner"]), ...dish("Chicken curry", ["Dinner"], { days: ["Sat", "Sun"] }), ...dish("Egg curry", ["Dinner"], { days: ["Sat", "Sun"] }),
      ...dish("Fish fry", ["Dinner"], { days: ["Sun"] }),
    ],
    rules: [
      avoid("nonveg_weekends", "Non-veg and eggs only on Saturday and Sunday", ["meat", "fish", "egg"], /weekend|weekday/i, { days: SCHOOL, also: ["only"] }),
      avoid("no_dairy_ishita", "Ishita: no dairy (lactose intolerant)", ["dairy"], /lactose|milk|curd|paneer/i, { who: "Ishita" }),
      { id: "millets_kabir", title: "millets three times a week for Vikram", hard: false, what: "require", who: "Vikram", items: ["millet"], frequency: "3/week", quote: /millet/i, also: ["swap"] },
    ],
    seed: [
      { slot: "Breakfast", dishes: ["Poha"] }, { slot: "Breakfast", dishes: ["Upma"] }, { slot: "Breakfast", dishes: ["Ragi dosa"] }, { slot: "Breakfast", dishes: ["Besan chilla"] },
      { slot: "Lunch", dishes: ["Dal", "Rice", "Sabzi", "Salad"] }, { slot: "Lunch", dishes: ["Dal", "Rice", "Sabzi", "Salad"] }, { slot: "Lunch", dishes: ["Rajma", "Rice", "Salad"] },
      { slot: "Dinner", dishes: ["Roti", "Dal", "Sabzi"] }, { slot: "Dinner", dishes: ["Roti", "Dal", "Sabzi"] }, { slot: "Dinner", dishes: ["Roti", "Chicken curry"] },
    ],
    week: [{ kind: "stay", person: "Rohan", days: ["Sat", "Sun"], dated: { person: "Rohan", what: "Vikram's brother staying the weekend", from: "2026-12-05", to: "2026-12-06" } }],
    cuisines: ["north"], cuisinesAlso: ["goa", "south", "west", "continental"],
    judgeNotes: ["Non-veg and eggs only Saturday and Sunday; weekdays fully veg.", "Ishita: no dairy at all (lactose intolerant).", "Vikram: millets three times a week.",
      "Friday dinner ordered in.", "Vikram's brother Rohan stays Saturday and Sunday this week."],
  },
};
