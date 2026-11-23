// 5. Marwari joint family, the daughter-in-law cooks (no paid cook): grandfather never eats onion or garlic; grandmother no
// onion or garlic on Tuesdays and Saturdays (corrected from Thursdays); the rest eat them. Vegetarian, no eggs; one child
// with a tiffin. Frequency words: khichdi on Saturday night, dal baati on Sundays, kadhi chawal sometimes.
import { avoid, dish, mains, noEggs, SCHOOL, veg, WEEK, type Household } from "../lib/truth";

export const h5: Household = {
  id: "h5-agarwal", title: "Marwari joint family, DIL cooks, no onion-garlic for one elder always / one on days",
  owner: "Ankit", intro: "You are Ankit Agarwal, 34, who runs the family textile business in Jaipur",
  household: {
    "household.people": [{ name: "Ankit", relation: "self", age: 34, group: "adult" }, { name: "Pooja", relation: "wife", age: 32, group: "adult" },
      { name: "Reyansh", relation: "son", age: 8, group: "child" }, { name: "Ramesh", relation: "father", age: 66, group: "elder", nicknames: [{ name: "Papa", by: "Ankit" }] },
      { name: "Kamla", relation: "mother", age: 62, group: "elder", nicknames: [{ name: "Mummy", by: "Ankit" }] }],
    "household.children": ["Reyansh"], "household.elders": ["Ramesh", "Kamla"], "household.schoolAge": true,
    "household.help": [{ role: "maid", name: "Geeta", days: "daily", times: "8am" }],
    "household.weekday": "Ankit and Papa at the shop 10 to 8, they come home for lunch. Reyansh school 7:30 to 1:30. Pooja and Mummy at home.",
    "household.mealsBy": "Pooja", "household.groceriesBy": "Pooja",
    "household.weekly": [{ person: "Ankit", where: "shop", weekdays: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"], from: "10:00", to: "20:00", lunch: "home" },
      { person: "Ramesh", where: "shop", weekdays: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"], from: "10:00", to: "20:00", lunch: "home" },
      { person: "Reyansh", where: "school", weekdays: SCHOOL, from: "07:30", to: "13:30", lunch: "home" }],
  },
  groceryApps: [],
  facts: [
    { id: "pain", text: "Hardest part: deciding what to make, with everyone's different rules." },
    { id: "apps", text: "We don't use apps; the kirana delivers." },
    { id: "people", text: "Wife Pooja (32), son Reyansh (8), Papa Ramesh (66) and Mummy Kamla (62)." },
    { id: "cookingDays", text: "No cook; Pooja cooks every meal, every day. We never eat out." },
    { id: "kidsBreakfast", text: "Reyansh has poha, paratha, besan chilla, or dalia." },
    { id: "kidsLunch", text: "Reyansh takes a tiffin to school Monday to Friday: paratha with sabzi, poha, aloo sandwich." },
    { id: "kidsDinner", text: "Same as everyone." },
    { id: "adultsBreakfast", text: "Breakfast is poha, paratha, besan chilla, dalia for Papa." },
    { id: "adultsLunch", text: "Lunch: dal, chawal, roti, ek sabzi; kadhi chawal sometimes. Dal baati on Sundays." },
    { id: "adultsDinner", text: "Dinner: roti and a sabzi, gatte ki sabzi or aloo matar or bhindi; khichdi on Saturday night." },
    { id: "diet", text: "Nobody on a diet." },
    { id: "elders", text: "Papa never eats onion or garlic. Mummy doesn't eat onion or garlic on Tuesdays and Thursdays. Rest of us eat everything." },
    { id: "rules", text: "Pure vegetarian, no eggs in the house." },
    { id: "orderIn", text: "We don't order in." },
    { id: "subscriptions", text: "Milk from the dairy, 2 litres daily." },
  ],
  correction: { after: "rules", line: "sorry I meant Mummy's no onion garlic days are Tuesday and Saturday, not Thursday", fact: "elders",
    corrected: "Papa never eats onion or garlic. Mummy doesn't eat onion or garlic on Tuesdays and Saturdays. Rest of us eat everything." },
  truth: {
    people: [{ name: "Ankit", group: "adult" }, { name: "Pooja", group: "adult" }, { name: "Reyansh", group: "child", age: 8 }, { name: "Ramesh", group: "elder", age: 66 }, { name: "Kamla", group: "elder", age: 62 }],
    cook: null,
    familyCooks: [{ person: "Pooja", days: WEEK }],
    slots: [
      ...mains(),
      { name: "Reyansh's tiffin", kind: "custom", usual_people: ["Reyansh"], days: SCHOOL, match: /tiffin|lunch ?box|school/i },
      { name: "Ramesh's breakfast", kind: "addon", addon_of: "Breakfast", usual_people: ["Ramesh"], match: /ramesh|papa|father/i, optional: true },
    ],
    away: [],
    // A home with an elder who never eats onion or garlic: Pooja's everyday dishes are made without (names say so where not).
    library: [
      ...dish("Poha", ["Breakfast", "Reyansh's tiffin"]), ...dish("Paratha", ["Breakfast", "Reyansh's tiffin"]), ...dish("Besan chilla", ["Breakfast"]),
      ...dish("Dalia", ["Breakfast"], { alsoSlots: ["Ramesh's breakfast"] }), ...dish("Aloo sandwich", ["Reyansh's tiffin"]),
      ...dish("Dal", ["Lunch"]), ...dish("Chawal", ["Lunch"]), ...dish("Roti", ["Lunch", "Dinner"]),
      ...dish("Aloo matar", ["Lunch"], { unsaid: true }), ...dish("Bhindi", ["Lunch"], { unsaid: true }),
      ...dish("Kadhi chawal", ["Lunch"], { frequency: "sometimes" }), ...dish("Dal baati", ["Lunch"], { days: ["Sun"], contains: ["dairy"] }),
      ...dish("Gatte ki sabzi", ["Dinner"], { contains: ["dairy"] }), ...dish("Aloo matar", ["Dinner"]), ...dish("Bhindi", ["Dinner"]), ...dish("Khichdi", ["Dinner"], { days: ["Sat"] }),
    ],
    rules: [
      veg(/vegetarian|veg/i), noEggs(/egg/i),
      avoid("no_og_ramesh", "Ramesh: no onion or garlic, ever", ["onion_garlic"], /onion|garlic/i, { who: "Ramesh" }),
      avoid("no_og_kamla_days", "Kamla: no onion or garlic on Tue and Sat", ["onion_garlic"], /onion|garlic|tuesday|saturday/i, { who: "Kamla", days: ["Tue", "Sat"] }),
    ],
    seed: [
      { slot: "Breakfast", dishes: ["Poha"] }, { slot: "Breakfast", dishes: ["Paratha"] }, { slot: "Breakfast", dishes: ["Besan chilla"] },
      { slot: "Reyansh's tiffin", dishes: ["Paratha"] }, { slot: "Reyansh's tiffin", dishes: ["Poha"] }, { slot: "Reyansh's tiffin", dishes: ["Aloo sandwich"] },
      { slot: "Lunch", dishes: ["Dal", "Chawal", "Roti", "Aloo matar"] }, { slot: "Lunch", dishes: ["Dal", "Chawal", "Roti", "Bhindi"] },
      { slot: "Lunch", dishes: ["Kadhi chawal", "Roti"] }, { slot: "Lunch", dishes: ["Dal", "Chawal", "Roti", "Aloo matar"] },
      { slot: "Dinner", dishes: ["Roti", "Gatte ki sabzi"] }, { slot: "Dinner", dishes: ["Roti", "Aloo matar"] }, { slot: "Dinner", dishes: ["Roti", "Bhindi"] }, { slot: "Dinner", dishes: ["Khichdi"] },
    ],
    week: [{ kind: "stay", person: "Sushila", days: ["Thu", "Fri", "Sat", "Sun"], dated: { person: "Sushila", what: "Pooja's mother staying with us", from: "2026-12-03", to: "2026-12-06" } }],
    judgeNotes: ["Pure vegetarian, no eggs.", "Ramesh never onion or garlic, and he eats every meal at home.", "Kamla no onion/garlic on Tuesday and Saturday only.",
      "Pooja cooks everything; Reyansh's tiffin Monday to Friday; khichdi Saturday night, dal baati Sunday.", "Pooja's mother Sushila stays Thursday to Sunday this week."],
  },
};
