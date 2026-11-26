// migrateMeaning.ts: a saved 4.1.x install moved to the one meaning model once, at boot (docs/2026-11-26-one-meaning-model-design.md
// §5.1–§5.3, §9.6, §11). The old rows are written straight to the database as 4.1.x left them: category words as library rows,
// rules with items and no targets, slots.kinds set, templates null. Expectations are worked out from the spec's mapping.
import { describe, expect, it } from "bun:test";
import { boot } from "./testkit";
import { deriveTemplates, migrateMeaning } from "./migrateMeaning";
import { getHouse } from "./family";
import { makePlan } from "./makePlan";
import type { ModelRequest, ModelResult } from "./model";
import type { MealTemplate } from "./kinds";
import { addRule, commit, listLibrary, listRules, listSlotDays, listSlots, saveSlotDay, upsertLibrary, upsertSlot, type LibraryDish, type LibraryInput,
  type RuleInput, type Slot, type SlotInput } from "./slotStore";
import { dishKey } from "./dishText";

const NOW = new Date(2026, 10, 29, 11, 0);
const MON = "2026-11-30", TODAY = "2026-11-29";
const T = (...parts: MealTemplate["parts"]): MealTemplate => ({ parts });

/** A 4.1.x house: its slots (then `kinds` written raw), its library and rules as saved then, setup's places when given. */
async function oldHouse(o: { slots: (SlotInput & { oldKinds?: unknown })[]; library?: LibraryInput[]; rules?: RuleInput[]; seed?: { slot: string; dishes: string[] }[];
  places?: Record<string, unknown> }) {
  const k = await boot({ now: () => NOW });
  for (const name of ["Asha", "Ravi"]) await k.op("set_person", { name, group: "adult" });
  commit(k.kit.db, k.kit.emitChange, (tx, ch) => {
    for (const { oldKinds: _, ...s } of o.slots) upsertSlot(tx, s, "app", ch);
    for (const d of o.library ?? []) upsertLibrary(tx, { origin: "setup_named", contains: [], contains_read: ["egg", "meat", "fish"], ...d }, "app", ch);
    for (const r of o.rules ?? []) addRule(tx, r, "app", ch);
    for (const s of o.seed ?? []) saveSlotDay(tx, { date: null, slot: s.slot, dishes: s.dishes.map((dish) => ({ dish })) }, "app", ch);
  });
  for (const s of o.slots) k.kit.sqlite.run(`UPDATE slots SET kinds = ? WHERE name = ?`, [JSON.stringify(s.oldKinds ?? [{ name: "Sabzi" }]), s.name]);
  if (o.places) { const h = getHouse(k.kit.db); k.kit.sqlite.run(`UPDATE house SET setup_state = ? WHERE id = ?`, [JSON.stringify({ places: o.places }), h.id]); }
  const lines: string[] = [];
  const migrate = () => migrateMeaning(k.kit.sqlite, k.kit.db, NOW, (l) => lines.push(l));
  const slot = (name: string) => listSlots(k.kit.db, { all: true }).find((s) => s.name === name)!;
  const lib = (s: string) => listLibrary(k.kit.db, { slot: s }).map((d) => d.name).sort();
  return { ...k, migrate, lines, slot, lib };
}

describe("migrateMeaning: library category rows become template words", () => {
  it("a category row becomes its template part's words and leaves the library", async () => {
    // Setup decided "dry sabji" is the Sabzi category (setup_state.places), though the catalog has no such word.
    const k = await oldHouse({
      slots: [{ name: "Lunch", kind: "main", order: 30, templates: [T({ kind: "Rice" }, { kind: "Sabzi" })] }],
      library: [{ name: "Rice", slot: "Lunch", kind: "Rice", catalog_item: null }, { name: "Dry sabji", slot: "Lunch", kind: "Sabzi" },
        { name: "Aloo gobi", slot: "Lunch", kind: "Sabzi", catalog_item: "Aloo gobi" }, { name: "Gravy", slot: "Lunch", kind: "Gravy" }],
      places: { [`lunch|${dishKey("Dry sabji")}`]: { kind: "Sabzi", sub: "Sabzi", item: null, own: false, named: "category", word: "dry sabji" } },
    });
    expect(k.migrate()).toBe("migrated");
    expect(k.slot("Lunch").templates).toEqual([T({ kind: "Rice" }, { kind: "Sabzi", words: "dry sabji" })]);
    expect(k.lib("Lunch")).toEqual(["Aloo gobi", "Rice"]);
    // A category no template holds is dropped, and said so.
    expect(k.lines).toContain("migrate: Lunch: gravy held by no template, dropped");
    // setup's memory is left as it was.
    expect(JSON.parse(getHouse(k.kit.db).setup_state!).places[`lunch|${dishKey("Dry sabji")}`].named).toBe("category");
  });

  it("a category kept to a day moves its days onto the template", async () => {
    const k = await oldHouse({
      slots: [{ name: "Breakfast", kind: "main", order: 10, templates: [T({ kind: "Khichdi", sub: "Pongal" }), T({ kind: "Idli" }), T({ kind: "Dosa" })] }],
      library: [{ name: "Pongal", slot: "Breakfast", kind: "Khichdi", days: ["Sun"], frequency: "sometimes", said: "pongal on Sundays" },
        { name: "Idli", slot: "Breakfast", kind: "Idli", catalog_item: "Idli" }, { name: "Dosa", slot: "Breakfast", kind: "Dosa" }],
    });
    expect(k.migrate()).toBe("migrated");
    const [pongal, idli, dosa] = k.slot("Breakfast").templates!;
    expect(pongal).toMatchObject({ days: ["Sun"], share: "sometimes", said: "pongal on Sundays" });
    expect(pongal.parts[0]).toMatchObject({ kind: "Khichdi", sub: "Pongal", words: "pongal" });
    expect(idli).toEqual(T({ kind: "Idli" }));
    // "dosa" names one dish (the catalog's bare dish): the part keeps its kind and gets that dish.
    expect(dosa).toEqual(T({ kind: "Dosa", words: "dosa", dish: "Plain dosa" }));
    expect(k.lib("Breakfast")).toEqual(["Idli"]);
  });

  it("a word another item holds names no bare dish: \"saaru\" stays any rasam, as setup reads it (H7 fix round 1)", async () => {
    const k = await oldHouse({
      slots: [{ name: "Lunch", kind: "main", order: 30, templates: [T({ kind: "Rice" }, { kind: "Rice curry", sub: "Rasam" })] }],
      library: [{ name: "Rice", slot: "Lunch", kind: "Rice", catalog_item: null }, { name: "Saaru", slot: "Lunch", kind: "Rice curry", sub: "Rasam" }],
    });
    expect(k.migrate()).toBe("migrated");
    expect(k.slot("Lunch").templates![0].parts[1]).toEqual({ kind: "Rice curry", sub: "Rasam", words: "saaru" });
  });

  it("two category words on one part are joined", async () => {
    const k = await oldHouse({
      slots: [{ name: "Lunch", kind: "main", order: 30, templates: [T({ kind: "Rice" }, { kind: "Dal" })] }],
      library: [{ name: "Dal", slot: "Lunch", kind: "Dal" }, { name: "Pappu", slot: "Lunch", kind: "Dal" }],
    });
    k.migrate();
    expect(k.slot("Lunch").templates![0].parts[1]).toEqual({ kind: "Dal", words: "dal or pappu" });
  });
  it("a meal whose migrated templates the store refuses keeps its category row", async () => {
    const k = await oldHouse({
      slots: [{ name: "Lunch", kind: "main", order: 30, templates: [T({ kind: "Rice" }, { kind: "Sabzi" })] }],
      library: [{ name: "Sabzi", slot: "Lunch", kind: "Sabzi" }],
    });
    // A shape saved before the store checked it: a link to a meal the house does not have.
    const bad = [T({ kind: "Rice" }, { kind: "Sabzi" }, { from: "Brunch", kind: "Dal" })];
    k.kit.sqlite.run(`UPDATE slots SET templates = ? WHERE name = 'Lunch'`, [JSON.stringify(bad)]);
    k.migrate();
    expect(k.slot("Lunch").templates).toEqual(bad);
    expect(k.lib("Lunch")).toEqual(["Sabzi"]);
    expect(k.lines).toContain("migrate: Lunch: sabzi kept in the library: its templates were not saved");
  });
});

describe("migrateMeaning: rules get typed targets", () => {
  it("old tag rules naming a kind get kind targets; tags stay ingredients", async () => {
    const k = await oldHouse({
      slots: [{ name: "Breakfast", kind: "main", order: 10, templates: [T({ kind: "Upma" })] }],
      rules: [{ hard: true, what: "avoid", who: "Ravi", items: ["salad", "egg"], quote: "Ravi doesn't eat salad or egg" },
        { hard: true, what: "swap", who: "Asha", items: ["upma"], to: "pancakes", quote: "pancakes for Asha when we make upma" },
        { hard: true, what: "veg", who: "Asha", quote: "Asha is vegetarian" },
        { hard: true, what: "avoid", who: "Asha", items: ["mushroom"], targets: [{ type: "ingredient", tag: "mushroom" }], quote: "no mushroom" }],
    });
    k.migrate();
    const [avoid, swap, veg, typed] = listRules(k.kit.db);
    expect(avoid.targets).toEqual([{ type: "kind", kind: "Salad" }, { type: "ingredient", tag: "egg" }]);
    expect(swap.targets).toEqual([{ type: "kind", kind: "Upma" }]);
    expect(swap.gives).toMatchObject({ type: "item", item: "Pancakes" });
    expect(veg.targets).toEqual([{ type: "ingredient", tag: "meat" }, { type: "ingredient", tag: "fish" }]);
    expect(typed.targets).toEqual([{ type: "ingredient", tag: "mushroom" }]);
    // The old words stay beside them.
    expect(avoid.items).toEqual(["salad", "egg"]);
  });
});

describe("migrateMeaning: slots", () => {
  it("slots.kinds is cleared; a slot without templates gets them once", async () => {
    const k = await oldHouse({
      slots: [{ name: "Dinner", kind: "main", order: 50, templates: null }, { name: "Evening snack", kind: "custom", order: 40, templates: null }],
      library: [{ name: "Phulka", slot: "Dinner", kind: "Roti" }, { name: "Aloo gobi", slot: "Dinner", kind: "Sabzi", catalog_item: "Aloo gobi" }],
      seed: [{ slot: "Dinner", dishes: ["Phulka", "Aloo gobi"] }],
    });
    expect(k.rows("slots").every((s) => s.kinds !== null)).toBe(true);
    expect(k.migrate()).toBe("migrated");
    expect(k.rows("slots").map((s) => s.kinds)).toEqual([null, null]);
    expect(k.slot("Dinner").templates).toEqual([T({ kind: "Roti" }, { kind: "Sabzi", sub: "Sabzi" })]);
    // Nothing of theirs and no history: left for setup to read.
    expect(k.slot("Evening snack").templates).toBeNull();
  });

  it("a person's own custom slot moves to one step after the meal it replaces", async () => {
    const days = ["Mon", "Tue", "Wed", "Thu", "Fri"] as const;
    const k = await oldHouse({ slots: [{ name: "Breakfast", kind: "main", order: 10, templates: [] }, { name: "Lunch", kind: "main", order: 30, templates: [] },
      { name: "Agastya's tiffin", kind: "custom", order: 20, usual_people: ["Agastya"], days: [...days], templates: [] },
      { name: "Agastya's breakfast box", kind: "custom", order: 12, usual_people: ["Agastya"], days: [...days], templates: [] },
      { name: "Ravi's lunch box", kind: "custom", order: 35, usual_people: ["Ravi"], days: [...days], templates: [] },
      { name: "Ravi's extras", kind: "addon", addon_of: "Lunch", order: 60, usual_people: ["Ravi"], templates: [] }] });
    expect(k.migrate()).toBe("migrated");
    expect(k.slot("Agastya's tiffin").order).toBe(35);
    expect(k.slot("Agastya's breakfast box").order).toBe(15);
    expect(k.slot("Ravi's lunch box").order).toBe(35);
    expect(k.slot("Ravi's extras").order).toBe(60);
    expect(k.lines).toContain("migrate: Agastya's tiffin: order 20 → 35 (replaces Lunch)");
  });

  it("runs once: a second boot changes nothing", async () => {
    const k = await oldHouse({
      slots: [{ name: "Lunch", kind: "main", order: 30, templates: [T({ kind: "Rice" }, { kind: "Sabzi" })] }, { name: "Dinner", kind: "main", order: 50, templates: null }],
      library: [{ name: "Sabzi", slot: "Lunch", kind: "Sabzi" }, { name: "Phulka", slot: "Dinner", kind: "Roti" }],
      rules: [{ hard: true, what: "avoid", who: "Ravi", items: ["egg"], quote: "no egg" }],
    });
    expect(k.migrate()).toBe("migrated");
    expect(getHouse(k.kit.db).meaning_model_at).toBe(NOW.toISOString());
    const snap = () => JSON.stringify(["slots", "library", "rules", "house"].map((t) => k.rows(t)));
    const before = snap();
    // Rows as a later 4.1.x write could leave them are not read again either.
    expect(k.migrate()).toBe("already");
    expect(snap()).toBe(before);
  });

  it("a fresh install has nothing to move, and is marked", async () => {
    const k = await boot({ now: () => NOW });
    expect(migrateMeaning(k.kit.sqlite, k.kit.db, NOW, () => {})).toBe("none");
    expect(getHouse(k.kit.db).meaning_model_at).toBe(NOW.toISOString());
    expect(migrateMeaning(k.kit.sqlite, k.kit.db, NOW, () => {})).toBe("already");
  });
});

describe("migrateMeaning: the plan after", () => {
  it("a migrated install still plans", async () => {
    const k = await oldHouse({
      slots: [{ name: "Lunch", kind: "main", order: 30, templates: [T({ kind: "Rice" }, { kind: "Sabzi" })] }],
      library: [{ name: "Rice", slot: "Lunch", kind: "Rice" }, { name: "Dry sabji", slot: "Lunch", kind: "Sabzi" },
        ...["Aloo gobi", "Bhindi sabzi", "Jeera aloo"].map((name) => ({ name, slot: "Lunch", kind: "Sabzi", catalog_item: name }))],
      // Their past week as told: the category word on every plate.
      seed: [1, 2, 3].map(() => ({ slot: "Lunch", dishes: ["Rice", "Dry sabji"] })),
      places: { [`lunch|${dishKey("Dry sabji")}`]: { kind: "Sabzi", sub: "Sabzi", item: null, own: false, named: "category", word: "dry sabji" } },
    });
    k.migrate();
    const model = async (_req: ModelRequest): Promise<ModelResult> => ({ ok: true, json: { dishes: [] }, model: "fake" });
    const r = await makePlan({ db: k.kit.db, emit: k.kit.emitChange, model, weekStart: MON, today: TODAY, basePath: "/a/t", log: () => {}, sqlite: k.kit.sqlite });
    expect(r.ok).toBe(true);
    const dishes = listSlotDays(k.kit.db, { from: MON, to: "2026-12-06" }).flatMap((d) => d.dishes.map((x) => x.dish));
    expect(dishes.length).toBeGreaterThan(0);
    expect(dishes).not.toContain("Dry sabji");
  });
});

// Moved from fillWeek.test.ts with deriveTemplates (it now runs once, here).
describe("deriveTemplates: a meal set up before templates", () => {
  const slot = (name: string, o: Partial<Slot> = {}): Slot => ({ id: name, name, kind: "main", addon_of: null, usual_people: [], days: [], skip_days: [],
    order: name === "Breakfast" ? 10 : name === "Lunch" ? 30 : 50, active: true, extras: false, templates: null, ...o });
  const dish = (name: string, slotName: string, kind: string | null): LibraryDish => ({ id: `${slotName}|${name}`, key: dishKey(name), slot: slotName,
    name, frequency: null, days: null, said: null, contains: [], contains_read: [], origin: "setup_named", suggested: false, untried: false, offers: 0, disliked: false,
    prep: null, video_url: null, video_title: null, video_thumbnail: null, rating: null, rating_note: null, rated_on: null, rated_by: null, ratings: [], kind, sub: null,
    catalog_item: null });

  it("reads templates off its seed plates: a part per dish, a dish the catalog does not know kept as theirs", () => {
    const lib = ["Rice", "Drumstick sambar", "Tomato rasam", "Pepper rasam", "Beans poriyal", "Cabbage poriyal", "Curd", "Paati's kuzhambu"].map((n) => dish(n, "Lunch", null));
    const ts = deriveTemplates(slot("Lunch"), [["Rice", "Drumstick sambar", "Beans poriyal", "Curd"], ["Rice", "Tomato rasam", "Curd"], ["Rice", "Paati's kuzhambu", "Curd"]], lib, "lunch");
    expect(ts).toHaveLength(3);
    expect(ts[0].parts).toEqual([{ kind: "Rice" }, { kind: "Rice curry", sub: "Sambar" }, { kind: "Sabzi", sub: "Poriyal/Thoran" }, { kind: "Curd" }]);
    expect(ts[2].parts[1]).toEqual({ items: ["Paati's kuzhambu"] });
  });

  it("with no plates and nothing of theirs: a plain plate of its meal", () => {
    expect(deriveTemplates(slot("Lunch"), [], [], "lunch")).toEqual([T({ kind: "Roti" }, { kind: "Dal" }, { kind: "Sabzi" }), T({ kind: "Rice" }, { kind: "Dal" }, { kind: "Sabzi" })]);
  });
});
