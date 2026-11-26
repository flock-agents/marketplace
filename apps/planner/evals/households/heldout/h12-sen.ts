// 12 (held out). A Bengali–Marwari home: the wife and daughter eat fish (their own add-on at dinner, twice a week), the
// husband and his diabetic father are vegetarian; the father's own millet rotis at night (never rice), no sugar; a cook
// Mon–Sat; the daughter's tiffin; the wife's mother stays the weekend. Not used for tuning: run only with --heldout.
import { avoid, dish, mains, MON_SAT, note, SCHOOL, type Household } from "../../lib/truth";

const OP = "Omprakash";
export const h12: Household = {
  id: "h12-sen", title: "Bengali–Marwari home, fish add-on for two, diabetic vegetarian father-in-law",
  owner: "Debjani", intro: "You are Debjani Sen, 44, a freelance editor in Kolkata who works from home",
  household: {
    "household.people": [{ name: "Debjani", relation: "self", age: 44, group: "adult" }, { name: "Sanjay", relation: "husband", age: 46, group: "adult" },
      { name: "Mili", relation: "daughter", age: 9, group: "child" }, { name: OP, relation: "father-in-law", age: 77, group: "elder", nicknames: [{ name: "Papaji", by: "Debjani" }] }],
    "household.children": ["Mili"], "household.elders": [OP], "household.schoolAge": true,
    "household.help": [{ role: "cook", name: "Pushpa", days: "Mon-Sat", times: "7am", meals: ["Breakfast", "Lunch"] },
      { role: "cook", name: "Pushpa", days: "Mon-Sat", times: "6pm", meals: ["Dinner"] }],
    "household.weekday": "Debjani works from home. Sanjay at his office 10 to 7, takes his lunch box. Mili's school 8 to 3, she takes a tiffin. Papaji at home.",
    "household.mealsBy": [{ person: "Debjani" }], "household.groceriesBy": [{ person: "Debjani" }],
    "household.weekly": [{ person: "Sanjay", where: "office", weekdays: SCHOOL, from: "10:00", to: "19:00", lunch: "carries" },
      { person: "Mili", where: "school", weekdays: SCHOOL, from: "08:00", to: "15:00", lunch: "away" }, { person: "Debjani", where: "home", weekdays: SCHOOL, lunch: "home" }],
  },
  groceryApps: ["Blinkit", "BigBasket"],
  facts: [
    { id: "pain", text: "Hardest part: two kitchens in one, Bengali for me and Mili, Marwari veg for Sanjay and Papaji, and his sugar." },
    { id: "apps", text: "Blinkit, and BigBasket for the monthly things." },
    { id: "lunchWhere", text: "Husband Sanjay (46), daughter Mili (9) and my father-in-law Omprakash (77), we call him Papaji." },
    { id: "cook", text: "Cook Pushpa comes Monday to Saturday, 7 in the morning for breakfast and lunch, and 6 in the evening for dinner." },
    { id: "cookTime", text: "She's fine on time." },
    { id: "otherDays", text: "Sunday I cook everything. Rarely, no fixed day." },
    { id: "childSame", text: "Mili takes a tiffin Monday to Friday: sandwich, paratha roll, pasta on Fridays.", differs: true },
    { id: "familyBreakfast", text: "Breakfast: poha, besan chilla, toast; luchi and cholar dal on Sunday." },
    { id: "familyLunch", text: "Lunch: rice, dal, a sabzi like aloo posto or gatte, and roti. Kadhi sometimes." },
    { id: "familyDinner", text: "Dinner: roti, dal and a sabzi. Macher jhol twice a week for me and Mili. Papaji has bajra or jowar roti at night, never rice." },
    { id: "childMeals", text: "Mili had toast, poha, besan chilla; luchi on Sunday. Mili eats what we eat, less spicy." },
    { id: "differently", text: "Papaji is diabetic: no sugar at all, and no rice at night. Papaji is pure veg, no eggs, and less salt for him. Sanjay and Papaji are vegetarian. Me and Mili eat fish and eggs. No beef in the house." },
    { id: "subscriptions", text: "Milk packets every morning." },
  ],
  correction: { after: "cookTime", line: "oh, Pushpa comes at 7:30 in the evening now, not 6", fact: "cook",
    corrected: "Cook Pushpa comes Monday to Saturday, 7 in the morning for breakfast and lunch, and 7:30 in the evening for dinner." },
  truth: {
    people: [{ name: "Debjani", group: "adult" }, { name: "Sanjay", group: "adult" }, { name: "Mili", group: "child", age: 9 }, { name: OP, group: "elder", age: 77 }],
    cook: { name: "Pushpa", days: MON_SAT, visits: [{ at: "07:00", meals: ["Breakfast", "Lunch"] }, { at: "19:30", meals: ["Dinner"] }] },
    familyCooks: [{ person: "Debjani", days: ["Sun"] }],
    slots: [
      ...mains(),
      { name: "Mili's tiffin", kind: "custom", usual_people: ["Mili"], days: SCHOOL, match: /tiffin|lunch ?box|school/i },
      // Fish for the two who eat it, beside the vegetarian dinner; the father's millet rotis beside it too.
      { name: "Debjani and Mili's fish", kind: "addon", addon_of: "Dinner", usual_people: ["Debjani", "Mili"], match: /fish|mach|debjani|mili/i },
      { name: "Papaji's dinner", kind: "addon", addon_of: "Dinner", usual_people: [OP], match: /papaji|omprakash|father|grand|roti/i },
    ],
    away: [{ person: "Mili", slots: ["Lunch"], days: SCHOOL }],
    library: [
      ...dish("Poha", ["Breakfast"]), ...dish("Besan chilla", ["Breakfast"]), ...dish("Toast", ["Breakfast"]),
      ...dish("Luchi", ["Breakfast"], { days: ["Sun"] }), ...dish("Cholar dal", ["Breakfast"], { days: ["Sun"] }),
      ...dish("Sandwich", ["Mili's tiffin"]), ...dish("Paratha roll", ["Mili's tiffin"], { kind: "Roll" }), ...dish("Pasta", ["Mili's tiffin"], { days: ["Fri"] }),
      ...dish("Rice", ["Lunch"]), ...dish("Dal", ["Lunch", "Dinner"]), ...dish("Aloo posto", ["Lunch"]), ...dish("Gatte ki sabzi", ["Lunch"], { contains: ["dairy"] }),
      ...dish("Roti", ["Lunch", "Dinner"]), ...dish("Kadhi", ["Lunch"], { frequency: "sometimes" }),
      ...dish("Aloo posto", ["Dinner"], { unsaid: true }), ...dish("Gatte ki sabzi", ["Dinner"], { unsaid: true, contains: ["dairy"] }),
      ...dish("Macher jhol", ["Debjani and Mili's fish"], { frequency: "2/week" }),
      ...dish("Bajra roti", ["Papaji's dinner"]), ...dish("Jowar roti", ["Papaji's dinner"]),
    ],
    rules: [
      avoid("veg_rahul", "Sanjay: vegetarian", ["meat", "fish"], /vegetarian|veg/i, { who: "Sanjay", also: ["veg"] }),
      avoid("veg_op", "Omprakash: pure veg, no eggs", ["meat", "fish", "egg"], /veg|egg/i, { who: OP, also: ["veg", "no_eggs"] }),
      avoid("no_beef", "No beef in the house", ["beef"], /beef/i),
      avoid("no_sugar_op", "Omprakash: no sugar", ["sugar"], /sugar|diabet/i, { who: OP }),
      avoid("no_rice_night_op", "Omprakash: no rice at night", ["white_rice"], /rice at night|never rice/i, { who: OP, slots: ["Dinner"] }),
      note("less_salt_op", "less salt for Omprakash", OP, /salt/i),
      note("less_spicy_tara", "less spicy for Mili", "Mili", /spic/i),
    ],
    seed: [
      { slot: "Breakfast", dishes: ["Poha"] }, { slot: "Breakfast", dishes: ["Besan chilla"] }, { slot: "Breakfast", dishes: ["Toast"] }, { slot: "Breakfast", dishes: ["Luchi", "Cholar dal"] },
      { slot: "Mili's tiffin", dishes: ["Sandwich"] }, { slot: "Mili's tiffin", dishes: ["Paratha roll"] }, { slot: "Mili's tiffin", dishes: ["Pasta"] },
      { slot: "Lunch", dishes: ["Rice", "Dal", "Aloo posto", "Roti"] }, { slot: "Lunch", dishes: ["Rice", "Dal", "Gatte ki sabzi", "Roti"] }, { slot: "Lunch", dishes: ["Rice", "Kadhi", "Roti"] },
      { slot: "Dinner", dishes: ["Roti", "Dal", "Gatte ki sabzi"] }, { slot: "Dinner", dishes: ["Roti", "Dal", "Aloo posto"] },
      { slot: "Debjani and Mili's fish", dishes: ["Macher jhol"] }, { slot: "Papaji's dinner", dishes: ["Bajra roti"] }, { slot: "Papaji's dinner", dishes: ["Jowar roti"] },
    ],
    week: [{ kind: "stay", person: "Shefali", days: ["Fri", "Sat", "Sun"], dated: { person: "Shefali", what: "Debjani's mother staying for the weekend", from: "2026-12-04", to: "2026-12-06" } }],
    cuisines: ["bengal", "rajasthan"], cuisinesAlso: ["east", "north", "west", "continental"],
    judgeNotes: ["Sanjay and Omprakash vegetarian (Omprakash also no eggs); Debjani and Mili have macher jhol twice a week at dinner, as their own dish.",
      "Omprakash: diabetic, no sugar, never rice at night (bajra or jowar roti), less salt.", "No beef.", "Mili's tiffin Monday to Friday; she is not home for weekday lunch.",
      "Debjani's mother Shefali stays Friday to Sunday this week."],
  },
};
