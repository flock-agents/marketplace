// A small made-up household for the scorers' unit tests (not an eval household): three people, a cook Mon–Sat, a child's
// tiffin, an elder's add-on dinner, one office lunch, a weekly fast, Saturday dinner ordered in.
import type { Household } from "./truth";
import { avoid, dish, kindPart, linked, mains, MON_SAT, note, SCHOOL } from "./truth";

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
      { slot: "Chotu's tiffin", dishes: ["Sandwich"] }, { slot: "Chotu's tiffin", dishes: ["Sandwich"] }, { slot: "Chotu's tiffin", dishes: ["Sandwich"] },
      { slot: "Lunch", dishes: ["Rice", "Dal", "Bhindi"] }, { slot: "Lunch", dishes: ["Rice", "Dal", "Aloo gobi"] }, { slot: "Lunch", dishes: ["Rice", "Dal"] },
      { slot: "Dinner", dishes: ["Roti", "Dal", "Lauki"] }, { slot: "Dinner", dishes: ["Roti", "Rajma"] }, { slot: "Dinner", dishes: ["Roti"] },
      { slot: "Dadu's dinner", dishes: ["Phulka"] },
    ],
    week: [
      { kind: "stay", person: "Nani", days: ["Fri", "Sat", "Sun"], dated: { person: "Nani", what: "staying", from: "2026-12-04", to: "2026-12-06" } },
      { kind: "guests", day: "Sun", slot: "Lunch", count: 2 },
    ],
    judgeNotes: [],
  },
};

/** The same household for Eval 2's scorer, its dal named the way a plan must name a dish ("Toor dal", not the bare kind
 *  word "Dal", owner 25 Nov) and its two vegetables placed in the catalog's Sabzi kind (the catalog has no item "Bhindi"). */
export const PLAN_FIX: Household = (() => {
  const h = structuredClone(FIX);
  h.truth.library = h.truth.library.map((d) => (d.name === "Dal" ? { ...d, name: "Toor dal" } : ["Bhindi", "Lauki"].includes(d.name) ? { ...d, kind: "Sabzi" } : d));
  h.truth.seed = h.truth.seed.map((r) => ({ ...r, dishes: r.dishes.map((x) => (x === "Dal" ? "Toor dal" : x)) }));
  return h;
})();

/** PLAN_FIX with the one meaning model's shapes (spec §5.4): Chotu's lunch box replaces Lunch Mon–Thu and rolls the lunch sabzi
 *  (a linked part), Asha carries the home lunch and her salad is an add-on whose person stays at Lunch (extras), Dadu Ram has plain
 *  parathas in place of roti on Tuesday and Thursday (a hard swap with typed targets), and no egg for him by name. */
export const BOX_FIX: Household = (() => {
  const h = structuredClone(PLAN_FIX);
  h.household["household.weekly"] = [{ person: "Asha", where: "office", weekdays: SCHOOL, lunch: "carries" }];
  h.truth.away = [];
  h.truth.slots.push(
    { name: "Chotu's lunch box", kind: "custom", usual_people: ["Chotu"], days: ["Mon", "Tue", "Wed", "Thu"], replaces: "Lunch", match: /lunch box/i },
    { name: "Asha's lunch extras", kind: "addon", addon_of: "Lunch", usual_people: ["Asha"], days: SCHOOL, extras: true, match: /extras/i },
  );
  h.truth.library.push(
    ...dish("Paratha roll", ["Chotu's lunch box"], { frequency: "daily", kind: "Paratha" }),
    ...dish("Cucumber salad", ["Asha's lunch extras"], { frequency: "daily" }),
    ...dish("Plain paratha", ["Dinner"], { days: ["Tue", "Thu"] }),
  );
  h.truth.rules.push(
    avoid("no_egg_dadu", "Dadu Ram: no egg", ["egg"], /egg/i, { who: "Dadu Ram", targets: [{ ingredient: "egg" }] }),
    { id: "paratha_swap", title: "Dadu Ram: parathas, not rotis", hard: true, what: "swap", who: "Dadu Ram", slots: ["Dinner"], days: ["Tue", "Thu"], items: ["Roti"], to: "Plain paratha",
      targets: [{ kind: "Roti" }], gives: { item: "Plain paratha", kind: "Paratha" }, quote: /paratha/i },
  );
  h.truth.seed.push({ slot: "Chotu's lunch box", dishes: ["Paratha roll"] }, { slot: "Asha's lunch extras", dishes: ["Cucumber salad"] });
  h.truth.meals = [{ slot: "Chotu's lunch box", templates: [{ parts: [kindPart("Paratha"), linked("Lunch", "Sabzi")] }] }];
  return h;
})();
