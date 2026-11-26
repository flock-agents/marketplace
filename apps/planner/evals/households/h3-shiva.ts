// 3. The owner's own household (the sim's family a, flock-sim scripts/fake-whatsapp/sim/families.ts): Shiva, Ankita,
// Agastya (6), Gowri Shankar (63, diabetic, fasts Thursday till evening); cook Lakshmi Mon–Sat; Sunday lunch out, Saturday
// dinner ordered in; vegetarian, no eggs, no mushrooms, nut-free tiffin. Meal shape in the owner's own words (23 Nov).
// Frequency words: weekend parathas, curd rice when he's tired, millets are good for him (soft), no sugar (hard).
import { avoid, dish, mains, MON_SAT, noEggs, note, SCHOOL, veg, items, kindPart, tpl, type Household } from "../lib/truth";

// Their bare words that name one dish (scripts/kinds/bare-decided.md).
const DOSA = kindPart("Dosa", { dish: "Plain dosa", words: "dosa" });

const GS = "Gowri Shankar";
export const h3: Household = {
  id: "h3-shiva", title: "The owner's family: mixed South/North, elder diabetic + Thursday fast, cook Mon–Sat",
  owner: "Shiva", intro: "You are Shiva, 38, a busy software manager in Bangalore",
  household: {
    "household.people": [{ name: "Shiva", relation: "self", age: 38, group: "adult" }, { name: "Ankita", relation: "wife", age: 35, group: "adult" },
      { name: "Agastya", relation: "son", age: 6, group: "child" }, { name: GS, relation: "father", age: 63, group: "elder", nicknames: [{ name: "Appa", by: "Shiva" }] }],
    "household.children": ["Agastya"], "household.elders": [GS], "household.schoolAge": true,
    "household.help": [{ role: "cook", name: "Lakshmi", days: "Mon-Sat", times: "7am", meals: ["Breakfast", "Lunch"] },
      { role: "cook", name: "Lakshmi", days: "Mon-Sat", times: "6pm", meals: ["Dinner"] }, { role: "maid", days: "daily", times: "9am" }],
    "household.weekday": "Shiva and Ankita work from office 9:30 to 6; father is home all day. Agastya has school 8:30 to 2:30.",
    "household.mealsBy": [{ person: "Ankita" }], "household.groceriesBy": [{ person: "Ankita" }],
    "household.weekly": [{ person: "Shiva", where: "office", weekdays: SCHOOL, from: "09:30", to: "18:00", lunch: "carries" },
      { person: "Ankita", where: "office", weekdays: SCHOOL, from: "09:30", to: "18:00", lunch: "carries" },
      { person: "Agastya", where: "school", weekdays: SCHOOL, from: "08:30", to: "14:30", lunch: "away" },
      { person: GS, where: "home", weekdays: SCHOOL, lunch: "home" }],
  },
  groceryApps: ["Zepto", "Instamart"],
  facts: [
    { id: "pain", text: "Hardest part: deciding what to make every day and remembering to order what the meals need." },
    { id: "apps", text: "Groceries on Zepto (main); Instamart when something is not on Zepto." },
    { id: "lunchWhere", text: "Lives with wife Ankita, son Agastya (6) and father Gowri Shankar (63)." },
    { id: "cook", text: "Cook Lakshmi comes Monday to Saturday, 7 in the morning for breakfast and lunch, and 6 in the evening for dinner." },
    { id: "cookTime", text: "Lakshmi has about an hour in the morning: breakfast plus at most two dishes for lunch." },
    { id: "otherDays", text: "Sunday: Ankita makes a quick breakfast and dinner; Sunday lunch is eaten out. Order in once a week, usually Saturday dinner from Swiggy." },
    { id: "childSame", text: "Agastya takes a school tiffin Monday to Friday; last week: paratha rolls, besan cheela, mini idlis, vegetable sandwich, lemon rice on Friday; after school the home lunch, dal rice and a sabzi.", differs: true },
    { id: "familyBreakfast", text: "Adults' breakfast, a mixed breakfast - idli, dosa, poha, upma, sandwich. Father had ragi dosa and oats. Weekend parathas." },
    { id: "familyLunch", text: "Lunch - south indian - rice, sambar, sabji, etc. Shiva and Ankita take lunch boxes. Rajma chawal twice a week. Bisi bele bath on Saturday. Father has the same with less rice." },
    { id: "familyDinner", text: "Dinner - roti, gravy or dry sabji. Chapati most nights. Palak dal, bhindi, aloo gobi, chole once a week. Father has two phulkas, no rice at night." },
    { id: "childMeals", text: "Agastya's breakfasts last week: idli with chutney twice, dosa, poha, upma, aloo paratha on Saturday; milk every morning. Agastya's dinner: same as the adults mostly, chapati with dal or a sabzi, less spicy; curd rice when he's tired." },
    { id: "differently", text: "Father Gowri Shankar is diabetic: less rice, no sugar, millets are good for him. Nobody else on a diet. Father: less salt too. Onion and garlic are fine. Vegetarian, no eggs at home. No mushrooms. Agastya's tiffin nut-free (school is nut-free). Father fasts Thursday till evening, then a light dinner." },
    { id: "subscriptions", text: "Country Delight milk, 1 litre every morning. Nothing else." },
  ],
  correction: { after: "cookTime", line: "actually Lakshmi comes at 7:30", fact: "cook",
    corrected: "Cook Lakshmi comes Monday to Saturday, 7:30 in the morning for breakfast and lunch, and 6 in the evening for dinner." },
  truth: {
    people: [{ name: "Shiva", group: "adult" }, { name: "Ankita", group: "adult" }, { name: "Agastya", group: "child", age: 6 }, { name: GS, group: "elder", age: 63 }],
    cook: { name: "Lakshmi", days: MON_SAT, visits: [{ at: "07:30", meals: ["Breakfast", "Lunch"] }, { at: "18:00", meals: ["Dinner"] }] },
    familyCooks: [{ person: "Ankita", days: ["Sun"] }],
    slots: [
      ...mains({ Lunch: [{ day: "Sun", skip: "eaten_out" }], Dinner: [{ day: "Sat", skip: "ordered_in" }] }),
      { name: "Agastya's tiffin", kind: "custom", usual_people: ["Agastya"], days: SCHOOL, match: /tiffin|lunch ?box|school/i },
      // "Father has two phulkas, no rice at night": his dinner is always different, so it gets an add-on with the phulkas.
      { name: "Gowri Shankar's dinner", kind: "addon", addon_of: "Dinner", usual_people: [GS], match: /gowri|father|appa|grand|phulka/i },
      { name: "Gowri Shankar's breakfast", kind: "addon", addon_of: "Breakfast", usual_people: [GS], match: /gowri|father|appa|grand/i, optional: true },
    ],
    away: [{ person: "Agastya", slots: ["Lunch"], days: SCHOOL }],
    library: [
      ...dish("Idli", ["Breakfast"]), ...dish("Plain dosa", ["Breakfast"]),
      ...dish("Aloo paratha", ["Breakfast"], { days: ["Sat", "Sun"] }),
      ...dish("Ragi dosa", ["Breakfast"], { alsoSlots: ["Gowri Shankar's breakfast"] }), ...dish("Oats", ["Breakfast"], { alsoSlots: ["Gowri Shankar's breakfast"] }),
      ...dish("Paratha roll", ["Agastya's tiffin"], { kind: "Roll" }), ...dish("Besan cheela", ["Agastya's tiffin"]), ...dish("Mini idli", ["Agastya's tiffin"]),
      ...dish("Vegetable sandwich", ["Agastya's tiffin"]), ...dish("Lemon rice", ["Agastya's tiffin"], { days: ["Fri"], notContains: ["nuts", "peanut"] }),
      ...dish("Rajma chawal", ["Lunch"], { frequency: "2/week" }), ...dish("Bisi bele bath", ["Lunch"], { days: ["Sat"] }), ...dish("Curd", ["Lunch"], { unsaid: true }),
      ...dish("Bhindi", ["Lunch"], { unsaid: true, kind: "Sabzi" }), ...dish("Aloo gobi", ["Lunch"], { unsaid: true }),
      ...dish("Chapati", ["Dinner"], { frequency: "usually" }), ...dish("Palak dal", ["Dinner"]), ...dish("Bhindi", ["Dinner"], { kind: "Sabzi" }),
      ...dish("Aloo gobi", ["Dinner"]), ...dish("Chole", ["Dinner"], { frequency: "1/week" }), ...dish("Curd rice", ["Dinner"], { frequency: "sometimes" }),
      ...dish("Phulka", ["Gowri Shankar's dinner"]),
    ],
    rules: [
      veg(/vegetarian/i), noEggs(/egg/i),
      avoid("no_mushrooms", "No mushrooms", ["mushroom"], /mushroom/i),
      avoid("nut_free_tiffin", "Agastya's tiffin nut-free", ["nuts"], /nut/i, { slots: ["Agastya's tiffin"] }),
      { id: "thu_fast", title: "Gowri Shankar fasts Thursday till evening", hard: true, what: "fasting", who: GS, days: ["Thu"], slots: ["Breakfast", "Lunch"], fasting_food: [], quote: /fast/i },
      avoid("no_sugar", "Gowri Shankar: no sugar", ["sugar"], /sugar/i, { who: GS }),
      avoid("no_rice_night", "Gowri Shankar: no rice at night", ["white_rice"], /no rice at night|rice at night/i, { who: GS, slots: ["Dinner"] }),
      note("less_rice", "less rice for Gowri Shankar", GS, /less rice/i),
      { id: "millets_good", title: "millets are good for Gowri Shankar", hard: false, what: "swap", who: GS, items: ["white_rice"], to: "millet", frequency: "sometimes", quote: /millet/i, also: ["require"] },
      note("less_salt", "less salt for Gowri Shankar", GS, /salt/i),
      note("less_spicy_kid", "less spicy for Agastya", "Agastya", /spic/i),
      { id: "cook_limit", title: "Lakshmi: breakfast plus at most two dishes for lunch", hard: false, hardAny: true, what: "cap", per_meal: 2, slots: ["Lunch"], days: MON_SAT, quote: /two dishes|an hour/i },
    ],
    seed: [
      { slot: "Breakfast", dishes: ["Idli", "Chutney"] }, { slot: "Breakfast", dishes: ["Plain dosa", "Chutney"] }, { slot: "Breakfast", dishes: ["Poha"] },
      { slot: "Breakfast", dishes: ["Upma", "Chutney"] }, { slot: "Breakfast", dishes: ["Idli", "Chutney"] }, { slot: "Breakfast", dishes: ["Aloo paratha"] },
      { slot: "Agastya's tiffin", dishes: ["Paratha roll"] }, { slot: "Agastya's tiffin", dishes: ["Besan cheela"] }, { slot: "Agastya's tiffin", dishes: ["Mini idli"] },
      { slot: "Agastya's tiffin", dishes: ["Vegetable sandwich"] }, { slot: "Agastya's tiffin", dishes: ["Lemon rice"] },
      { slot: "Lunch", dishes: ["Rice", "Sambar", "Bhindi", "Curd"] }, { slot: "Lunch", dishes: ["Rajma chawal", "Curd"] }, { slot: "Lunch", dishes: ["Rice", "Dal", "Aloo gobi", "Curd"] },
      { slot: "Lunch", dishes: ["Bisi bele bath", "Curd"] }, { slot: "Lunch", dishes: ["Rice", "Sambar", "Aloo gobi", "Curd"] },
      { slot: "Dinner", dishes: ["Chapati", "Palak dal", "Bhindi"] }, { slot: "Dinner", dishes: ["Chapati", "Chole"] }, { slot: "Dinner", dishes: ["Chapati", "Dal", "Aloo gobi"] },
      { slot: "Gowri Shankar's dinner", dishes: ["Phulka"] }, { slot: "Gowri Shankar's dinner", dishes: ["Phulka"] },
    ],
    cuisines: ["south", "north"], cuisinesAlso: ["tamil", "karnataka", "punjab", "west", "central", "continental"],
    meals: [
      { slot: "Breakfast", templates: [tpl(["Idli", "Chutney"]), tpl([DOSA, "Chutney"]), tpl(["Poha"]), tpl(["Upma", "Chutney"]), tpl(["Paratha"])] },
      { slot: "Agastya's tiffin", templates: [tpl(["Roll"]), tpl(["Chilla"]), tpl(["Idli"]), tpl(["Sandwich"]), tpl(["Flavoured rice"])] },
      { slot: "Lunch", staples: ["Rice", "Curd"], templates: [tpl(["Rice", "Rice curry/Sambar", "Sabzi", "Curd"]), tpl(["Rice", "Dal", "Sabzi", "Curd"]),
        tpl([items("Rajma chawal"), "Curd"], "2/week"), tpl(["Flavoured rice", "Curd"])] },
      { slot: "Dinner", staples: ["Roti"], templates: [tpl(["Roti", "Dal", "Sabzi"]), tpl(["Roti", "Dal/Rajma/Chole"])] },
      { slot: "Gowri Shankar's dinner", staples: ["Roti"], templates: [tpl(["Roti"])] },
    ],
    judgeNotes: ["Gowri Shankar fasts Thursday till evening: he is not at Thursday breakfast and lunch.", "Gowri Shankar: no sugar, less rice and no rice at night (his own phulkas at dinner); millets good for him two or three times a week.",
      "Agastya's tiffin Monday to Friday, nut-free.", "Sunday lunch eaten out, Saturday dinner ordered in; Ankita cooks quick Sunday breakfast and dinner.", "Cook has an hour in the morning: breakfast plus at most two lunch dishes."],
  },
};
