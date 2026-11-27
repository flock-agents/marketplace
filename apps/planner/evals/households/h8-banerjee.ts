// 8. Bengali family with grandparents and a cook every day: rice + dal + bhaja + a torkari + fish curry most days, luchi on
// Sunday morning, mutton on Sunday. The grandmother is vegetarian with no onion or garlic (and no fish, no eggs); the
// grandfather diabetic, no sweets. Frequency words: fish curry most days, luchi on Sunday, kosha mangsho on Sunday.
import { avoid, dish, mains, note, SCHOOL, veg, WEEK, items, kindPart, tpl, type Household } from "../lib/truth";

export const h8: Household = {
  id: "h8-banerjee", title: "Bengali, grandparents, cook every day, fish most days, veg no-onion-garlic grandmother",
  owner: "Sourav", intro: "You are Sourav Banerjee, 42, a professor in Kolkata",
  household: {
    "household.people": [{ name: "Sourav", relation: "self", age: 42, group: "adult" }, { name: "Rituparna", relation: "wife", age: 40, group: "adult" },
      { name: "Riya", relation: "daughter", age: 12, group: "child" }, { name: "Pradip", relation: "father", age: 72, group: "elder", nicknames: [{ name: "Baba", by: "Sourav" }] },
      { name: "Gita", relation: "mother", age: 68, group: "elder", nicknames: [{ name: "Ma", by: "Sourav" }] }],
    "household.children": ["Riya"], "household.elders": ["Pradip", "Gita"], "household.schoolAge": true,
    "household.help": [{ role: "cook", name: "Mala", days: "every day", times: "8am", meals: ["Breakfast", "Lunch"] },
      { role: "cook", name: "Mala", days: "every day", times: "6pm", meals: ["Dinner"] }],
    "household.weekday": "Sourav at the university 10 to 5, Rituparna at the bank 10 to 6; both eat lunch at work. Riya's school 7 to 1. Baba and Ma at home.",
    "household.mealsBy": [{ person: "Rituparna" }], "household.groceriesBy": [{ person: "Sourav" }],
    "household.weekly": [{ person: "Sourav", where: "office", weekdays: SCHOOL, from: "10:00", to: "17:00", lunch: "away" },
      { person: "Rituparna", where: "office", weekdays: SCHOOL, from: "10:00", to: "18:00", lunch: "away" },
      { person: "Riya", where: "school", weekdays: SCHOOL, from: "07:00", to: "13:00", lunch: "away" }],
  },
  groceryApps: ["Blinkit"],
  facts: [
    { id: "pain", text: "Hardest part: deciding the menu every day, Mala asks every morning." },
    { id: "apps", text: "Blinkit, and the fish from the bazaar." },
    { id: "lunchWhere", text: "Riya takes a tiffin Monday to Friday. They eat that at school." },
    { id: "cook", text: "Cook Mala comes every day, 8 in the morning for breakfast and lunch, 6 in the evening for dinner." },
    { id: "cookTime", text: "She has time." },
    { id: "otherDays", text: "Yes, all seven days at home. Rarely, maybe Saturday dinner sometimes. No fixed day." },
    { id: "childSame", text: "Riya takes a tiffin Monday to Friday: egg roll, chowmein, sandwich. They eat that at school.", differs: true },
    { id: "familyBreakfast", text: "Breakfast: toast and egg, muri, chire bhaja; luchi with alur dom on Sunday." },
    { id: "familyLunch", text: "Lunch is bhaat, dal, ekta bhaja, ekta torkari ar maacher jhol. Fish curry most days, rui or katla. Kosha mangsho on Sunday." },
    { id: "familyDinner", text: "Dinner: roti with a torkari and dal, sometimes fish. Ma has her own veg torkari." },
    { id: "childMeals", text: "Riya has toast and egg, or muri; luchi on Sunday. Same as ours." },
    { id: "differently", text: "Baba is diabetic, no sweets at all. Ma is vegetarian: no fish, no meat, no eggs, and no onion or garlic. Baba eats everything but less oil. No beef or pork in the house. That's it." },
    { id: "subscriptions", text: "Milk packets every morning." },
  ],
  correction: { after: "cookTime", line: "sorry, Mala comes at 8:30 in the morning, not 8", fact: "cook",
    corrected: "Cook Mala comes every day, 8:30 in the morning for breakfast and lunch, 6 in the evening for dinner." },
  truth: {
    people: [{ name: "Sourav", group: "adult" }, { name: "Rituparna", group: "adult" }, { name: "Riya", group: "child", age: 12 }, { name: "Pradip", group: "elder", age: 72 }, { name: "Gita", group: "elder", age: 68 }],
    cook: { name: "Mala", days: WEEK, visits: [{ at: "08:30", meals: ["Breakfast", "Lunch"] }, { at: "18:00", meals: ["Dinner"] }] },
    familyCooks: [],
    slots: [
      ...mains(),
      { name: "Riya's tiffin", kind: "custom", usual_people: ["Riya"], days: SCHOOL, match: /tiffin|lunch ?box|school/i },
      // "Ma has her own veg torkari": her own dish beside the family's dinner.
      { name: "Gita's dinner", kind: "addon", addon_of: "Dinner", usual_people: ["Gita"], match: /gita|\bma\b|mother|grand|torkari/i },
      { name: "Gita's lunch", kind: "addon", addon_of: "Lunch", usual_people: ["Gita"], match: /gita|\bma\b|mother|grand/i, optional: true },
    ],
    // Both eat lunch at work on weekdays.
    away: [{ person: "Sourav", slots: ["Lunch"], days: SCHOOL }, { person: "Rituparna", slots: ["Lunch"], days: SCHOOL }, { person: "Riya", slots: ["Lunch"], days: SCHOOL }],
    library: [
      ...dish("Muri", ["Breakfast"]), ...dish("Chire bhaja", ["Breakfast"]),
      ...dish("Luchi", ["Breakfast"], { days: ["Sun"] }), ...dish("Alur dom", ["Breakfast"], { days: ["Sun"], kind: "Gravy", sub: "Curry" }),
      ...dish("Egg roll", ["Riya's tiffin"]), ...dish("Chowmein", ["Riya's tiffin"]),
      ...dish("Bhaat", ["Lunch"]),
      ...dish("Maacher jhol", ["Lunch"], { frequency: "usually", aka: ["Fish curry"] }), ...dish("Kosha mangsho", ["Lunch"], { days: ["Sun"] }),
      ...dish("Veg torkari", ["Gita's dinner"], { alsoSlots: ["Gita's lunch"] }),
    ],
    rules: [
      avoid("veg_gita", "Gita: vegetarian, no fish, meat or eggs", ["meat", "fish", "egg"], /vegetarian|veg/i, { who: "Gita", also: ["veg", "no_eggs"] }),
      avoid("no_og_gita", "Gita: no onion or garlic", ["onion_garlic"], /onion|garlic/i, { who: "Gita" }),
      avoid("no_sweets_pradip", "Pradip: no sweets", ["sugar"], /sweet|sugar|diabet/i, { who: "Pradip" }),
      avoid("no_beef_pork", "No beef or pork", ["beef", "pork"], /beef|pork/i),
      note("less_oil", "less oil for Pradip", "Pradip", /oil/i),
    ],
    seed: [
      { slot: "Breakfast", dishes: ["Toast", "Egg"] }, { slot: "Breakfast", dishes: ["Muri"] }, { slot: "Breakfast", dishes: ["Chire bhaja"] }, { slot: "Breakfast", dishes: ["Luchi", "Alur dom"] },
      { slot: "Riya's tiffin", dishes: ["Egg roll"] }, { slot: "Riya's tiffin", dishes: ["Chowmein"] }, { slot: "Riya's tiffin", dishes: ["Sandwich"] },
      { slot: "Lunch", dishes: ["Bhaat", "Dal", "Bhaja", "Torkari", "Maacher jhol"] }, { slot: "Lunch", dishes: ["Bhaat", "Dal", "Bhaja", "Torkari", "Maacher jhol"] },
      { slot: "Lunch", dishes: ["Bhaat", "Dal", "Bhaja", "Torkari", "Kosha mangsho"] },
      { slot: "Dinner", dishes: ["Roti", "Torkari", "Dal"] }, { slot: "Dinner", dishes: ["Roti", "Torkari", "Fish"] },
      { slot: "Gita's dinner", dishes: ["Veg torkari"] }, { slot: "Gita's dinner", dishes: ["Veg torkari"] },
    ],
    cuisines: ["bengal", "east"], cuisinesAlso: ["odisha", "indo_chinese", "continental"],
    meals: [
      { slot: "Breakfast", own: ["Muri"], templates: [tpl(["Toast", "Egg"]), tpl(["Muri"]), tpl(["Poha"]), tpl(["Puri", "Gravy"])] },
      { slot: "Riya's tiffin", templates: [tpl(["Roll"]), tpl(["Noodles"]), tpl(["Sandwich"])] },
      // Two sabzis a plate from different sub-kinds (decided 2, 17): a bhaja and a torkari.
      { slot: "Lunch", staples: ["Rice"], templates: [tpl(["Rice", "Dal", "Sabzi/Bhaja", "Sabzi/Torkari/Ghonto", "Fish & seafood"]),
        tpl(["Rice", "Dal", "Sabzi/Bhaja", "Sabzi/Torkari/Ghonto", "Mutton"])] },
      { slot: "Dinner", staples: ["Roti"], templates: [tpl(["Roti", "Sabzi/Torkari/Ghonto", "Dal"]), tpl(["Roti", "Sabzi/Torkari/Ghonto", kindPart("Fish & seafood", { words: "fish" })], "sometimes")] },
      { slot: "Gita's dinner", templates: [tpl(["Sabzi/Torkari/Ghonto"])] },
    ],
    judgeNotes: ["A Bengali home: lunch is bhaat + dal + a bhaja + a torkari + fish curry most days; luchi-alur dom Sunday morning; mutton Sunday.",
      "Gita: vegetarian (no fish, meat, eggs) and no onion or garlic: she needs her own dishes wherever the rest have fish.", "Pradip: diabetic, no sweets, less oil.", "No beef or pork.",
      "Sourav and Rituparna eat weekday lunch at work."],
  },
};
