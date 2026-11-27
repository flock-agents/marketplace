// 4. Telugu family with grandparents and a paid cook: diabetic grandmother (no sugar; ragi is good for her: soft, a few
// times a week; Ekadashi fast twice a month: not a weekday), grandfather less salt and soft food, two working adults, a teen
// with a school tiffin. Non-veg (chicken) Sunday lunch for the three younger ones; the grandparents are pure veg.
import { avoid, dish, mains, MON_SAT, note, SCHOOL, veg, items, kindPart, tpl, type Household } from "../lib/truth";

// Their bare words that name one dish (scripts/kinds/bare-decided.md).
const DOSA = kindPart("Dosa", { dish: "Plain dosa", words: "dosa" });
const RASAM = kindPart("Rice curry", { sub: "Rasam", dish: "Tomato rasam", words: "rasam" });
// Their word for the sabzi part: "one curry", "a curry".
const CURRY = kindPart("Sabzi", { words: "curry" });

export const h4: Household = {
  id: "h4-reddy", title: "Grandparents + cook: diabetic grandmother, Ekadashi, soft food, teen tiffin",
  owner: "Srinivas", intro: "You are Srinivas Reddy, 45, a bank manager in Hyderabad",
  household: {
    "household.people": [{ name: "Srinivas", relation: "self", age: 45, group: "adult" }, { name: "Padma", relation: "wife", age: 42, group: "adult" },
      { name: "Karan", relation: "son", age: 15, group: "child" }, { name: "Sarojini", relation: "mother", age: 70, group: "elder", nicknames: [{ name: "Amma", by: "Srinivas" }] },
      { name: "Venkat", relation: "father", age: 74, group: "elder", nicknames: [{ name: "Nanna", by: "Srinivas" }] }],
    "household.children": ["Karan"], "household.elders": ["Sarojini", "Venkat"], "household.schoolAge": true,
    "household.help": [{ role: "cook", name: "Kavitha", days: "Mon-Sat", times: "7:30am", meals: ["Breakfast", "Lunch"] },
      { role: "cook", name: "Kavitha", days: "Mon-Sat", times: "6:30pm", meals: ["Dinner"] }],
    "household.weekday": "Srinivas and Padma both at work 9 to 6. Karan's school 7:45 to 3:30. Amma and Nanna are home.",
    "household.mealsBy": [{ person: "Padma" }], "household.groceriesBy": [{ person: "Srinivas" }],
    "household.weekly": [{ person: "Srinivas", where: "office", weekdays: SCHOOL, from: "09:00", to: "18:00", lunch: null },
      { person: "Padma", where: "office", weekdays: SCHOOL, from: "09:00", to: "18:00", lunch: null },
      { person: "Karan", where: "school", weekdays: SCHOOL, from: "07:45", to: "15:30", lunch: "away" },
      { person: "Sarojini", where: "home", weekdays: SCHOOL, lunch: "home" }, { person: "Venkat", where: "home", weekdays: SCHOOL, lunch: "home" }],
  },
  groceryApps: ["BigBasket"],
  facts: [
    { id: "pain", text: "Hardest part: cooking separately for my parents' health every day." },
    { id: "apps", text: "BigBasket only." },
    { id: "lunchWhere", text: "Karan takes a school tiffin Monday to Friday." },
    { id: "cook", text: "Cook Kavitha comes Monday to Saturday, 7:30 morning for breakfast and lunch, 6:30 evening for dinner." },
    { id: "cookTime", text: "Kavitha has time, no rush." },
    { id: "otherDays", text: "Sunday Padma cooks everything. We hardly order in, maybe once a month. No fixed day." },
    { id: "childSame", text: "Karan takes a school tiffin Monday to Friday: chapati roll, lemon rice, veg pulao, curd rice.", differs: true },
    { id: "familyBreakfast", text: "Breakfast: idli, pesarattu, upma, dosa with allam chutney. Ragi dosa or ragi java for Amma." },
    { id: "familyLunch", text: "Lunch is rice, pappu, one curry, rasam, curd, and a pachadi. Curry like dondakaya, beans, bendakaya. Chicken curry on Sunday lunch for the three of us." },
    { id: "familyDinner", text: "Dinner: chapati with a curry, or rice and pappu. Jowar roti for Amma at night." },
    { id: "childMeals", text: "Karan: idli, pesarattu, upma, bread toast on rushed days. Karan eats same as us at dinner." },
    { id: "differently", text: "Amma (Sarojini) is diabetic: no sugar at all. Ragi is good for her, a few times a week. Otherwise no diets. Nanna (Venkat) less salt, and soft food, he has trouble chewing. Amma fasts on Ekadashi, twice a month, only fruits that day. My parents are pure vegetarian, no eggs, no meat. The three of us eat chicken, only on Sunday lunch. Nothing else." },
    { id: "subscriptions", text: "Milk from Heritage, delivered daily." },
  ],
  correction: { after: "otherDays", line: "oh one thing, evening Kavitha comes at 7, not 6:30", fact: "cook",
    corrected: "Cook Kavitha comes Monday to Saturday, 7:30 morning for breakfast and lunch, 7 evening for dinner." },
  truth: {
    people: [{ name: "Srinivas", group: "adult" }, { name: "Padma", group: "adult" }, { name: "Karan", group: "child", age: 15 }, { name: "Sarojini", group: "elder", age: 70 }, { name: "Venkat", group: "elder", age: 74 }],
    cook: { name: "Kavitha", days: MON_SAT, visits: [{ at: "07:30", meals: ["Breakfast", "Lunch"] }, { at: "19:00", meals: ["Dinner"] }] },
    familyCooks: [{ person: "Padma", days: ["Sun"] }],
    slots: [
      ...mains(),
      { name: "Karan's tiffin", kind: "custom", usual_people: ["Karan"], days: SCHOOL, match: /tiffin|lunch ?box|school/i },
      { name: "Sarojini's breakfast", kind: "addon", addon_of: "Breakfast", usual_people: ["Sarojini"], match: /sarojini|amma|mother|grand/i },
      { name: "Sarojini's dinner", kind: "addon", addon_of: "Dinner", usual_people: ["Sarojini"], match: /sarojini|amma|mother|grand/i },
      // Sunday chicken for the three of them: an add-on is one way to hold it; a rule alone is another.
      { name: "Sunday chicken", kind: "addon", addon_of: "Lunch", usual_people: ["Srinivas", "Padma", "Karan"], days: ["Sun"], match: /chicken|non.?veg|sunday/i, optional: true },
    ],
    // Nobody said whether the two of them take lunch to work: weekday lunch is unclear for them (asked once in the read-back).
    away: [{ person: "Karan", slots: ["Lunch"], days: SCHOOL }],
    lunchUnclear: ["Srinivas", "Padma"],
    library: [
      ...dish("Idli", ["Breakfast"]), ...dish("Pesarattu", ["Breakfast"]), ...dish("Plain dosa", ["Breakfast"]),
      ...dish("Allam chutney", ["Breakfast"]), ...dish("Bread toast", ["Breakfast"], { frequency: "sometimes" }),
      ...dish("Ragi dosa", ["Sarojini's breakfast"]), ...dish("Ragi java", ["Sarojini's breakfast"]),
      ...dish("Chapati roll", ["Karan's tiffin"]), ...dish("Lemon rice", ["Karan's tiffin"]), ...dish("Veg pulao", ["Karan's tiffin"]), ...dish("Curd rice", ["Karan's tiffin"]),
      ...dish("Tomato rasam", ["Lunch"]), ...dish("Curd", ["Lunch"]), ...dish("Pachadi", ["Lunch"], { kind: "Chutney" }),
      ...dish("Dondakaya curry", ["Lunch"], { kind: "Sabzi" }), ...dish("Beans curry", ["Lunch"], { kind: "Sabzi" }), ...dish("Bendakaya curry", ["Lunch"], { kind: "Sabzi" }),
      ...dish("Dondakaya curry", ["Dinner"], { unsaid: true, kind: "Sabzi" }), ...dish("Beans curry", ["Dinner"], { unsaid: true, kind: "Sabzi" }), ...dish("Bendakaya curry", ["Dinner"], { unsaid: true, kind: "Sabzi" }),
      ...dish("Chicken curry", ["Lunch"], { days: ["Sun"], alsoSlots: ["Sunday chicken"] }),
      ...dish("Chapati", ["Dinner"]), ...dish("Jowar roti", ["Sarojini's dinner"]),
    ],
    rules: [
      avoid("veg_sarojini", "Sarojini: pure veg, no eggs", ["meat", "fish", "egg"], /vegetarian|veg/i, { who: "Sarojini", also: ["veg", "no_eggs"] }),
      avoid("veg_venkat", "Venkat: pure veg, no eggs", ["meat", "fish", "egg"], /vegetarian|veg/i, { who: "Venkat", also: ["veg", "no_eggs"] }),
      avoid("nonveg_sunday", "Chicken only on Sunday (lunch)", ["meat"], /sunday/i, { days: MON_SAT, also: ["only"] }),
      avoid("no_sugar", "Sarojini: no sugar", ["sugar"], /sugar/i, { who: "Sarojini" }),
      { id: "ragi_good", title: "ragi is good for Sarojini, a few times a week", hard: false, what: "require", who: "Sarojini", items: ["millet"], frequency: "sometimes", quote: /ragi/i, also: ["swap"] },
      note("less_salt", "less salt for Venkat", "Venkat", /salt/i),
      note("soft_food", "soft food for Venkat", "Venkat", /soft|chew/i),
    ],
    noted: [{ id: "ekadashi", who: "Sarojini", re: /ekadashi/i }],
    seed: [
      { slot: "Breakfast", dishes: ["Idli", "Allam chutney"] }, { slot: "Breakfast", dishes: ["Pesarattu", "Allam chutney"] }, { slot: "Breakfast", dishes: ["Upma", "Allam chutney"] },
      { slot: "Breakfast", dishes: ["Plain dosa", "Allam chutney"] },
      { slot: "Sarojini's breakfast", dishes: ["Ragi dosa"] }, { slot: "Sarojini's breakfast", dishes: ["Ragi java"] },
      { slot: "Karan's tiffin", dishes: ["Chapati roll"] }, { slot: "Karan's tiffin", dishes: ["Lemon rice"] }, { slot: "Karan's tiffin", dishes: ["Veg pulao"] }, { slot: "Karan's tiffin", dishes: ["Curd rice"] },
      { slot: "Lunch", dishes: ["Rice", "Pappu", "Dondakaya curry", "Tomato rasam", "Curd", "Pachadi"] }, { slot: "Lunch", dishes: ["Rice", "Pappu", "Beans curry", "Tomato rasam", "Curd", "Pachadi"] },
      { slot: "Lunch", dishes: ["Rice", "Pappu", "Bendakaya curry", "Tomato rasam", "Curd"] },
      { slot: "Dinner", dishes: ["Chapati", "Beans curry"] }, { slot: "Dinner", dishes: ["Rice", "Pappu"] }, { slot: "Dinner", dishes: ["Chapati", "Dondakaya curry"] },
      { slot: "Sarojini's dinner", dishes: ["Jowar roti"] }, { slot: "Sarojini's dinner", dishes: ["Jowar roti"] },
    ],
    week: [{ kind: "away", person: "Srinivas", days: ["Wed", "Thu"], dated: { person: "Srinivas", what: "work trip to Mumbai", from: "2026-12-02", to: "2026-12-03" } }],
    cuisines: ["south", "andhra"], cuisinesAlso: ["karnataka", "tamil", "north"],
    meals: [
      { slot: "Breakfast", staples: ["Chutney"], templates: [tpl(["Idli", "Chutney"]), tpl([DOSA, "Chutney"]), tpl(["Upma", "Chutney"])] },
      { slot: "Sarojini's breakfast", templates: [tpl(["Dosa"]), tpl(["Porridge"])] },
      { slot: "Karan's tiffin", templates: [tpl(["Roll"]), tpl(["Flavoured rice"]), tpl(["Pulao"]), tpl([items("Curd rice")])] },
      // Two of three seeded lunches have the pachadi: the plate with it.
      { slot: "Lunch", staples: ["Rice", "Curd"], templates: [tpl(["Rice", "Dal/Pappu", CURRY, RASAM, "Curd", "Chutney"])] },
      { slot: "Dinner", staples: ["Roti", "Rice"], templates: [tpl(["Roti", CURRY]), tpl(["Rice", "Dal/Pappu"])] },
      { slot: "Sarojini's dinner", staples: ["Bhakri"], templates: [tpl(["Bhakri"])] },
    ],
    judgeNotes: ["Grandparents pure veg, no eggs; chicken only Sunday lunch for Srinivas, Padma, Karan.", "Sarojini: no sugar; her own ragi breakfast and jowar roti at night; ragi a few times a week; Ekadashi fast (fruit) twice a month.",
      "Venkat: less salt and soft food.", "Karan's tiffin Monday to Friday.", "Srinivas is away Wednesday and Thursday this week."],
  },
};
