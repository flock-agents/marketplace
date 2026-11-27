// 2. South Indian (Tamil), one child, the wife cooks every meal, no cook; vegetarian, no eggs; the husband carries lunch to
// office. Frequency words: curd rice when Ananya's not well, pongal on Sundays. Correction: the order-in night.
import { avoid, dish, mains, noEggs, note, SCHOOL, veg, WEEK, items, kindPart, tpl, type Household } from "../lib/truth";

// Their bare words that name one dish (scripts/kinds/bare-decided.md).
const DOSA = kindPart("Dosa", { dish: "Plain dosa", words: "dosa" });
const PONGAL = kindPart("Khichdi", { sub: "Pongal", dish: "Ven pongal", words: "pongal" });
const RASAM = kindPart("Rice curry", { sub: "Rasam", dish: "Tomato rasam", words: "rasam" });
const KOOTU = kindPart("Rice curry", { sub: "Kootu", dish: "Mixed vegetable kootu", words: "kootu" });

export const h2: Household = {
  id: "h2-iyer", title: "South Indian veg, wife cooks every meal, no cook",
  owner: "Karthik", intro: "You are Karthik Iyer, 36, an engineer in Chennai",
  household: {
    "household.people": [{ name: "Karthik", relation: "self", age: 36, group: "adult" }, { name: "Meenakshi", relation: "wife", age: 33, group: "adult" },
      { name: "Ananya", relation: "daughter", age: 5, group: "child" }],
    "household.children": ["Ananya"], "household.elders": [], "household.schoolAge": true,
    "household.help": [{ role: "maid", name: "Selvi", days: "Mon-Sat", times: "7am" }],
    "household.weekday": "Karthik is at office 9 to 6 and takes his lunch box. Meenakshi works from home. Ananya has playschool 9 to 12, lunch at home.",
    "household.mealsBy": [{ person: "Meenakshi" }], "household.groceriesBy": [{ person: "Karthik" }],
    "household.weekly": [{ person: "Karthik", where: "office", weekdays: SCHOOL, from: "09:00", to: "18:00", lunch: "carries" },
      { person: "Meenakshi", where: "home", weekdays: SCHOOL, lunch: "home" },
      { person: "Ananya", where: "school", weekdays: SCHOOL, from: "09:00", to: "12:00", lunch: "home" }],
  },
  groceryApps: ["Instamart"],
  facts: [
    { id: "pain", text: "Hardest part: remembering to order what the meals need." },
    { id: "apps", text: "Only Instamart." },
    { id: "lunchWhere", text: "Ananya eats lunch at home after playschool, same as us. Karthik takes the same in his lunch box." },
    { id: "otherDays", text: "No cook. Meenakshi cooks every meal, all seven days. We order in one night a week, Friday dinner. Once a week, Friday dinner, usually from a Saravana Bhavan on Swiggy." },
    { id: "childSame", text: "Ananya eats lunch at home after playschool, same as us, rice with sambar or rasam and curd. Curd rice when she's not well.", differs: false },
    { id: "familyBreakfast", text: "Breakfast: idli, dosa, upma, pongal on Sundays; with coconut chutney and sambar." },
    { id: "familyLunch", text: "Lunch is rice, sambar, rasam, a poriyal and curd. Karthik takes the same in his lunch box. Poriyal like beans, cabbage, carrot; kootu sometimes." },
    { id: "familyDinner", text: "Dinner: dosa or chapati with kurma, sometimes uthappam; and rasam rice if it's late." },
    { id: "childMeals", text: "Ananya's breakfast: idli, dosa, sometimes ragi porridge; same as us mostly. Ananya's dinner same as ours, less spicy." },
    { id: "differently", text: "No diets. Pure vegetarian, no eggs. Karthik won't touch brinjal. Less spicy for Ananya." },
    { id: "subscriptions", text: "Aavin milk packets every morning from the milkman." },
  ],
  correction: { after: "otherDays", line: "sorry, saturday dinner we order, not friday", fact: "otherDays",
    corrected: "No cook. Meenakshi cooks every meal, all seven days. We order in one night a week, Saturday dinner. Once a week, Saturday dinner, usually from a Saravana Bhavan on Swiggy." },
  truth: {
    people: [{ name: "Karthik", group: "adult" }, { name: "Meenakshi", group: "adult" }, { name: "Ananya", group: "child", age: 5 }],
    cook: null,
    familyCooks: [{ person: "Meenakshi", days: WEEK }],
    slots: [
      ...mains({ Dinner: [{ day: "Sat", skip: "ordered_in" }] }),
      // Her breakfast is the family's "mostly": an add-on for the porridge is fine, not needed.
      { name: "Ananya's breakfast", kind: "addon", addon_of: "Breakfast", usual_people: ["Ananya"], match: /ananya/i, optional: true },
    ],
    away: [],
    library: [
      ...dish("Idli", ["Breakfast"]), ...dish("Plain dosa", ["Breakfast", "Dinner"]), ...dish("Ven pongal", ["Breakfast"], { days: ["Sun"] }),
      ...dish("Ragi porridge", ["Breakfast"], { frequency: "sometimes", alsoSlots: ["Ananya's breakfast"] }),
      ...dish("Coconut chutney", ["Breakfast"]),
      ...dish("Tomato rasam", ["Lunch"]), ...dish("Curd", ["Lunch"]),
      ...dish("Beans poriyal", ["Lunch"]), ...dish("Cabbage poriyal", ["Lunch"]), ...dish("Carrot poriyal", ["Lunch"]), ...dish("Mixed vegetable kootu", ["Lunch"], { frequency: "sometimes" }),
      ...dish("Curd rice", ["Lunch"], { frequency: "rarely" }),
      ...dish("Chapati", ["Dinner"]), ...dish("Uthappam", ["Dinner"], { frequency: "sometimes" }), ...dish("Rasam rice", ["Dinner"], { frequency: "sometimes" }),
    ],
    rules: [
      veg(/vegetarian|veg/i), noEggs(/egg/i),
      avoid("no_brinjal_karthik", "Karthik eats no brinjal", ["brinjal"], /brinjal/i, { who: "Karthik" }),
      note("less_spicy_kid", "less spicy for Ananya", "Ananya", /spic/i),
    ],
    seed: [
      { slot: "Breakfast", dishes: ["Idli", "Coconut chutney", "Sambar"] }, { slot: "Breakfast", dishes: ["Plain dosa", "Coconut chutney", "Sambar"] },
      { slot: "Breakfast", dishes: ["Upma", "Coconut chutney"] }, { slot: "Breakfast", dishes: ["Ven pongal", "Coconut chutney", "Sambar"] },
      { slot: "Lunch", dishes: ["Rice", "Sambar", "Tomato rasam", "Beans poriyal", "Curd"] }, { slot: "Lunch", dishes: ["Rice", "Sambar", "Tomato rasam", "Cabbage poriyal", "Curd"] },
      { slot: "Lunch", dishes: ["Rice", "Tomato rasam", "Mixed vegetable kootu", "Curd"] },
      { slot: "Dinner", dishes: ["Plain dosa", "Kurma"] }, { slot: "Dinner", dishes: ["Chapati", "Kurma"] }, { slot: "Dinner", dishes: ["Uthappam", "Kurma"] }, { slot: "Dinner", dishes: ["Rasam rice"] },
    ],
    week: [{ kind: "guests", day: "Sun", slot: "Lunch", count: 2, occasion: "relatives for lunch" }],
    cuisines: ["south", "tamil"], cuisinesAlso: ["kerala"],
    meals: [
      { slot: "Breakfast", staples: ["Chutney"], templates: [tpl(["Idli", "Chutney", "Rice curry/Sambar"]), tpl([DOSA, "Chutney", "Rice curry/Sambar"]), tpl(["Upma", "Chutney"]),
        tpl([PONGAL, "Chutney", "Rice curry/Sambar"])] },
      { slot: "Lunch", staples: ["Rice", "Curd"], templates: [tpl(["Rice", "Rice curry/Sambar", RASAM, "Sabzi/Poriyal/Thoran", "Curd"]),
        tpl(["Rice", RASAM, KOOTU, "Curd"])] },
      // Rasam rice when it's late: not stated plainly enough as a plate to score.
      { slot: "Dinner", staples: ["Roti"], templates: [tpl([DOSA, "Gravy/Kurma"]), tpl(["Roti", "Gravy/Kurma"])] },
    ],
    judgeNotes: ["Pure vegetarian, no eggs; Karthik eats no brinjal.", "Saturday dinner ordered in.", "Meenakshi cooks every meal herself.", "Two guests at Sunday lunch this week."],
  },
};
