// 6. Maharashtrian family, non-veg on weekends only (Saturday fish, Sunday chicken), two children with school snack boxes
// Mon–Fri, the younger with a peanut allergy (in a cuisine that puts peanuts in poha and chivda; asked by the read-back,
// the family cooks everything without peanuts, so the rule is the whole house's and their own dishes have none), a cook
// Mon–Fri, the parents cook on weekends. Frequency words: noodles sometimes on Friday for Ishaan, thalipeeth on weekends.
import { avoid, dish, mains, SCHOOL, veg, type Household } from "../lib/truth";

export const h6: Household = {
  id: "h6-kulkarni", title: "Maharashtrian, non-veg weekends, two snack boxes, peanut allergy, cook Mon–Fri",
  owner: "Amit", intro: "You are Amit Kulkarni, 40, an architect in Pune",
  household: {
    "household.people": [{ name: "Amit", relation: "self", age: 40, group: "adult" }, { name: "Snehal", relation: "wife", age: 38, group: "adult" },
      { name: "Aditi", relation: "daughter", age: 10, group: "child" }, { name: "Ishaan", relation: "son", age: 6, group: "child" }],
    "household.children": ["Aditi", "Ishaan"], "household.elders": [], "household.schoolAge": true,
    "household.help": [{ role: "cook", name: "Mangala", days: "Mon-Fri", times: "7am", meals: ["Breakfast", "Lunch"] },
      { role: "cook", name: "Mangala", days: "Mon-Fri", times: "6pm", meals: ["Dinner"] }],
    "household.weekday": "Amit at the studio 10 to 7, takes his lunch. Snehal teaches, 8 to 3, lunch at home after. Kids' school 8 to 2:30.",
    "household.mealsBy": "Snehal", "household.groceriesBy": "Amit",
    "household.weekly": [{ person: "Amit", where: "office", weekdays: SCHOOL, from: "10:00", to: "19:00", lunch: "carries" },
      { person: "Snehal", where: "school", weekdays: SCHOOL, from: "08:00", to: "15:00", lunch: "home" },
      { person: "Aditi", where: "school", weekdays: SCHOOL, from: "08:00", to: "14:30", lunch: "home" },
      { person: "Ishaan", where: "school", weekdays: SCHOOL, from: "08:00", to: "14:30", lunch: "home" }],
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
    { id: "allergyKitchen", text: "Everything at home is without peanuts, we don't even use groundnut oil." },
    { id: "orderIn", text: "Sometimes Sunday dinner, not fixed." },
    { id: "subscriptions", text: "Chitale milk every morning." },
  ],
  correction: { after: "cookingDays", line: "actually Mangala comes at 6:45 in the morning now", fact: "cook",
    corrected: "Cook Mangala comes Monday to Friday, 6:45 in the morning for breakfast and lunch, 6 in the evening for dinner." },
  truth: {
    people: [{ name: "Amit", group: "adult" }, { name: "Snehal", group: "adult" }, { name: "Aditi", group: "child", age: 10 }, { name: "Ishaan", group: "child", age: 6 }],
    cook: { name: "Mangala", days: SCHOOL, visits: [{ at: "06:45", meals: ["Breakfast", "Lunch"] }, { at: "18:00", meals: ["Dinner"] }] },
    familyCooks: [{ person: "Amit", days: ["Sat"] }, { person: "Snehal", days: ["Sun"] }],
    slots: [
      ...mains(),
      { name: "Snack box", kind: "custom", usual_people: ["Aditi", "Ishaan"], days: SCHOOL, match: /snack|box|tiffin/i },
    ],
    away: [],
    // Poha, chivda and koshimbir usually have peanuts in a Maharashtrian kitchen; not in this one (everything at home is without).
    library: [
      ...dish("Poha", ["Breakfast"]), ...dish("Upma", ["Breakfast"]), ...dish("Sheera", ["Breakfast"]), ...dish("Thalipeeth", ["Breakfast"], { days: ["Sat", "Sun"] }),
      ...dish("Sandwich", ["Snack box"]), ...dish("Fruits", ["Snack box"]), ...dish("Chivda", ["Snack box"]), ...dish("Idli", ["Snack box"]),
      ...dish("Noodles", ["Snack box"], { days: ["Fri"] }),
      ...dish("Poli", ["Lunch", "Dinner"]), ...dish("Bhaji", ["Lunch"]), ...dish("Varan bhaat", ["Lunch"]), ...dish("Koshimbir", ["Lunch"]),
      ...dish("Amti", ["Lunch"], { frequency: "sometimes" }),
      ...dish("Bhakri", ["Dinner"]), ...dish("Usal", ["Dinner"]), ...dish("Pithla", ["Dinner"]),
      ...dish("Fish fry", ["Dinner"], { days: ["Sat"] }), ...dish("Chicken rassa", ["Lunch"], { days: ["Sun"] }),
    ],
    rules: [
      avoid("nonveg_weekends", "Non-veg only on Saturday and Sunday", ["meat", "fish"], /weekend|saturday and sunday/i, { days: SCHOOL, also: ["only"] }),
      // Ishaan's allergy, kept by the whole kitchen (the read-back's question, answered "everything"): a house rule.
      avoid("peanut_house", "No peanuts at home (Ishaan's allergy)", ["peanut"], /peanut|groundnut|allerg/i),
    ],
    seed: [
      { slot: "Breakfast", dishes: ["Poha"] }, { slot: "Breakfast", dishes: ["Upma"] }, { slot: "Breakfast", dishes: ["Sheera"] }, { slot: "Breakfast", dishes: ["Thalipeeth"] },
      { slot: "Snack box", dishes: ["Sandwich", "Fruits"] }, { slot: "Snack box", dishes: ["Chivda", "Fruits"] }, { slot: "Snack box", dishes: ["Idli", "Fruits"] }, { slot: "Snack box", dishes: ["Noodles"] },
      { slot: "Lunch", dishes: ["Poli", "Bhaji", "Varan bhaat", "Koshimbir"] }, { slot: "Lunch", dishes: ["Poli", "Bhaji", "Varan bhaat", "Koshimbir"] },
      { slot: "Lunch", dishes: ["Poli", "Bhaji", "Amti", "Koshimbir"] }, { slot: "Lunch", dishes: ["Poli", "Bhaji", "Varan bhaat"] },
      { slot: "Lunch", dishes: ["Chicken rassa", "Poli"] },
      { slot: "Dinner", dishes: ["Bhakri", "Usal"] }, { slot: "Dinner", dishes: ["Poli", "Pithla"] }, { slot: "Dinner", dishes: ["Bhakri", "Pithla"] }, { slot: "Dinner", dishes: ["Fish fry", "Poli"] },
    ],
    week: [{ kind: "guests", day: "Sat", slot: "Dinner", count: 4, rules: ["vegetarian"], items: ["meat", "fish"], occasion: "dinner with friends" }],
    judgeNotes: ["Non-veg only Saturday and Sunday (fish fry Saturday dinner, chicken rassa Sunday lunch).", "Ishaan has a peanut allergy and the whole house cooks without peanuts or groundnut oil: the family's poha, chivda and koshimbir have none.",
      "Snack boxes Monday to Friday for both children.", "Four vegetarian guests for Saturday dinner this week."],
  },
};
