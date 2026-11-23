// The food rules the app checks before a plan is kept (docs/specs/2026-11-21-planner-food-rules-check.md): the matcher and the
// breaks of each kind of rule, as pure functions. (Run 11's week through plan_week went with the old plan operations; lane C
// checks rules against the slot model's rules rows and each dish's contains.)
import { describe, it, expect } from "bun:test";
import { breaksText, dishHas, isSide, matches, ruleBreaks, ruleBreaksIn, rulesSaid, ruleText, type RuleWeek } from "./rules";

describe("matches", () => {
  it("drops a negation from a dish's name: in brackets, and 'without X' / 'no X'", () => {
    expect(matches("Lemon rice (no peanuts)", "peanut", { name: true })).toBe(false);
    expect(matches("Lemon rice (without peanuts)", "@peanut", { name: true })).toBe(false);
    expect(matches("Lemon rice [minus groundnut]", "@peanut", { name: true })).toBe(false);
    expect(matches("Poha without onion", "onion", { name: true })).toBe(false);
    expect(matches("Upma no onion, with peas", "onion", { name: true })).toBe(false);
    expect(matches("Upma no onion, with peas", "peas", { name: true })).toBe(true);
    expect(matches("Sambar without onion and garlic", "garlic", { name: true })).toBe(false);
    expect(matches("Lemon rice (no peanuts)", "rice", { name: true })).toBe(true);
    // An ingredient is matched as given.
    expect(matches("no peanuts", "peanut")).toBe(true);
    // "no" is a word: "Dal Makhani" is not a negation.
    expect(matches("Dal makhani", "dal", { name: true })).toBe(true);
    // An Indian food word reads as its English one: aloo is potato, suji is semolina (gluten), matar is peas, kadhi has curd.
    expect(matches("Aloo matar", "@root_veg", { name: true })).toBe(true);
    expect(matches("Aloo matar", "@green_leafy", { name: true })).toBe(true);
    expect(matches("Suji sheera", "@gluten", { name: true })).toBe(true);
    expect(matches("Kadhi chana", "@dairy", { name: true })).toBe(true);
    expect(matches("yogurt", "@dairy")).toBe(true);
    expect(matches("Palak paneer", "spinach", { name: true })).toBe(true);
    expect(matches("Rava idli", "@white_rice", { name: true })).toBe(false);
    expect(matches("Akki roti", "@white_rice", { name: true })).toBe(true);
    // Makhani is butter and cream: dairy.
    expect(matches("Dal makhani", "@dairy", { name: true })).toBe(true);
  });

  it("drops a trailing plural s / es on both sides", () => {
    expect(matches("Potatoes", "potato")).toBe(true);
    expect(matches("potato", "potatoes")).toBe(true);
    expect(matches("Chapatis", "chapati")).toBe(true);
    expect(matches("Dates", "date")).toBe(true);
    expect(matches("peanuts", "peanut")).toBe(true);
    expect(matches("Cheeses", "cheese")).toBe(true);
    expect(matches("Radishes", "radish")).toBe(true);
  });

  it("matches a phrase as consecutive words, whatever the capitals and punctuation", () => {
    expect(matches("Plain idli", "plain idli")).toBe(true);
    expect(matches("Plain Idli, with chutney", "plain idli")).toBe(true);
    expect(matches("Rava idli", "plain idli")).toBe(false);
    expect(matches("Idli plain", "plain idli")).toBe(false);
    expect(matches("Coconut chutney", "nut")).toBe(false);
    expect(matches("Eggplant bharta", "egg")).toBe(false);
  });

  it("matches a category by its words", () => {
    expect(matches("groundnut oil", "@peanut")).toBe(true);
    expect(matches("Peanut chikki", "@nuts")).toBe(true);
    expect(matches("Coconut chutney", "@nuts")).toBe(false);
    expect(matches("Aloo gobi", "@root_veg")).toBe(true);   // aloo is potato (SAME_AS)
    expect(matches("potato", "@root_veg")).toBe(true);
    expect(matches("Sweet potato chaat", "@root_veg")).toBe(true);
    expect(matches("Palak paneer", "@green_leafy")).toBe(true);
    expect(matches("Palak paneer", "@protein")).toBe(true);
    expect(matches("Chicken curry", "@meat")).toBe(true);
    expect(matches("Prawn fry", "@fish")).toBe(true);
    expect(matches("Masala omelette", "@egg")).toBe(true);
    expect(matches("Mushroom masala", "@mushroom")).toBe(true);
    expect(matches("Banana walnut cake", "@baked")).toBe(true);
    expect(matches("Garlic bread", "@baked")).toBe(true);
  });

  it("white rice is rice and what is made of it; millet, brown, red and ragi rice (and a millet idli) are not", () => {
    for (const yes of ["Lemon rice", "Idli", "Plain dosa", "Neer dosa", "Appam", "Poha", "rice flour", "basmati", "Sona masoori", "Jeera rice"])
      expect(matches(yes, "@white_rice")).toBe(true);
    for (const no of ["Millet rice", "Brown rice", "Red rice", "Ragi rice", "Millet idli", "Ragi dosa", "Foxtail millet pongal", "Rava idli", "Oats dosa"])
      expect(matches(no, "@white_rice")).toBe(false);
  });

  // Live eval 2026-11-22: rules the interview saves named categories the app did not have.
  it("the categories from the 2026-11-22 eval: chilli, sweet, soy, gluten, dairy, dal, pickle, vegan protein, and visible green", () => {
    const yes: [string, string][] = [["sambar powder", "@chilli"], ["rasam powder", "@chilli"], ["Green chillies", "@chilli"], ["Mirchi bajji", "@chilli"],
      ["kashmiri chilli", "@chilli"], ["garam masala", "@chilli"], ["Mango achaar", "@chilli"], ["Schezwan noodles", "@chilli"],
      ["Carrot halwa", "@sweet"], ["Gulab jamun", "@sweet"], ["jaggery", "@sweet"], ["Rava kesari with sugar", "@sweet"], ["Besan ladoo", "@sweet"],
      ["Tofu stir fry", "@soy"], ["Soya chunks curry", "@soy"], ["soy sauce", "@soy"],
      ["Aloo paratha", "@gluten"], ["Rava upma", "@gluten"], ["Phulkas", "@gluten"], ["maida", "@gluten"], ["Veg noodles", "@gluten"], ["Dalia", "@gluten"],
      ["Paneer butter masala", "@dairy"], ["ghee", "@dairy"], ["Sweet lassi", "@dairy"], ["Cucumber raita", "@dairy"], ["Chaas", "@dairy"],
      ["Toor dal", "@dal"], ["Moong dal khichdi", "@dal"], ["chana dal", "@dal"], ["Arhar dal fry", "@dal"],
      ["Lemon pickle", "@pickle"], ["Papad", "@pickle"], ["Achaar", "@pickle"],
      ["Tofu bhurji", "@vegan_protein"], ["Rajma", "@vegan_protein"], ["Besan chilla", "@vegan_protein"], ["Sprouts salad", "@vegan_protein"],
      ["Cucumber raita", "@green_leafy"], ["Bhindi fry", "@green_leafy"], ["Lettuce", "@green_leafy"], ["spring onion", "@green_leafy"], ["Zucchini", "@green_leafy"], ["okra", "@green_leafy"]];
    for (const [text, item] of yes) expect(matches(text, item), `${text} ${item}`).toBe(true);
    const no: [string, string][] = [["Chana masala", "@dal"], ["Curd rice", "@soy"], ["Coconut milk", "@dairy"], ["peanut butter", "@dairy"], ["Ragi dosa", "@gluten"],
      ["Peanut chikki", "@vegan_protein"], ["Paneer tikka", "@vegan_protein"], ["Plain idli", "@chilli"], ["Banana", "@sweet"], ["Onion", "@green_leafy"]];
    for (const [text, item] of no) expect(matches(text, item), `${text} ${item}`).toBe(false);
  });

  it("a dish named 'no sugar' is not sweet by its name; its ingredients still count", () => {
    for (const name of ["Banana sheera (no sugar)", "Banana sheera without sugar", "Sugar-free halwa", "Sugar free kheer", "Unsweetened payasam"]) {
      expect(matches(name, "@sweet", { name: true }), name).toBe(false);
      expect(dishHas({ name, ingredients: ["banana", "rava", "ghee"] }, "@sweet"), name).toBe(false);
    }
    expect(dishHas({ name: "Banana sheera (no sugar)", ingredients: ["banana", "rava", "jaggery"] }, "@sweet")).toBe(true);
    expect(dishHas({ name: "Banana sheera", ingredients: ["banana", "rava"] }, "@sweet")).toBe(true);
    // Only the sweet category reads the name this way: an ingredient as given, and other items, are unchanged.
    expect(matches("Sugar-free halwa", "@sweet")).toBe(true);
    expect(matches("Banana sheera (no sugar)", "sheera", { name: true })).toBe(true);
  });

  it("a side is a chutney, podi, pickle, raita, papad, salad, or a dish that is just curd or fruit", () => {
    for (const side of ["Coconut chutney", "Gunpowder podi", "Lemon pickle", "Boondi raita", "Papad", "Curd", "Plain curd", "Fruit", "Cut fruits", "Banana"])
      expect(isSide(side), side).toBe(true);
    for (const main of ["Curd rice", "Idli", "Fruit custard", "Banana sheera", "Ragi idli"]) expect(isSide(main), main).toBe(false);
  });

  it("a dish has an item when its name (negations dropped) or one of its ingredients has it", () => {
    expect(dishHas({ name: "Lemon rice (no peanuts)", ingredients: ["rice", "lemon"] }, "@peanut")).toBe(false);
    expect(dishHas({ name: "Lemon rice (no peanuts)", ingredients: ["rice", "groundnut oil"] }, "@peanut")).toBe(true);
    expect(dishHas({ name: "Oats dosa", ingredients: ["oats", "rice flour"] }, "@white_rice")).toBe(true);
  });
});

const people = ["Shiva", "Ankita", "Lakshmi", "Agastya", "Meera"].map((name) => ({ name }));
type D = { name: string; for_people?: string[] | null; portion_note?: string | null; ingredients?: string[] };
const week = (meals: { date: string; slot: string; ordered_in?: boolean; dishes: D[] }[]): RuleWeek =>
  ({ days: [...new Set(meals.map((m) => m.date))].map((date) => ({ date, meals: meals.filter((m) => m.date === date)
    .map((m) => ({ ...m, dishes: m.dishes.map((d) => ({ for_people: null, portion_note: null, ingredients: [], ...d })) })) })) });
const keys = (b: { meal: string; dish?: string; who?: string }[]) => b.map((x) => `${x.meal}|${x.dish ?? ""}|${x.who ?? ""}`);

describe("ruleBreaks", () => {
  it("who eats a dish, as written: the dishes naming them, and the ones for everyone (or naming no one)", () => {
    const rules = [{ kind: "only" as const, who: "Meera", slots: ["Breakfast"], items: ["plain idli"], days: [] }];
    // Meera's own dish names only her; the shared dish names everyone else.
    const own = week([{ date: "2026-11-23", slot: "Breakfast", dishes: [{ name: "Plain idli", for_people: ["Meera"] },
      { name: "Rava idli", for_people: ["Shiva", "Ankita", "Lakshmi", "Agastya"] }] }]);
    expect(ruleBreaks(own, { rules }, people)).toEqual([]);
    // A dish for everyone is hers too, whether it says ["everyone"] or names no one (a family's own dish, an older row).
    for (const shared of [["everyone"], ["Everyone"], null])
      expect(keys(ruleBreaks(week([{ date: "2026-11-23", slot: "Breakfast", dishes: [{ name: "Plain idli", for_people: ["Meera"] }, { name: "Rava idli", for_people: shared }] }]),
        { rules }, people))).toEqual(["Mon 2026-11-23 Breakfast|Rava idli|Meera"]);
    // Named on no dish while every dish names someone: she eats nothing, and the rule says what she eats.
    const none = week([{ date: "2026-11-23", slot: "Breakfast", dishes: [{ name: "Milk", for_people: ["Agastya"] }] }]);
    expect(ruleBreaks(none, { rules }, people)).toMatchObject([{ meal: "Mon 2026-11-23 Breakfast", who: "Meera", fix: "add a dish for Meera: one of plain idli" }]);
  });

  it("the colliding case: chana for all four, rice for three, sauteed veg for Rohan keeps everyone's protein and Rohan's no-rice", () => {
    const four = ["Rohan", "Priya", "Dev", "Sushila"].map((name) => ({ name }));
    const rules = [
      { kind: "require" as const, who: "Rohan", slots: ["Lunch", "Dinner"], items: ["@protein"], days: [] },
      { kind: "require" as const, who: "Priya", slots: ["Lunch", "Dinner"], items: ["@protein"], days: [] },
      { kind: "avoid" as const, who: "Rohan", slots: ["Lunch", "Dinner"], items: ["@white_rice"], days: [] }];
    const dinner = (chana: string[] | null) => week([{ date: "2026-11-23", slot: "Dinner", dishes: [
      { name: "Chana masala", for_people: chana, ingredients: ["chana", "onion"] }, { name: "Rice", for_people: ["Priya", "Dev", "Sushila"], ingredients: ["rice"] },
      { name: "Sauteed veg", for_people: ["Rohan"], ingredients: ["beans", "carrot"] }] }]);
    for (const chana of [["Rohan", "Priya", "Dev", "Sushila"], ["everyone"], null]) expect(ruleBreaks(dinner(chana), { rules }, four)).toEqual([]);
    // Chana for the three who have rice only: Rohan has no protein. Rice for everyone: Rohan has rice.
    expect(keys(ruleBreaks(dinner(["Priya", "Dev", "Sushila"]), { rules }, four))).toEqual(["Mon 2026-11-23 Dinner||Rohan"]);
    const rice = week([{ date: "2026-11-23", slot: "Dinner", dishes: [{ name: "Chana masala", for_people: ["everyone"] }, { name: "Rice", for_people: ["everyone"] }] }]);
    expect(keys(ruleBreaks(rice, { rules }, four))).toEqual(["Mon 2026-11-23 Dinner|Rice|Rohan"]);
  });

  it("everyone in an extra slot with its own people is those people; a rule for someone who does not eat it holds nothing there", () => {
    const house = { extra_slots: [{ name: "Agastya's tiffin", for: ["Agastya"] }], rules: [
      { kind: "require" as const, slots: ["Agastya's tiffin"], items: ["@protein"], days: [] },
      { kind: "only" as const, who: "Meera", items: ["plain idli"], days: [] },
      { kind: "avoid" as const, who: "Agastya", items: ["@nuts"], days: [] }] };
    const w = week([{ date: "2026-11-23", slot: "Agastya's tiffin", dishes: [{ name: "Cashew pulao", for_people: ["everyone"], ingredients: ["rice", "cashew"] }] }]);
    // Agastya eats it (no protein, nuts); Meera does not eat the tiffin, so her only rule says nothing; nor do the others need protein there.
    expect(keys(ruleBreaks(w, house, people))).toEqual(["Mon 2026-11-23 Agastya's tiffin||Agastya", "Mon 2026-11-23 Agastya's tiffin|Cashew pulao|Agastya"]);
    // Without the slot's people, everyone at home eats it.
    expect(ruleBreaks(w, { rules: house.rules }, people).map((b) => b.who).sort()).toEqual(["Agastya", "Agastya", "Ankita", "Lakshmi", "Meera", "Meera", "Shiva"]);
  });

  it("avoid holds on its days and slots only, and for its person only when one is named", () => {
    const rules = [{ kind: "avoid" as const, days: ["Tue"], items: ["@root_veg"] }, { kind: "avoid" as const, who: "Agastya", items: ["@nuts"], days: [] }];
    const w = week([
      { date: "2026-11-23", slot: "Lunch", dishes: [{ name: "Aloo gobi", ingredients: ["potato"] }] },
      { date: "2026-11-24", slot: "Lunch", dishes: [{ name: "Aloo gobi", ingredients: ["potato"] }, { name: "Kaju katli", for_people: ["Shiva"] }] },
      { date: "2026-11-24", slot: "Dinner", dishes: [{ name: "Kaju katli" }] }]);
    const b = ruleBreaks(w, { rules }, people);
    expect(keys(b)).toEqual(["Tue 2026-11-24 Lunch|Aloo gobi|", "Tue 2026-11-24 Dinner|Kaju katli|Agastya"]);
    expect(b[0].rule).toBe("no root vegetables on Tue");
    expect(b[0].fix).toContain("potato");
  });

  it("swap: a dish they eat with the item carries a note naming them and the swap, or they get a dish of their own", () => {
    const rules = [{ kind: "swap" as const, who: "Lakshmi", items: ["@white_rice"], to: "millet", days: [] }];
    const bad = week([{ date: "2026-11-23", slot: "Lunch", dishes: [{ name: "Jeera rice", portion_note: "less for Meera" }, { name: "Dal" }] }]);
    expect(keys(ruleBreaks(bad, { rules }, people))).toEqual(["Mon 2026-11-23 Lunch|Jeera rice|Lakshmi"]);
    const noted = week([{ date: "2026-11-23", slot: "Lunch", dishes: [{ name: "Jeera rice", portion_note: "millet rice for Lakshmi" }, { name: "Dal" }] }]);
    expect(ruleBreaks(noted, { rules }, people)).toEqual([]);
    const own = week([{ date: "2026-11-23", slot: "Lunch", dishes: [{ name: "Jeera rice", for_people: ["Shiva", "Ankita", "Agastya", "Meera"] },
      { name: "Millet khichdi", for_people: ["Lakshmi"] }] }]);
    expect(ruleBreaks(own, { rules }, people)).toEqual([]);
  });

  it("require: in each of its slots the person eats a dish with one of the items; everyone when nobody is named", () => {
    const rules = [{ kind: "require" as const, who: "Shiva", slots: ["Lunch", "Dinner"], items: ["@protein"], days: [] }];
    const w = week([
      { date: "2026-11-23", slot: "Breakfast", dishes: [{ name: "Upma" }] },
      { date: "2026-11-23", slot: "Lunch", dishes: [{ name: "Bhindi fry" }, { name: "Rice", ingredients: ["rice"] }] },
      { date: "2026-11-23", slot: "Dinner", dishes: [{ name: "Aloo sabzi" }, { name: "Egg bhurji", for_people: ["Shiva"] }] },
      { date: "2026-11-24", slot: "Dinner", ordered_in: true, dishes: [] }]);
    const b = ruleBreaks(w, { rules }, people);
    expect(keys(b)).toEqual(["Mon 2026-11-23 Lunch||Shiva"]);
    expect(b[0]).toMatchObject({ rule: "Shiva has protein at Lunch, Dinner", fix: "add a dish with protein that Shiva eats" });
    const all = ruleBreaks(w, { rules: [{ kind: "require", slots: ["Dinner"], items: ["@protein"], days: [] }] }, people);
    expect(all.map((x) => x.who)).toEqual(["Ankita", "Lakshmi", "Agastya", "Meera"]);
  });

  it("cap: dishes with the items in at most per_week meals; each meal over it is named", () => {
    const rules = [{ kind: "cap" as const, items: ["chapati", "phulka"], per_week: 2, days: [] }];
    const w = week([
      { date: "2026-11-23", slot: "Lunch", dishes: [{ name: "Phulka" }] },
      { date: "2026-11-23", slot: "Dinner", dishes: [{ name: "Chapatis" }] },
      { date: "2026-11-24", slot: "Lunch", dishes: [{ name: "Chapati" }] }]);
    const b = ruleBreaks(w, { rules }, people);
    expect(keys(b)).toEqual(["Tue 2026-11-24 Lunch|Chapati|"]);
    expect(b[0].fix).toContain("Mon Lunch, Mon Dinner, Tue Lunch");
    // Writing Tuesday alone (a day of the weekly run): Monday's two stay, Tuesday is the one to change, said so.
    const tue = ruleBreaksIn(w, { rules }, people, ["Tue 2026-11-24 Lunch"]);
    expect(tue[0].fix).toBe("Mon Lunch, Mon Dinner already have it, as many as the rule allows: plan Tue Lunch without it");
  });

  // Live eval 2026-11-22: the cook's "max 2 dishes in the morning" broken by per-person variants (3 to cook).
  it("cap per_meal: at most N dishes to cook in each meal of slots; sides and one dish sent per person do not count", () => {
    const rules = [{ kind: "cap" as const, slots: ["Breakfast"], per_meal: 2, days: [] }];
    expect(ruleText(rules[0])).toBe("at most 2 dishes a meal at Breakfast");
    const w = week([
      { date: "2026-11-23", slot: "Breakfast", dishes: [{ name: "Idli", for_people: ["Shiva", "Ankita", "Agastya"] }, { name: "Plain idli", for_people: ["Meera"] },
        { name: "Ragi idli", for_people: ["Lakshmi"] }, { name: "Coconut chutney" }] },
      { date: "2026-11-24", slot: "Breakfast", dishes: [{ name: "Upma" }, { name: "Plain dosa", for_people: ["Meera"] }, { name: "Coconut chutney" },
        { name: "Curd" }, { name: "Fruit" }] },
      // The same dish sent once per person is one dish to cook.
      { date: "2026-11-25", slot: "Breakfast", dishes: [{ name: "Poha", for_people: ["Shiva"] }, { name: "poha", for_people: ["Ankita"] },
        { name: "Plain idli", for_people: ["Meera"] }] },
      // Not in slots.
      { date: "2026-11-23", slot: "Lunch", dishes: [{ name: "Rice" }, { name: "Sambar" }, { name: "Beans poriyal" }, { name: "Rasam" }] }]);
    const b = ruleBreaks(w, { rules }, people);
    expect(keys(b)).toEqual(["Mon 2026-11-23 Breakfast||"]);
    expect(b[0].fix).toBe("now 3 dishes (Idli, Plain idli, Ragi idli): serve one dish to more people, or a swap as a portion_note");
    // A swap as a portion_note keeps it at two.
    const fixed = week([{ date: "2026-11-23", slot: "Breakfast", dishes: [{ name: "Idli", portion_note: "ragi idli for Lakshmi" }, { name: "Plain idli", for_people: ["Meera"] }] }]);
    expect(ruleBreaks(fixed, { rules }, people)).toEqual([]);
    // With items, only those dishes count; with who, only what that person eats.
    const fried = [{ kind: "cap" as const, items: ["fry", "pakoda"], per_meal: 1, days: [] }];
    expect(keys(ruleBreaks(week([{ date: "2026-11-23", slot: "Dinner", dishes: [{ name: "Aloo fry" }, { name: "Onion pakoda" }, { name: "Dal" }, { name: "Roti" }] }]),
      { rules: fried }, people))).toEqual(["Mon 2026-11-23 Dinner||"]);
    const meera = [{ kind: "cap" as const, who: "Meera", per_meal: 1, days: [] }];
    expect(ruleBreaks(w, { rules: meera }, people).map((x) => x.meal)).toEqual(["Mon 2026-11-23 Lunch", "Tue 2026-11-24 Breakfast"]);
  });

  it("the older kinds are checked as the spec maps them; fasting and other are not", () => {
    const w = week([
      { date: "2026-11-24", slot: "Lunch", dishes: [{ name: "Egg curry", ingredients: ["eggs", "onion"] }, { name: "Chicken 65" }] },
      { date: "2026-11-25", slot: "Lunch", dishes: [{ name: "Fish fry" }] }]);
    const rule = (kind: string, days: string[] = []) => ({ kind: kind as any, days });
    expect(keys(ruleBreaks(w, { rules: [rule("no_eggs", ["Tue"])] }, people))).toEqual(["Tue 2026-11-24 Lunch|Egg curry|"]);
    // Vegetarian is no meat, fish or eggs (constants.ts; eval 23 Nov: a grandparent's "pure vegetarian" let eggs through).
    expect(keys(ruleBreaks(w, { rules: [rule("veg")] }, people))).toEqual(["Tue 2026-11-24 Lunch|Egg curry|", "Tue 2026-11-24 Lunch|Chicken 65|", "Wed 2026-11-25 Lunch|Fish fry|"]);
    expect(keys(ruleBreaks(w, { rules: [rule("egg")] }, people))).toEqual(["Tue 2026-11-24 Lunch|Chicken 65|", "Wed 2026-11-25 Lunch|Fish fry|"]);
    expect(keys(ruleBreaks(w, { rules: [rule("egg", ["Wed"])] }, people))).toEqual(["Wed 2026-11-25 Lunch|Fish fry|"]);
    expect(keys(ruleBreaks(w, { rules: [rule("no_meat", ["Tue"])] }, people))).toEqual(["Tue 2026-11-24 Lunch|Chicken 65|"]);
    expect(keys(ruleBreaks(w, { rules: [rule("no_onion_garlic", ["Tue"])] }, people))).toEqual(["Tue 2026-11-24 Lunch|Egg curry|"]);
    expect(ruleBreaks(w, { rules: [rule("fasting", ["Tue"]), { kind: "other", days: [], note: "no fish" }] }, people)).toEqual([]);
    // A day in the family's own words ("Ekadashi") is not a weekday the app can check.
    expect(ruleBreaks(w, { rules: [rule("veg", ["Ekadashi"])] }, people)).toEqual([]);
  });

  // Lane B (2026-11-23): a cook's "no baking, no oven" is avoid @baked: what needs an oven, not what is bought baked.
  it("@baked takes what needs an oven, not bread, pav, buns or tandoori food", () => {
    for (const dish of ["Chocolate cake", "Veg puffs", "Garlic bread", "Pizza", "Baked vegetables", "Oats cookies", "Banana muffins", "Brownies", "Veg lasagna"])
      expect(matches(dish, "@baked", { name: true }), dish).toBe(true);
    for (const dish of ["Pav bhaji", "Bread upma", "Bun dosa", "Tandoori roti", "Paneer tikka", "Rava kesari", "Puri bhaji", "Masala dosa", "Bread pakora"])
      expect(matches(dish, "@baked", { name: true }), dish).toBe(false);
    const w = week([{ date: "2026-11-23", slot: "Dinner", dishes: [{ name: "Veg puffs" }, { name: "Dal" }] }]);
    const cook = [{ kind: "avoid" as const, days: [], items: ["@baked"], note: "no oven" }];
    expect(keys(ruleBreaks(w, { rules: cook }, people))).toEqual(["Mon 2026-11-23 Dinner|Veg puffs|"]);
    expect(rulesSaid(cook)).toBe("Everyone: no baked food");
  });

  // Lane B (2026-11-23): "fasts Thursday till evening" was a note nobody checked; with who, days and slots it is checked.
  it("a fast with who, days and slots is checked: a dish for that person, or for everyone without except of them, is a break", () => {
    const fast = [{ kind: "fasting" as const, who: "Lakshmi", days: ["Thu"], slots: ["Breakfast", "Lunch"], note: "fast till evening, light dinner" }];
    const thu = "2026-11-26";
    const w = week([
      { date: thu, slot: "Breakfast", dishes: [{ name: "Upma", for_people: ["everyone"] }] },
      { date: thu, slot: "Lunch", dishes: [{ name: "Rajma", for_people: ["Shiva", "Ankita", "Agastya", "Meera"] }, { name: "Curd rice", for_people: ["Lakshmi"] }] },
      { date: thu, slot: "Dinner", dishes: [{ name: "Khichdi", for_people: ["everyone"] }] },
      { date: "2026-11-27", slot: "Breakfast", dishes: [{ name: "Poha", for_people: ["everyone"] }] }]);
    const b = ruleBreaks(w, { rules: fast }, people);
    expect(keys(b)).toEqual(["Thu 2026-11-26 Breakfast|Upma|Lakshmi", "Thu 2026-11-26 Lunch|Curd rice|Lakshmi"]);
    expect(b[0].rule).toBe("Lakshmi fasts at Breakfast, Lunch on Thu");
    expect(b[0].fix).toBe('Upma is for everyone, which includes Lakshmi, who fasts at Breakfast and Lunch on Thursday: make it for everyone except Lakshmi (except: ["Lakshmi"])');
    expect(b[1].fix).toContain("plan nothing for Lakshmi at this meal");
    // Without slots it stays a note; so does a day in the family's words.
    expect(ruleBreaks(w, { rules: [{ kind: "fasting", who: "Lakshmi", days: ["Thu"], note: "fasts" }] }, people)).toEqual([]);
    expect(ruleBreaks(w, { rules: [{ kind: "fasting", who: "Lakshmi", days: ["Ekadashi"], slots: ["Breakfast"] }] }, people)).toEqual([]);
    expect(rulesSaid(fast)).toBe("Lakshmi: fasts at Breakfast, Lunch on Thu (fast till evening, light dinner)");
  });

  it("names each break in one line: meal, dish, the rule, and the fix", () => {
    const rules = [{ kind: "only" as const, who: "Meera", slots: ["Breakfast"], items: ["plain idli", "plain dosa", "banana sheera"], days: [] }];
    const b = ruleBreaks(week([{ date: "2026-11-23", slot: "Breakfast", dishes: [{ name: "Rava idli" }] }]), { rules }, people);
    expect(breaksText(b)).toBe("Mon 2026-11-23 Breakfast: Rava idli — Meera eats only plain idli, plain dosa, banana sheera at Breakfast (add a dish for Meera)");
  });
});

// Owner, 23 Nov: a soft wish ("millets are good for him") is kept some meals of the week, not at every one: too many is a
// break, too few a softer one (only when asked for, as the stepped plan does).
describe("a soft rule, kept some times a week", () => {
  const DAYS = ["2026-11-23", "2026-11-24", "2026-11-25", "2026-11-26", "2026-11-27"];
  const swap = { kind: "swap", who: "Meera", items: ["@white_rice"], to: "millets", often: "sometimes" as const, days: [] };
  /** Five lunches of rice for everyone; the first `n` say "millets for Meera". */
  const lunches = (n: number) => week(DAYS.map((date, i) => ({ date, slot: "Lunch", dishes: [{ name: "Rice", for_people: ["everyone"], portion_note: i < n ? "millets in place of rice for Meera" : null },
    { name: "Sambar", for_people: ["everyone"] }] })));

  it("2–3 meals keep it: no break; a hard swap would want every meal", () => {
    for (const n of [2, 3]) expect(ruleBreaks(lunches(n), { rules: [swap] }, people, { under: true })).toEqual([]);
    const { often: _o, ...hard } = swap;
    expect(keys(ruleBreaks(lunches(2), { rules: [hard] }, people))).toEqual(["Wed 2026-11-25 Lunch|Rice|Meera", "Thu 2026-11-26 Lunch|Rice|Meera", "Fri 2026-11-27 Lunch|Rice|Meera"]);
  });

  it("every meal (the live run): the meals past 3 are breaks, 'over'", () => {
    const b = ruleBreaks(lunches(5), { rules: [swap] }, people);
    expect(keys(b)).toEqual(["Thu 2026-11-26 Lunch|Rice|Meera", "Fri 2026-11-27 Lunch|Rice|Meera"]);
    expect(b.every((x) => x.soft === "over" && x.to === "millets")).toBe(true);
    expect(b[0].rule).toBe("Meera has millets in place of white rice 2–3 times a week");
    expect(b[0].fix).toContain("now in 5 meals");
    // The swap said on a dish with no rice in its name (sambar, bisi bele bath) is the swap kept at that meal too (eval 23 Nov).
    const onSambar = week(DAYS.map((date) => ({ date, slot: "Lunch", dishes: [{ name: "Sambar", for_people: ["everyone"], portion_note: "millet in place of rice for Meera" }] })));
    expect(keys(ruleBreaks(onSambar, { rules: [swap] }, people))).toEqual(["Thu 2026-11-26 Lunch|Sambar|Meera", "Fri 2026-11-27 Lunch|Sambar|Meera"]);
    // A dish of theirs alone says the swap without naming them ("Rice" for Meera: "millet in place of white rice").
    const own = week(DAYS.map((date) => ({ date, slot: "Lunch", dishes: [{ name: "Rice", for_people: ["Meera"], portion_note: "millet in place of white rice" }] })));
    expect(keys(ruleBreaks(own, { rules: [swap] }, people))).toEqual(["Thu 2026-11-26 Lunch|Rice|Meera", "Fri 2026-11-27 Lunch|Rice|Meera"]);
  });

  it("too few: a softer break on the meals that could keep it, only when asked (plan_menu never refuses for it)", () => {
    expect(ruleBreaks(lunches(0), { rules: [swap] }, people)).toEqual([]);
    const b = ruleBreaks(lunches(0), { rules: [swap] }, people, { under: true });
    expect(keys(b)).toEqual(["Mon 2026-11-23 Lunch|Rice|Meera", "Tue 2026-11-24 Lunch|Rice|Meera"]);
    expect(b.every((x) => x.soft === "under")).toBe(true);
  });

  it("a dish of the person's own that is the swap counts; per_week is exact", () => {
    const own = week(DAYS.map((date, i) => ({ date, slot: "Lunch", dishes: i < 4 ? [{ name: "Foxtail millet pongal", for_people: ["Meera"] }, { name: "Rice", for_people: ["everyone"] }]
      : [{ name: "Rice", for_people: ["everyone"] }] })));
    expect(keys(ruleBreaks(own, { rules: [{ ...swap, often: undefined, per_week: 2 }] }, people))).toEqual(["Wed 2026-11-25 Lunch|Foxtail millet pongal|Meera", "Thu 2026-11-26 Lunch|Foxtail millet pongal|Meera"]);
    expect(ruleText({ ...swap, often: undefined, per_week: 2 })).toBe("Meera has millets in place of white rice twice a week");
  });

  it("a soft require: fruit three times a week, counted over the week", () => {
    const fruit = { kind: "require", who: "Agastya", items: ["fruit"], per_week: 3, days: [] };
    const snacks = (n: number) => week(DAYS.map((date, i) => ({ date, slot: "Dinner", dishes: [{ name: i < n ? "Fruit bowl" : "Dhokla", for_people: ["everyone"] }] })));
    expect(ruleBreaks(snacks(3), { rules: [fruit] }, people, { under: true })).toEqual([]);
    expect(keys(ruleBreaks(snacks(5), { rules: [fruit] }, people))).toEqual(["Thu 2026-11-26 Dinner|Fruit bowl|Agastya", "Fri 2026-11-27 Dinner|Fruit bowl|Agastya"]);
    expect(keys(ruleBreaks(snacks(1), { rules: [fruit] }, people, { under: true }))).toEqual(["Tue 2026-11-24 Dinner||Agastya", "Wed 2026-11-25 Dinner||Agastya"]);
    expect(rulesSaid([fruit, { kind: "other", who: "Agastya", note: "something light at night", often: "sometimes", days: [] }]))
      .toBe("Agastya: has fruit 3 times a week; something light at night 2–3 times a week");
  });
});
