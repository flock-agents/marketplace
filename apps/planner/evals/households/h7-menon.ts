// 7. Young working couple, long hours: a cook on weekdays only, one visit that makes lunch and dinner (no breakfast);
// weekends mostly out or ordered in (Saturday lunch out, Saturday dinner and Sunday lunch ordered in); high protein for one;
// she eats no red meat. Frequency words: eggs every morning for Nikhil, biryani once a month.
import { avoid, SCHOOL, WEEK, type Household } from "../lib/truth";

export const h7: Household = {
  id: "h7-menon", title: "Young couple, weekday cook one visit (lunch+dinner), weekends out, high protein",
  owner: "Nikhil", intro: "You are Nikhil Menon, 30, a consultant in Bangalore who works long hours",
  household: {
    "household.people": [{ name: "Nikhil", relation: "self", age: 30, group: "adult" }, { name: "Tanya", relation: "wife", age: 29, group: "adult" }],
    "household.children": [], "household.elders": [], "household.schoolAge": false,
    "household.help": [{ role: "cook", name: "Rekha", days: "Mon-Fri", times: "10am", meals: ["Lunch", "Dinner"] }],
    "household.weekday": "Both of us out 9 to 9 most days. Lunch box from home, dinner reheated.",
    "household.mealsBy": "Tanya", "household.groceriesBy": "Nikhil",
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
    homeCook: [{ days: ["Sat", "Sun"], slots: ["Breakfast"], by: "Nikhil" }, { days: ["Sun"], slots: ["Dinner"], by: "Tanya" }],
    extraSlots: [],
    orderIn: [{ day: "Sat", slot: "Lunch", note: "eaten out" }, { day: "Sat", slot: "Dinner", note: "ordered in" }, { day: "Sun", slot: "Lunch", note: "ordered in" }],
    hardRules: [avoid("no_red_meat_tanya", "Tanya: no red meat", ["mutton", "lamb", "beef", "pork", "goat"], { who: "Tanya" })],
    softNotes: [{ id: "high_protein", who: "Nikhil", text: "high protein", re: /protein/i }],
    dishes: [
      { name: "Eggs", slots: ["Breakfast"], for: ["Nikhil"], often: "usually" }, { name: "Oats", slots: ["Breakfast"], for: ["Tanya"] }, { name: "Smoothie", slots: ["Breakfast"], for: ["Tanya"] },
      { name: "Toast", slots: ["Breakfast"], often: "sometimes" },
      { name: "Chicken curry", slots: ["Lunch"] }, { name: "Dal", slots: ["Lunch", "Dinner"] }, { name: "Rice", slots: ["Lunch"] }, { name: "Sabzi", slots: ["Lunch", "Dinner"] }, { name: "Salad", slots: ["Lunch"] },
      { name: "Paneer", slots: ["Lunch", "Dinner"] }, { name: "Roti", slots: ["Dinner"] }, { name: "Chicken", slots: ["Dinner"] }, { name: "Biryani", slots: ["Dinner"], often: "rarely" },
    ],
    examples: [
      { slot: "Lunch", words: "chicken curry or dal, rice, a sabzi, salad", parts: 4, staple: /rice/i },
      { slot: "Dinner", words: "roti with chicken or paneer and a sabzi", parts: 3, staple: /roti|chapati|phulka/i },
    ],
    judgeNotes: ["Rekha cooks lunch and dinner at one 11am visit on weekdays; they make breakfast.", "Saturday lunch out; Saturday dinner and Sunday lunch ordered in; Tanya cooks a simple Sunday dinner.",
      "Nikhil high protein; Tanya no red meat."],
  },
};
