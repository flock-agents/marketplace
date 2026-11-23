// 2. South Indian (Tamil), one child, the wife cooks every meal, no cook; vegetarian, no eggs; the husband carries lunch to
// office. Frequency words: curd rice when Ananya's not well, pongal on Sundays. Correction: the order-in night.
import { avoid, noEggs, veg, WEEK, type Household } from "../lib/truth";

export const h2: Household = {
  id: "h2-iyer", title: "South Indian veg, wife cooks every meal, no cook",
  owner: "Karthik", intro: "You are Karthik Iyer, 36, an engineer in Chennai",
  household: {
    "household.people": [{ name: "Karthik", relation: "self", age: 36, group: "adult" }, { name: "Meenakshi", relation: "wife", age: 33, group: "adult" },
      { name: "Ananya", relation: "daughter", age: 5, group: "child" }],
    "household.children": ["Ananya"], "household.elders": [], "household.schoolAge": true,
    "household.help": [{ role: "maid", name: "Selvi", days: "Mon-Sat", times: "7am" }],
    "household.weekday": "Karthik is at office 9 to 6 and takes his lunch box. Meenakshi works from home. Ananya has playschool 9 to 12, lunch at home.",
    "household.mealsBy": "Meenakshi", "household.groceriesBy": "Karthik",
  },
  groceryApps: ["Instamart"],
  facts: [
    { id: "pain", text: "Hardest part: remembering to order what the meals need." },
    { id: "apps", text: "Only Instamart." },
    { id: "people", text: "Wife Meenakshi (33) and daughter Ananya (5). Just the three of us." },
    { id: "cookingDays", text: "No cook. Meenakshi cooks every meal, all seven days. We order in one night a week, Friday dinner." },
    { id: "kidsBreakfast", text: "Ananya's breakfast: idli, dosa, sometimes ragi porridge; same as us mostly." },
    { id: "kidsLunch", text: "Ananya eats lunch at home after playschool, same as us, rice with sambar or rasam and curd. Curd rice when she's not well." },
    { id: "kidsDinner", text: "Ananya's dinner same as ours, less spicy." },
    { id: "adultsBreakfast", text: "Breakfast: idli, dosa, upma, pongal on Sundays; with coconut chutney and sambar." },
    { id: "adultsLunch", text: "Lunch is rice, sambar, rasam, a poriyal and curd. Karthik takes the same in his lunch box. Poriyal like beans, cabbage, carrot; kootu sometimes." },
    { id: "adultsDinner", text: "Dinner: dosa or chapati with kurma, sometimes uthappam; and rasam rice if it's late." },
    { id: "diet", text: "No diets." },
    { id: "rules", text: "Pure vegetarian, no eggs. Karthik won't touch brinjal. Less spicy for Ananya." },
    { id: "orderIn", text: "Once a week, Friday dinner, usually from a Saravana Bhavan on Swiggy." },
    { id: "subscriptions", text: "Aavin milk packets every morning from the milkman." },
  ],
  correction: { after: "orderIn", line: "sorry, saturday dinner we order, not friday", fact: "orderIn",
    corrected: "Once a week, Saturday dinner, usually from a Saravana Bhavan on Swiggy." },
  truth: {
    people: [{ name: "Karthik", group: "adult" }, { name: "Meenakshi", group: "adult" }, { name: "Ananya", group: "child", age: 5 }],
    cook: null,
    homeCook: [{ days: WEEK, by: "Meenakshi" }],
    extraSlots: [],
    orderIn: [{ day: "Sat", slot: "Dinner", note: "ordered from Swiggy" }],
    hardRules: [veg(), noEggs(), avoid("no_brinjal_karthik", "Karthik eats no brinjal", ["brinjal"], { who: "Karthik" })],
    softNotes: [{ id: "less_spicy_kid", who: "Ananya", text: "less spicy for Ananya", re: /spic|mild/i }],
    dishes: [
      { name: "Idli", slots: ["Breakfast"] }, { name: "Dosa", slots: ["Breakfast", "Dinner"] }, { name: "Ragi porridge", slots: ["Breakfast"], for: ["Ananya"], often: "sometimes" },
      { name: "Upma", slots: ["Breakfast"] }, { name: "Pongal", slots: ["Breakfast"], days: ["Sun"] }, { name: "Coconut chutney", slots: ["Breakfast"] }, { name: "Sambar", slots: ["Breakfast", "Lunch"] },
      { name: "Rice", slots: ["Lunch"] }, { name: "Rasam", slots: ["Lunch", "Dinner"] }, { name: "Poriyal", slots: ["Lunch"] }, { name: "Curd", slots: ["Lunch"] },
      { name: "Beans poriyal", slots: ["Lunch"] }, { name: "Cabbage poriyal", slots: ["Lunch"] }, { name: "Kootu", slots: ["Lunch"], often: "sometimes" },
      { name: "Curd rice", slots: ["Lunch"], for: ["Ananya"], often: "rarely" },
      { name: "Chapati", slots: ["Dinner"] }, { name: "Kurma", slots: ["Dinner"] }, { name: "Uthappam", slots: ["Dinner"], often: "sometimes" }, { name: "Rasam rice", slots: ["Dinner"], often: "sometimes" },
    ],
    examples: [
      { slot: "Breakfast", words: "idli, dosa, upma, pongal on Sundays; with coconut chutney and sambar", parts: 3, staple: /idli|dosa|upma|pongal|uthappam/i },
      { slot: "Lunch", words: "rice, sambar, rasam, a poriyal and curd", parts: 5, staple: /rice/i },
      { slot: "Dinner", words: "dosa or chapati with kurma, sometimes uthappam", parts: 2, staple: /dosa|chapati|uthappam|roti/i },
    ],
    judgeNotes: ["Pure vegetarian, no eggs; Karthik eats no brinjal.", "Saturday dinner ordered in.", "Meenakshi cooks every meal herself."],
  },
};
