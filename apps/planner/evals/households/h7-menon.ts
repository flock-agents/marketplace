// 7. Young working couple, long hours: a cook on weekdays only, one visit that makes lunch and dinner (no breakfast);
// weekends mostly out or ordered in (Saturday lunch out, Saturday dinner and Sunday lunch ordered in); high protein for one;
// she eats no red meat. Frequency words: eggs every morning for Nikhil, biryani once a month.
import { avoid, dish, mains, note, SCHOOL, WEEK, type Household } from "../lib/truth";

export const h7: Household = {
  id: "h7-menon", title: "Young couple, weekday cook one visit (lunch+dinner), weekends out, high protein",
  owner: "Nikhil", intro: "You are Nikhil Menon, 30, a consultant in Bangalore who works long hours",
  household: {
    "household.people": [{ name: "Nikhil", relation: "self", age: 30, group: "adult" }, { name: "Tanya", relation: "wife", age: 29, group: "adult" }],
    "household.children": [], "household.elders": [], "household.schoolAge": false,
    "household.help": [{ role: "cook", name: "Rekha", days: "Mon-Fri", times: "10am", meals: ["Lunch", "Dinner"] }],
    "household.weekday": "Both of us out 9 to 9 most days. Lunch box from home, dinner reheated.",
    "household.mealsBy": "Tanya", "household.groceriesBy": "Nikhil",
    "household.weekly": [{ person: "Nikhil", where: "office", weekdays: SCHOOL, from: "09:00", to: "21:00", lunch: "carries" },
      { person: "Tanya", where: "office", weekdays: SCHOOL, from: "09:00", to: "21:00", lunch: "carries" }],
  },
  groceryApps: ["Zepto", "Blinkit"],
  facts: [
    { id: "pain", text: "Hardest part: we never know what to tell Rekha, and groceries run out." },
    { id: "apps", text: "Zepto mainly, Blinkit if Zepto doesn't have it." },
    { id: "people", text: "Just me and my wife Tanya (29)." },
    { id: "cook", text: "Cook Rekha comes Monday to Friday, once, at 10 in the morning, and makes lunch and dinner in one go. We make breakfast ourselves." },
    { id: "cookTime", text: "She has an hour and a half." },
    { id: "cookingDays", text: "Weekends: Saturday lunch we eat out, Saturday dinner and Sunday lunch we order in. Breakfast I make every day. Sunday dinner Tanya cooks something simple." },
    { id: "adultsBreakfast", text: "Breakfast: eggs every morning for me, Tanya has oats or a smoothie; sometimes toast." },
    { id: "adultsLunch", text: "Lunch box: chicken curry or dal, rice, a sabzi, salad. Paneer when not chicken." },
    { id: "adultsDinner", text: "Dinner: roti with chicken or paneer and a sabzi; dal sometimes. Biryani once a month on a weekend, maybe." },
    { id: "diet", text: "I'm on high protein, gym. Tanya nothing." },
    { id: "rules", text: "Tanya doesn't eat red meat, mutton or anything. Chicken, fish, eggs fine for both." },
    { id: "orderIn", text: "Saturday dinner and Sunday lunch, every week." },
    { id: "subscriptions", text: "Nothing." },
  ],
  correction: { after: "adultsLunch", line: "btw Rekha's timing changed, she comes at 11 now not 10", fact: "cook",
    corrected: "Cook Rekha comes Monday to Friday, once, at 11 in the morning, and makes lunch and dinner in one go. We make breakfast ourselves." },
  truth: {
    people: [{ name: "Nikhil", group: "adult" }, { name: "Tanya", group: "adult" }],
    cook: { name: "Rekha", days: SCHOOL, visits: [{ at: "11:00", meals: ["Lunch", "Dinner"] }] },
    familyCooks: [{ person: "Nikhil", days: WEEK }, { person: "Tanya", days: ["Sun"] }],
    slots: [
      ...mains({ Lunch: [{ day: "Sat", skip: "eaten_out" }, { day: "Sun", skip: "ordered_in" }], Dinner: [{ day: "Sat", skip: "ordered_in" }] }),
      { name: "Nikhil's breakfast", kind: "addon", addon_of: "Breakfast", usual_people: ["Nikhil"], match: /nikhil/i, optional: true },
      { name: "Tanya's breakfast", kind: "addon", addon_of: "Breakfast", usual_people: ["Tanya"], match: /tanya/i, optional: true },
    ],
    away: [],
    library: [
      ...dish("Eggs", ["Breakfast"], { frequency: "usually", alsoSlots: ["Nikhil's breakfast"] }), ...dish("Oats", ["Breakfast"], { alsoSlots: ["Tanya's breakfast"] }),
      ...dish("Smoothie", ["Breakfast"], { alsoSlots: ["Tanya's breakfast"] }), ...dish("Toast", ["Breakfast"], { frequency: "sometimes" }),
      ...dish("Chicken curry", ["Lunch"]), ...dish("Dal", ["Lunch"]), ...dish("Rice", ["Lunch"]), ...dish("Sabzi", ["Lunch", "Dinner"]), ...dish("Salad", ["Lunch"]),
      ...dish("Paneer", ["Lunch", "Dinner"]), ...dish("Roti", ["Dinner"]), ...dish("Chicken", ["Dinner"]), ...dish("Dal", ["Dinner"], { frequency: "sometimes" }),
      ...dish("Biryani", ["Dinner"], { frequency: "rarely", contains: ["chicken"] }),
    ],
    rules: [
      avoid("no_red_meat_tanya", "Tanya: no red meat", ["red_meat"], /red meat|mutton/i, { who: "Tanya" }),
      note("high_protein", "high protein for Nikhil", "Nikhil", /protein/i),
    ],
    seed: [
      { slot: "Breakfast", dishes: ["Eggs", "Oats"] }, { slot: "Breakfast", dishes: ["Eggs", "Smoothie"] }, { slot: "Breakfast", dishes: ["Eggs", "Toast"] },
      { slot: "Lunch", dishes: ["Chicken curry", "Rice", "Sabzi", "Salad"] }, { slot: "Lunch", dishes: ["Dal", "Rice", "Sabzi", "Salad"] }, { slot: "Lunch", dishes: ["Paneer", "Rice", "Sabzi", "Salad"] },
      { slot: "Dinner", dishes: ["Roti", "Chicken", "Sabzi"] }, { slot: "Dinner", dishes: ["Roti", "Paneer", "Sabzi"] }, { slot: "Dinner", dishes: ["Roti", "Dal", "Sabzi"] },
    ],
    judgeNotes: ["Rekha cooks lunch and dinner at one 11am visit on weekdays; they make breakfast.", "Saturday lunch out; Saturday dinner and Sunday lunch ordered in; Tanya cooks a simple Sunday dinner.",
      "Nikhil high protein, eggs every morning; Tanya no red meat."],
  },
};
