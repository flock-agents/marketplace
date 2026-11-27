// 17 (held out, set 2). North–South home in Bengaluru: a Tamil father at office, a Punjabi mother who works from home, the
// father's mother living with them (eats everything, no diet of her own) and a six-year-old with a school lunch box. A cook
// comes Monday to Saturday, twice; on Sunday the mother cooks and the family goes out for dinner. Eggs and chicken, but none
// on Tuesdays. Frequency words: aloo paratha on Sundays, curd every day at lunch, rajma chawal on Wednesdays, chicken curry
// twice a week, paneer butter masala sometimes, paneer roll on Thursdays (after the correction).
import { avoid, dish, mains, MON_SAT, note, SCHOOL, items, kindPart, tpl, type Household } from "../../lib/truth";

// Their bare words that name one dish (scripts/kinds/bare-decided.md).
const DOSA = kindPart("Dosa", { dish: "Plain dosa", words: "dosa" });

export const h17: Household = {
  id: "h17-subramanian", title: "Tamil–Punjabi, grandmother with no diet of her own, cook Mon–Sat, son's lunch box, no non-veg on Tuesdays",
  owner: "Karthik", intro: "You are Karthik Subramanian, 39, a product manager in Bengaluru",
  household: {
    "household.people": [{ name: "Karthik", relation: "self", age: 39, group: "adult" }, { name: "Simran", relation: "wife", age: 37, group: "adult" },
      { name: "Lakshmi", relation: "mother", age: 67, group: "elder" }, { name: "Ishaan", relation: "son", age: 6, group: "child" }],
    "household.children": ["Ishaan"], "household.elders": ["Lakshmi"], "household.schoolAge": true,
    "household.help": [{ role: "cook", name: "Manjula", days: "Mon-Sat", times: "7:30am", meals: ["Breakfast", "Lunch"] },
      { role: "cook", name: "Manjula", days: "Mon-Sat", times: "6:30pm", meals: ["Dinner"] }, { role: "maid", name: "Shanthi", days: "daily", times: "8am" }],
    "household.weekday": "Karthik is at office 9:30 to 7 and carries lunch. Simran works from home and Amma is home all day. Ishaan has school 8:30 to 3 and takes a lunch box.",
    "household.mealsBy": [{ person: "Simran" }], "household.groceriesBy": [{ person: "Simran" }],
    "household.weekly": [{ person: "Karthik", where: "office", weekdays: SCHOOL, from: "09:30", to: "19:00", lunch: "carries" },
      { person: "Ishaan", where: "school", weekdays: SCHOOL, from: "08:30", to: "15:00", lunch: "away" }],
  },
  groceryApps: ["Zepto"],
  facts: [
    { id: "pain", text: "Hardest part: balancing my side's South Indian food and Simran's North Indian food so everyone is happy." },
    { id: "apps", text: "Groceries on Zepto, almost everything." },
    { id: "lunchWhere", text: "Ishaan takes a lunch box to school Monday to Friday." },
    { id: "cook", text: "Cook Manjula comes Monday to Saturday: 7:30 in the morning for breakfast and lunch (she packs my lunch and Ishaan's lunch box), and 6:30 in the evening for dinner." },
    { id: "cookTime", text: "Manjula has about two hours in the morning, an hour in the evening." },
    { id: "otherDays", text: "On Sunday Manjula is off; Simran cooks breakfast and lunch, and Sunday dinner we all go out. Sunday dinner we go out, all four of us. We don't order in much otherwise." },
    { id: "childSame", text: "Ishaan takes a lunch box to school Monday to Friday: mini idli, veg pulao, paneer roll on Fridays.", differs: true },
    { id: "familyBreakfast", text: "Breakfast: idli with sambar and coconut chutney, dosa with chutney, rava upma, poha; aloo paratha with curd on Sundays." },
    { id: "familyLunch", text: "Lunch has both rice and roti: sambar or dal, a poriyal or sabzi like beans poriyal, cabbage poriyal or aloo gobi, and curd every day. Rajma chawal on Wednesdays." },
    { id: "familyDinner", text: "Dinner is roti with dal tadka and a sabzi like bhindi masala; chicken curry twice a week; egg curry; paneer butter masala sometimes." },
    { id: "childMeals", text: "Ishaan eats what we eat at breakfast. Ishaan eats what we eat at dinner, less spicy." },
    { id: "differently", text: "Nobody is on a diet. Amma (Lakshmi) eats everything we eat, no restrictions. No chicken or eggs on Tuesdays, Simran's family keeps that. Less spicy for Ishaan." },
    { id: "subscriptions", text: "Nandini milk, 2 packets every morning." },
  ],
  correction: { after: "childSame", line: "wait, paneer roll is Thursdays, not Fridays", fact: "childSame",
    corrected: "Ishaan takes a lunch box to school Monday to Friday: mini idli, veg pulao, paneer roll on Thursdays." },
  truth: {
    people: [{ name: "Karthik", group: "adult" }, { name: "Simran", group: "adult" }, { name: "Lakshmi", group: "elder" }, { name: "Ishaan", group: "child", age: 6 }],
    cook: { name: "Manjula", days: MON_SAT, visits: [{ at: "07:30", meals: ["Breakfast", "Lunch"] }, { at: "18:30", meals: ["Dinner"] }] },
    familyCooks: [{ person: "Simran", days: ["Sun"] }],
    slots: [
      ...mains({ Dinner: [{ day: "Sun", skip: "eaten_out" }] }),
      { name: "Ishaan's lunch box", kind: "custom", usual_people: ["Ishaan"], days: SCHOOL, match: /lunch ?box|tiffin|school/i },
    ],
    // Ishaan's weekday lunch is his lunch box; Karthik carries the home lunch; Simran and Amma eat lunch at home.
    away: [{ person: "Ishaan", slots: ["Lunch"], days: SCHOOL }],
    library: [
      ...dish("Idli", ["Breakfast"]), ...dish("Coconut chutney", ["Breakfast"]), ...dish("Plain dosa", ["Breakfast"]),
      ...dish("Rava upma", ["Breakfast"]), ...dish("Aloo paratha", ["Breakfast"], { days: ["Sun"] }), ...dish("Curd", ["Breakfast"], { days: ["Sun"] }),
      ...dish("Mini idli", ["Ishaan's lunch box"]), ...dish("Veg pulao", ["Ishaan's lunch box"]), ...dish("Paneer roll", ["Ishaan's lunch box"], { days: ["Thu"] }),
      ...dish("Curd", ["Lunch"], { frequency: "daily" }),
      ...dish("Beans poriyal", ["Lunch"]), ...dish("Cabbage poriyal", ["Lunch"]), ...dish("Aloo gobi", ["Lunch"]), ...dish("Rajma chawal", ["Lunch"], { days: ["Wed"] }),
      ...dish("Dal tadka", ["Dinner"]), ...dish("Bhindi masala", ["Dinner"]), ...dish("Chicken curry", ["Dinner"], { frequency: "2/week" }),
      ...dish("Egg curry", ["Dinner"]), ...dish("Paneer butter masala", ["Dinner"], { frequency: "sometimes" }),
    ],
    rules: [
      avoid("no_nonveg_tue", "No chicken or eggs on Tuesdays", ["chicken", "egg"], /tuesday/i, { days: ["Tue"] }),
      note("less_spicy_kid", "less spicy for Ishaan", "Ishaan", /spic/i),
    ],
    seed: [
      { slot: "Breakfast", dishes: ["Idli", "Sambar", "Coconut chutney"] }, { slot: "Breakfast", dishes: ["Plain dosa", "Coconut chutney"] }, { slot: "Breakfast", dishes: ["Rava upma"] },
      { slot: "Breakfast", dishes: ["Poha"] }, { slot: "Breakfast", dishes: ["Aloo paratha", "Curd"] },
      { slot: "Ishaan's lunch box", dishes: ["Mini idli"] }, { slot: "Ishaan's lunch box", dishes: ["Veg pulao"] }, { slot: "Ishaan's lunch box", dishes: ["Paneer roll"] },
      { slot: "Lunch", dishes: ["Rice", "Roti", "Sambar", "Beans poriyal", "Curd"] }, { slot: "Lunch", dishes: ["Rice", "Roti", "Dal", "Aloo gobi", "Curd"] },
      { slot: "Lunch", dishes: ["Rajma chawal", "Curd"] }, { slot: "Lunch", dishes: ["Rice", "Roti", "Sambar", "Cabbage poriyal", "Curd"] },
      { slot: "Dinner", dishes: ["Roti", "Dal tadka", "Bhindi masala"] }, { slot: "Dinner", dishes: ["Roti", "Chicken curry"] }, { slot: "Dinner", dishes: ["Roti", "Egg curry"] },
      { slot: "Dinner", dishes: ["Roti", "Paneer butter masala"] },
    ],
    cuisines: ["north", "south"], cuisinesAlso: ["tamil", "karnataka", "punjab", "central", "kerala"],
    meals: [
      { slot: "Breakfast", templates: [tpl(["Idli", "Rice curry/Sambar", "Chutney"]), tpl([DOSA, "Chutney"]), tpl(["Upma"]), tpl(["Poha"]), tpl(["Paratha", "Curd"])] },
      { slot: "Ishaan's lunch box", templates: [tpl(["Idli"]), tpl(["Pulao"]), tpl(["Roll"])] },
      // Rice and roti both, sambar or dal, a poriyal or sabzi, curd every day; Wednesday's rajma chawal with curd.
      { slot: "Lunch", staples: ["Rice", "Roti", "Curd"], templates: [tpl(["Rice", "Roti", "Rice curry/Sambar", "Sabzi", "Curd"]), tpl(["Rice", "Roti", "Dal", "Sabzi", "Curd"]),
        tpl([items("Rajma chawal"), "Curd"])] },
      { slot: "Dinner", staples: ["Roti"], templates: [tpl(["Roti", "Dal", "Sabzi"]), tpl(["Roti", "Chicken"], "2/week"), tpl(["Roti", "Egg/Egg curry"]), tpl(["Roti", "Gravy/Paneer"], "sometimes")] },
    ],
    judgeNotes: ["No chicken or eggs on Tuesdays; otherwise both are fine.", "Ishaan's lunch box Monday to Friday; he is not home for weekday lunch.", "Lakshmi (Amma) eats what everyone eats.", "Sunday dinner is eaten out."],
  },
};
