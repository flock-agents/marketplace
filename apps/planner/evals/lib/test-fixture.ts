// A small made-up household for the scorers' unit tests (not an eval household): three people, a cook Mon–Sat, a child's
// tiffin, an elder's add-on dinner, one office lunch, a weekly fast, Saturday dinner ordered in.
import type { Household } from "./truth";
import { avoid, dish, mains, MON_SAT, note, SCHOOL } from "./truth";

export const FIX: Household = {
  id: "t-fixture", title: "unit-test household", owner: "Asha", intro: "You are Asha",
  household: {
    "household.people": [{ name: "Asha", group: "adult" }, { name: "Chotu", group: "child" }, { name: "Dadu Ram", group: "elder" }],
    "household.weekly": [{ person: "Asha", where: "office", weekdays: SCHOOL, lunch: "away" }],
  },
  groceryApps: [],
  facts: [
    { id: "rules", text: "No eggs at home. Dadu Ram fasts on Monday till evening. Dadu Ram: no sugar. Millets are good for Dadu Ram, a few times a week." },
    { id: "adultsDinner", text: "Dinner is roti, dal and a sabzi; Dadu Ram has two phulkas every night. Rajma twice a week. Khichdi on Saturday." },
    { id: "diet", text: "Less salt for Dadu Ram. On Ekadashi he eats only fruit." },
  ],
  correction: { after: "rules", line: "ok", fact: "rules", corrected: "No eggs at home. Dadu Ram fasts on Monday till evening. Dadu Ram: no sugar. Millets are good for Dadu Ram, a few times a week." },
  truth: {
    people: [{ name: "Asha", group: "adult" }, { name: "Chotu", group: "child" }, { name: "Dadu Ram", group: "elder" }],
    cook: { name: "Kamini", days: MON_SAT, visits: [{ at: "08:00", meals: ["Breakfast", "Lunch", "Dinner"] }] },
    familyCooks: [{ person: "Asha", days: ["Sun"] }],
    slots: [
      ...mains({ Dinner: [{ day: "Sat", skip: "ordered_in" }] }),
      { name: "Chotu's tiffin", kind: "custom", usual_people: ["Chotu"], days: SCHOOL, match: /tiffin/i },
      { name: "Dadu's dinner", kind: "addon", addon_of: "Dinner", usual_people: ["Dadu Ram"], match: /dadu/i },
    ],
    away: [{ person: "Asha", slots: ["Lunch"], days: SCHOOL }],
    library: [
      ...dish("Poha", ["Breakfast", "Chotu's tiffin"]), ...dish("Upma", ["Breakfast"]), ...dish("Idli", ["Breakfast"]),
      ...dish("Sandwich", ["Chotu's tiffin"]),
      ...dish("Rice", ["Lunch"]), ...dish("Dal", ["Lunch", "Dinner"]), ...dish("Bhindi", ["Lunch"]), ...dish("Aloo gobi", ["Lunch"]),
      ...dish("Roti", ["Dinner"]), ...dish("Lauki", ["Dinner"]), ...dish("Rajma", ["Dinner"], { frequency: "2/week" }), ...dish("Khichdi", ["Dinner"], { days: ["Sat"] }),
      ...dish("Phulka", ["Dadu's dinner"], { frequency: "daily" }),
    ],
    rules: [
      { id: "no_eggs", title: "No eggs", hard: true, what: "no_eggs", items: ["egg"], quote: /egg/i, also: ["avoid"] },
      { id: "fast", title: "Dadu Ram fasts Monday till evening", hard: true, what: "fasting", who: "Dadu Ram", days: ["Mon"], slots: ["Breakfast", "Lunch"], fasting_food: [], quote: /fasts/i },
      avoid("no_sugar", "Dadu Ram: no sugar", ["sugar"], /sugar/i, { who: "Dadu Ram" }),
      { id: "millets", title: "millets good for Dadu Ram", hard: false, what: "require", who: "Dadu Ram", items: ["millet"], frequency: "sometimes", quote: /millet/i, also: ["swap"] },
      note("less_salt", "less salt for Dadu Ram", "Dadu Ram", /salt/i),
    ],
    noted: [{ id: "ekadashi", who: "Dadu Ram", re: /ekadashi/i }],
    seed: [
      { slot: "Breakfast", dishes: ["Poha"] }, { slot: "Breakfast", dishes: ["Upma"] },
      { slot: "Chotu's tiffin", dishes: ["Sandwich"] },
      { slot: "Lunch", dishes: ["Rice", "Dal", "Bhindi"] }, { slot: "Lunch", dishes: ["Rice", "Dal", "Aloo gobi"] },
      { slot: "Dinner", dishes: ["Roti", "Dal", "Lauki"] }, { slot: "Dinner", dishes: ["Roti", "Rajma"] },
      { slot: "Dadu's dinner", dishes: ["Phulka"] },
    ],
    week: [
      { kind: "stay", person: "Nani", days: ["Fri", "Sat", "Sun"], dated: { person: "Nani", what: "staying", from: "2026-12-04", to: "2026-12-06" } },
      { kind: "guests", day: "Sun", slot: "Lunch", count: 2 },
    ],
    judgeNotes: [],
  },
};
