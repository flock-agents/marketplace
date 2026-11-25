// 10 (held out). A single mother and her two-year-old: hybrid office days (Tue–Thu, daycare feeds him then), an evening
// cook on weekdays, the toddler's own mashed dinner every night (even when she orders in), a nut allergy and no sugar for
// him; fish day corrected. Not used for tuning: run only with --heldout.
import { avoid, dish, note, WEEK, SCHOOL, type Household, type Weekday } from "../../lib/truth";

const OFFICE: Weekday[] = ["Tue", "Wed", "Thu"];
export const h10: Household = {
  id: "h10-qureshi", title: "Single parent + toddler, hybrid office days, evening cook, toddler's own dinner",
  owner: "Farah", intro: "You are Farah Qureshi, 34, an HR manager in Lucknow, raising your son alone",
  household: {
    "household.people": [{ name: "Farah", relation: "self", age: 34, group: "adult" }, { name: "Zayan", relation: "son", age: 2, group: "child" }],
    "household.children": ["Zayan"], "household.elders": [], "household.schoolAge": false,
    "household.help": [{ role: "cook", name: "Shabana", days: "Mon-Fri", times: "5pm", meals: ["Dinner"] }],
    "household.weekday": "Farah works from office Tuesday to Thursday, 9 to 6, and eats at the office canteen; Monday and Friday from home. Zayan goes to daycare on her office days and they feed him lunch there.",
    "household.mealsBy": "Farah", "household.groceriesBy": "Farah",
    "household.weekly": [{ person: "Farah", where: "office", weekdays: OFFICE, from: "09:00", to: "18:00", lunch: "away" },
      { person: "Farah", where: "home", weekdays: ["Mon", "Fri"], lunch: "home" },
      { person: "Zayan", where: "daycare", weekdays: OFFICE, from: "09:00", to: "18:00", lunch: "away" }],
  },
  groceryApps: ["Instamart", "Blinkit"],
  facts: [
    { id: "pain", text: "Hardest part: planning two kinds of food every day, mine and Zayan's." },
    { id: "apps", text: "Instamart mostly, Blinkit sometimes." },
    { id: "people", text: "Just me and my son Zayan, he's 2." },
    { id: "cook", text: "Cook Shabana comes Monday to Friday at 5 in the evening, only for dinner." },
    { id: "cookTime", text: "She has an hour." },
    { id: "cookingDays", text: "I make breakfast every day, and lunch on the days I'm home. Weekends I cook dinner too." },
    { id: "kidsBreakfast", text: "Zayan had suji upma, banana pancake, idli and ragi porridge." },
    { id: "kidsLunch", text: "At home Zayan has khichdi or dal rice, mashed. On daycare days they feed him." },
    { id: "kidsDinner", text: "Zayan doesn't eat our dinner: he has khichdi, dal rice or vegetable daliya, mashed, every night." },
    { id: "adultsBreakfast", text: "Me: paratha with chai, bread omelette, or upma." },
    { id: "adultsLunch", text: "My lunch at home: dal chawal, roti and a sabzi. Chicken biryani on Sundays." },
    { id: "adultsDinner", text: "Dinner: roti with chicken curry or a sabzi and dal. Fish curry on Fridays. Mutton curry maybe once a month." },
    { id: "diet", text: "Nobody on a diet." },
    { id: "rules", text: "We eat everything, halal only, no pork. Zayan is allergic to cashews, so no nuts at all for him. No sugar for Zayan, he's only 2, and less salt." },
    { id: "orderIn", text: "Saturday dinner I order in for myself, every week." },
    { id: "subscriptions", text: "Milk from the milkman every morning." },
  ],
  correction: { after: "adultsDinner", line: "oh, fish is on Wednesdays now, not Fridays", fact: "adultsDinner",
    corrected: "Dinner: roti with chicken curry or a sabzi and dal. Fish curry on Wednesdays. Mutton curry maybe once a month." },
  truth: {
    people: [{ name: "Farah", group: "adult" }, { name: "Zayan", group: "child", age: 2 }],
    cook: { name: "Shabana", days: SCHOOL, visits: [{ at: "17:00", meals: ["Dinner"] }] },
    familyCooks: [{ person: "Farah", days: WEEK }],
    slots: [
      { name: "Breakfast", kind: "main" }, { name: "Lunch", kind: "main" },
      // Zayan never eats the family dinner: Dinner is Farah's (ordered in on Saturday); his mashed dinner is his own slot, cooked every night.
      { name: "Dinner", kind: "main", usual_people: ["Farah"], skip_days: [{ day: "Sat", skip: "ordered_in" }] },
      { name: "Zayan's dinner", kind: "custom", usual_people: ["Zayan"], match: /zayan|toddler|baby|son|kid/i },
      { name: "Zayan's breakfast", kind: "addon", addon_of: "Breakfast", usual_people: ["Zayan"], match: /zayan|toddler|baby/i, optional: true },
      { name: "Zayan's lunch", kind: "addon", addon_of: "Lunch", usual_people: ["Zayan"], match: /zayan|toddler|baby/i, optional: true },
    ],
    // On her office days both are out at lunch: no Lunch is cooked Tue–Thu.
    away: [{ person: "Farah", slots: ["Lunch"], days: OFFICE }, { person: "Zayan", slots: ["Lunch"], days: OFFICE }],
    library: [
      ...dish("Paratha", ["Breakfast"]), ...dish("Bread omelette", ["Breakfast"]), ...dish("Upma", ["Breakfast"]),
      ...dish("Banana pancake", ["Breakfast"], { alsoSlots: ["Zayan's breakfast"] }), ...dish("Idli", ["Breakfast"], { alsoSlots: ["Zayan's breakfast"] }),
      ...dish("Ragi porridge", ["Breakfast"], { alsoSlots: ["Zayan's breakfast"] }),
      ...dish("Dal chawal", ["Lunch"]), ...dish("Roti", ["Lunch", "Dinner"]), ...dish("Sabzi", ["Lunch", "Dinner"]), ...dish("Chicken biryani", ["Lunch"], { days: ["Sun"] }),
      ...dish("Khichdi", ["Lunch"], { alsoSlots: ["Zayan's lunch"] }), ...dish("Dal rice", ["Lunch"], { alsoSlots: ["Zayan's lunch"] }),
      ...dish("Chicken curry", ["Dinner"]), ...dish("Dal", ["Dinner"]), ...dish("Fish curry", ["Dinner"], { days: ["Wed"] }), ...dish("Mutton curry", ["Dinner"], { frequency: "rarely" }),
      ...dish("Khichdi", ["Zayan's dinner"]), ...dish("Dal rice", ["Zayan's dinner"]), ...dish("Vegetable daliya", ["Zayan's dinner"]),
    ],
    rules: [
      avoid("no_pork", "No pork", ["pork"], /pork/i),
      avoid("nuts_zayan", "Zayan: no nuts (cashew allergy)", ["nuts"], /cashew|nut|allerg/i, { who: "Zayan" }),
      avoid("no_sugar_zayan", "Zayan: no sugar", ["sugar"], /sugar/i, { who: "Zayan" }),
      note("less_salt_zayan", "less salt for Zayan", "Zayan", /salt/i),
    ],
    noted: [{ id: "halal", re: /halal/i }],
    seed: [
      { slot: "Breakfast", dishes: ["Paratha"] }, { slot: "Breakfast", dishes: ["Bread omelette"] }, { slot: "Breakfast", dishes: ["Upma"] },
      { slot: "Breakfast", dishes: ["Idli"] }, { slot: "Breakfast", dishes: ["Ragi porridge"] },
      { slot: "Lunch", dishes: ["Dal chawal", "Roti", "Sabzi"] }, { slot: "Lunch", dishes: ["Khichdi"] }, { slot: "Lunch", dishes: ["Chicken biryani"] },
      { slot: "Dinner", dishes: ["Roti", "Chicken curry"] }, { slot: "Dinner", dishes: ["Roti", "Sabzi", "Dal"] }, { slot: "Dinner", dishes: ["Roti", "Fish curry"] },
      { slot: "Zayan's dinner", dishes: ["Khichdi"] }, { slot: "Zayan's dinner", dishes: ["Dal rice"] }, { slot: "Zayan's dinner", dishes: ["Vegetable daliya"] },
    ],
    week: [{ kind: "guests", day: "Fri", slot: "Dinner", count: 3, occasion: "her sister's family for dinner" }],
    cuisines: ["north"], cuisinesAlso: ["punjab", "south", "central", "continental"],
    judgeNotes: ["Zayan (2) has his own mashed dinner every night (khichdi, dal rice, daliya), also on Saturday when Farah orders in for herself.",
      "Nobody is home for lunch Tuesday to Thursday.", "No pork; Zayan: no nuts (cashew allergy), no sugar, less salt.", "Fish curry on Wednesday; three guests at Friday dinner this week."],
  },
};
