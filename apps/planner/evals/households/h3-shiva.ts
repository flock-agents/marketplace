// 3. The owner's own household (the sim's family a, flock-sim scripts/fake-whatsapp/sim/families.ts): Shiva, Ankita,
// Agastya (6), Gowri Shankar (63, diabetic, fasts Thursday till evening); cook Lakshmi Mon–Sat; Sunday lunch out, Saturday
// dinner ordered in; vegetarian, no eggs, no mushrooms, nut-free tiffin. Meal shape in the owner's own words (23 Nov).
// Frequency words: weekend parathas, curd rice when he's tired, millets are good for him (soft), no sugar (hard).
import { avoid, fast, noEggs, SCHOOL, veg, WEEK, type Household } from "../lib/truth";

const MON_SAT = WEEK.slice(0, 6);
const GS = "Gowri Shankar";
export const h3: Household = {
  id: "h3-shiva", title: "The owner's family: mixed South/North, elder diabetic + Thursday fast, cook Mon–Sat",
  owner: "Shiva", intro: "You are Shiva, 38, a busy software manager in Bangalore",
  household: {
    "household.people": [{ name: "Shiva", relation: "self", age: 38, group: "adult" }, { name: "Ankita", relation: "wife", age: 35, group: "adult" },
      { name: "Agastya", relation: "son", age: 6, group: "child" }, { name: GS, relation: "father", age: 63, group: "elder" }],
    "household.children": ["Agastya"], "household.elders": [GS], "household.schoolAge": true,
    "household.help": [{ role: "cook", name: "Lakshmi", days: "Mon-Sat", times: "7am", meals: ["Breakfast", "Lunch"] },
      { role: "cook", name: "Lakshmi", days: "Mon-Sat", times: "6pm", meals: ["Dinner"] }, { role: "maid", days: "daily", times: "9am" }],
    "household.weekday": "Shiva and Ankita work from office 9:30 to 6; father is home all day. Agastya has school 8:30 to 2:30.",
    "household.mealsBy": "Ankita", "household.groceriesBy": "Ankita",
  },
  groceryApps: ["Zepto", "Instamart"],
  facts: [
    { id: "pain", text: "Hardest part: deciding what to make every day and remembering to order what the meals need." },
    { id: "apps", text: "Groceries on Zepto (main); Instamart when something is not on Zepto." },
    { id: "people", text: "Lives with wife Ankita, son Agastya (6) and father Gowri Shankar (63)." },
    { id: "cook", text: "Cook Lakshmi comes Monday to Saturday, 7 in the morning for breakfast and lunch, and 6 in the evening for dinner." },
    { id: "cookTime", text: "Lakshmi has about an hour in the morning: breakfast plus at most two dishes for lunch." },
    { id: "cookingDays", text: "Sunday: Ankita makes a quick breakfast and dinner; Sunday lunch is eaten out." },
    { id: "kidsBreakfast", text: "Agastya's breakfasts last week: idli with chutney twice, dosa, poha, upma, aloo paratha on Saturday; milk every morning." },
    { id: "kidsLunch", text: "Agastya takes a school tiffin Monday to Friday; last week: paratha rolls, besan cheela, mini idlis, vegetable sandwich, lemon rice on Friday; after school the home lunch, dal rice and a sabzi." },
    { id: "kidsDinner", text: "Agastya's dinner: same as the adults mostly, chapati with dal or a sabzi, less spicy; curd rice when he's tired." },
    { id: "adultsBreakfast", text: "Adults' breakfast, a mixed breakfast - idli, dosa, poha, upma, sandwich. Father had ragi dosa and oats. Weekend parathas." },
    { id: "adultsLunch", text: "Lunch - south indian - rice, sambar, sabji, etc. Shiva and Ankita take lunch boxes. Rajma chawal twice a week. Bisi bele bath on Saturday. Father has the same with less rice." },
    { id: "adultsDinner", text: "Dinner - roti, gravy or dry sabji. Chapati most nights. Palak dal, bhindi, aloo gobi, chole once a week. Father has two phulkas, no rice at night." },
    { id: "diet", text: "Father Gowri Shankar is diabetic: less rice, no sugar, millets are good for him. Nobody else on a diet." },
    { id: "elders", text: "Father: less salt too. Onion and garlic are fine." },
    { id: "rules", text: "Vegetarian, no eggs at home. No mushrooms. Agastya's tiffin nut-free (school is nut-free). Father fasts Thursday till evening, then a light dinner." },
    { id: "orderIn", text: "Order in once a week, usually Saturday dinner from Swiggy." },
    { id: "subscriptions", text: "Country Delight milk, 1 litre every morning. Nothing else." },
  ],
  correction: { after: "cookTime", line: "actually Lakshmi comes at 7:30", fact: "cook",
    corrected: "Cook Lakshmi comes Monday to Saturday, 7:30 in the morning for breakfast and lunch, and 6 in the evening for dinner." },
  truth: {
    people: [{ name: "Shiva", group: "adult" }, { name: "Ankita", group: "adult" }, { name: "Agastya", group: "child", age: 6 }, { name: GS, group: "elder", age: 63 }],
    cook: { name: "Lakshmi", days: MON_SAT, visits: [{ at: "07:30", meals: ["Breakfast", "Lunch"] }, { at: "18:00", meals: ["Dinner"] }] },
    homeCook: [{ days: ["Sun"], slots: ["Breakfast", "Dinner"], by: "Ankita" }],
    extraSlots: [{ name: "Agastya's tiffin", match: /tiffin|lunch ?box|school/i, days: SCHOOL, for: ["Agastya"] }],
    orderIn: [{ day: "Sun", slot: "Lunch", note: "eaten out" }, { day: "Sat", slot: "Dinner", note: "ordered from Swiggy" }],
    hardRules: [
      veg(), noEggs(),
      avoid("no_mushrooms", "No mushrooms", ["mushroom"]),
      avoid("nut_free_tiffin", "Agastya's tiffin nut-free", ["@nuts"], { slots: ["Agastya's tiffin"], alsoKinds: [] }),
      fast("thu_fast", "Gowri Shankar fasts Thursday till evening", GS, ["Thu"], ["Breakfast", "Lunch"]),
      avoid("no_sugar", "Gowri Shankar: no sugar", ["@sweet"], { who: GS }),
      avoid("no_rice_night", "Gowri Shankar: no rice at night", ["@white_rice"], { who: GS, slots: ["Dinner"], alsoKinds: ["swap", "cap"] }),
    ],
    softNotes: [
      { id: "less_rice", who: GS, text: "less rice", re: /less rice|small(er)? portion|less of rice/i },
      { id: "millets_good", who: GS, text: "millets are good for him", re: /millet|ragi|jowar/i, often: "sometimes", per_week: [2, 3], items: ["millet", "ragi", "jowar", "bajra", "foxtail"],
        rule: { kind: "swap", who: GS, items: ["@white_rice"], to: "millets", often: "sometimes", note: "millets are good for him" } },
      { id: "less_salt", who: GS, text: "less salt", re: /salt/i },
      { id: "less_spicy_kid", who: "Agastya", text: "less spicy for Agastya", re: /spic|mild/i },
    ],
    dishes: [
      { name: "Idli", slots: ["Breakfast"] }, { name: "Dosa", slots: ["Breakfast"] }, { name: "Poha", slots: ["Breakfast"] }, { name: "Upma", slots: ["Breakfast"] },
      { name: "Sandwich", slots: ["Breakfast"] }, { name: "Chutney", slots: ["Breakfast"] }, { name: "Aloo paratha", slots: ["Breakfast"], days: ["Sat", "Sun"] },
      { name: "Ragi dosa", slots: ["Breakfast"], for: [GS] }, { name: "Oats", slots: ["Breakfast"], for: [GS] },
      { name: "Paratha roll", slots: ["Agastya's tiffin"] }, { name: "Besan cheela", slots: ["Agastya's tiffin"] }, { name: "Mini idli", slots: ["Agastya's tiffin"] },
      { name: "Vegetable sandwich", slots: ["Agastya's tiffin"] }, { name: "Lemon rice", slots: ["Agastya's tiffin"], days: ["Fri"] },
      { name: "Rice", slots: ["Lunch"] }, { name: "Sambar", slots: ["Lunch"] }, { name: "Sabji", slots: ["Lunch", "Dinner"] }, { name: "Dal", slots: ["Lunch", "Dinner"] },
      { name: "Rajma chawal", slots: ["Lunch"], per_week: 2 }, { name: "Bisi bele bath", slots: ["Lunch"] }, { name: "Curd", slots: ["Lunch"] },
      { name: "Roti", slots: ["Dinner"] }, { name: "Phulka", slots: ["Dinner"] }, { name: "Chapati", slots: ["Dinner"], often: "usually" }, { name: "Palak dal", slots: ["Dinner"] }, { name: "Bhindi", slots: ["Dinner"] },
      { name: "Aloo gobi", slots: ["Dinner"] }, { name: "Chole", slots: ["Dinner"], per_week: 1 }, { name: "Curd rice", slots: ["Dinner"], for: ["Agastya"], often: "sometimes" },
    ],
    examples: [
      { slot: "Breakfast", words: "a mixed breakfast - idli, dosa, poha, upma, sandwich", parts: 2, staple: /idli|dosa|poha|upma|sandwich|paratha|uttapam|pesarattu/i },
      { slot: "Lunch", words: "south indian - rice, sambar, sabji, etc.", parts: 4, staple: /rice|bath/i },
      { slot: "Dinner", words: "roti, gravy or dry sabji", parts: 3, staple: /roti|phulka|chapati|paratha/i },
    ],
    judgeNotes: ["Gowri Shankar fasts Thursday till evening: nothing for him at Thursday breakfast and lunch.", "Gowri Shankar: no sugar, less rice and no rice at night; millets good for him two or three times a week.",
      "Agastya's tiffin Monday to Friday, nut-free.", "Sunday lunch eaten out, Saturday dinner ordered in; Ankita cooks quick Sunday breakfast and dinner.", "Cook has an hour in the morning: breakfast plus at most two lunch dishes."],
  },
};
