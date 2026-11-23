// 6. Maharashtrian family, non-veg on weekends only (Saturday fish, Sunday chicken), two children with school snack boxes
// Mon–Fri, the younger with a peanut allergy (in a cuisine that puts peanuts in poha and chivda), a cook Mon–Fri, the
// parents cook on weekends. Frequency words: noodles sometimes on Friday for Ishaan, thalipeeth on weekends.
import { avoid, SCHOOL, type Household } from "../lib/truth";

export const h6: Household = {
  id: "h6-kulkarni", title: "Maharashtrian, non-veg weekends, two snack boxes, peanut allergy, cook Mon–Fri",
  owner: "Amit", intro: "You are Amit Kulkarni, 40, an architect in Pune",
  household: {
    "household.people": [{ name: "Amit", relation: "self", age: 40, group: "adult" }, { name: "Snehal", relation: "wife", age: 38, group: "adult" },
      { name: "Aditi", relation: "daughter", age: 10, group: "child" }, { name: "Ishaan", relation: "son", age: 6, group: "child" }],
    "household.children": ["Aditi", "Ishaan"], "household.elders": [], "household.schoolAge": true,
    "household.help": [{ role: "cook", name: "Mangala", days: "Mon-Fri", times: "7am", meals: ["Breakfast", "Lunch"] },
      { role: "cook", name: "Mangala", days: "Mon-Fri", times: "6pm", meals: ["Dinner"] }],
    "household.weekday": "Amit at the studio 10 to 7, Snehal teaches, 8 to 3. Kids' school 8 to 2:30.",
    "household.mealsBy": "Snehal", "household.groceriesBy": "Amit",
  },
  groceryApps: ["Zepto"],
  facts: [
    { id: "pain", text: "Hardest part: deciding what to make." },
    { id: "apps", text: "Zepto." },
    { id: "people", text: "Wife Snehal (38), daughter Aditi (10), son Ishaan (6)." },
    { id: "cook", text: "Cook Mangala comes Monday to Friday, 7 in the morning for breakfast and lunch, 6 in the evening for dinner." },
    { id: "cookTime", text: "She's fine on time." },
    { id: "cookingDays", text: "Weekends we cook: I do Saturday, Snehal does Sunday." },
    { id: "kidsBreakfast", text: "Kids had poha, upma, sheera, and thalipeeth on the weekend." },
    { id: "kidsLunch", text: "Both take a snack box to school Monday to Friday: sandwich, fruits, chivda, idli; noodles sometimes on Friday for Ishaan. Lunch at home after school, same as ours." },
    { id: "kidsDinner", text: "Same as ours." },
    { id: "adultsBreakfast", text: "Poha, upma, sheera; thalipeeth on weekends." },
    { id: "adultsLunch", text: "Lunch: poli, bhaji, varan bhaat, koshimbir. Amti sometimes instead of varan." },
    { id: "adultsDinner", text: "Dinner: bhakri or poli with usal or pithla. Fish fry on Saturday dinner, chicken rassa on Sunday lunch." },
    { id: "diet", text: "No diets." },
    { id: "rules", text: "Non-veg only on weekends, Saturday and Sunday. Ishaan is allergic to peanuts, so nothing with peanuts for him, not even groundnut oil. Eggs are fine." },
    { id: "orderIn", text: "Sometimes Sunday dinner, not fixed." },
    { id: "subscriptions", text: "Chitale milk every morning." },
  ],
  correction: { after: "cookingDays", line: "actually Mangala comes at 6:45 in the morning now", fact: "cook",
    corrected: "Cook Mangala comes Monday to Friday, 6:45 in the morning for breakfast and lunch, 6 in the evening for dinner." },
  truth: {
    people: [{ name: "Amit", group: "adult" }, { name: "Snehal", group: "adult" }, { name: "Aditi", group: "child", age: 10 }, { name: "Ishaan", group: "child", age: 6 }],
    cook: { name: "Mangala", days: SCHOOL, visits: [{ at: "06:45", meals: ["Breakfast", "Lunch"] }, { at: "18:00", meals: ["Dinner"] }] },
    homeCook: [{ days: ["Sat"], by: "Amit" }, { days: ["Sun"], by: "Snehal" }],
    extraSlots: [{ name: "Snack box", match: /snack|box|tiffin/i, days: SCHOOL, for: ["Aditi", "Ishaan"] }],
    orderIn: [],
    hardRules: [
      avoid("nonveg_weekends", "Non-veg only on Saturday and Sunday", ["@meat", "@fish"], { days: SCHOOL }),
      avoid("peanut_ishaan", "Ishaan: no peanuts (allergy)", ["@peanut"], { who: "Ishaan" }),
    ],
    softNotes: [],
    dishes: [
      { name: "Poha", slots: ["Breakfast"] }, { name: "Upma", slots: ["Breakfast"] }, { name: "Sheera", slots: ["Breakfast"] }, { name: "Thalipeeth", slots: ["Breakfast"], days: ["Sat", "Sun"] },
      { name: "Sandwich", slots: ["Snack box"] }, { name: "Fruits", slots: ["Snack box"] }, { name: "Chivda", slots: ["Snack box"] }, { name: "Idli", slots: ["Snack box"] },
      { name: "Noodles", slots: ["Snack box"], for: ["Ishaan"], often: "sometimes", days: ["Fri"] },
      { name: "Poli", slots: ["Lunch", "Dinner"] }, { name: "Bhaji", slots: ["Lunch"] }, { name: "Varan bhaat", slots: ["Lunch"] }, { name: "Koshimbir", slots: ["Lunch"] }, { name: "Amti", slots: ["Lunch"], often: "sometimes" },
      { name: "Bhakri", slots: ["Dinner"] }, { name: "Usal", slots: ["Dinner"] }, { name: "Pithla", slots: ["Dinner"] },
      { name: "Fish fry", slots: ["Dinner"], days: ["Sat"] }, { name: "Chicken rassa", slots: ["Lunch"], days: ["Sun"] },
    ],
    examples: [
      { slot: "Lunch", words: "poli, bhaji, varan bhaat, koshimbir", parts: 4, staple: /poli|chapati|bhaat|rice|bhakri/i },
      { slot: "Dinner", words: "bhakri or poli with usal or pithla", parts: 2, staple: /bhakri|poli|chapati|roti/i },
    ],
    judgeNotes: ["Non-veg only Saturday and Sunday (fish fry Saturday dinner, chicken rassa Sunday lunch).", "Ishaan has a peanut allergy: no peanuts or groundnut oil in anything he eats (poha, chivda, koshimbir often have them).",
      "Snack boxes Monday to Friday for both children."],
  },
};
