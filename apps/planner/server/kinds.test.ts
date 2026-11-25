// The dish-kinds catalog (kinds.ts over kinds.json): matching a family's words to an item, sub-kind or kind; where a new item
// may be suggested (decided 18); what an item contains with its tag families; what may be suggested to a family of some cuisines;
// and a slot's kinds and templates: checked against the catalog, stored on the slot, the library's kind fields and the house's
// cuisine profile.
import { describe, it, expect } from "bun:test";
import { boot } from "./testkit";
import { CATALOG, catalogContains, catalogSub, checkMealShape, matchDish, plannerTags, regionalDish, regionalIn, regionalMeaning, regionalWordOf, suggestable, suggestMeals, type MealKind,
  type MealTemplate } from "./kinds";
import { BASE_TAGS } from "./db/constants";
import { commit, getLibraryDish, getSlot, upsertLibrary, upsertSlot } from "./slotStore";
import { getHouse, houseView } from "./family";
import { house } from "./db/schema";

describe("the catalog", () => {
  it("is whole: every item's sub-kind is one of its kind's, and every sub-kind has meals", () => {
    for (const k of CATALOG.kinds) {
      expect(k.subs.length).toBeGreaterThan(0);
      for (const it of k.items) expect(k.subs.map((s) => s.name)).toContain(it.sub);
      for (const s of k.subs) expect(s.meals.length).toBeGreaterThan(0);
    }
  });
});

describe("matchDish", () => {
  it("an item first, by its name or other names, as said or as a singular", () => {
    expect(matchDish("Aloo gobi")).toEqual({ kind: "Sabzi", sub: "Sabzi", item: "Aloo gobi", by: "item" });
    expect(matchDish("rajma chawal")).toMatchObject({ kind: "Dal", sub: "Rajma/Chole", item: "Rajma" });
    expect(matchDish("Maacher jhol")).toMatchObject({ kind: "Fish & seafood", item: "Macher jhol" });
    expect(matchDish("idlis")).toMatchObject({ kind: "Idli", item: "Idli" });
  });
  it("then a sub-kind, by either half of its name or another name of it", () => {
    expect(matchDish("poriyal")).toEqual({ kind: "Sabzi", sub: "Poriyal/Thoran", item: null, by: "sub" });
    expect(matchDish("Thoran")).toMatchObject({ kind: "Sabzi", sub: "Poriyal/Thoran" });
    expect(matchDish("pappu")).toMatchObject({ kind: "Dal", sub: "Pappu", by: "sub" });
    expect(matchDish("aamti")).toMatchObject({ kind: "Dal", sub: "Amti/Varan", by: "sub" });
    expect(matchDish("Sambar")).toMatchObject({ kind: "Rice curry", sub: "Sambar", by: "sub" });
  });
  it("then a kind", () => {
    expect(matchDish("Dosa")).toEqual({ kind: "Dosa", sub: null, item: null, by: "kind" });
    expect(matchDish("uthappam")).toMatchObject({ kind: "Dosa", by: "kind" });
  });
  it("leaves to the model words that name two places, and words it does not know", () => {
    expect(matchDish("shaak")).toBeNull();          // a dry and a gravy vegetable
    expect(matchDish("Bhindi")).toBeNull();         // a vegetable, not a dish name
    expect(matchDish("Boiled chicken")).toBeNull();
  });
});

describe("suggestMeals: where a NEW item may be suggested (decided 18)", () => {
  it("a sub-kind's meals, an item's own where it differs", () => {
    expect(suggestMeals({ kind: "Gravy" })).not.toContain("breakfast");
    expect(suggestMeals({ kind: "Gravy", item: "Vegetable stew" })).not.toContain("breakfast");
    expect(suggestMeals({ kind: "Rice curry", sub: "Sambar" })).toEqual(expect.arrayContaining(["breakfast", "lunch", "dinner"]));
    expect(suggestMeals({ kind: "Rice curry", sub: "Rasam" })).toEqual(["lunch", "dinner"]);
    expect(suggestMeals({ kind: "Khichdi", item: "Ven pongal" })).toContain("breakfast");
    expect(suggestMeals({ kind: "Khichdi", item: "Moong dal khichdi" })).not.toContain("breakfast");
    expect(suggestMeals({ kind: "Halwa", item: "Rava kesari" })).toContain("breakfast");
    expect(suggestMeals({ kind: "Halwa", item: "Gajar halwa" })).not.toContain("breakfast");
    expect(suggestMeals({ kind: "No such kind" })).toEqual([]);
  });
});

describe("catalogContains", () => {
  it("an item's tags with their families; null for a dish not in the catalog", () => {
    expect(catalogContains("Chicken curry")).toEqual(expect.arrayContaining(["chicken", "meat"]));
    expect(catalogContains("Macher jhol")).toEqual(expect.arrayContaining(["fish", "seafood"]));
    expect(catalogContains("Idli")).toEqual(["white_rice"]);
    expect(catalogContains("Grandma's special")).toBeNull();
  });
});

describe("plannerTags: an item's contents in the planner's tags (setup prefills them)", () => {
  it("meats are meat (mutton, pork and beef red meat too), seafood is the planner's fish, peanuts are nuts", () => {
    expect(plannerTags("Chicken curry")!.contains.sort()).toEqual(["chicken", "meat", "onion_garlic"]);
    expect(plannerTags("Prawn masala")!.contains).toEqual(expect.arrayContaining(["prawn", "fish"]));
    expect(plannerTags("Macher jhol")!.contains).toContain("fish");
    expect(plannerTags("Macher jhol")!.contains).not.toContain("seafood");
    expect(plannerTags("Mutton curry")!.contains).toEqual(expect.arrayContaining(["mutton", "meat", "red_meat"]));
    expect(plannerTags("Lemon rice")!.contains.sort()).toEqual(["nuts", "peanut", "white_rice"]);
    expect(plannerTags("Grandma's special")).toBeNull();
  });
  it("answers every base tag: what an item does not list, it does not have", () => {
    const t = plannerTags("Idli")!;
    expect(t.contains).toEqual(["white_rice"]);
    for (const tag of BASE_TAGS) expect(t.read).toContain(tag);
  });
});

describe("catalogSub", () => {
  it("a kind's sub-kind by either half of its name or another name; null when it is not that kind's", () => {
    expect(catalogSub("Sabzi", "thoran")).toBe("Poriyal/Thoran");
    expect(catalogSub("Rice curry", "Sambar")).toBe("Sambar");
    expect(catalogSub("Dal", "Sambar")).toBeNull();
    expect(catalogSub("No such kind", "Sambar")).toBeNull();
  });
});

describe("suggestable", () => {
  it("suggest items of the kind or sub-kind; a regional one only to a family of its cuisine; nothing for a staple", () => {
    const names = (xs: { name: string }[]) => xs.map((x) => x.name);
    expect(names(suggestable("Idli"))).toContain("Ragi idli");
    expect(names(suggestable("Idli"))).not.toContain("Thatte idli");   // recognised only
    expect(suggestable("Roti")).toEqual([]);
    expect(names(suggestable("Fish & seafood", { sub: "Fish curry" }))).not.toContain("Macher jhol");
    expect(names(suggestable("Fish & seafood", { sub: "Fish curry", cuisines: ["bengal"] }))).toContain("Macher jhol");
    expect(suggestable("Dal", { sub: "Pappu" }).every((i) => i.sub === "Pappu")).toBe(true);
  });
});

describe("checkMealShape", () => {
  const tamilLunch: MealKind[] = [{ name: "Rice", staple: true }, { name: "Rice curry", subs: ["Sambar", "Rasam"] }, { name: "Sabzi", subs: ["Poriyal/Thoran"] }, { name: "Curd", staple: true }];
  it("a catalog kind with its own sub-kinds; templates of kinds, sub-kinds and the family's fixed dishes", () => {
    const t: MealTemplate[] = [
      { parts: [{ kind: "Rice" }, { kind: "Rice curry", sub: "Sambar" }, { kind: "Rice curry", sub: "Rasam" }, { kind: "sabzi", sub: "Poriyal/Thoran" }, { kind: "Curd" }] },
      { parts: [{ kind: "Rice" }, { kind: "Rice curry", sub: "Rasam" }, { kind: "Curd" }], share: "1/week", said: "rasam rice once a week" },
    ];
    expect(checkMealShape(tamilLunch, t)).toEqual([]);
    // Breakfast: "appam with stew" (a dish named at a meal outside its kind's meals) and "boiled chicken with khichdi" (an own kind).
    expect(checkMealShape([{ name: "Appam" }, { name: "Boiled chicken", own: true }],
      [{ parts: [{ kind: "Appam" }, { items: ["Vegetable stew"] }] }, { parts: [{ items: ["Khichdi"] }, { kind: "Boiled chicken" }] }])).toEqual([]);
  });
  it("names what is wrong", () => {
    expect(checkMealShape([{ name: "Breakfast dish" }], [])).toEqual(["Breakfast dish: not a catalog kind (mark it own if only this family has it)"]);
    expect(checkMealShape([{ name: "Dal", subs: ["Sambar"] }], [])[0]).toContain("Sambar is not one of its sub-kinds");
    expect(checkMealShape([{ name: "Dosa", own: true }], [])).toEqual(["Dosa: is a catalog kind, not an own one"]);
    expect(checkMealShape(tamilLunch, [{ parts: [{ kind: "Dal" }] }])).toEqual(["template 1: Dal is not one of this meal's kinds"]);
    expect(checkMealShape(tamilLunch, [{ parts: [{ kind: "Rice curry", sub: "Pappu" }] }])).toEqual(["template 1: Pappu is not a sub-kind of Rice curry"]);
    expect(checkMealShape(tamilLunch, [{ parts: [] }, { parts: [{ items: [] }] }, { parts: [{ kind: "Rice" }], share: "often" as never }])).toEqual([
      "template 1: has no parts", "template 2: a part of items needs their dishes' names",
      "template 3: share often is not usually, sometimes, rarely, daily or \"<n>/week\""]);
  });
});

describe("stored", () => {
  it("a slot's kinds and templates; a wrong shape is refused and nothing changes", async () => {
    const { kit } = await boot();
    const kinds: MealKind[] = [{ name: "Roti", staple: true }, { name: "Sabzi" }, { name: "Dal" }];
    const templates: MealTemplate[] = [{ parts: [{ kind: "Roti" }, { kind: "Sabzi" }] }, { parts: [{ kind: "Roti" }, { kind: "Dal" }, { kind: "Sabzi" }], share: "2/week", said: "dal twice a week" }];
    commit(kit.db, kit.emitChange, (tx, ch) => upsertSlot(tx, { name: "Dinner", kind: "main", order: 50, kinds, templates }, "app", ch));
    expect(getSlot(kit.db, "Dinner")).toMatchObject({ kinds, templates });
    expect(() => commit(kit.db, kit.emitChange, (tx, ch) => upsertSlot(tx, { name: "Dinner", templates: [{ parts: [{ kind: "Rice" }] }] }, "app", ch)))
      .toThrow("Dinner: template 1: Rice is not one of this meal's kinds");
    expect(getSlot(kit.db, "Dinner")!.templates).toEqual(templates);
    // A slot from before keeps null: not read yet.
    commit(kit.db, kit.emitChange, (tx, ch) => upsertSlot(tx, { name: "Lunch", kind: "main", order: 30 }, "app", ch));
    expect(getSlot(kit.db, "Lunch")).toMatchObject({ kinds: null, templates: null });
  });

  it("a library dish's kind, sub-kind and catalog item; the house's cuisine profile", async () => {
    const { kit } = await boot();
    commit(kit.db, kit.emitChange, (tx, ch) => {
      upsertLibrary(tx, { name: "Beans poriyal", slot: "Lunch", kind: "Sabzi", sub: "Poriyal/Thoran", catalog_item: "Beans poriyal" }, "app", ch);
      upsertLibrary(tx, { name: "Boiled chicken", slot: "Breakfast", kind: "Boiled chicken" }, "app", ch);
      upsertLibrary(tx, { name: "Paati's kuzhambu", slot: "Lunch" }, "app", ch);
    });
    expect(getLibraryDish(kit.db, "beans poriyal", "Lunch")).toMatchObject({ kind: "Sabzi", sub: "Poriyal/Thoran", catalog_item: "Beans poriyal" });
    expect(getLibraryDish(kit.db, "Boiled chicken", "Breakfast")).toMatchObject({ kind: "Boiled chicken", sub: null, catalog_item: null });
    expect(getLibraryDish(kit.db, "Paati's kuzhambu", "Lunch")).toMatchObject({ kind: null, sub: null, catalog_item: null });

    expect(houseView(getHouse(kit.db)).cuisines).toBeNull();
    kit.db.update(house).set({ cuisines: JSON.stringify(["tamil", "south"]) }).run();
    expect(houseView(getHouse(kit.db)).cuisines).toEqual(["tamil", "south"]);
  });
});

describe("usal (decided 16, 18)", () => {
  it("bare usal is the Rajma/Chole sub-kind of Dal; usal pav stays a Misal", async () => {
    const { matchDish } = await import("./kinds");
    expect(matchDish("Usal")).toMatchObject({ kind: "Dal", sub: "Rajma/Chole" });
    expect(matchDish("Usal pav")).toMatchObject({ kind: "Pav meal", sub: "Misal" });
  });
});

// Owner, 26 Nov (decided 20): "curry means dry sabji even in Tamil Nadu and generally South India: it's actually kari";
// "pachadi" is a chutney in Andhra and Telangana but a curd dish (raita-like) in Kerala and Tamil Nadu.
describe("regional words (decided 20)", () => {
  const curry = regionalWordOf("curry")!, pachadi = regionalWordOf("pachadi")!;
  const at = (w: typeof curry, cs: string[]) => { const m = regionalMeaning(w, cs); return m ? [m.kind, m.sub] : null; };
  it("are never matched plainly: the word alone is no kind until the family's region says which", () => {
    expect(matchDish("curry")).toBeNull();
    expect(matchDish("pachadi")).toBeNull();
    expect(regionalWordOf("a kura")?.word).toBe("curry");
    expect(regionalWordOf("kari")?.word).toBe("curry");
    expect(regionalWordOf("sabzi")).toBeNull();
  });
  it("curry: a dry vegetable dish in South India (a vepudu in Andhra, a poriyal or thoran in Tamil Nadu, Kerala, Karnataka); a gravy elsewhere", () => {
    expect(at(curry, ["tamil", "south"])).toEqual(["Sabzi", "Poriyal/Thoran"]);
    expect(at(curry, ["kerala"])).toEqual(["Sabzi", "Poriyal/Thoran"]);
    expect(at(curry, ["andhra", "south"])).toEqual(["Sabzi", "Vepudu"]);
    expect(at(curry, ["south"])).toEqual(["Sabzi", "Poriyal/Thoran"]);
    expect(at(curry, ["punjab", "north"])).toEqual(["Gravy", "Curry"]);
    expect(at(curry, ["bengal", "east"])).toEqual(["Gravy", "Curry"]);
  });
  it("pachadi: a chutney in Andhra, Telangana and Karnataka; a curd dish in Kerala and Tamil Nadu", () => {
    expect(at(pachadi, ["andhra", "south"])).toEqual(["Chutney", null]);
    expect(at(pachadi, ["karnataka"])).toEqual(["Chutney", null]);
    expect(at(pachadi, ["tamil", "south"])).toEqual(["Raita", null]);
    expect(at(pachadi, ["kerala"])).toEqual(["Raita", null]);
  });
  it("a region that is not clear (none, South India alone for pachadi, or two regions that disagree) settles nothing", () => {
    expect(at(curry, [])).toBeNull();
    expect(at(pachadi, ["south"])).toBeNull();
    expect(at(curry, ["tamil", "andhra", "south"])).toBeNull();
  });
  it("a dish named with one is placed by its vegetable and the word's meaning; a dish of another kind is not", () => {
    const place = (name: string, cs: string[]) => { const r = regionalIn(name)!; const m = regionalMeaning(r.word, cs); return m ? regionalDish(r.base, m) : null; };
    expect(place("Dondakaya curry", ["andhra"])).toMatchObject({ kind: "Sabzi", sub: "Vepudu" });
    expect(place("Beans curry", ["tamil"])).toMatchObject({ kind: "Sabzi", sub: "Poriyal/Thoran" });
    expect(place("Tomato pachadi", ["andhra"])).toMatchObject({ kind: "Chutney" });
    expect(place("Cucumber pachadi", ["kerala"])).toMatchObject({ kind: "Raita" });
    expect(place("Aloo curry", ["north"])).toMatchObject({ kind: "Gravy", sub: "Curry" });
    expect(place("Paneer curry", ["tamil"])).toBeNull();
    expect(matchDish("Chicken curry")?.kind).toBe("Chicken");
  });
});
