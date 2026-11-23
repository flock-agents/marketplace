// 1. North Indian, both parents in office, one child with a school tiffin, a paid cook Mon–Sat twice a day; Sunday the mother
// cooks. Eggs fine, chicken only on weekends. Frequency words: parathas on weekends, rajma twice a week, Maggi on Fridays.
import { avoid, SCHOOL, WEEK, type Household } from "../lib/truth";

const MON_SAT = WEEK.slice(0, 6);
export const h1: Household = {
  id: "h1-sharma", title: "North Indian, office parents, cook Mon–Sat, eggs OK, chicken on weekends",
  owner: "Rohit", intro: "You are Rohit Sharma, 38, a sales manager in Gurgaon",
  household: {
    "household.people": [{ name: "Rohit", relation: "self", age: 38, group: "adult" }, { name: "Neha", relation: "wife", age: 36, group: "adult" },
      { name: "Vihaan", relation: "son", age: 7, group: "child" }],
    "household.children": ["Vihaan"], "household.elders": [], "household.schoolAge": true,
    "household.help": [{ role: "cook", name: "Sunita", days: "Mon-Sat", times: "8am", meals: ["Breakfast", "Lunch"] },
      { role: "cook", name: "Sunita", days: "Mon-Sat", times: "7pm", meals: ["Dinner"] }, { role: "maid", name: "Kamla", days: "daily", times: "10am" }],
    "household.weekday": "Rohit and Neha are at office 9:30 to 7. Vihaan has school 8 to 2, then a day care till 6.",
    "household.mealsBy": "Neha", "household.groceriesBy": "Neha",
  },
  groceryApps: ["Blinkit", "BigBasket"],
  facts: [
    { id: "pain", text: "Hardest part: deciding what to make every day; Sunita keeps asking." },
    { id: "apps", text: "Groceries on Blinkit mostly, BigBasket for the monthly stuff." },
    { id: "people", text: "Lives with wife Neha (36) and son Vihaan (7). Nobody else eats at home." },
    { id: "cook", text: "Cook Sunita comes Monday to Saturday: 8 in the morning for breakfast and lunch (she also packs Vihaan's tiffin), and 7 in the evening for dinner." },
    { id: "cookTime", text: "Sunita has enough time, about two hours in the morning." },
    { id: "cookingDays", text: "On Sunday Sunita is off and Neha cooks all three meals. We order dinner on Sunday night from Zomato." },
    { id: "kidsBreakfast", text: "Vihaan's breakfast last week: poha, bread omelette, aloo paratha, and cornflakes with milk on busy days." },
    { id: "kidsLunch", text: "Vihaan takes a school tiffin Monday to Friday: sandwich, paratha roll, poha; Maggi on Fridays as a treat. After day care he eats what we eat." },
    { id: "kidsDinner", text: "Vihaan eats what we eat at dinner, less spicy." },
    { id: "adultsBreakfast", text: "Adults' breakfast: poha, besan chilla, bread omelette; parathas on weekends." },
    { id: "adultsLunch", text: "Lunch is dal, chawal, roti, ek sabzi aur raita; rajma chawal twice a week; sabzi like aloo gobi, bhindi, lauki." },
    { id: "adultsDinner", text: "Dinner is roti, dal and a sabzi; paneer bhurji or matar paneer; chicken curry on Saturday and Sunday." },
    { id: "diet", text: "Nobody is on a diet." },
    { id: "rules", text: "Eggs are fine any day. Non-veg (chicken) only on weekends, Saturday and Sunday, never on weekdays. Less spicy for Vihaan." },
    { id: "orderIn", text: "Order in once a week, Sunday dinner from Zomato." },
    { id: "subscriptions", text: "Mother Dairy milk from the milkman, 1 litre daily." },
  ],
  correction: { after: "cookTime", line: "oh and evening Sunita comes at 7:30 now, not 7", fact: "cook",
    corrected: "Cook Sunita comes Monday to Saturday: 8 in the morning for breakfast and lunch (she also packs Vihaan's tiffin), and 7:30 in the evening for dinner." },
  truth: {
    people: [{ name: "Rohit", group: "adult" }, { name: "Neha", group: "adult" }, { name: "Vihaan", group: "child", age: 7 }],
    cook: { name: "Sunita", days: MON_SAT, visits: [{ at: "08:00", meals: ["Breakfast", "Lunch"] }, { at: "19:30", meals: ["Dinner"] }] },
    homeCook: [{ days: ["Sun"], by: "Neha" }],
    extraSlots: [{ name: "Vihaan's tiffin", match: /tiffin|lunch ?box|school/i, days: SCHOOL, for: ["Vihaan"] }],
    orderIn: [{ day: "Sun", slot: "Dinner", note: "ordered from Zomato" }],
    hardRules: [avoid("nonveg_weekends", "Chicken (non-veg) only on Saturday and Sunday", ["@meat"], { days: SCHOOL })],
    softNotes: [{ id: "less_spicy_kid", who: "Vihaan", text: "less spicy for Vihaan", re: /spic|mild/i }],
    dishes: [
      { name: "Poha", slots: ["Breakfast", "Vihaan's tiffin"] }, { name: "Bread omelette", slots: ["Breakfast"] }, { name: "Aloo paratha", slots: ["Breakfast"], days: ["Sat", "Sun"] },
      { name: "Cornflakes", slots: ["Breakfast"], for: ["Vihaan"], often: "sometimes" }, { name: "Besan chilla", slots: ["Breakfast"] },
      { name: "Sandwich", slots: ["Vihaan's tiffin"] }, { name: "Paratha roll", slots: ["Vihaan's tiffin"] }, { name: "Maggi", slots: ["Vihaan's tiffin"], days: ["Fri"] },
      { name: "Dal", slots: ["Lunch", "Dinner"] }, { name: "Chawal", slots: ["Lunch"] }, { name: "Roti", slots: ["Lunch", "Dinner"] }, { name: "Raita", slots: ["Lunch"] },
      { name: "Rajma chawal", slots: ["Lunch"], per_week: 2 }, { name: "Aloo gobi", slots: ["Lunch"] }, { name: "Bhindi", slots: ["Lunch"] }, { name: "Lauki", slots: ["Lunch"] },
      { name: "Paneer bhurji", slots: ["Dinner"] }, { name: "Matar paneer", slots: ["Dinner"] }, { name: "Chicken curry", slots: ["Dinner"], days: ["Sat", "Sun"] },
    ],
    examples: [
      { slot: "Lunch", words: "dal, chawal, roti, ek sabzi aur raita", parts: 5, staple: /chawal|rice|roti|chapati|phulka/i },
      { slot: "Dinner", words: "roti, dal and a sabzi", parts: 3, staple: /roti|chapati|phulka|paratha/i },
    ],
    judgeNotes: ["Chicken only on Saturday and Sunday; eggs any day.", "Vihaan's tiffin Monday to Friday only.", "Sunday dinner is ordered in."],
  },
};
