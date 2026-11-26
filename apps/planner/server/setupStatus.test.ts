// The setup's status (setupStatus.ts, the agentInterface.setup contract): what is known and missing for an empty, a partial
// and a full household, ready only once everyone's diet and the allergies are known, and the stages from asking to done.
import { describe, it, expect } from "bun:test";
import { boot } from "./testkit";
import { setupStatus, type Snapshot } from "./setupStatus";

const TODAY = "2026-11-28";   // a Saturday
const now = () => new Date(2026, 10, 28, 11, 0);
const ids = (s: any, critical?: string) => s.missing.filter((m: any) => !critical || m.critical === critical).map((m: any) => m.id);

async function family() {
  const k = await boot({ now });
  const status = () => k.op("status", {});
  return { ...k, status };
}

describe("status: what is known and missing", () => {
  it("an empty household: not ready, asking, the people group without a default and the meals group with one", async () => {
    const { status } = await family();
    const s = await status();
    expect(s).toMatchObject({ ready: false, stage: "asking", known: [], first_task: "Make a 3-day meal plan from today" });
    const people = s.missing.find((m: any) => m.id === "people");
    expect(people).toMatchObject({ critical: "blocks_first_task" });
    expect(people.default).toBeUndefined();
    expect(people.ask).toContain("Any allergy?");
    expect(ids(s, "blocks_first_task")).toEqual(["people", "meals", "cook", "menu", "shopping", "plate"]);
    for (const m of s.missing.filter((x: any) => x.critical === "blocks_first_task" && x.id !== "people")) expect(m.default, m.id).toBeTruthy();
    expect(s.missing.find((m: any) => m.id === "meals").default).toBe("lunch and dinner");
    expect(s.missing.find((m: any) => m.id === "meals").ask).not.toContain("tiffin");
    expect(ids(s, "improves")).toEqual(["fasting", "visitors", "goals", "tastes"]);
    expect(ids(s, "later")).toEqual([]);
    expect(s.next).toContain("voice note");
  });

  it("a partial household: someone's diet missing keeps it asking, and only that is asked", async () => {
    const { op, status } = await family();
    await op("set_person", { name: "Yogesh", group: "adult", diet: "veg, eggs ok", allergies: "none" });
    await op("set_person", { name: "Kabir", group: "child" });
    const s = await status();
    expect(s.ready).toBe(false);
    expect(s.stage).toBe("asking");
    expect(s.known).toContain("Yogesh: veg, eggs ok");
    const people = s.missing.find((m: any) => m.id === "people");
    expect(people.what).toBe("What Kabir eats");
    expect(people.ask).toBe("What does Kabir eat: veg, eggs, non-veg or Jain?");
    expect(s.next).toContain("what kabir eats");
  });

  it("a diet said as a rule counts, and the allergies count once anyone's are said", async () => {
    const { op, status } = await family();
    await op("set_person", { name: "Asha", group: "adult" });
    await op("set_rule", { hard: true, what: "veg", quote: "we are all vegetarian" });
    let s = await status();
    expect(s.missing.find((m: any) => m.id === "people").what).toBe("Any allergy");
    await op("set_answered", { ids: ["allergies"] });
    s = await status();
    expect(s.ready).toBe(true);
    expect(s.known).toContain("Asha: we are all vegetarian");
  });

  it("a full household: ready, the first task next with the defaults for what was not said", async () => {
    const { op, status } = await family();
    await op("set_person", { name: "Yogesh", group: "adult", diet: "veg, eggs ok", allergies: "none", targets: { protein: "high" } });
    await op("set_person", { name: "Kritika", group: "adult", diet: "veg" });
    const s = await status();
    expect(s).toMatchObject({ ready: true, stage: "first_task" });
    expect(s.known).toContain("Yogesh: veg, eggs ok, high protein");
    expect(s.next).toContain('make_plan { from: "2026-11-28", days: 3 }');
    expect(s.next).toContain("the meals to plan: lunch and dinner");
    expect(s.next).toContain("who cooks: not said");
  });

  it("the meals group is known once its parts are said, a family that cooks itself included", async () => {
    const { op, status } = await family();
    await op("set_person", { name: "Asha", group: "adult", diet: "veg", allergies: "peanuts" });
    await op("set_slot", { name: "Lunch", kind: "main" });
    await op("set_slot", { name: "Dinner", kind: "main" });
    await op("set_cook", { name: "Sunita", days: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"], arrival: "07:30" });
    await op("add_dish", { name: "Roti", slot: "Lunch" });
    await op("set_cuisine", { cuisine: "Punjabi" });
    const s = await status();
    for (const id of ["meals", "cook", "plate"]) expect(ids(s)).not.toContain(id);
    expect(ids(s, "blocks_first_task")).toEqual(["menu", "shopping"]);
    expect(s.known).toEqual(expect.arrayContaining(["Meals planned: Lunch and Dinner", "Lunch: Roti", "Cook: Sunita, Mon–Sat, 7:30 am", "Kitchen: Punjabi and North Indian"]));
    expect(ids(s, "improves")).toContain("cook_dishes");
    await op("set_answered", { ids: ["fasting", "visitors"] });
    expect(ids(await status(), "improves")).not.toContain("fasting");
  });

  it("set_answered and set_cuisine refuse what they do not know", async () => {
    const { op } = await family();
    expect((await op("set_answered", { ids: ["weather"] })).error).toContain("ids must be a list of");
    expect((await op("set_cuisine", { cuisine: "Martian" })).error).toContain("not a cuisine the app knows");
    expect((await op("set_cuisine", { cuisine: "South Indian, mostly Tamil" })).cuisines).toEqual(["tamil", "south"]);
  });
});

describe("status: the stages", () => {
  it("asking, first_task, feedback, then done once 7 days are planned and one round of feedback is saved", async () => {
    const { op, status } = await family();
    expect((await status()).stage).toBe("asking");
    await op("set_person", { name: "Asha", group: "adult", diet: "veg", allergies: "none" });
    expect((await status()).stage).toBe("first_task");
    const first = await op("make_plan", { from: TODAY, days: 3 });
    expect(first.ok).toBe(true);
    let s = await status();
    expect(s.stage).toBe("feedback");
    expect(s.next).toContain("feedback question");
    await op("set_answered", { ids: ["feedback"] });
    s = await status();
    expect(s.stage).toBe("feedback");
    expect(s.next).toContain('make_plan { from: "2026-12-01", days: 4 }');
    expect((await op("make_plan", { from: "2026-12-01", days: 4 })).ok).toBe(true);
    // Done waits for the grocery apps to be asked.
    s = await status();
    expect(s.stage).toBe("feedback");
    expect(s.next).toContain("Offer to connect the grocery apps");
    await op("set_answered", { ids: ["grocery"] });
    s = await status();
    expect(s.stage).toBe("done");
    expect(s.next).toContain("how it goes from here");
  });

  it("a rating saved after the first plan is a round of feedback", async () => {
    const { op, status, rows } = await family();
    await op("set_person", { name: "Asha", group: "adult", diet: "veg", allergies: "none" });
    await op("make_plan", { from: TODAY, days: 7 });
    expect((await status()).stage).toBe("feedback");
    const dish = rows("slot_dishes")[0].dish;
    await op("rate_dishes", { ratings: [{ dish, rating: "good", said_by: "Asha" }] });
    await op("set_shopping_apps", { main: "zepto", connected: [] });
    expect((await status()).stage).toBe("done");
  });

  const snap = (o: Partial<Snapshot>): Snapshot => ({ people: [{ name: "Asha", group: "adult", relationship: null, diet: "veg", allergies: "none", dislikes: null, targets: null, home: true }],
    rules: [], slots: [], dishes: {}, cook: null, roles: { menu: null, cooking: null, shopping: null }, cuisines: [], answered: [], connected: [], historyRead: false, planned: [], feedback: false, ...o });

  it("first_task again when today has no plan; an install whose first plan is 14 days old is past setup", () => {
    expect(setupStatus(snap({ planned: ["2026-11-20", "2026-11-21"] }), TODAY).stage).toBe("first_task");
    expect(setupStatus(snap({ planned: ["2026-11-10"] }), TODAY).stage).toBe("done");
    expect(setupStatus(snap({ people: [] }), TODAY).stage).toBe("asking");
  });
});

// Families differ in shape and in who does what (owner guidance, 27 Nov): nothing assumes a cook, children, a veg house, a
// nuclear family, or that the person setting up decides, cooks, shops or eats.
describe("status: households of every shape", () => {
  it("a single adult who cooks, decides and shops: no cook, tiffin or cook's-dishes question", async () => {
    const { op, status } = await family();
    await op("set_person", { name: "Neha", group: "adult", diet: "non-veg", allergies: "none" });
    await op("set_roles", { menu: "Neha", cooking: "Neha", shopping: "Neha" });
    const s = await status();
    expect(s.ready).toBe(true);
    expect(s.known).toEqual(expect.arrayContaining(["Neha: non-veg", "Cooking: Neha", "Menu decided by: Neha", "Groceries bought by: Neha"]));
    expect(ids(s)).not.toContain("cook");
    expect(ids(s)).not.toContain("cook_dishes");
    expect(s.missing.find((m: any) => m.id === "meals").ask).not.toContain("tiffin");
    expect((await op("make_plan", { from: TODAY, days: 3 })).ok).toBe(true);
  });

  it("a joint family whose elder decides the menu, with a cook on a set menu and a child at school", async () => {
    const { op, status } = await family();
    for (const [name, group, relationship] of [["Dadi", "elder", "grandmother"], ["Papa", "adult", "father"], ["Mummy", "adult", "mother"], ["Rohan", "child", "son"]])
      await op("set_person", { name, group, relationship, diet: "veg", allergies: "none" });
    await op("set_cook", { name: "Sunita", days: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"], arrival: "08:00", new_recipes: "set_menu" });
    await op("set_roles", { menu: "Dadi", shopping: "Papa" });
    const s = await status();
    expect(s.known).toEqual(expect.arrayContaining(["Dadi (grandmother): veg", "Cook: Sunita, Mon–Sat, 8 am, sticks to familiar dishes", "Menu decided by: Dadi", "Groceries bought by: Papa"]));
    expect(s.missing.find((m: any) => m.id === "meals").ask).toContain("a school tiffin");
    expect(ids(s, "improves")).toContain("cook_dishes");
  });

  it("flatmates who cook in turns and each buy their own groceries", async () => {
    const { op, status } = await family();
    for (const name of ["Aman", "Kiran", "Zoya"]) await op("set_person", { name, group: "adult", diet: name === "Zoya" ? "eggs, no meat" : "non-veg" });
    await op("set_answered", { ids: ["allergies"] });
    await op("set_roles", { menu: "shared", cooking: "turns", shopping: "each buys their own" });
    const s = await status();
    expect(s.ready).toBe(true);
    expect(s.known).toEqual(expect.arrayContaining(["Cooking: turns", "Menu decided by: shared", "Groceries bought by: each buys their own"]));
    for (const id of ["cook", "menu", "shopping", "cook_dishes"]) expect(ids(s)).not.toContain(id);
  });

  it("a manager from afar who does not eat the meals: the parents at home eat, the manager decides", async () => {
    const { op, status } = await family();
    for (const name of ["Mummy", "Papa"]) await op("set_person", { name, group: "elder", diet: "veg", allergies: "none" });
    await op("set_roles", { menu: "Arjun (from Pune)", cooking: "the cook", shopping: "Arjun (from Pune)" });
    const s = await op("status", { person: "Arjun" });
    expect(s.ready).toBe(true);
    expect(s.known).toContain("Arjun does not eat at home");
    expect(s.known.some((l: string) => l.startsWith("Arjun:"))).toBe(false);
    expect((await op("status", { person: "Mummy" })).known).not.toContain("Mummy does not eat at home");
  });

  it("a cook on a set menu gets no new dishes after the setup week", async () => {
    const { op, rows, kit } = await family();
    await op("set_person", { name: "Asha", group: "adult", diet: "veg", allergies: "none" });
    await op("set_cook", { name: "Sunita", days: ["Mon"], arrival: "08:00", new_recipes: "set_menu" });
    await op("set_slot", { name: "Lunch", kind: "main" });
    for (const name of ["Roti", "Dal tadka", "Aloo gobi", "Bhindi sabzi"]) await op("add_dish", { name, slot: "Lunch" });
    // Past the setup week: the first plan was weeks ago.
    kit.sqlite.run(`INSERT INTO slot_days (id, created_at, updated_at, updated_by, date, slot, people, guests, status, edited) VALUES ('old', '2026-10-01', '2026-10-01', 'app', '2026-10-01', 'Lunch', '[]', '[]', 'planned', 0)`);
    expect((await op("make_plan", { week_start: "2026-11-30" })).ok).toBe(true);
    const placed = (rows("slot_dishes") as any[]).filter((d) => d.slot_day_id !== "old");
    expect(placed.length).toBeGreaterThan(0);
    expect(placed.filter((d) => d.new)).toEqual([]);
  });
});

describe("status: the grocery apps, after the first plan", () => {
  it("are not asked before the first plan; then asked, and past orders follow a connected app", async () => {
    const { op, status } = await family();
    await op("set_person", { name: "Asha", group: "adult", diet: "veg", allergies: "none" });
    expect(ids(await status())).not.toContain("grocery");
    await op("make_plan", { from: TODAY, days: 3 });
    let s = await status();
    const grocery = s.missing.find((m: any) => m.id === "grocery");
    expect(grocery).toMatchObject({ critical: "improves" });
    expect(grocery.ask).toContain("one at a time");
    expect(ids(s)).not.toContain("orders");
    await op("set_shopping_apps", { main: "Blinkit", connected: ["Blinkit"] });
    s = await status();
    expect(ids(s)).not.toContain("grocery");
    expect(s.known).toContain("Grocery apps connected: Blinkit");
    expect(s.missing.find((m: any) => m.id === "orders")).toMatchObject({ critical: "improves" });
  });
});
