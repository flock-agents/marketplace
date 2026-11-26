// 1. North Indian, both parents in office, one child with a school tiffin, a paid cook Mon–Sat twice a day; Sunday the mother
// cooks. Eggs fine, chicken only on weekends. Frequency words: parathas on weekends, rajma twice a week, Maggi on Fridays.
import { avoid, dish, mains, MON_SAT, note, SCHOOL, veg, items, tpl, type Household } from "../lib/truth";

export const h1: Household = {
  id: "h1-sharma", title: "North Indian, office parents, cook Mon–Sat, eggs OK, chicken on weekends",
  owner: "Rohit", intro: "You are Rohit Sharma, 38, a sales manager in Gurgaon",
  household: {
    "household.people": [{ name: "Rohit", relation: "self", age: 38, group: "adult" }, { name: "Neha", relation: "wife", age: 36, group: "adult" },
      { name: "Vihaan", relation: "son", age: 7, group: "child" }],
    "household.children": ["Vihaan"], "household.elders": [], "household.schoolAge": true,
    "household.help": [{ role: "cook", name: "Sunita", days: "Mon-Sat", times: "8am", meals: ["Breakfast", "Lunch"] },
      { role: "cook", name: "Sunita", days: "Mon-Sat", times: "7pm", meals: ["Dinner"] }, { role: "maid", name: "Kamla", days: "daily", times: "10am" }],
    "household.weekday": "Rohit and Neha are at office 9:30 to 7 and carry lunch from home. Vihaan has school 8 to 2, then a day care till 6.",
    "household.mealsBy": [{ person: "Neha" }], "household.groceriesBy": [{ person: "Neha" }],
    "household.weekly": [{ person: "Rohit", where: "office", weekdays: SCHOOL, from: "09:30", to: "19:00", lunch: "carries" },
      { person: "Neha", where: "office", weekdays: SCHOOL, from: "09:30", to: "19:00", lunch: "carries" },
      { person: "Vihaan", where: "school", weekdays: SCHOOL, from: "08:00", to: "18:00", lunch: "away" }],
  },
  groceryApps: ["Blinkit", "BigBasket"],
  facts: [
    { id: "pain", text: "Hardest part: deciding what to make every day; Sunita keeps asking." },
    { id: "apps", text: "Groceries on Blinkit mostly, BigBasket for the monthly stuff." },
    { id: "lunchWhere", text: "Lives with wife Neha (36) and son Vihaan (7). Nobody else eats at home." },
    { id: "cook", text: "Cook Sunita comes Monday to Saturday: 8 in the morning for breakfast and lunch (she also packs Vihaan's tiffin), and 7 in the evening for dinner." },
    { id: "cookTime", text: "Sunita has enough time, about two hours in the morning." },
    { id: "otherDays", text: "On Sunday Sunita is off and Neha cooks all three meals. We order dinner on Sunday night from Zomato. Order in once a week, Sunday dinner from Zomato." },
    { id: "childSame", text: "Vihaan takes a school tiffin Monday to Friday: sandwich, paratha roll, poha; Maggi on Fridays as a treat. After day care he eats what we eat.", differs: true },
    { id: "familyBreakfast", text: "Adults' breakfast: poha, besan chilla, bread omelette; parathas on weekends." },
    { id: "familyLunch", text: "Lunch is dal, chawal, roti, ek sabzi aur raita; rajma chawal twice a week; sabzi like aloo gobi, bhindi, lauki." },
    { id: "familyDinner", text: "Dinner is roti, dal and a sabzi; paneer bhurji or matar paneer; chicken curry on Saturday and Sunday." },
    { id: "childMeals", text: "Vihaan's breakfast last week: poha, bread omelette, aloo paratha, and cornflakes with milk on busy days. Vihaan eats what we eat at dinner, less spicy." },
    { id: "differently", text: "Nobody is on a diet. Eggs are fine any day. Non-veg (chicken) only on weekends, Saturday and Sunday, never on weekdays. Less spicy for Vihaan." },
    { id: "subscriptions", text: "Mother Dairy milk from the milkman, 1 litre daily." },
  ],
  correction: { after: "cookTime", line: "oh and evening Sunita comes at 7:30 now, not 7", fact: "cook",
    corrected: "Cook Sunita comes Monday to Saturday: 8 in the morning for breakfast and lunch (she also packs Vihaan's tiffin), and 7:30 in the evening for dinner." },
  truth: {
    people: [{ name: "Rohit", group: "adult" }, { name: "Neha", group: "adult" }, { name: "Vihaan", group: "child", age: 7 }],
    cook: { name: "Sunita", days: MON_SAT, visits: [{ at: "08:00", meals: ["Breakfast", "Lunch"] }, { at: "19:30", meals: ["Dinner"] }] },
    familyCooks: [{ person: "Neha", days: ["Sun"] }],
    slots: [
      ...mains({ Dinner: [{ day: "Sun", skip: "ordered_in" }] }),
      { name: "Vihaan's tiffin", kind: "custom", usual_people: ["Vihaan"], days: SCHOOL, match: /tiffin|lunch ?box|school/i },
    ],
    // Vihaan's weekday lunch is his school tiffin (day care till 6); his parents carry the home lunch.
    away: [{ person: "Vihaan", slots: ["Lunch"], days: SCHOOL }],
    library: [
      ...dish("Bread omelette", ["Breakfast"]), ...dish("Aloo paratha", ["Breakfast"], { days: ["Sat", "Sun"] }),
      ...dish("Cornflakes", ["Breakfast"], { frequency: "sometimes", contains: ["dairy"] }), ...dish("Besan chilla", ["Breakfast"]),
      ...dish("Paratha roll", ["Vihaan's tiffin"], { kind: "Roll" }), ...dish("Maggi", ["Vihaan's tiffin"], { days: ["Fri"] }),
      ...dish("Chawal", ["Lunch"]),
      ...dish("Rajma chawal", ["Lunch"], { frequency: "2/week" }), ...dish("Aloo gobi", ["Lunch"]), ...dish("Bhindi", ["Lunch"], { kind: "Sabzi" }), ...dish("Lauki", ["Lunch"], { kind: "Sabzi" }),
      ...dish("Aloo gobi", ["Dinner"], { unsaid: true }), ...dish("Bhindi", ["Dinner"], { unsaid: true, kind: "Sabzi" }), ...dish("Lauki", ["Dinner"], { unsaid: true, kind: "Sabzi" }),
      ...dish("Paneer bhurji", ["Dinner"]), ...dish("Matar paneer", ["Dinner"]), ...dish("Chicken curry", ["Dinner"], { days: ["Sat", "Sun"] }),
    ],
    rules: [
      avoid("nonveg_weekends", "Chicken (non-veg) only on Saturday and Sunday", ["meat"], /weekend|weekday|saturday and sunday/i, { days: SCHOOL, also: ["only"] }),
      note("less_spicy_kid", "less spicy for Vihaan", "Vihaan", /spic/i),
    ],
    seed: [
      { slot: "Breakfast", dishes: ["Poha"] }, { slot: "Breakfast", dishes: ["Bread omelette"] }, { slot: "Breakfast", dishes: ["Aloo paratha"] },
      { slot: "Breakfast", dishes: ["Besan chilla"] }, { slot: "Breakfast", dishes: ["Cornflakes"] },
      { slot: "Vihaan's tiffin", dishes: ["Sandwich"] }, { slot: "Vihaan's tiffin", dishes: ["Paratha roll"] }, { slot: "Vihaan's tiffin", dishes: ["Poha"] }, { slot: "Vihaan's tiffin", dishes: ["Maggi"] },
      { slot: "Lunch", dishes: ["Dal", "Chawal", "Roti", "Aloo gobi", "Raita"] }, { slot: "Lunch", dishes: ["Rajma chawal", "Raita"] }, { slot: "Lunch", dishes: ["Dal", "Chawal", "Roti", "Bhindi", "Raita"] },
      { slot: "Dinner", dishes: ["Roti", "Dal", "Lauki"] }, { slot: "Dinner", dishes: ["Roti", "Matar paneer"] }, { slot: "Dinner", dishes: ["Roti", "Dal", "Paneer bhurji"] },
    ],
    cuisines: ["north"], cuisinesAlso: ["punjab", "central", "west", "continental", "indo_chinese"],
    meals: [
      { slot: "Breakfast", templates: [tpl(["Poha"]), tpl(["Egg/Eggs"]), tpl(["Paratha"]), tpl(["Chilla"]), tpl(["Cereal"])] },
      { slot: "Vihaan's tiffin", templates: [tpl(["Poha"]), tpl(["Sandwich"]), tpl(["Roll"]), tpl(["Noodles"])] },
      // Rajma chawal is their one dish (twice a week), with its raita; every other lunch is the full plate.
      { slot: "Lunch", staples: ["Roti", "Rice", "Raita"], templates: [tpl(["Roti", "Rice", "Dal", "Sabzi", "Raita"]), tpl([items("Rajma chawal"), "Raita"], "2/week")] },
      { slot: "Dinner", staples: ["Roti"], templates: [tpl(["Roti", "Dal", "Sabzi"]), tpl(["Roti", "Gravy/Paneer"])] },
    ],
    judgeNotes: ["Chicken only on Saturday and Sunday; eggs any day.", "Vihaan's tiffin Monday to Friday only; he is not home for weekday lunch.", "Sunday dinner is ordered in."],
  },
};
