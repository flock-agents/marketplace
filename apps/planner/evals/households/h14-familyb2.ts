// 14. Tier B: a Tamil family with both grandparents, who eat what everyone eats (no diet, no fast, no soft food, no own
// plate). Lavanya (speaks, works from home) makes breakfast every day; cook Valli Mon–Sat for lunch (8am) and dinner (6pm,
// corrected to 6:30); Lavanya cooks Sunday. Senthil carries lunch to office; Nila (15) takes a school lunch box. Vegetarian,
// eggs for Nila only. Frequency words: dosa most mornings, pongal on Sundays, sambar or rasam with rice at lunch most days,
// kootu some days, chapati and a kurma at night twice a week, an omelette for Nila some mornings.
import { avoid, dish, mains, SCHOOL, veg, WEEK, items, kindPart, tpl, type Household } from "../lib/truth";

// Their bare words that name one dish (scripts/kinds/bare-decided.md).
const DOSA = kindPart("Dosa", { dish: "Plain dosa", words: "dosa" });
const PONGAL = kindPart("Khichdi", { sub: "Pongal", dish: "Ven pongal", words: "pongal" });
const RASAM = kindPart("Rice curry", { sub: "Rasam", dish: "Tomato rasam", words: "rasam" });
const KOOTU = kindPart("Rice curry", { sub: "Kootu", dish: "Mixed vegetable kootu", words: "kootu" });

export const h14: Household = {
  id: "h14-familyb2", title: "Tier B: Tamil family, both grandparents with no diet of their own, cook Mon–Sat lunch and dinner",
  owner: "Lavanya", intro: "You are Lavanya, 42, an accountant in Chennai who works from home",
  household: {
    "household.people": [{ name: "Lavanya", relation: "self", age: 42, group: "adult" }, { name: "Senthil", relation: "husband", age: 45, group: "adult" },
      { name: "Nila", relation: "daughter", age: 15, group: "child" },
      { name: "Murugesan", relation: "father-in-law", age: 74, group: "elder", nicknames: [{ name: "Appa", by: "Lavanya" }] },
      { name: "Kamakshi", relation: "mother-in-law", age: 68, group: "elder", nicknames: [{ name: "Amma", by: "Lavanya" }] }],
    "household.children": ["Nila"], "household.elders": ["Murugesan", "Kamakshi"], "household.schoolAge": true,
    "household.help": [{ role: "cook", name: "Valli", days: "Mon-Sat", times: "8am", meals: ["Lunch"] },
      { role: "cook", name: "Valli", days: "Mon-Sat", times: "6pm", meals: ["Dinner"] }],
    "household.weekday": "Senthil at his office on weekdays, carries his lunch. Lavanya works from home. Nila's school on weekdays, she takes a lunch box. Appa and Amma at home.",
    "household.mealsBy": [{ person: "Lavanya" }], "household.groceriesBy": [{ person: "Lavanya" }],
    "household.weekly": [{ person: "Senthil", where: "office", weekdays: SCHOOL, lunch: "carries" }, { person: "Lavanya", where: "home", weekdays: SCHOOL, lunch: "home" },
      { person: "Nila", where: "school", weekdays: SCHOOL, lunch: "away" },
      { person: "Murugesan", where: "home", weekdays: SCHOOL, lunch: "home" }, { person: "Kamakshi", where: "home", weekdays: SCHOOL, lunch: "home" }],
  },
  groceryApps: ["BigBasket", "Instamart"],
  facts: [
    { id: "pain", text: "Hardest part: thinking of something different every day, everyone gets bored of the same thing." },
    { id: "apps", text: "BigBasket mostly; Instamart when something is needed quickly." },
    { id: "lunchWhere", text: "Senthil carries his lunch. Nila takes a lunch box to school." },
    { id: "cook", text: "Cook Valli comes Monday to Saturday, 8 in the morning for lunch and 6 in the evening for dinner. I make breakfast myself every day." },
    { id: "cookTime", text: "She's fine on time." },
    { id: "otherDays", text: "Sunday I cook everything. Rarely, no fixed day." },
    { id: "childSame", text: "Nila takes a lunch box to school: lemon rice, curd rice, chapati roll, tomato rice.", differs: true },
    { id: "familyBreakfast", text: "Breakfast: dosa most mornings, with chutney; idli and upma on the other days; pongal on Sundays." },
    { id: "familyLunch", text: "Senthil carries his lunch. Sambar or rasam with rice at lunch most days, with a poriyal and curd. Kootu some days." },
    { id: "familyDinner", text: "Chapati and a kurma at night twice a week. Other nights idli or dosa with sambar." },
    { id: "childMeals", text: "Nila eats the same breakfast as us. She also has an omelette some mornings. Nila has the same dinner as us." },
    { id: "differently", text: "No, nobody is on a diet. No, Appa and Amma eat what everyone eats. Vegetarian. Only Nila eats eggs, nobody else." },
    { id: "subscriptions", text: "Aavin milk packets every morning." },
  ],
  correction: { after: "cookTime", line: "oh, Valli comes at 6:30 in the evening now, not 6", fact: "cook",
    corrected: "Cook Valli comes Monday to Saturday, 8 in the morning for lunch and 6:30 in the evening for dinner. I make breakfast myself every day." },
  truth: {
    people: [{ name: "Lavanya", group: "adult" }, { name: "Senthil", group: "adult" }, { name: "Nila", group: "child", age: 15 },
      { name: "Murugesan", group: "elder", age: 74 }, { name: "Kamakshi", group: "elder", age: 68 }],
    cook: { name: "Valli", days: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"], visits: [{ at: "08:00", meals: ["Lunch"] }, { at: "18:30", meals: ["Dinner"] }] },
    familyCooks: [{ person: "Lavanya", days: WEEK }],
    slots: [
      ...mains(),
      { name: "Nila's lunch box", kind: "custom", usual_people: ["Nila"], days: SCHOOL, match: /tiffin|lunch ?box|school/i },
      // The omelette is only hers; a planner may give her own breakfast add-on, or keep it on the shared breakfast.
      { name: "Nila's breakfast", kind: "addon", addon_of: "Breakfast", usual_people: ["Nila"], match: /nila|egg|omelette/i, optional: true },
    ],
    away: [{ person: "Nila", slots: ["Lunch"], days: SCHOOL }],
    library: [
      ...dish("Plain dosa", ["Breakfast"], { frequency: "usually" }), ...dish("Idli", ["Breakfast"]),
      ...dish("Ven pongal", ["Breakfast"], { days: ["Sun"] }), ...dish("Omelette", ["Breakfast"], { frequency: "sometimes", alsoSlots: ["Nila's breakfast"] }),
      ...dish("Lemon rice", ["Nila's lunch box"]), ...dish("Curd rice", ["Nila's lunch box"]), ...dish("Chapati roll", ["Nila's lunch box"]), ...dish("Tomato rice", ["Nila's lunch box"]),
      // "Sambar or rasam with rice at lunch most days": rice, sambar and poriyal are their words for the lunch parts, no rows; the rasam
      // is their one dish of it.
      ...dish("Tomato rasam", ["Lunch"]),
      ...dish("Curd", ["Lunch"]), ...dish("Mixed vegetable kootu", ["Lunch"], { frequency: "sometimes" }),
      ...dish("Chapati", ["Dinner"], { frequency: "2/week" }), ...dish("Idli", ["Dinner"]), ...dish("Plain dosa", ["Dinner"]),
    ],
    rules: [
      veg(/vegetarian/i),
      avoid("no_eggs_lavanya", "Lavanya: no eggs", ["egg"], /egg/i, { who: "Lavanya", also: ["no_eggs"] }),
      avoid("no_eggs_senthil", "Senthil: no eggs", ["egg"], /egg/i, { who: "Senthil", also: ["no_eggs"] }),
      avoid("no_eggs_murugesan", "Murugesan: no eggs", ["egg"], /egg/i, { who: "Murugesan", also: ["no_eggs"] }),
      avoid("no_eggs_kamakshi", "Kamakshi: no eggs", ["egg"], /egg/i, { who: "Kamakshi", also: ["no_eggs"] }),
    ],
    seed: [
      { slot: "Breakfast", dishes: ["Plain dosa", "Chutney"] }, { slot: "Breakfast", dishes: ["Plain dosa", "Chutney"] }, { slot: "Breakfast", dishes: ["Plain dosa", "Chutney"] },
      { slot: "Breakfast", dishes: ["Idli", "Chutney"] }, { slot: "Breakfast", dishes: ["Upma"] }, { slot: "Breakfast", dishes: ["Ven pongal"] },
      { slot: "Nila's lunch box", dishes: ["Lemon rice"] }, { slot: "Nila's lunch box", dishes: ["Curd rice"] }, { slot: "Nila's lunch box", dishes: ["Chapati roll"] },
      { slot: "Nila's lunch box", dishes: ["Tomato rice"] },
      { slot: "Lunch", dishes: ["Rice", "Sambar", "Poriyal", "Curd"] }, { slot: "Lunch", dishes: ["Rice", "Tomato rasam", "Poriyal", "Curd"] }, { slot: "Lunch", dishes: ["Rice", "Sambar", "Mixed vegetable kootu", "Curd"] },
      { slot: "Dinner", dishes: ["Chapati", "Kurma"] }, { slot: "Dinner", dishes: ["Idli", "Sambar"] }, { slot: "Dinner", dishes: ["Plain dosa", "Sambar"] },
    ],
    cuisines: ["south", "tamil"], cuisinesAlso: ["kerala"],
    meals: [
      { slot: "Breakfast", templates: [tpl([DOSA, "Chutney"]), tpl(["Idli", "Chutney"]), tpl(["Upma"]), tpl([PONGAL])] },
      { slot: "Nila's lunch box", templates: [tpl(["Flavoured rice"]), tpl([items("Curd rice")]), tpl(["Roll"])] },
      { slot: "Lunch", staples: ["Rice", "Curd"], templates: [tpl(["Rice", "Rice curry/Sambar", "Sabzi/Poriyal/Thoran", "Curd"]), tpl(["Rice", RASAM, "Sabzi/Poriyal/Thoran", "Curd"]),
        tpl(["Rice", "Rice curry/Sambar", KOOTU, "Curd"])] },
      { slot: "Dinner", staples: ["Roti"], templates: [tpl(["Roti", "Gravy/Kurma"], "2/week"), tpl(["Idli", "Rice curry/Sambar"]), tpl([DOSA, "Rice curry/Sambar"])] },
    ],
    judgeNotes: ["Murugesan and Kamakshi have no diet or rule of their own beyond no eggs: they eat what everyone eats, no own plate.",
      "Vegetarian; only Nila eats eggs (an omelette some mornings).", "Valli cooks lunch (8am) and dinner (6:30pm) Monday to Saturday; Lavanya makes breakfast every day and cooks all of Sunday.",
      "Senthil carries the home lunch; Nila's lunch box Monday to Friday, she is not home for weekday lunch.", "Dosa most mornings, pongal on Sundays, chapati and kurma twice a week at dinner."],
  },
};
