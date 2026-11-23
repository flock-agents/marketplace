// 5. Marwari joint family, the daughter-in-law cooks (no paid cook): grandfather never eats onion or garlic; grandmother no
// onion or garlic on Tuesdays and Saturdays (corrected from Thursdays); the rest eat them. Vegetarian, no eggs; one child
// with a tiffin. Frequency words: khichdi on Saturday night, dal baati on Sundays, kadhi chawal sometimes.
import { avoid, noEggs, SCHOOL, veg, WEEK, type Household } from "../lib/truth";

export const h5: Household = {
  id: "h5-agarwal", title: "Marwari joint family, DIL cooks, no onion-garlic for one elder always / one on days",
  owner: "Ankit", intro: "You are Ankit Agarwal, 34, who runs the family textile business in Jaipur",
  household: {
    "household.people": [{ name: "Ankit", relation: "self", age: 34, group: "adult" }, { name: "Pooja", relation: "wife", age: 32, group: "adult" },
      { name: "Reyansh", relation: "son", age: 8, group: "child" }, { name: "Ramesh", relation: "father", age: 66, group: "elder" },
      { name: "Kamla", relation: "mother", age: 62, group: "elder" }],
    "household.children": ["Reyansh"], "household.elders": ["Ramesh", "Kamla"], "household.schoolAge": true,
    "household.help": [{ role: "maid", name: "Geeta", days: "daily", times: "8am" }],
    "household.weekday": "Ankit and Papa at the shop 10 to 8, they come home for lunch. Reyansh school 7:30 to 1:30. Pooja and Mummy at home.",
    "household.mealsBy": "Pooja", "household.groceriesBy": "Pooja",
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
    homeCook: [{ days: WEEK, by: "Pooja" }],
    extraSlots: [{ name: "Reyansh's tiffin", match: /tiffin|lunch ?box|school/i, days: SCHOOL, for: ["Reyansh"] }],
    orderIn: [],
    hardRules: [
      veg(), noEggs(),
      { ...avoid("no_og_ramesh", "Ramesh: no onion or garlic, ever", ["onion", "garlic"], { who: "Ramesh", alsoKinds: ["no_onion_garlic"] }), rule: { kind: "no_onion_garlic", who: "Ramesh" } },
      { ...avoid("no_og_kamla_days", "Kamla: no onion or garlic on Tue and Sat", ["onion", "garlic"], { who: "Kamla", days: ["Tue", "Sat"], alsoKinds: ["no_onion_garlic"] }),
        rule: { kind: "no_onion_garlic", who: "Kamla", days: ["Tue", "Sat"] } },
    ],
    softNotes: [],
    dishes: [
      { name: "Poha", slots: ["Breakfast", "Reyansh's tiffin"] }, { name: "Paratha", slots: ["Breakfast", "Reyansh's tiffin"] }, { name: "Besan chilla", slots: ["Breakfast"] },
      { name: "Dalia", slots: ["Breakfast"], for: ["Ramesh"] }, { name: "Aloo sandwich", slots: ["Reyansh's tiffin"] },
      { name: "Dal", slots: ["Lunch"] }, { name: "Chawal", slots: ["Lunch"] }, { name: "Roti", slots: ["Lunch", "Dinner"] }, { name: "Sabzi", slots: ["Lunch", "Dinner"] },
      { name: "Kadhi chawal", slots: ["Lunch"], often: "sometimes" }, { name: "Dal baati", slots: ["Lunch"], days: ["Sun"] },
      { name: "Gatte ki sabzi", slots: ["Dinner"] }, { name: "Aloo matar", slots: ["Dinner"] }, { name: "Bhindi", slots: ["Dinner"] }, { name: "Khichdi", slots: ["Dinner"], days: ["Sat"] },
    ],
    examples: [
      { slot: "Lunch", words: "dal, chawal, roti, ek sabzi", parts: 4, staple: /chawal|rice|roti|baati/i },
      { slot: "Dinner", words: "roti and a sabzi", parts: 2, staple: /roti|chapati|phulka|khichdi/i },
    ],
    judgeNotes: ["Pure vegetarian, no eggs.", "Ramesh never onion or garlic: his dishes need a no-onion-garlic version every meal.", "Kamla no onion/garlic on Tuesday and Saturday only.",
      "Pooja cooks everything; Reyansh's tiffin Monday to Friday; khichdi Saturday night, dal baati Sunday."],
  },
};
