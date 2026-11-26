// 15 (held out, set 2). North Indian vegetarian (no eggs) in Lucknow: father at office, mother works from home and does all
// the cooking, a five-year-old in UKG with a school tiffin who is home for lunch. Sunday lunch is eaten out.
// Frequency words: poha twice a week, chole chawal once a week, kadhi chawal on Saturdays, pasta on Wednesdays, puri sabzi
// and moong dal khichdi on Sundays.
import { dish, mains, noEggs, note, SCHOOL, veg, items, part, tpl, WEEK, type Household } from "../../lib/truth";

export const h15: Household = {
  id: "h15-gupta", title: "North Indian vegetarian, no eggs, mother cooks, UKG child with a snack tiffin, Sunday lunch out",
  owner: "Ankit", intro: "You are Ankit Gupta, 36, a branch manager at a bank in Lucknow",
  household: {
    "household.people": [{ name: "Ankit", relation: "self", age: 36, group: "adult" }, { name: "Pooja", relation: "wife", age: 33, group: "adult" },
      { name: "Myra", relation: "daughter", age: 5, group: "child" }],
    "household.children": ["Myra"], "household.elders": [], "household.schoolAge": true,
    "household.help": [{ role: "maid", name: "Sushila", days: "daily", times: "9am" }],
    "household.weekday": "Ankit is at the bank 9:30 to 6:30 and carries lunch from home. Pooja works from home. Myra has school 8 to 12:30 and is home for lunch.",
    "household.mealsBy": [{ person: "Pooja" }], "household.groceriesBy": [{ person: "Pooja" }],
    "household.weekly": [{ person: "Ankit", where: "office", weekdays: SCHOOL, from: "09:30", to: "18:30", lunch: "carries" },
      { person: "Myra", where: "school", weekdays: SCHOOL, from: "08:00", to: "12:30", lunch: "home" }],
  },
  groceryApps: ["Blinkit"],
  facts: [
    { id: "pain", text: "Hardest part: Pooja runs out of ideas and we end up making the same four things." },
    { id: "apps", text: "Groceries on Blinkit; sabzi from the thela outside most mornings." },
    { id: "lunchWhere", text: "Myra takes a small tiffin to school Monday to Friday for the break. She comes home by 1 and has lunch with Pooja." },
    { id: "cook", text: "No cook. Pooja does all the cooking herself, every day. Sushila the maid only cleans and does the dishes." },
    { id: "cookTime", text: "Pooja has about an hour in the morning before her work calls start, and cooks dinner around 7:30." },
    { id: "otherDays", text: "Pooja cooks every day of the week. On Sunday we go out for lunch. We eat out once a week, Sunday dinner, usually at a place in Hazratganj. We rarely order in." },
    { id: "childSame", text: "Myra takes a small tiffin to school Monday to Friday for the break: cheese sandwich, besan cheela, pasta on Wednesdays. She comes home by 1 and has lunch with Pooja.", differs: true },
    { id: "familyBreakfast", text: "Breakfast: aloo paratha, gobhi paratha or paneer paratha with curd; poha twice a week; suji upma. On Sundays Pooja makes puri sabzi." },
    { id: "familyLunch", text: "Lunch is dal, chawal, roti and a sabzi with salad; sabzi like aloo jeera, bhindi, lauki, tinda. Chole chawal once a week, kadhi chawal on Saturdays." },
    { id: "familyDinner", text: "Dinner is lighter: roti with dal and a sabzi like mix veg or baingan bharta, or roti with palak paneer or shahi paneer. Moong dal khichdi on Sundays." },
    { id: "childMeals", text: "Myra eats what we eat at breakfast, just less spicy. Myra eats what we eat at dinner, less spicy." },
    { id: "differently", text: "Nobody is on a diet. We are pure vegetarian, and no eggs at home either. Less spicy for Myra." },
    { id: "subscriptions", text: "Milk from the Parag doodhwala, 1 litre daily." },
  ],
  correction: { after: "otherDays", line: "sorry, I mean Sunday lunch we go out, not dinner. Dinner is at home, khichdi", fact: "otherDays",
    corrected: "Pooja cooks every day of the week. On Sunday we go out for lunch. We eat out once a week, Sunday lunch, usually at a place in Hazratganj. Sunday dinner is at home. We rarely order in." },
  truth: {
    people: [{ name: "Ankit", group: "adult" }, { name: "Pooja", group: "adult" }, { name: "Myra", group: "child", age: 5 }],
    cook: null,
    familyCooks: [{ person: "Pooja", days: WEEK }],
    slots: [
      ...mains({ Lunch: [{ day: "Sun", skip: "eaten_out" }] }),
      { name: "Myra's tiffin", kind: "custom", usual_people: ["Myra"], days: SCHOOL, match: /tiffin|lunch ?box|school|snack/i },
    ],
    // Myra is home for lunch by 1; Ankit carries the home lunch. Nobody is away from a main slot.
    away: [],
    library: [
      ...dish("Aloo paratha", ["Breakfast"]), ...dish("Gobhi paratha", ["Breakfast"]), ...dish("Paneer paratha", ["Breakfast"]), ...dish("Curd", ["Breakfast"]),
      ...dish("Suji upma", ["Breakfast"]), ...dish("Puri sabzi", ["Breakfast"], { days: ["Sun"] }),
      ...dish("Cheese sandwich", ["Myra's tiffin"], { contains: ["dairy"] }), ...dish("Besan cheela", ["Myra's tiffin"]),
      ...dish("Chawal", ["Lunch"]),
      ...dish("Aloo jeera", ["Lunch"]), ...dish("Bhindi", ["Lunch"], { kind: "Sabzi" }), ...dish("Lauki", ["Lunch"], { kind: "Sabzi" }), ...dish("Tinda", ["Lunch"], { kind: "Sabzi" }),
      ...dish("Chole chawal", ["Lunch"], { frequency: "1/week" }), ...dish("Kadhi chawal", ["Lunch"], { days: ["Sat"], contains: ["dairy"] }),
      ...dish("Mix veg", ["Dinner"], { kind: "Sabzi" }), ...dish("Baingan bharta", ["Dinner"]), ...dish("Palak paneer", ["Dinner"]), ...dish("Shahi paneer", ["Dinner"]),
      ...dish("Moong dal khichdi", ["Dinner"], { days: ["Sun"] }),
    ],
    rules: [
      veg(/pure veg|vegetarian/i),
      noEggs(/no eggs/i),
      note("less_spicy_kid", "less spicy for Myra", "Myra", /spic/i),
    ],
    seed: [
      { slot: "Breakfast", dishes: ["Aloo paratha", "Curd"] }, { slot: "Breakfast", dishes: ["Poha"] }, { slot: "Breakfast", dishes: ["Gobhi paratha", "Curd"] },
      { slot: "Breakfast", dishes: ["Suji upma"] }, { slot: "Breakfast", dishes: ["Paneer paratha", "Curd"] }, { slot: "Breakfast", dishes: ["Puri sabzi"] },
      { slot: "Myra's tiffin", dishes: ["Cheese sandwich"] }, { slot: "Myra's tiffin", dishes: ["Besan cheela"] }, { slot: "Myra's tiffin", dishes: ["Pasta"] },
      { slot: "Lunch", dishes: ["Dal", "Chawal", "Roti", "Aloo jeera", "Salad"] }, { slot: "Lunch", dishes: ["Dal", "Chawal", "Roti", "Bhindi", "Salad"] },
      { slot: "Lunch", dishes: ["Chole chawal", "Salad"] }, { slot: "Lunch", dishes: ["Kadhi chawal"] }, { slot: "Lunch", dishes: ["Dal", "Chawal", "Roti", "Lauki", "Salad"] },
      { slot: "Dinner", dishes: ["Roti", "Dal", "Mix veg"] }, { slot: "Dinner", dishes: ["Roti", "Palak paneer"] }, { slot: "Dinner", dishes: ["Roti", "Dal", "Baingan bharta"] },
      { slot: "Dinner", dishes: ["Moong dal khichdi"] },
    ],
    cuisines: ["north"], cuisinesAlso: ["punjab", "central", "continental"],
    meals: [
      { slot: "Breakfast", templates: [tpl(["Paratha", "Curd"]), tpl(["Poha"], "2/week"), tpl(["Upma"]), tpl([items("Puri sabzi")])] },
      { slot: "Myra's tiffin", templates: [tpl(["Sandwich"]), tpl(["Chilla"]), { parts: [part("Pasta")], days: ["Wed"] }] },
      // The everyday plate; chole chawal (once a week, with salad) and kadhi chawal (Saturdays) are their own dishes.
      { slot: "Lunch", staples: ["Roti", "Rice", "Salad"], templates: [tpl(["Roti", "Rice", "Dal", "Sabzi", "Salad"]), tpl([items("Chole chawal"), "Salad"], "1/week"), tpl([items("Kadhi chawal")])] },
      { slot: "Dinner", staples: ["Roti"], templates: [tpl(["Roti", "Dal", "Sabzi"]), tpl(["Roti", "Gravy/Paneer"]), tpl([items("Moong dal khichdi")])] },
    ],
    judgeNotes: ["Pure vegetarian, no eggs.", "Myra's tiffin Monday to Friday only; she is home for lunch every day.", "Sunday lunch is eaten out; Sunday dinner is moong dal khichdi at home."],
  },
};
