// 16 (held out, set 2). Kerala non-vegetarian in Kochi: father at an IT park, mother a schoolteacher, both carry lunch; a
// seven-year-old with his own school lunch box. A cook comes Monday to Saturday, twice; on Sunday the father cooks and
// dinner is ordered in. No beef, no pork. Frequency words: puttu and kadala curry twice a week, fish curry most days,
// chicken biryani on Sundays, kanji and payar on Wednesdays.
import { avoid, dish, mains, MON_SAT, note, SCHOOL, items, tpl, type Household } from "../../lib/truth";

export const h16: Household = {
  id: "h16-pillai", title: "Kerala non-veg, no beef/pork, both parents out, cook Mon–Sat, son's lunch box, Sunday dinner ordered in",
  owner: "Arun", intro: "You are Arun Pillai, 40, a software lead at Infopark in Kochi",
  household: {
    "household.people": [{ name: "Arun", relation: "self", age: 40, group: "adult" }, { name: "Revathi", relation: "wife", age: 37, group: "adult" },
      { name: "Advaith", relation: "son", age: 7, group: "child" }],
    "household.children": ["Advaith"], "household.elders": [], "household.schoolAge": true,
    "household.help": [{ role: "cook", name: "Lathika", days: "Mon-Sat", times: "7am", meals: ["Breakfast", "Lunch"] },
      { role: "cook", name: "Lathika", days: "Mon-Sat", times: "5pm", meals: ["Dinner"] }],
    "household.weekday": "Arun is at Infopark 9 to 6 and Revathi teaches at a school 8 to 3:30; both carry lunch. Advaith has school 8:30 to 3:30 with a lunch box.",
    "household.mealsBy": "Revathi", "household.groceriesBy": "Arun",
    "household.weekly": [{ person: "Arun", where: "office", weekdays: SCHOOL, from: "09:00", to: "18:00", lunch: "carries" },
      { person: "Revathi", where: "school", weekdays: SCHOOL, from: "08:00", to: "15:30", lunch: "carries" },
      { person: "Advaith", where: "school", weekdays: SCHOOL, from: "08:30", to: "15:30", lunch: "away" }],
  },
  groceryApps: ["Swiggy Instamart"],
  facts: [
    { id: "pain", text: "Hardest part: telling Lathika chechi the next day's menu every evening; we keep repeating." },
    { id: "apps", text: "Groceries on Swiggy Instamart; fish from the fish stall at the market on Saturday mornings." },
    { id: "people", text: "Lives with wife Revathi (37) and son Advaith (7). Nobody else eats at home." },
    { id: "cook", text: "Cook Lathika chechi comes Monday to Saturday: 7 in the morning for breakfast and lunch (she packs all three lunches), and 5 in the evening for dinner." },
    { id: "cookTime", text: "Lathika has about an hour and a half in the morning, enough for puttu or appam and the lunch." },
    { id: "cookingDays", text: "Sunday Lathika is off. I cook on Sunday, breakfast and the biryani at lunch. Sunday dinner we order on Swiggy." },
    { id: "kidsBreakfast", text: "Advaith eats the same breakfast as us." },
    { id: "kidsLunch", text: "Advaith takes a lunch box to school Monday to Friday: lemon rice, egg fried rice, chapati roll." },
    { id: "kidsDinner", text: "Advaith eats what we eat at dinner, not too spicy for him." },
    { id: "adultsBreakfast", text: "Breakfast: puttu and kadala curry twice a week; appam with egg roast or vegetable stew; idiyappam with stew; dosa with coconut chutney." },
    { id: "adultsLunch", text: "Lunch is matta rice with fish curry most days, or sambar; a thoran like cabbage, beans or beetroot; and pappadam. On Sundays chicken biryani." },
    { id: "adultsDinner", text: "Dinner is chapati with chicken curry, egg curry or veg kurma. Kanji and payar on Wednesdays." },
    { id: "diet", text: "Nobody is on a diet." },
    { id: "rules", text: "No beef and no pork at home. Not too spicy for Advaith. Fish, chicken and eggs any day." },
    { id: "orderIn", text: "Sunday dinner we order in on Swiggy, porotta and chicken usually." },
    { id: "subscriptions", text: "Milma milk packets, 1 litre every morning." },
  ],
  correction: { after: "cookTime", line: "oh one thing, Lathika comes at 6:30 in the morning now, not 7", fact: "cook",
    corrected: "Cook Lathika chechi comes Monday to Saturday: 6:30 in the morning for breakfast and lunch (she packs all three lunches), and 5 in the evening for dinner." },
  truth: {
    people: [{ name: "Arun", group: "adult" }, { name: "Revathi", group: "adult" }, { name: "Advaith", group: "child", age: 7 }],
    cook: { name: "Lathika", days: MON_SAT, visits: [{ at: "06:30", meals: ["Breakfast", "Lunch"] }, { at: "17:00", meals: ["Dinner"] }] },
    familyCooks: [{ person: "Arun", days: ["Sun"] }],
    slots: [
      ...mains({ Dinner: [{ day: "Sun", skip: "ordered_in" }] }),
      { name: "Advaith's lunch box", kind: "custom", usual_people: ["Advaith"], days: SCHOOL, match: /lunch ?box|tiffin|school/i },
    ],
    // Advaith's weekday lunch is his lunch box; his parents carry the home lunch.
    away: [{ person: "Advaith", slots: ["Lunch"], days: SCHOOL }],
    library: [
      ...dish("Puttu", ["Breakfast"], { frequency: "2/week" }), ...dish("Kadala curry", ["Breakfast"], { frequency: "2/week" }),
      ...dish("Appam", ["Breakfast"]), ...dish("Egg roast", ["Breakfast"]), ...dish("Vegetable stew", ["Breakfast"], { aka: ["Stew", "Veg stew"] }),
      ...dish("Idiyappam", ["Breakfast"]), ...dish("Dosa", ["Breakfast"]), ...dish("Coconut chutney", ["Breakfast"]),
      ...dish("Lemon rice", ["Advaith's lunch box"]), ...dish("Egg fried rice", ["Advaith's lunch box"]), ...dish("Chapati roll", ["Advaith's lunch box"]),
      ...dish("Matta rice", ["Lunch"]), ...dish("Fish curry", ["Lunch"], { frequency: "usually" }), ...dish("Sambar", ["Lunch"]),
      ...dish("Cabbage thoran", ["Lunch"]), ...dish("Beans thoran", ["Lunch"]), ...dish("Beetroot thoran", ["Lunch"]), ...dish("Pappadam", ["Lunch"]),
      ...dish("Chicken biryani", ["Lunch"], { days: ["Sun"] }),
      ...dish("Chapati", ["Dinner"]), ...dish("Chicken curry", ["Dinner"]), ...dish("Egg curry", ["Dinner"]), ...dish("Veg kurma", ["Dinner"]),
      ...dish("Kanji and payar", ["Dinner"], { days: ["Wed"] }),
    ],
    rules: [
      avoid("no_beef_pork", "No beef and no pork", ["beef", "pork"], /no beef|no pork/i),
      note("less_spicy_kid", "not too spicy for Advaith", "Advaith", /spic/i),
    ],
    seed: [
      { slot: "Breakfast", dishes: ["Puttu", "Kadala curry"] }, { slot: "Breakfast", dishes: ["Appam", "Egg roast"] }, { slot: "Breakfast", dishes: ["Idiyappam", "Vegetable stew"] },
      { slot: "Breakfast", dishes: ["Dosa", "Coconut chutney"] }, { slot: "Breakfast", dishes: ["Puttu", "Kadala curry"] }, { slot: "Breakfast", dishes: ["Appam", "Vegetable stew"] },
      { slot: "Advaith's lunch box", dishes: ["Lemon rice"] }, { slot: "Advaith's lunch box", dishes: ["Egg fried rice"] }, { slot: "Advaith's lunch box", dishes: ["Chapati roll"] },
      { slot: "Lunch", dishes: ["Matta rice", "Fish curry", "Cabbage thoran", "Pappadam"] }, { slot: "Lunch", dishes: ["Matta rice", "Sambar", "Beans thoran", "Pappadam"] },
      { slot: "Lunch", dishes: ["Matta rice", "Fish curry", "Beetroot thoran", "Pappadam"] }, { slot: "Lunch", dishes: ["Chicken biryani"] },
      { slot: "Dinner", dishes: ["Chapati", "Chicken curry"] }, { slot: "Dinner", dishes: ["Chapati", "Veg kurma"] }, { slot: "Dinner", dishes: ["Kanji and payar"] },
      { slot: "Dinner", dishes: ["Chapati", "Egg curry"] },
    ],
    cuisines: ["kerala"], cuisinesAlso: ["south", "indo_chinese", "tamil"],
    meals: [
      { slot: "Breakfast", templates: [tpl(["Puttu", items("Kadala curry")], "2/week"), tpl(["Appam", "Egg/Egg curry"]), tpl(["Appam", "Gravy/Kerala curry"]),
        tpl(["Idiyappam", "Gravy/Kerala curry"]), tpl(["Dosa", "Chutney"])] },
      { slot: "Advaith's lunch box", templates: [tpl(["Flavoured rice"]), tpl(["Fried rice"]), tpl(["Roll"])] },
      // Rice, a curry, a thoran and pappadam; Sunday's biryani is its own dish.
      { slot: "Lunch", staples: ["Rice", "Papad"], templates: [tpl(["Rice", "Fish & seafood/Fish curry", "Sabzi/Poriyal/Thoran", "Papad"], "usually"),
        tpl(["Rice", "Rice curry/Sambar", "Sabzi/Poriyal/Thoran", "Papad"]), tpl([items("Chicken biryani")])] },
      { slot: "Dinner", staples: ["Roti"], templates: [tpl(["Roti", "Chicken"]), tpl(["Roti", "Egg/Egg curry"]), tpl(["Roti", "Gravy/Kurma"]), tpl([items("Kanji and payar")])] },
    ],
    judgeNotes: ["No beef and no pork; fish, chicken and eggs any day.", "Advaith's lunch box Monday to Friday; he is not home for weekday lunch.", "Sunday dinner is ordered in; Sunday lunch is chicken biryani."],
  },
};
