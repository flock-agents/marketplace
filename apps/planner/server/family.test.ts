// The family profile as the agent writes it during the interview: people, house rules, the cook, extra slots and order-in meals.
import { describe, it, expect } from "bun:test";
import { boot } from "./testkit";

describe("set_person", () => {
  it("set_person upserts by name and keeps the family's words", async () => {
    const { op, rows } = await boot();
    await op("set_person", { name: "Agastya", relationship: "son", group: "child", portions: "2 rotis, small rice" });
    await op("set_person", { name: "agastya", group: "child", allergies: "peanuts" });
    expect(rows("people")).toHaveLength(1);
    expect(rows("people")[0]).toMatchObject({ name: "Agastya", relationship: "son", portions: "2 rotis, small rice", allergies: "peanuts" });
  });

  it("answers with the person, stamped as the agent's write", async () => {
    const { op } = await boot();
    const res = await op("set_person", { name: " Meera ", group: "adult", diet: "vegetarian" });
    expect(res.person).toMatchObject({ name: "Meera", group: "adult", diet: "vegetarian", active: 1, updated_by: "agent:meal-agent" });
  });

  it("set_person refuses a group outside child/adult/elder", async () => {
    expect((await (await boot()).op("set_person", { name: "X", group: "teen" })).code).toBe("APP_REFUSED");
  });

  it("refuses a new person with no name or no group, and a field that is not text", async () => {
    const { op, rows } = await boot();
    expect((await op("set_person", { group: "adult" })).code).toBe("APP_REFUSED");
    expect((await op("set_person", { name: "  ", group: "adult" })).code).toBe("APP_REFUSED");
    expect((await op("set_person", { name: "Dad" })).code).toBe("APP_REFUSED");
    expect((await op("set_person", { name: "Dad", group: "elder", portions: 2 })).code).toBe("APP_REFUSED");
    expect(rows("people")).toHaveLength(0);
  });

  it("changes one field of a person already there without a group, and clears a field given as null", async () => {
    const { op, rows } = await boot();
    await op("set_person", { name: "Dad", group: "elder", dislikes: "brinjal", diet: "no sugar" });
    expect((await op("set_person", { name: "dad", dislikes: null, targets: "60 g protein" })).person).toMatchObject({ group: "elder", dislikes: null, targets: "60 g protein" });
    expect(rows("people")[0]).toMatchObject({ name: "Dad", diet: "no sugar", dislikes: null });
  });

  it("remove takes the person out of the family without deleting them; setting them again brings them back", async () => {
    const { op, owner, rows } = await boot();
    await op("set_person", { name: "Nani", group: "elder", portions: "1 roti" });
    await op("set_person", { name: "Meera", group: "adult" });
    expect((await op("set_person", { name: "nani", remove: true })).person.active).toBe(0);
    expect((await owner("GET", "/api/family")).body.people.map((p: any) => p.name)).toEqual(["Meera"]);
    await op("set_person", { name: "Nani" });
    expect(rows("people").find((p) => p.name === "Nani")).toMatchObject({ active: 1, portions: "1 roti" });
    expect((await op("set_person", { name: "Nobody", remove: true })).status).toBe(404);
  });
});

describe("the house", () => {
  it("set_cook, set_house_rules and set_slots fill the one house row", async () => {
    const { op, rows } = await boot();
    await op("set_cook", { name: "Lakshmi", days: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"], arrival: "07:30", makes_well: "dosa, sambar" });
    await op("set_house_rules", { rules: [{ kind: "veg", days: ["Tue", "Thu"] }] });
    await op("set_slots", { extra_slots: [{ name: "Agastya's tiffin", days: ["Mon", "Tue", "Wed", "Thu", "Fri"], for: ["Agastya"] }], order_in: [{ day: "Sun", slot: "Dinner" }] });
    const h = rows("house"); expect(h).toHaveLength(1);
    expect(h[0].cook_arrival).toBe("07:30");
    expect(h[0]).toMatchObject({ cook_name: "Lakshmi", cook_makes_well: "dosa, sambar" });
    expect(JSON.parse(h[0].cook_days)).toEqual(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]);
    expect(JSON.parse(h[0].rules)).toEqual([{ kind: "veg", days: ["Tue", "Thu"] }]);
    expect(JSON.parse(h[0].extra_slots)[0].name).toBe("Agastya's tiffin");
    expect(JSON.parse(h[0].order_in)).toEqual([{ day: "Sun", slot: "Dinner" }]);
  });

  it("a rule for \"Everyone\" is the whole house's, not a person's (sim run 5: the read-back's heading sent back as who)", async () => {
    const { op, rows } = await boot();
    const r = await op("set_house_rules", { rules: [{ kind: "veg", who: "Everyone", days: [] }] });
    expect(r.code).toBeUndefined();
    expect(JSON.parse(rows("house")[0].rules)[0].who).toBeUndefined();
  });

  it("set_cook refuses an arrival that is not HH:MM", async () => {
    const { op, rows } = await boot();
    for (const arrival of ["7.30am", "7:30", "24:00", "07:60", 730, undefined])
      expect((await op("set_cook", { name: "Lakshmi", days: ["Mon"], arrival })).code).toBe("APP_REFUSED");
    expect(rows("house").every((h) => h.cook_name === null)).toBe(true);
  });

  it("set_cook takes a cook who comes twice a day, each visit with the meals it makes; one visit stays a plain time", async () => {
    const { op, rows, owner } = await boot();
    await op("set_slots", { extra_slots: [{ name: "Agastya's tiffin", days: ["Mon"], for: ["Agastya"] }] });
    const twice = await op("set_cook", { name: "Lakshmi", days: ["Mon"], arrival: [{ at: "16:30", meals: ["dinner"] }, { at: "06:00", meals: ["Breakfast", "Lunch", "agastya's tiffin"] }] });
    // Earliest first, the meals by their own names; cook_arrival stays the first visit for whoever reads one time.
    expect(twice.house).toMatchObject({ cook_arrival: "06:00", cook_visits: [{ at: "06:00", meals: ["Breakfast", "Lunch", "Agastya's tiffin"] }, { at: "16:30", meals: ["Dinner"] }] });
    expect((await owner("GET", "/api/family")).body.house.cook_visits).toHaveLength(2);
    // Times alone are visits too; another field leaves them as they are.
    expect((await op("set_cook", { name: "Lakshmi", arrival: ["06:00", "16:30"] })).house.cook_visits).toEqual([{ at: "06:00" }, { at: "16:30" }]);
    expect((await op("set_cook", { name: "Lakshmi", note: "off on festival days" })).house.cook_visits).toEqual([{ at: "06:00" }, { at: "16:30" }]);
    // One visit without meals is kept as the plain time, the shape every earlier row has.
    expect((await op("set_cook", { name: "Lakshmi", arrival: ["07:30"] })).house).toMatchObject({ cook_arrival: "07:30", cook_visits: [{ at: "07:30" }] });
    expect(rows("house")[0].cook_arrival).toBe("07:30");
    for (const arrival of [[], ["6:00", "16:30"], "06:00 and 16:30", ["06:00", "06:00"], [{ at: "06:00", meals: ["Brunch"] }], [{ at: "06:00", meals: "Breakfast" }], [{ meals: ["Dinner"] }]])
      expect((await op("set_cook", { name: "Lakshmi", arrival })).code, JSON.stringify(arrival)).toBe("APP_REFUSED");
    expect((await op("set_cook", { name: "Lakshmi", arrival: "6:00 and 16:30" })).error).toContain('[{ at: "06:00", meals: ["Breakfast", "Lunch"] }');
    expect(rows("house")[0].cook_arrival).toBe("07:30");
  });

  it("set_cook refuses a missing name and a day that is not a weekday; it reads weekdays however they are written", async () => {
    const { op } = await boot();
    expect((await op("set_cook", { days: ["Mon"], arrival: "07:30" })).code).toBe("APP_REFUSED");
    expect((await op("set_cook", { name: "Lakshmi", days: ["Someday"], arrival: "07:30" })).code).toBe("APP_REFUSED");
    expect((await op("set_cook", { name: "Lakshmi", days: ["Monthly"], arrival: "07:30" })).code).toBe("APP_REFUSED");
    expect((await op("set_cook", { name: "Lakshmi", days: "Mon", arrival: "07:30" })).code).toBe("APP_REFUSED");
    const { house } = await op("set_cook", { name: "Lakshmi", days: ["monday", "TUES", "Wednesday"], arrival: "07:30", note: "off on festival days" });
    expect(house).toMatchObject({ cook_name: "Lakshmi", cook_days: ["Mon", "Tue", "Wed"], cook_note: "off on festival days" });
  });

  // The interview runner (3.4.0): each setup answer saves only the rules it said, and the rules are read back from `said`.
  it("set_house_rules with add: true adds to the rules there, never twice, and answers every rule in plain words", async () => {
    const { op } = await boot();
    await op("set_person", { name: "Meera", group: "child" });
    await op("set_house_rules", { rules: [{ kind: "avoid", days: ["Tue"], items: ["@root_veg"], note: "Jain on Tuesday" }] });
    const r = await op("set_house_rules", { add: true, rules: [
      { kind: "only", who: "meera", slots: ["Breakfast"], items: ["plain idli", "plain dosa"] },
      { kind: "avoid", days: ["tuesday"], items: ["@root_veg"] },
      { kind: "other", slots: ["Dinner"], note: "light dinner" }] });
    expect(r.house.rules.map((x: { kind: string }) => x.kind)).toEqual(["avoid", "only", "other"]);
    expect(r.said).toBe("Everyone: no root vegetables on Tue; light dinner at Dinner\nMeera: eats only plain idli, plain dosa at Breakfast");
    // Without add the list sent is the list kept.
    expect((await op("set_house_rules", { rules: [{ kind: "veg" }] })).house.rules).toHaveLength(1);
    expect((await op("set_house_rules", { rules: [] })).said).toBe("");
    expect((await op("set_house_rules", { add: true })).code).toBe("APP_REFUSED");
    expect((await op("set_house_rules", { add: "yes", rules: [] })).code).toBe("APP_REFUSED");
  });

  it("set_house_rules replaces the rules, keeps a fasting day in the family's words, and refuses an unknown kind", async () => {
    const { op } = await boot();
    await op("set_house_rules", { rules: [{ kind: "veg", days: ["Tue"] }], notes: "no beef at home" });
    const { house } = await op("set_house_rules", { rules: [{ kind: "fasting", days: ["Ekadashi"], note: "Nani only" }, { kind: "no_onion_garlic", days: ["saturday"] }] });
    expect(house.rules).toEqual([{ kind: "fasting", days: ["Ekadashi"], note: "Nani only" }, { kind: "no_onion_garlic", days: ["Sat"] }]);
    expect(house.notes).toBe("no beef at home");
    expect((await op("set_house_rules", { rules: [{ kind: "keto", days: ["Mon"] }] })).code).toBe("APP_REFUSED");
    expect((await op("set_house_rules", { rules: [{ kind: "veg", days: "Tue" }] })).code).toBe("APP_REFUSED");
    expect((await op("set_house_rules", { rules: [{ kind: "other" }] })).code).toBe("APP_REFUSED");   // an other rule says what it is
    expect((await op("set_house_rules", { rules: "veg on Tuesdays" })).code).toBe("APP_REFUSED");
    expect((await op("set_house_rules", {})).code).toBe("APP_REFUSED");
  });

  it("set_house_rules takes the checked kinds: who on the Family page, days, slots, items and categories, to, per_week", async () => {
    const { op } = await boot();
    for (const name of ["Meera", "Lakshmi", "Shiva"]) await op("set_person", { name, group: "adult" });
    await op("set_slots", { extra_slots: [{ name: "Agastya's tiffin", days: ["Mon"] }] });
    const { house } = await op("set_house_rules", { rules: [
      { kind: "only", who: "meera", slots: ["breakfast"], items: ["plain idli", " plain dosa "], note: "Meera's breakfasts" },
      { kind: "swap", who: "Lakshmi", items: ["@White_Rice"], to: "millet" },
      { kind: "only", who: "Lakshmi", days: ["thursday"], items: ["sabudana khichdi", "fruit"] },
      { kind: "require", who: "Shiva", slots: ["Lunch", "Dinner"], items: ["@protein"] },
      { kind: "avoid", slots: ["agastya's tiffin"], items: ["@peanut"] },
      { kind: "cap", items: ["chapati", "phulka"], per_week: 2 },
      { kind: "cap", slots: ["breakfast"], per_meal: 2, note: "2 dishes in the morning" },
      { kind: "avoid", who: "Meera", items: ["@chilli", "@sweet", "@soy", "@gluten", "@dairy", "@dal", "@pickle", "@vegan_protein"] },
      { kind: "veg", days: ["Tue"] }] });
    expect(house.rules).toEqual([
      { kind: "only", who: "Meera", days: [], slots: ["Breakfast"], items: ["plain idli", "plain dosa"], note: "Meera's breakfasts" },
      { kind: "swap", who: "Lakshmi", days: [], items: ["@white_rice"], to: "millet" },
      { kind: "only", who: "Lakshmi", days: ["Thu"], items: ["sabudana khichdi", "fruit"] },
      { kind: "require", who: "Shiva", days: [], slots: ["Lunch", "Dinner"], items: ["@protein"] },
      { kind: "avoid", days: [], slots: ["Agastya's tiffin"], items: ["@peanut"] },
      { kind: "cap", days: [], items: ["chapati", "phulka"], per_week: 2 },
      { kind: "cap", days: [], slots: ["Breakfast"], per_meal: 2, note: "2 dishes in the morning" },
      { kind: "avoid", who: "Meera", days: [], items: ["@chilli", "@sweet", "@soy", "@gluten", "@dairy", "@dal", "@pickle", "@vegan_protein"] },
      { kind: "veg", days: ["Tue"] }]);
  });

  it("set_house_rules takes a category a little off: its singular, else the plain word (sim run seed 15)", async () => {
    const { op } = await boot();
    const r = await op("set_house_rules", { rules: [{ kind: "avoid", items: ["@peanuts", "@spicy"] }] });
    expect(r.code).toBeUndefined();
    expect(r.house.rules[0].items).toEqual(["@peanut", "spicy"]);
  });

  it("set_house_rules refuses a checked rule it cannot check, naming the field; nothing is saved", async () => {
    const { op, rows } = await boot();
    for (const name of ["Meera", "Lakshmi"]) await op("set_person", { name, group: "adult" });
    const refused = async (rule: Record<string, unknown>) => {
      const r = await op("set_house_rules", { rules: [rule] });
      expect(r.code).toBe("APP_REFUSED");
      return r.error as string;
    };
    expect(await refused({ kind: "avoid", who: "Meeraa", items: ["egg"] })).toContain("did you mean Meera?");
    expect(await refused({ kind: "avoid", who: "Nani", items: ["egg"] })).toContain("set_person");
    expect(await refused({ kind: "only", who: "Meera", slots: ["Brekfast"], items: ["plain idli"] })).toContain("did you mean Breakfast?");
    expect(await refused({ kind: "avoid", items: [] })).toContain("items");
    expect(await refused({ kind: "avoid", items: ["egg", " "] })).toContain("items");
    expect(await refused({ kind: "avoid" })).toContain("needs items");
    expect(await refused({ kind: "only", items: ["plain idli"] })).toContain("needs who");
    expect(await refused({ kind: "swap", who: "Lakshmi", items: ["@white_rice"] })).toContain("needs to");
    expect(await refused({ kind: "require", who: "Lakshmi", items: ["@protein"] })).toContain("needs slots");
    expect(await refused({ kind: "cap", items: ["chapati"] })).toContain("needs per_week");
    expect(await refused({ kind: "cap", items: ["chapati"], per_week: 2, per_meal: 1 })).toContain("not both");
    expect(await refused({ kind: "cap", slots: ["Breakfast"], per_meal: 0 })).toContain("per_meal");
    expect(await refused({ kind: "cap", slots: ["Breakfast"], per_meal: "two" })).toContain("per_meal");
    expect(await refused({ kind: "cap", per_week: 2 })).toContain("needs items");
    expect(await refused({ kind: "avoid", items: ["egg"], per_meal: 2 })).toContain("takes no per_meal");
    expect(await refused({ kind: "cap", items: ["chapati"], per_week: 1.5 })).toContain("per_week");
    expect(await refused({ kind: "avoid", items: ["egg"], per_week: 2 })).toContain("takes no per_week");
    expect(await refused({ kind: "avoid", items: ["egg"], to: "tofu" })).toContain("takes no to");
    expect(await refused({ kind: "fasting", days: ["Thu"], items: ["sabudana khichdi"] })).toContain("kind: only");
    expect(await refused({ kind: "avoid", days: ["Ekadashi"], items: ["rice"] })).toContain("not a weekday");
    expect(rows("house").every((h) => h.rules === null || JSON.parse(h.rules).length === 0)).toBe(true);
  });

  it("set_slots replaces only the field it is given", async () => {
    const { op } = await boot();
    await op("set_slots", { extra_slots: [{ name: "Agastya's tiffin", days: ["Mon"], for: ["Agastya"] }], order_in: [{ day: "Sun", slot: "Dinner" }] });
    const { house } = await op("set_slots", { order_in: [{ day: "friday", slot: "Agastya's tiffin", note: "canteen day" }] });
    expect(house.extra_slots).toEqual([{ name: "Agastya's tiffin", days: ["Mon"], for: ["Agastya"] }]);
    expect(house.order_in).toEqual([{ day: "Fri", slot: "Agastya's tiffin", note: "canteen day" }]);
    expect((await op("set_slots", { extra_slots: [] })).house.extra_slots).toEqual([]);
  });

  it("set_slots refuses a slot with no name, one named like a main meal, an order-in day that is no weekday and a slot the family does not have", async () => {
    const { op } = await boot();
    expect((await op("set_slots", { extra_slots: [{ days: ["Mon"] }] })).code).toBe("APP_REFUSED");
    expect((await op("set_slots", { extra_slots: [{ name: "lunch" }] })).code).toBe("APP_REFUSED");
    expect((await op("set_slots", { order_in: [{ day: "Funday", slot: "Dinner" }] })).code).toBe("APP_REFUSED");
    expect((await op("set_slots", { order_in: [{ day: "Sun", slot: "Supper" }] })).code).toBe("APP_REFUSED");
    expect((await op("set_slots", {})).code).toBe("APP_REFUSED");
  });

  it("set_cooking_days takes lowercase days and stores weekdays; Mon–Sat until set", async () => {
    const k = await boot();
    expect((await k.owner("GET", "/api/family")).body.house.cooking_days).toEqual(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]);
    const r = await k.op("set_cooking_days", { days: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] });
    expect(r.house.cooking_days).toEqual(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]);
    expect((await k.op("set_cooking_days", { days: [] })).code).toBe("APP_REFUSED");
    expect((await k.op("set_cooking_days", { days: ["funday"] })).error).toContain("mon, tue");
    // Nothing of the refused calls was saved.
    expect((await k.owner("GET", "/api/family")).body.house.cooking_days).toEqual(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]);
  });

  it("set_cooking_days keeps the cook's days (sim run seed 16: 'Sunday too?' answered with Sunday alone planned Sunday alone)", async () => {
    const k = await boot();
    await k.op("set_cook", { name: "Lakshmi", days: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"], arrival: "07:30" });
    const r = await k.op("set_cooking_days", { days: ["sun"] });
    expect(r.house.cooking_days).toEqual(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]);
  });

  it("set_shopping_apps saves main and fallback as settings and the connected apps exactly as given; names or ids", async () => {
    const k = await boot();
    const heard: string[] = [];
    k.kit.ctx.events.subscribe((e) => { if (e.table === "_settings") heard.push(`${e.id} by ${e.by}`); });
    const r = await k.op("set_shopping_apps", { main: "Zepto", fallback: "BigBasket", connected: ["Blinkit", "amazon fresh"] });
    expect(r).toMatchObject({ main: "zepto", fallback: "bigbasket", order_without_asking: false });
    expect(r.connected).toEqual(["zomato-blinkit", "amazon"]);   // only what the call says: choosing an app is not signing in to it
    expect((await k.owner("GET", "/api/_app")).body.settings).toMatchObject({ grocery_app: "zepto", fallback_app: "bigbasket", order_without_asking: false });
    // The pages hear of the settings as of any setting, stamped as the agent's.
    expect(heard.sort()).toEqual(["fallback_app by agent:meal-agent", "grocery_app by agent:meal-agent"]);
    expect((await k.owner("GET", "/api/family")).body).toMatchObject({ shopping: { main: "zepto", fallback: "bigbasket" }, house: { connected_apps: ["zomato-blinkit", "amazon"] } });
    // The live case: a main app and a fallback, neither signed in to yet.
    const none = await k.op("set_shopping_apps", { main: "zepto", fallback: "swiggy-instamart", connected: [] });
    expect(none).toMatchObject({ main: "zepto", fallback: "swiggy-instamart", connected: [], house: { connected_apps: [] } });
    expect((await k.op("set_shopping_apps", { main: "zepto", fallback: null, connected: [] })).fallback).toBeNull();
    expect((await k.owner("GET", "/api/_app")).body.settings.fallback_app).toBe("none");
    expect((await k.op("set_shopping_apps", { main: "dmart", fallback: null, connected: [] })).error).toContain("zepto");
    expect((await k.op("set_shopping_apps", { main: "zepto", fallback: "zepto", connected: [] })).code).toBe("APP_REFUSED");
    expect((await k.op("set_shopping_apps", { main: "zepto", fallback: null, connected: ["dmart"] })).code).toBe("APP_REFUSED");
    expect((await k.op("set_shopping_apps", { main: "zepto", fallback: null })).code).toBe("APP_REFUSED");
    // A refused call changes nothing.
    expect((await k.owner("GET", "/api/_app")).body.settings.grocery_app).toBe("zepto");
  });

  it("set_house_rules takes a rule that holds every day (no days), one in the family's own words, no eggs, and notes as a list", async () => {
    const { op } = await boot();
    const { house } = await op("set_house_rules", {
      rules: [{ kind: "veg", note: "mostly" }, { note: "mostly vegetarian" }, { kind: "no_eggs", days: ["tuesday"] }, { kind: "egg", days: ["Thu"] }],
      notes: ["no beef at home", "light dinners"] });
    expect(house.rules).toEqual([{ kind: "veg", days: [], note: "mostly" }, { kind: "other", days: [], note: "mostly vegetarian" },
      { kind: "no_eggs", days: ["Tue"] }, { kind: "egg", days: ["Thu"] }]);
    expect(house.notes).toBe("no beef at home\nlight dinners");
    expect((await op("set_house_rules", { notes: "mostly vegetarian, fish on Sundays" })).house.notes).toBe("mostly vegetarian, fish on Sundays");
  });

  it("set_cook holds what the cook does not make, the cook's time and whether they try new recipes; only what is sent changes", async () => {
    const { op } = await boot();
    expect((await op("set_cook", { name: "Lakshmi", wont_make: "non-veg" })).code).toBe("APP_REFUSED");   // a first cook needs days and arrival
    await op("set_cook", { name: "Lakshmi", days: ["Mon", "Tue"], arrival: "07:30", makes_well: "dosa" });
    const { house } = await op("set_cook", { name: "Lakshmi", wont_make: "non-veg, baking", time_limit: "leaves at 9 for the next house: a dish or two in the morning", new_recipes: "set_menu" });
    expect(house).toMatchObject({ cook_name: "Lakshmi", cook_days: ["Mon", "Tue"], cook_arrival: "07:30", cook_makes_well: "dosa", cook_wont_make: "non-veg, baking",
      cook_time_limit: "leaves at 9 for the next house: a dish or two in the morning", cook_new_recipes: "set_menu" });
    expect((await op("set_cook", { name: "Lakshmi", new_recipes: "maybe" })).error).toContain("open, set_menu");
    expect((await op("set_cook", { name: "Lakshmi", new_recipes: null })).house.cook_new_recipes).toBeNull();
  });

  it("an operation names its fields when it is sent one it does not take, or misses one it needs", async () => {
    const { op, rows } = await boot();
    const r = await op("set_cook", { name: "Lakshmi", days: ["Mon"], arrival: "07:30", specialty: "dosa" });
    expect(r.code).toBe("APP_REFUSED");
    expect(r.error).toBe("set_cook does not take specialty. Its fields: name, days, arrival, makes_well, wont_make, time_limit, new_recipes, note. Send it again with those only.");
    expect((await op("set_cook", { name: "Lakshmi", days: ["Mon"], arrival: "07:30", make_well: "dosa" })).error).toContain("(did you mean makes_well?)");
    expect(rows("house").every((h) => h.cook_name === null)).toBe(true);
    const dish = await op("set_dish", { date: "2026-11-23", slot: "Lunch", dish: "Dal" });
    expect(dish.error).toContain("set_dish does not take dish"); expect(dish.error).toContain("Its fields: dish_id, meal_id, date, slot, name,");
    expect((await op("set_person", { group: "adult" })).error).toContain("set_person needs name.");
  });

  it("an operation the app does not have is answered with the closest one and its fields", async () => {
    const { unknownOperation } = await import("./agentOps");
    expect(unknownOperation("save_meal").error).toBe(`save_meal is not an operation of this app. Did you mean set_meal? Its fields: date, slot, meal_id, ordered_in, note, dishes. The operations: ${Object.keys((await import("./agentOps")).FIELDS).join(", ")}.`);
    expect(unknownOperation("add_dish").error).toContain("Did you mean set_dish?");
    expect(unknownOperation("set_rules").error).toContain("Did you mean set_house_rules?");
    expect(unknownOperation("plan").error).toContain("Did you mean plan_week?");
    expect(unknownOperation("zzzz").error).not.toContain("Did you mean");
  });

  it("set_house_rules refuses grocery_app and points to set_shopping_apps; it changes nothing", async () => {
    const { op, owner } = await boot();
    const r = await op("set_house_rules", { grocery_app: "bigbasket", notes: "x" });
    expect(r.code).toBe("APP_REFUSED");
    expect(r.error).toContain("set_shopping_apps");
    const { body } = await owner("GET", "/api/family");
    expect(body.shopping.main).toBe("zepto");
    expect(body.house.notes).toBeNull();
    expect((await op("set_house_rules", {})).code).toBe("APP_REFUSED");
  });

  it("on an install paired with Flock the settings are written with the app's own token", async () => {
    const { op, owner } = await boot({ token: "app-secret" });
    // The kit's settings route refuses a caller without the token; the operation holds it.
    expect((await owner("PATCH", "/api/_app/settings", { grocery_app: "bigbasket" })).status).toBe(401);
    expect((await op("set_shopping_apps", { main: "Blinkit", fallback: null, connected: [] })).main).toBe("zomato-blinkit");
    expect((await owner("GET", "/api/family")).body.shopping.main).toBe("zomato-blinkit");
  });

  it("GET /api/family gives the people at home, the house with its lists read, and the shopping apps", async () => {
    const { op, owner, rows } = await boot();
    expect((await owner("GET", "/api/family")).body).toMatchObject({ people: [], house: { rules: [], cook_days: [], extra_slots: [], order_in: [], cook_name: null, connected_apps: [], history_synced: {} },
      shopping: { main: "zepto", fallback: null, connected: [], order_without_asking: false } });
    await op("set_person", { name: "Meera", group: "adult" });
    await op("set_cook", { name: "Lakshmi", days: ["Mon"], arrival: "07:30" });
    await owner("PATCH", "/api/_app/settings", { grocery_app: "bigbasket" });
    const { body } = await owner("GET", "/api/family");
    expect(body.people.map((p: any) => p.name)).toEqual(["Meera"]);
    expect(body.house).toMatchObject({ cook_name: "Lakshmi", cook_days: ["Mon"], cook_arrival: "07:30" });
    expect(body.shopping.main).toBe("bigbasket");
    expect(rows("house")).toHaveLength(1);
  });
});

describe("set_slots add: true and the slots read back", () => {
  it("add: true keeps a slot saved earlier, a slot of the same name takes that one's place, and without add the list is the whole list", async () => {
    const { op } = await boot();
    for (const name of ["Agastya", "Meera"]) await op("set_person", { name, group: "child" });
    await op("set_slots", { add: true, extra_slots: [{ name: "Agastya's tiffin", days: ["Mon", "Tue", "Wed", "Thu", "Fri"], for: ["Agastya"] }] });
    const r = await op("set_slots", { add: true, extra_slots: [{ name: "Evening snack" }], order_in: [{ day: "Sun", slot: "Dinner" }] });
    expect(r.house.extra_slots.map((s: any) => s.name)).toEqual(["Agastya's tiffin", "Evening snack"]);
    expect(r.said).toBe("Each day we'll plan Breakfast, Lunch and Dinner, plus Agastya's tiffin Mon–Fri and Evening snack every day. Sunday dinner you order in.");
    const again = await op("set_slots", { add: true, extra_slots: [{ name: "agastya's tiffin", days: ["Mon", "Wed", "Fri"], for: ["Agastya"] }], order_in: [{ day: "Sat", slot: "Lunch" }] });
    expect(again.house.extra_slots).toEqual([{ name: "Evening snack" }, { name: "agastya's tiffin", days: ["Mon", "Wed", "Fri"], for: ["Agastya"] }]);
    expect(again.house.order_in).toEqual([{ day: "Sun", slot: "Dinner" }, { day: "Sat", slot: "Lunch" }]);
    expect(again.said).toContain("agastya's tiffin Mon, Wed and Fri");
    expect(again.said).toContain("Sunday dinner and Saturday lunch you order in.");
    const whole = await op("set_slots", { extra_slots: [{ name: "Meera's tiffin", days: ["Tue"], for: ["Meera"] }] });
    expect(whole.house.extra_slots.map((s: any) => s.name)).toEqual(["Meera's tiffin"]);
    expect((await op("set_slots", { add: "yes", extra_slots: [] })).error).toContain("add is true");
  });

  it("set_family_dishes and set_cooking_days answer slots_said, which the setup's slot question shows", async () => {
    const { op } = await boot();
    await op("set_person", { name: "Agastya", group: "child" });
    await op("set_slots", { add: true, extra_slots: [{ name: "Tiffin", days: ["Mon", "Tue", "Wed", "Thu", "Fri"], for: ["Agastya"] }] });
    const r = await op("set_family_dishes", { dishes: [{ name: "Poha", slots: ["Breakfast", "Tiffin"] }] });
    expect(r.slots_said).toBe("Each day we'll plan Breakfast, Lunch and Dinner, plus Tiffin Mon–Fri for Agastya.");
    expect((await op("set_cooking_days", { days: ["mon"] })).slots_said).toContain("Tiffin Mon–Fri");
  });
});
