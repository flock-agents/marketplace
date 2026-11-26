// People's food goals (targets.ts): the family's words read into levels, the old free text moved at boot with the words kept,
// what a dish is rich in (kinds.json nutrition), and the plan leaning towards dishes that fit without passing a food rule.
import { describe, it, expect } from "bun:test";
import { Database } from "bun:sqlite";
import { join } from "path";
import { boot, tempDir } from "./testkit";
import { migrateTargets, targetScore, targetsFromText, targetsInput, targetsOf, targetsText } from "./targets";
import { dishNutrition, type MealTemplate } from "./kinds";
import { commit, listSlotDays, upsertLibrary, upsertSlot } from "./slotStore";

describe("targets: the family's words", () => {
  it("reads levels from words, and leaves out what is not said", () => {
    expect(targetsFromText("high protein, less oil")).toEqual({ protein: "high", fat: "low" });
    expect(targetsFromText("Low-carb please, protein-rich")).toEqual({ protein: "high", carbs: "low" });
    expect(targetsFromText("less rice for Papa")).toEqual({ carbs: "low" });
    expect(targetsFromText("1800 kcal")).toEqual({});
  });

  it("set_person takes the levels or the words, and refuses a level outside the list", async () => {
    const { op } = await boot();
    const a = await op("set_person", { name: "Yogesh", group: "adult", targets: { protein: "high", note: "gym 4 days" } });
    expect(JSON.parse(a.person.targets)).toEqual({ protein: "high", note: "gym 4 days" });
    const b = await op("set_person", { name: "Papa", group: "elder", targets: "less rice, low fat" });
    expect(JSON.parse(b.person.targets)).toEqual({ carbs: "low", fat: "low", note: "less rice, low fat" });
    expect((await op("set_person", { name: "Papa", targets: { protein: "lots" } })).error).toContain("targets.protein must be one of: high, normal, low");
    expect((await op("set_person", { name: "Papa", targets: null })).person.targets).toBeNull();
    expect(targetsInput({ sugar: "low" })).toEqual({ error: "targets takes protein, carbs, fat and note only, not sugar" });
  });

  it("reads back as the family's words, else the levels", () => {
    expect(targetsText({ protein: "high", carbs: "low" })).toBe("high protein, low carbs");
    expect(targetsText({ protein: "high", note: "more protein for the gym" })).toBe("more protein for the gym");
    expect(targetsText(null)).toBe("");
  });

  it("boot moves free text into the shape, keeping the words, and leaves JSON alone", async () => {
    const dir = tempDir("planner-targets-"); const file = join(dir, "app.db");
    const k = await boot({ dbFile: file, dataDir: dir });
    await k.op("set_person", { name: "Asha", group: "adult", targets: { fat: "low" } });
    await k.op("set_person", { name: "Ravi", group: "adult" });
    k.kit.sqlite.run(`UPDATE people SET targets = 'more protein, 60 g a day' WHERE name = 'Ravi'`);
    expect(migrateTargets(k.kit.sqlite as unknown as Database)).toBe(1);
    const t = Object.fromEntries((k.rows("people") as any[]).map((p) => [p.name, targetsOf(p.targets)]));
    expect(t).toEqual({ Asha: { fat: "low" }, Ravi: { protein: "high", note: "more protein, 60 g a day" } });
    expect(migrateTargets(k.kit.sqlite as unknown as Database)).toBe(0);
  });
});

describe("targets: the plan's lean", () => {
  it("knows what a dish is rich in from its main ingredients or its kind", () => {
    expect([...dishNutrition("Paneer bhurji")]).toContain("protein");
    expect([...dishNutrition("Moong dal")]).toEqual(["protein"]);
    expect([...dishNutrition("Aloo gobi")]).toEqual(["carbs"]);
    expect([...dishNutrition("Lauki sabzi")]).toEqual([]);
    expect([...dishNutrition("Pappu", "Dal")]).toEqual(["protein"]);
  });

  it("scores a dish for the goals at the table: a fit up, a goal against it down", () => {
    expect(targetScore(new Set(["protein"]), [{ protein: "high" }])).toBe(1);
    expect(targetScore(new Set(["carbs"]), [{ carbs: "low" }, { carbs: "low" }])).toBe(-2);
    expect(targetScore(new Set(["carbs"]), [{ protein: "high", carbs: "normal" }])).toBe(0);
    expect(targetScore(new Set(["protein"]), [])).toBe(0);
  });

  /** A house whose dinner is roti and one curry, from six: two rich in protein, two in carbs, two in neither. */
  async function dinners(targets: unknown) {
    const k = await boot({ now: () => new Date(2026, 10, 29, 11, 0) });
    await k.op("set_person", { name: "Yogesh", group: "adult", diet: "veg", ...(targets ? { targets } : {}) });
    const T = (...parts: MealTemplate["parts"]): MealTemplate => ({ parts });
    commit(k.kit.db, k.kit.emitChange, (tx, ch) => {
      upsertSlot(tx, { name: "Dinner", kind: "main", order: 50, kinds: [{ name: "Roti", staple: true }, { name: "Gravy" }], templates: [T({ kind: "Roti" }, { kind: "Gravy" })] }, "app", ch);
      upsertLibrary(tx, { name: "Phulka", slot: "Dinner", kind: "Roti", origin: "setup_named" }, "app", ch);
      for (const name of ["Aloo matar", "Dum aloo", "Mix veg curry", "Mushroom masala", "Palak paneer", "Kadai paneer"])
        upsertLibrary(tx, { name, slot: "Dinner", kind: "Gravy", origin: "setup_named", catalog_item: name }, "app", ch);
    });
    await k.op("make_plan", { week_start: "2026-11-30" });
    return listSlotDays(k.kit.db, { slot: "Dinner" }).map((d) => d.dishes.map((x) => x.dish).filter((x) => x !== "Phulka")[0]);
  }

  it("high protein brings the paneer curries first; low carbs keeps the potato ones back; no goal, the rotation alone", async () => {
    const protein = await dinners({ protein: "high" });
    expect(protein.slice(0, 2).sort()).toEqual(["Kadai paneer", "Palak paneer"]);
    const lowCarb = await dinners({ carbs: "low" });
    expect(lowCarb.slice(0, 4).filter((x) => ["Aloo matar", "Dum aloo"].includes(x))).toEqual([]);
    const none = await dinners(null);
    expect(none.slice(0, 2).sort()).not.toEqual(["Kadai paneer", "Palak paneer"]);
    expect(new Set(none.slice(0, 6)).size).toBe(6);
  });
});
