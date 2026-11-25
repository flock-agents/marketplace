// 13. Tier B: a normal Indian household WITH an elder who has no dietary needs of his own (he eats what everyone eats: no
// diabetes, no fast, no onion/garlic rule, no soft food, no own plate). Built from a real owner's answers (24 Nov), renamed.
// Varun, Anjali (speaks), Vivaan (6), Varun's father Raghavan (72); cook Shanti every day at 7, one visit for breakfast,
// the lunch boxes and dinner (reheated at 8), two hours, 3 to 4 dishes in all; Saturday dinner ordered in. Vegetarian, eggs
// only for Vivaan and Varun; Vivaan won't eat karela; Varun wants more protein. ONE lunch, cooked once: the couple carry it,
// Raghavan eats it at home. Frequency words: dal-rice-roti-sabzi most nights, rajma or chole twice a week, khichdi once.
import { avoid, dish, mains, note, SCHOOL, veg, WEEK, items, tpl, type Household } from "../lib/truth";

export const h13: Household = {
  id: "h13-familyb", title: "Tier B: elder with no diet of his own, cook every day one visit, eggs for two",
  owner: "Anjali", intro: "You are Anjali, 36, a marketing manager in Pune who works from office",
  household: {
    "household.people": [{ name: "Anjali", relation: "self", age: 36, group: "adult" }, { name: "Varun", relation: "husband", age: 38, group: "adult" },
      { name: "Vivaan", relation: "son", age: 6, group: "child" }, { name: "Raghavan", relation: "father-in-law", age: 72, group: "elder", nicknames: [{ name: "Dad", by: "Anjali" }] }],
    "household.children": ["Vivaan"], "household.elders": ["Raghavan"], "household.schoolAge": true,
    "household.help": [{ role: "cook", name: "Shanti", days: "every day", times: "7am", meals: ["Breakfast", "Lunch", "Dinner"] }],
    "household.weekday": "Varun and Anjali work from office on weekdays and carry their lunch. Vivaan goes to school and takes a tiffin. Dad is home all day.",
    "household.mealsBy": "Anjali", "household.groceriesBy": "Anjali",
    "household.weekly": [{ person: "Varun", where: "office", weekdays: SCHOOL, lunch: "carries" }, { person: "Anjali", where: "office", weekdays: SCHOOL, lunch: "carries" },
      { person: "Vivaan", where: "school", weekdays: SCHOOL, lunch: "away" }, { person: "Raghavan", where: "home", weekdays: SCHOOL, lunch: "home" }],
  },
  groceryApps: ["Blinkit"],
  facts: [
    { id: "pain", text: "Hardest part: deciding every day what Shanti should make, and Vivaan's tiffin." },
    { id: "apps", text: "Blinkit only." },
    { id: "people", text: "Husband Varun, son Vivaan (6) and Varun's father Raghavan (72), I call him Dad." },
    { id: "cook", text: "Cook Shanti comes every day at 7 in the morning and makes breakfast, the lunch boxes and dinner in one go." },
    { id: "cookTime", text: "She has two hours. Makes 3 to 4 dishes in all." },
    { id: "cookingDays", text: "Food at home all seven days, except Saturday dinner, which we order in." },
    { id: "kidsBreakfast", text: "Vivaan's breakfast last week: poha twice, idli with chutney, dosa, upma, cornflakes with milk, paratha on Sunday." },
    { id: "kidsLunch", text: "Vivaan takes a tiffin to school: sandwich, roti roll with paneer, curd rice, pasta, fruit with some snack." },
    { id: "kidsDinner", text: "Vivaan's dinner: same as everyone." },
    { id: "adultsBreakfast", text: "Adults' breakfast: poha, idli, dosa, upma, Sunday aloo paratha." },
    { id: "adultsLunch", text: "Varun and I carry roti sabzi to office. Dad has dal, rice, sabzi and curd at home." },
    { id: "adultsDinner", text: "Dinner: dal, rice, roti and a sabzi most nights, rajma or chole twice a week, khichdi once." },
    { id: "diet", text: "Varun wants more protein. Nobody else." },
    { id: "elders", text: "No, Dad eats what everyone eats, nothing different." },
    { id: "rules", text: "Vegetarian. Eggs okay for Vivaan and Varun. Vivaan won't eat karela." },
    { id: "orderIn", text: "Once a week, Saturday dinner." },
    { id: "subscriptions", text: "Milk from Country Delight." },
  ],
  // Not a wrong fact put right but a missing one added: dinner is made in the morning visit and reheated at 8.
  correction: { after: "cookingDays", line: "oh and dinner she makes in the morning itself, we just reheat it at 8", fact: "cook",
    corrected: "Cook Shanti comes every day at 7 in the morning and makes breakfast, the lunch boxes and dinner in one go; dinner is reheated at 8." },
  truth: {
    people: [{ name: "Anjali", group: "adult" }, { name: "Varun", group: "adult" }, { name: "Vivaan", group: "child", age: 6 }, { name: "Raghavan", group: "elder", age: 72 }],
    cook: { name: "Shanti", days: WEEK, visits: [{ at: "07:00", meals: ["Breakfast", "Lunch", "Dinner"] }] },
    familyCooks: [],
    slots: [
      ...mains({ Dinner: [{ day: "Sat", skip: "ordered_in" }] }),
      { name: "Vivaan's tiffin", kind: "custom", usual_people: ["Vivaan"], days: SCHOOL, match: /tiffin|lunch ?box|school/i },
      // Cornflakes are only his; a planner may give him his own breakfast add-on, or keep them on the shared breakfast.
      { name: "Vivaan's breakfast", kind: "addon", addon_of: "Breakfast", usual_people: ["Vivaan"], match: /vivaan|kid|child|son/i, optional: true },
    ],
    // The couple carry the home lunch (not away); Vivaan is at school with his tiffin.
    away: [{ person: "Vivaan", slots: ["Lunch"], days: SCHOOL }],
    library: [
      ...dish("Poha", ["Breakfast"]), ...dish("Idli", ["Breakfast"]), ...dish("Chutney", ["Breakfast"]), ...dish("Dosa", ["Breakfast"]), ...dish("Upma", ["Breakfast"]),
      ...dish("Aloo paratha", ["Breakfast"], { days: ["Sun"] }), ...dish("Cornflakes", ["Breakfast"], { alsoSlots: ["Vivaan's breakfast"], contains: ["dairy"] }),
      ...dish("Sandwich", ["Vivaan's tiffin"]), ...dish("Paneer roti roll", ["Vivaan's tiffin"], { aka: ["Roti roll"] }), ...dish("Curd rice", ["Vivaan's tiffin"]),
      ...dish("Pasta", ["Vivaan's tiffin"]), ...dish("Fruit", ["Vivaan's tiffin"]),
      // "fruit with some snack": a snack beside the fruit, any of the dry snacks (the catalog's Namkeen).
      ...dish("Snack", ["Vivaan's tiffin"], { kind: "Namkeen" }),
      ...dish("Roti", ["Lunch"]), ...dish("Sabzi", ["Lunch"]), ...dish("Dal", ["Lunch"]), ...dish("Rice", ["Lunch"]), ...dish("Curd", ["Lunch"]),
      ...dish("Dal", ["Dinner"], { frequency: "usually" }), ...dish("Rice", ["Dinner"], { frequency: "usually" }), ...dish("Roti", ["Dinner"], { frequency: "usually" }),
      ...dish("Sabzi", ["Dinner"], { frequency: "usually" }),
      // "rajma or chole twice a week": the two together twice, read as once each.
      ...dish("Rajma", ["Dinner"], { frequency: "1/week" }), ...dish("Chole", ["Dinner"], { frequency: "1/week" }), ...dish("Khichdi", ["Dinner"], { frequency: "1/week" }),
    ],
    rules: [
      veg(/vegetarian/i),
      avoid("no_eggs_anjali", "Anjali: no eggs", ["egg"], /egg/i, { who: "Anjali", also: ["no_eggs"] }),
      avoid("no_eggs_raghavan", "Raghavan: no eggs", ["egg"], /egg/i, { who: "Raghavan", also: ["no_eggs"] }),
      avoid("no_karela_vivaan", "Vivaan won't eat karela", ["karela"], /karela/i, { who: "Vivaan" }),
      note("more_protein", "more protein for Varun", "Varun", /protein/i),
      { id: "cook_limit", title: "Shanti: two hours, 3 to 4 dishes in all", hard: false, hardAny: true, what: "cap", quote: /3 to 4 dishes|two hours/i },
    ],
    seed: [
      { slot: "Breakfast", dishes: ["Poha"] }, { slot: "Breakfast", dishes: ["Poha"] }, { slot: "Breakfast", dishes: ["Idli", "Chutney"] }, { slot: "Breakfast", dishes: ["Dosa"] },
      { slot: "Breakfast", dishes: ["Upma"] }, { slot: "Breakfast", dishes: ["Cornflakes"] }, { slot: "Breakfast", dishes: ["Aloo paratha"] },
      { slot: "Vivaan's tiffin", dishes: ["Sandwich"] }, { slot: "Vivaan's tiffin", dishes: ["Paneer roti roll"] }, { slot: "Vivaan's tiffin", dishes: ["Curd rice"] },
      { slot: "Vivaan's tiffin", dishes: ["Pasta"] }, { slot: "Vivaan's tiffin", dishes: ["Fruit"] },
      { slot: "Lunch", dishes: ["Roti", "Sabzi", "Dal", "Rice", "Curd"] },
      { slot: "Dinner", dishes: ["Dal", "Rice", "Roti", "Sabzi"] }, { slot: "Dinner", dishes: ["Rajma"] }, { slot: "Dinner", dishes: ["Chole"] }, { slot: "Dinner", dishes: ["Khichdi"] },
    ],
    cuisines: ["north", "south"], cuisinesAlso: ["west", "central", "punjab", "continental"],
    meals: [
      { slot: "Breakfast", templates: [tpl(["Poha"]), tpl(["Idli", "Chutney"]), tpl(["Dosa"]), tpl(["Upma"]), tpl(["Cereal"]), tpl(["Paratha"])] },
      { slot: "Vivaan's tiffin", templates: [tpl(["Sandwich"]), tpl(["Roll"]), tpl([items("Curd rice")]), tpl(["Pasta"]), tpl(["Fruit"])] },
      { slot: "Lunch", staples: ["Roti", "Rice", "Curd"], templates: [tpl(["Roti", "Sabzi", "Dal", "Rice", "Curd"])] },
      // Rajma and chole stand alone in the seed: their plate is not stated plainly enough to score.
      { slot: "Dinner", staples: ["Roti", "Rice"], templates: [tpl(["Roti", "Rice", "Dal", "Sabzi"]), tpl(["Khichdi"])] },
    ],
    judgeNotes: ["Raghavan (72) has no diet and no rule of his own beyond no eggs: he eats what everyone eats, no own plate.",
      "One lunch cooked once (roti, sabzi, dal, rice, curd): Varun and Anjali carry it, Raghavan eats it at home; Vivaan has his tiffin on school days.",
      "Cook Shanti comes once at 7 every day, two hours, 3 to 4 dishes in all; dinner is reheated at 8.", "Saturday dinner ordered in.",
      "Vegetarian; eggs only for Vivaan and Varun; Vivaan won't eat karela; Varun wants more protein."],
  },
};
