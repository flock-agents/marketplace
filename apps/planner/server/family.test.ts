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

  it("set_cook refuses an arrival that is not HH:MM", async () => {
    const { op, rows } = await boot();
    for (const arrival of ["7.30am", "7:30", "24:00", "07:60", 730, undefined])
      expect((await op("set_cook", { name: "Lakshmi", days: ["Mon"], arrival })).code).toBe("APP_REFUSED");
    expect(rows("house").every((h) => h.cook_name === null)).toBe(true);
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

  it("set_house_rules replaces the rules, keeps a fasting day in the family's words, and refuses an unknown kind", async () => {
    const { op } = await boot();
    await op("set_house_rules", { rules: [{ kind: "veg", days: ["Tue"] }], notes: "no beef at home" });
    const { house } = await op("set_house_rules", { rules: [{ kind: "fasting", days: ["Ekadashi"], note: "Nani only" }, { kind: "no_onion_garlic", days: ["saturday"] }] });
    expect(house.rules).toEqual([{ kind: "fasting", days: ["Ekadashi"], note: "Nani only" }, { kind: "no_onion_garlic", days: ["Sat"] }]);
    expect(house.notes).toBe("no beef at home");
    expect((await op("set_house_rules", { rules: [{ kind: "keto", days: ["Mon"] }] })).code).toBe("APP_REFUSED");
    expect((await op("set_house_rules", { rules: [{ kind: "veg" }] })).code).toBe("APP_REFUSED");
    expect((await op("set_house_rules", { rules: "veg on Tuesdays" })).code).toBe("APP_REFUSED");
    expect((await op("set_house_rules", {})).code).toBe("APP_REFUSED");
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

  it("GET /api/family gives the people at home, the house with its lists read, and the grocery app", async () => {
    const { op, owner, rows } = await boot();
    expect((await owner("GET", "/api/family")).body).toMatchObject({ people: [], house: { rules: [], cook_days: [], extra_slots: [], order_in: [], cook_name: null }, grocery_app: "zepto" });
    await op("set_person", { name: "Meera", group: "adult" });
    await op("set_cook", { name: "Lakshmi", days: ["Mon"], arrival: "07:30" });
    await owner("PATCH", "/api/_app/settings", { grocery_app: "bigbasket" });
    const { body } = await owner("GET", "/api/family");
    expect(body.people.map((p: any) => p.name)).toEqual(["Meera"]);
    expect(body.house).toMatchObject({ cook_name: "Lakshmi", cook_days: ["Mon"], cook_arrival: "07:30" });
    expect(body.grocery_app).toBe("bigbasket");
    expect(rows("house")).toHaveLength(1);
  });
});
