// 9 (held out). Jain joint family in Ahmedabad with a morning-only cook; the grandmother eats before sunset (her own early
// dinner, not at the family's), no root vegetables for anyone, tithi days for her (not a weekday), eating out one night a
// week (corrected day). Not used for tuning: run only with --heldout.
import { avoid, dish, mains, note, WEEK, type Household } from "../../lib/truth";

export const h9: Household = {
  id: "h9-mehta", title: "Jain joint family, morning cook, grandmother's early dinner, eating out one night",
  owner: "Hitesh", intro: "You are Hitesh Mehta, 48, who runs a diamond-trading office in Ahmedabad",
  household: {
    "household.people": [{ name: "Hitesh", relation: "self", age: 48, group: "adult" }, { name: "Bhavna", relation: "wife", age: 46, group: "adult" },
      { name: "Dhruv", relation: "son", age: 17, group: "child" }, { name: "Kantaben", relation: "mother", age: 76, group: "elder", nicknames: [{ name: "Ba", by: "Hitesh" }] }],
    "household.children": ["Dhruv"], "household.elders": ["Kantaben"], "household.schoolAge": true,
    "household.help": [{ role: "cook", name: "Ramila", days: "daily", times: "8am", meals: ["Breakfast", "Lunch"] }],
    "household.weekday": "Hitesh at the office 10 to 7, Monday to Saturday, takes his dabba. Dhruv's school 7:30 to 1:30, home for lunch. Bhavna and Ba at home.",
    "household.mealsBy": [{ person: "Bhavna" }], "household.groceriesBy": [{ person: "Bhavna" }],
    "household.weekly": [{ person: "Hitesh", where: "office", weekdays: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"], from: "10:00", to: "19:00", lunch: "carries" },
      { person: "Dhruv", where: "school", weekdays: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"], from: "07:30", to: "13:30", lunch: "home" }],
  },
  groceryApps: ["BigBasket", "Zepto"],
  facts: [
    { id: "pain", text: "Hardest part: Jain food every day without repeating, and Ba's early dinner." },
    { id: "apps", text: "BigBasket for the monthly things, Zepto for daily." },
    { id: "lunchWhere", text: "Dhruv eats lunch at home after school, same as us." },
    { id: "cook", text: "Cook Ramila comes every day at 8 in the morning and makes breakfast and lunch." },
    { id: "cookTime", text: "She has about two hours, no rush." },
    { id: "otherDays", text: "Ramila comes all seven days, only mornings. Bhavna makes dinner every night. One night a week we eat out. We never order in. Saturday dinner we go out to a Jain restaurant." },
    { id: "childSame", text: "Dhruv eats lunch at home after school, same as us.", differs: false },
    { id: "familyBreakfast", text: "Breakfast: thepla, khakhra, poha without onion or potato; dhokla on Sunday." },
    { id: "familyLunch", text: "Lunch: rotli, dal, bhaat and one shaak, tindora, bhindi or cabbage; kadhi sometimes instead of dal. Dal dhokli on Sundays." },
    { id: "familyDinner", text: "Dinner: khichdi and kadhi twice a week; other nights bhakri or thepla with a shaak." },
    { id: "childMeals", text: "Dhruv had thepla, khakhra, poha, and dhokla on Sunday. Same as us." },
    { id: "differently", text: "I have high cholesterol, so less oil for me. Nobody else. Ba eats before sunset, so her dinner is at 5:30, on her own: khichdi or thepla, and doodh every day. She doesn't sit for our dinner. We are Jain: no onion, no garlic, no potato or any root vegetables, no eggs, no meat. On ashtami and chaudas Ba doesn't eat green vegetables." },
    { id: "subscriptions", text: "Amul milk, 2 litres every morning." },
  ],
  correction: { after: "otherDays", line: "sorry, it's Sunday dinner we eat out, not Saturday", fact: "otherDays",
    corrected: "Ramila comes all seven days, only mornings. Bhavna makes dinner every night. One night a week we eat out. We never order in. Sunday dinner we go out to a Jain restaurant." },
  truth: {
    people: [{ name: "Hitesh", group: "adult" }, { name: "Bhavna", group: "adult" }, { name: "Dhruv", group: "child", age: 17 }, { name: "Kantaben", group: "elder", age: 76 }],
    cook: { name: "Ramila", days: WEEK, visits: [{ at: "08:00", meals: ["Breakfast", "Lunch"] }] },
    familyCooks: [],
    slots: [
      { name: "Breakfast", kind: "main" }, { name: "Lunch", kind: "main" },
      // Ba doesn't sit for the family's dinner: Dinner is the other three's, her early dinner a slot of her own, made at home
      // even on the night the rest eat out.
      { name: "Dinner", kind: "main", usual_people: ["Hitesh", "Bhavna", "Dhruv"], skip_days: [{ day: "Sun", skip: "eaten_out" }] },
      { name: "Ba's dinner", kind: "custom", usual_people: ["Kantaben"], match: /\bba\b|kantaben|early|sunset|5:30/i },
    ],
    away: [],
    library: [
      ...dish("Thepla", ["Breakfast", "Dinner", "Ba's dinner"]), ...dish("Khakhra", ["Breakfast"]), ...dish("Poha", ["Breakfast"]), ...dish("Dhokla", ["Breakfast"], { days: ["Sun"] }),
      ...dish("Rotli", ["Lunch"]), ...dish("Dal", ["Lunch"]), ...dish("Bhaat", ["Lunch"]),
      ...dish("Tindora shaak", ["Lunch"]), ...dish("Bhindi shaak", ["Lunch"], { kind: "Sabzi" }), ...dish("Cabbage shaak", ["Lunch"], { kind: "Sabzi" }),
      ...dish("Tindora shaak", ["Dinner"], { unsaid: true }), ...dish("Bhindi shaak", ["Dinner"], { unsaid: true, kind: "Sabzi" }), ...dish("Cabbage shaak", ["Dinner"], { unsaid: true, kind: "Sabzi" }),
      ...dish("Kadhi", ["Lunch"], { frequency: "sometimes" }), ...dish("Dal dhokli", ["Lunch"], { days: ["Sun"] }),
      ...dish("Khichdi", ["Dinner"], { frequency: "2/week" }), ...dish("Kadhi", ["Dinner"], { frequency: "2/week" }), ...dish("Bhakri", ["Dinner"]),
      ...dish("Khichdi", ["Ba's dinner"]), ...dish("Doodh", ["Ba's dinner"], { frequency: "daily", contains: ["dairy"] }),
    ],
    rules: [
      avoid("jain", "Jain: no onion, garlic, root vegetables, eggs or meat", ["meat", "fish", "egg", "onion_garlic", "root_veg"], /jain|onion|garlic|root|potato/i, { also: ["veg", "no_eggs"] }),
      note("less_oil", "less oil for Hitesh", "Hitesh", /oil|cholesterol/i),
    ],
    noted: [{ id: "tithi", who: "Kantaben", re: /ashtami|chaudas|green vegetables/i }],
    seed: [
      { slot: "Breakfast", dishes: ["Thepla"] }, { slot: "Breakfast", dishes: ["Khakhra"] }, { slot: "Breakfast", dishes: ["Poha"] }, { slot: "Breakfast", dishes: ["Dhokla"] },
      { slot: "Lunch", dishes: ["Rotli", "Dal", "Bhaat", "Tindora shaak"] }, { slot: "Lunch", dishes: ["Rotli", "Dal", "Bhaat", "Bhindi shaak"] },
      { slot: "Lunch", dishes: ["Rotli", "Kadhi", "Bhaat", "Cabbage shaak"] }, { slot: "Lunch", dishes: ["Dal dhokli"] },
      { slot: "Dinner", dishes: ["Khichdi", "Kadhi"] }, { slot: "Dinner", dishes: ["Bhakri", "Bhindi shaak"] }, { slot: "Dinner", dishes: ["Thepla", "Cabbage shaak"] },
      { slot: "Ba's dinner", dishes: ["Khichdi", "Doodh"] }, { slot: "Ba's dinner", dishes: ["Thepla", "Doodh"] },
    ],
    week: [{ kind: "away", person: "Dhruv", days: ["Thu", "Fri"], dated: { person: "Dhruv", what: "school trip to Udaipur", from: "2026-12-03", to: "2026-12-04" } }],
    cuisines: ["gujarat", "west"], cuisinesAlso: ["north", "rajasthan", "central"],
    judgeNotes: ["Jain: no onion, garlic, potato or any root vegetable, no eggs or meat, for everyone.", "Ba (Kantaben) has her own early dinner at 5:30 (khichdi or thepla with milk), even on Sunday when the rest eat out.",
      "Hitesh: less oil.", "Dhruv is away on a school trip Thursday and Friday this week."],
  },
};
