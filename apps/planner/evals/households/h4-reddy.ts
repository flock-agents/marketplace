// 4. Telugu family with grandparents and a paid cook: diabetic grandmother (no sugar; ragi is good for her: soft, a few
// times a week; Ekadashi fast twice a month: not a weekday), grandfather less salt and soft food, two working adults, a teen
// with a school tiffin. Non-veg (chicken) Sunday lunch for the three younger ones; the grandparents are pure veg.
import { avoid, SCHOOL, WEEK, type Household } from "../lib/truth";

const MON_SAT = WEEK.slice(0, 6);
export const h4: Household = {
  id: "h4-reddy", title: "Grandparents + cook: diabetic grandmother, Ekadashi, soft food, teen tiffin",
  owner: "Srinivas", intro: "You are Srinivas Reddy, 45, a bank manager in Hyderabad",
  household: {
    "household.people": [{ name: "Srinivas", relation: "self", age: 45, group: "adult" }, { name: "Padma", relation: "wife", age: 42, group: "adult" },
      { name: "Arjun", relation: "son", age: 15, group: "child" }, { name: "Sarojini", relation: "mother", age: 70, group: "elder" },
      { name: "Venkat", relation: "father", age: 74, group: "elder" }],
    "household.children": ["Arjun"], "household.elders": ["Sarojini", "Venkat"], "household.schoolAge": true,
    "household.help": [{ role: "cook", name: "Kavitha", days: "Mon-Sat", times: "7:30am", meals: ["Breakfast", "Lunch"] },
      { role: "cook", name: "Kavitha", days: "Mon-Sat", times: "6:30pm", meals: ["Dinner"] }],
    "household.weekday": "Srinivas and Padma both at work 9 to 6. Arjun's school 7:45 to 3:30. Amma and Nanna are home.",
    "household.mealsBy": "Padma", "household.groceriesBy": "Srinivas",
  },
  groceryApps: ["BigBasket"],
  facts: [
    { id: "pain", text: "Hardest part: cooking separately for my parents' health every day." },
    { id: "apps", text: "BigBasket only." },
    { id: "people", text: "Wife Padma (42), son Arjun (15), my mother Sarojini (70) and father Venkat (74)." },
    { id: "cook", text: "Cook Kavitha comes Monday to Saturday, 7:30 morning for breakfast and lunch, 6:30 evening for dinner." },
    { id: "cookTime", text: "Kavitha has time, no rush." },
    { id: "cookingDays", text: "Sunday Padma cooks everything." },
    { id: "kidsBreakfast", text: "Arjun: idli, pesarattu, upma, bread toast on rushed days." },
    { id: "kidsLunch", text: "Arjun takes a school tiffin Monday to Friday: chapati roll, lemon rice, veg pulao, curd rice." },
    { id: "kidsDinner", text: "Arjun eats same as us at dinner." },
    { id: "adultsBreakfast", text: "Breakfast: idli, pesarattu, upma, dosa with allam chutney. Ragi dosa or ragi java for Amma." },
    { id: "adultsLunch", text: "Lunch is rice, pappu, one curry, rasam, curd, and a pachadi. Curry like dondakaya, beans, bendakaya. Chicken curry on Sunday lunch for the three of us." },
    { id: "adultsDinner", text: "Dinner: chapati with a curry, or rice and pappu. Jowar roti for Amma at night." },
    { id: "diet", text: "Amma (Sarojini) is diabetic: no sugar at all. Ragi is good for her, a few times a week. Otherwise no diets." },
    { id: "elders", text: "Nanna (Venkat) less salt, and soft food, he has trouble chewing. Amma fasts on Ekadashi, twice a month, only fruits that day." },
    { id: "rules", text: "My parents are pure vegetarian, no eggs, no meat. The three of us eat chicken, only on Sunday lunch. Nothing else." },
    { id: "orderIn", text: "We hardly order in, maybe once a month. No fixed day." },
    { id: "subscriptions", text: "Milk from Heritage, delivered daily." },
  ],
  correction: { after: "cookingDays", line: "oh one thing, evening Kavitha comes at 7, not 6:30", fact: "cook",
    corrected: "Cook Kavitha comes Monday to Saturday, 7:30 morning for breakfast and lunch, 7 evening for dinner." },
  truth: {
    people: [{ name: "Srinivas", group: "adult" }, { name: "Padma", group: "adult" }, { name: "Arjun", group: "child", age: 15 }, { name: "Sarojini", group: "elder", age: 70 }, { name: "Venkat", group: "elder", age: 74 }],
    cook: { name: "Kavitha", days: MON_SAT, visits: [{ at: "07:30", meals: ["Breakfast", "Lunch"] }, { at: "19:00", meals: ["Dinner"] }] },
    homeCook: [{ days: ["Sun"], by: "Padma" }],
    extraSlots: [{ name: "Arjun's tiffin", match: /tiffin|lunch ?box|school/i, days: SCHOOL, for: ["Arjun"] }],
    orderIn: [],
    hardRules: [
      avoid("veg_sarojini", "Sarojini: pure veg, no eggs", ["@meat", "@fish", "@egg"], { who: "Sarojini" }),
      avoid("veg_venkat", "Venkat: pure veg, no eggs", ["@meat", "@fish", "@egg"], { who: "Venkat" }),
      avoid("nonveg_sunday_lunch", "Chicken only at Sunday lunch", ["@meat", "@fish"], { days: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] }),
      avoid("no_sugar", "Sarojini: no sugar", ["@sweet"], { who: "Sarojini" }),
      { id: "ekadashi", title: "Sarojini fasts on Ekadashi (fruits only)", rule: { kind: "fasting", who: "Sarojini", days: ["Ekadashi"], note: "fasts on Ekadashi, only fruits" }, check: null, words: /ekadashi/i },
    ],
    softNotes: [
      { id: "ragi_good", who: "Sarojini", text: "ragi is good for her, a few times a week", re: /ragi|millet/i, often: "sometimes", per_week: [2, 3], items: ["ragi"] },
      { id: "less_salt", who: "Venkat", text: "less salt", re: /salt/i },
      { id: "soft_food", who: "Venkat", text: "soft food", re: /soft|chew/i },
    ],
    dishes: [
      { name: "Idli", slots: ["Breakfast"] }, { name: "Pesarattu", slots: ["Breakfast"] }, { name: "Upma", slots: ["Breakfast"] }, { name: "Dosa", slots: ["Breakfast"] },
      { name: "Allam chutney", slots: ["Breakfast"] }, { name: "Bread toast", slots: ["Breakfast"], for: ["Arjun"], often: "sometimes" },
      { name: "Ragi dosa", slots: ["Breakfast"], for: ["Sarojini"] }, { name: "Ragi java", slots: ["Breakfast"], for: ["Sarojini"] },
      { name: "Chapati roll", slots: ["Arjun's tiffin"] }, { name: "Lemon rice", slots: ["Arjun's tiffin"] }, { name: "Veg pulao", slots: ["Arjun's tiffin"] }, { name: "Curd rice", slots: ["Arjun's tiffin"] },
      { name: "Rice", slots: ["Lunch", "Dinner"] }, { name: "Pappu", slots: ["Lunch", "Dinner"] }, { name: "Rasam", slots: ["Lunch"] }, { name: "Curd", slots: ["Lunch"] }, { name: "Pachadi", slots: ["Lunch"] },
      { name: "Dondakaya curry", slots: ["Lunch"] }, { name: "Beans curry", slots: ["Lunch"] }, { name: "Bendakaya curry", slots: ["Lunch"] },
      { name: "Chicken curry", slots: ["Lunch"], for: ["Srinivas", "Padma", "Arjun"], days: ["Sun"] },
      { name: "Chapati", slots: ["Dinner"] }, { name: "Jowar roti", slots: ["Dinner"], for: ["Sarojini"] },
    ],
    examples: [
      { slot: "Breakfast", words: "idli, pesarattu, upma, dosa with allam chutney", parts: 2, staple: /idli|pesarattu|upma|dosa/i },
      { slot: "Lunch", words: "rice, pappu, one curry, rasam, curd, and a pachadi", parts: 6, staple: /rice/i },
      { slot: "Dinner", words: "chapati with a curry, or rice and pappu", parts: 2, staple: /chapati|roti|rice/i },
    ],
    judgeNotes: ["Grandparents pure veg, no eggs; chicken only Sunday lunch for Srinivas, Padma, Arjun.", "Sarojini: no sugar; ragi a few times a week; Ekadashi fast (fruit) twice a month.",
      "Venkat: less salt and soft food.", "Arjun's tiffin Monday to Friday."],
  },
};
