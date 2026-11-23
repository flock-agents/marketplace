// The slot model's store (slotStore.ts): its reads and writes on a real database, and the derived values of spec §2.2 as
// pure functions: staples (≥60% of a slot's last 14 history rows with dishes, the seed counting), looks like (seed and
// confirmed only, recent confirmed first, at most 6) and recent (any status, planned included).
import { describe, it, expect } from "bun:test";
import { boot } from "./testkit";
import { addRule, commit, deleteSlotDays, getLibraryDish, getSlot, getSlotDay, listLibrary, listRules, listSlotDays, listSlots, looksLike, looksLikeRows,
  newDishesPerWeek, recent, removeLibrary, removeRule, removeSlot, saveSlotDay, seedSlotDays, slotHistory, staples, updateLibraryByName, updateRule,
  updateSlotDish, upsertLibrary, upsertSlot, type HistoryRow } from "./slotStore";

const row = (date: string | null, status: "planned" | "confirmed", dishes: string[], skip: "eaten_out" | null = null): HistoryRow =>
  ({ date, status, skip, dishes: dishes.map((dish) => ({ dish })) });

describe("staples", () => {
  it("are the dishes in at least 60% of the slot's history rows with dishes, the seed counting", () => {
    // 5 rows: Rice in 5, Curd in 3 (60%), Sambar in 2 (40%).
    const rows = [row(null, "confirmed", ["Rice", "Sambar", "Curd"]), row("2026-11-20", "planned", ["Rice", "Rasam", "Curd"]),
      row("2026-11-21", "confirmed", ["rice", "Sambar"]), row("2026-11-22", "planned", ["Rice", "Dal", "Curd"]), row("2026-11-23", "planned", ["Rice", "Rajma"])];
    expect(staples(rows)).toEqual(["Rice", "Curd"]);
  });

  it("read only the last 14 rows with dishes, newest first, the seed oldest; skipped and empty rows do not count", () => {
    // 14 dated rows with Roti, then a seed row with only Idli: the seed falls outside the window.
    const dated = Array.from({ length: 14 }, (_, i) => row(`2026-11-${String(i + 1).padStart(2, "0")}`, "planned", ["Roti", i < 8 ? "Dal" : "Sabzi"]));
    const rows = [row(null, "confirmed", ["Idli"]), ...dated, row("2026-11-20", "planned", [], "eaten_out"), row("2026-11-21", "planned", [])];
    expect(staples(rows)).toEqual(["Roti"]);
    // Dal is in 8 of the last 14 (57%): not a staple; at 50% it is.
    expect(staples(rows, { share: 0.5 })).toEqual(["Roti", "Dal"]);
    // A dish counts once a row.
    expect(staples([row(null, "confirmed", ["Chapati", "chapati"]), row("2026-11-01", "planned", ["Dal"])])).toEqual([]);
  });

  it("no history: none", () => {
    expect(staples([])).toEqual([]);
    expect(staples([row("2026-11-01", "planned", [], "eaten_out")])).toEqual([]);
  });
});

describe("looks like", () => {
  it("holds the seed and confirmed rows only, the most recent confirmed first, then the seed, at most 6", () => {
    const rows = [row(null, "confirmed", ["Rice", "Sambar", "Beans poriyal", "Curd"]), row(null, "confirmed", ["Rajma chawal", "Curd"]),
      row("2026-11-20", "confirmed", ["Bisi bele bath"]), row("2026-11-22", "planned", ["Never eaten", "Shown only"]),
      row("2026-11-21", "confirmed", ["Curd rice", "Pickle"])];
    expect(looksLike(rows)).toEqual(["Curd rice, Pickle", "Bisi bele bath", "Rice, Sambar, Beans poriyal, Curd", "Rajma chawal, Curd"]);
    expect(looksLike(rows).join()).not.toContain("Shown only");
    expect(looksLike(rows, 2)).toEqual(["Curd rice, Pickle", "Bisi bele bath"]);
    const many = Array.from({ length: 9 }, (_, i) => row(`2026-11-${String(i + 10)}`, "confirmed", [`Dish ${i}`]));
    expect(looksLikeRows(many)).toHaveLength(6);
    expect(looksLikeRows(many)[0].dishes[0].dish).toBe("Dish 8");
  });

  it("never a planned-only row, even with nothing else", () => {
    expect(looksLike([row("2026-11-22", "planned", ["Idli"]), row("2026-11-23", "planned", ["Dosa"])])).toEqual([]);
  });
});

describe("recent", () => {
  it("is what the slot had in the days before, planned or confirmed alike; the seed and skipped days left out", () => {
    const rows = [row(null, "confirmed", ["Seed dish"]), row("2026-11-26", "planned", ["Bisi bele bath", "Curd"]), row("2026-11-27", "confirmed", ["Khichdi"]),
      row("2026-11-28", "planned", [], "eaten_out"), row("2026-11-24", "planned", ["Too early"]), row("2026-11-29", "planned", ["Lemon rice"]),
      row("2026-11-30", "planned", ["Not before"])];
    expect(recent(rows, "2026-11-30", 3)).toEqual({ "2026-11-27": ["Khichdi"], "2026-11-29": ["Lemon rice"] });
    expect(recent(rows, "2026-11-30", 4)).toEqual({ "2026-11-26": ["Bisi bele bath", "Curd"], "2026-11-27": ["Khichdi"], "2026-11-29": ["Lemon rice"] });
  });
});

describe("the store", () => {
  it("slots: added, changed by name (any capitals), read in planning order, taken away inactive", async () => {
    const { kit, rows } = await boot();
    commit(kit.db, kit.emitChange, (tx, ch) => {
      upsertSlot(tx, { name: "Dinner", kind: "main", order: 50 }, "app", ch);
      upsertSlot(tx, { name: "Breakfast", kind: "main", order: 10 }, "app", ch);
      upsertSlot(tx, { name: "Agastya's tiffin", kind: "custom", order: 20, usual_people: ["Agastya"], days: ["Mon", "Tue", "Wed", "Thu", "Fri"] }, "app", ch);
      upsertSlot(tx, { name: "Papa's dinner", kind: "addon", addon_of: "Dinner", order: 60, usual_people: ["Papa"] }, "app", ch);
      upsertSlot(tx, { name: "dinner", skip_days: [{ day: "Sun", skip: "ordered_in" }] }, "agent:a", ch);
    });
    expect(listSlots(kit.db).map((s) => s.name)).toEqual(["Breakfast", "Agastya's tiffin", "Dinner", "Papa's dinner"]);
    expect(getSlot(kit.db, "DINNER")).toMatchObject({ name: "Dinner", kind: "main", order: 50, usual_people: [], days: [], skip_days: [{ day: "Sun", skip: "ordered_in" }], active: true });
    expect(getSlot(kit.db, "papa's dinner")).toMatchObject({ kind: "addon", addon_of: "Dinner", usual_people: ["Papa"] });
    expect(() => commit(kit.db, kit.emitChange, (tx, ch) => upsertSlot(tx, { name: "Snack" }, "app", ch))).toThrow("needs its kind and order");
    commit(kit.db, kit.emitChange, (tx, ch) => expect(removeSlot(tx, "agastya's tiffin", "app", ch)).toBe(true));
    expect(listSlots(kit.db).map((s) => s.name)).not.toContain("Agastya's tiffin");
    expect(listSlots(kit.db, { all: true }).map((s) => s.name)).toContain("Agastya's tiffin");
    expect(rows("slots")).toHaveLength(4);
  });

  it("slot-days: one per date and slot with dishes and ingredients; the seed has no date and is confirmed; history and deletes", async () => {
    const { kit, rows } = await boot();
    const save = (d: Parameters<typeof saveSlotDay>[1]) => commit(kit.db, kit.emitChange, (tx, ch) => saveSlotDay(tx, d, "app", ch));
    commit(kit.db, kit.emitChange, (tx, ch) => { upsertSlot(tx, { name: "Lunch", kind: "main", order: 30 }, "app", ch); upsertSlot(tx, { name: "Breakfast", kind: "main", order: 10 }, "app", ch); });
    const seed = save({ date: null, slot: "Lunch", dishes: [{ dish: "Rice" }, { dish: "Sambar" }] });
    save({ date: null, slot: "Lunch", dishes: [{ dish: "Rajma chawal" }] });
    expect(seed).toMatchObject({ date: null, status: "confirmed", dishes: [{ dish: "Rice", position: 0 }, { dish: "Sambar", position: 1 }] });
    expect(seedSlotDays(kit.db, "lunch").map((d) => d.dishes.map((x) => x.dish))).toEqual([["Rice", "Sambar"], ["Rajma chawal"]]);

    const lunch = save({ date: "2026-11-30", slot: "Lunch", people: ["Ankur", "Mira"], guests: [{ count: 2, rules: ["veg"] }],
      dishes: [{ dish: "Rice", ingredients: [{ item: "rice", amount: 300, unit: "g" }] }, { dish: "Cabbage poriyal", new: true, note: "less spicy for Mira",
        ingredients: [{ item: "cabbage", amount: 500, unit: "g" }, { item: "coconut", amount: null, unit: null }] }] });
    expect(lunch).toMatchObject({ date: "2026-11-30", status: "planned", edited: false, skip: null, people: ["Ankur", "Mira"], guests: [{ count: 2, rules: ["veg"] }],
      dishes: [{ dish: "Rice", new: false, ingredients: [{ item: "rice", amount: 300, unit: "g" }] },
        { dish: "Cabbage poriyal", new: true, feedback_asked: false, note: "less spicy for Mira", ingredients: [{ item: "cabbage" }, { item: "coconut", amount: null }] }] });
    save({ date: "2026-11-30", slot: "Breakfast", dishes: [{ dish: "Idli" }] });
    // The same date and slot again (any capitals): that row changes, only what is given; dishes given replace the dishes.
    const again = save({ date: "2026-11-30", slot: "lunch", status: "confirmed", edited: true, dishes: [{ dish: "Khichdi" }] });
    expect(again).toMatchObject({ id: lunch.id, slot: "Lunch", status: "confirmed", edited: true, people: ["Ankur", "Mira"], dishes: [{ dish: "Khichdi", ingredients: [] }] });
    expect(rows("slot_dishes").filter((d) => d.slot_day_id === lunch.id)).toHaveLength(1);
    expect(rows("dish_ingredients")).toHaveLength(0);
    // Read by date then planning order.
    expect(listSlotDays(kit.db, { from: "2026-11-30", to: "2026-12-06" }).map((d) => d.slot)).toEqual(["Breakfast", "Lunch"]);
    expect(getSlotDay(kit.db, "2026-11-30", "LUNCH")?.id).toBe(lunch.id);
    commit(kit.db, kit.emitChange, (tx, ch) => updateSlotDish(tx, again.dishes[0].id, { feedback_asked: true }, "app", ch));
    expect(getSlotDay(kit.db, "2026-11-30", "Lunch")!.dishes[0].feedback_asked).toBe(true);

    // History: the seed and the dated slot-days before a day, any status.
    save({ date: "2026-12-01", slot: "Lunch", skip: "eaten_out" });
    expect(slotHistory(kit.db, "Lunch", "2026-12-01").map((d) => d.date)).toEqual([null, null, "2026-11-30"]);
    expect(slotHistory(kit.db, "Lunch", "2026-12-02").map((d) => [d.date, d.skip])).toContainEqual(["2026-12-01", "eaten_out"]);

    // Deleting a week leaves the edited slot-days when asked, and the seed always.
    save({ date: "2026-12-02", slot: "Lunch", dishes: [{ dish: "Dal", ingredients: [{ item: "toor dal", amount: 150, unit: "g" }] }] });
    expect(commit(kit.db, kit.emitChange, (tx, ch) => deleteSlotDays(tx, { from: "2026-11-30", to: "2026-12-06", keepEdited: true }, "app", ch))).toBe(3);
    expect(listSlotDays(kit.db).map((d) => d.id)).toEqual([lunch.id]);
    expect(rows("dish_ingredients")).toHaveLength(0);
    expect(seedSlotDays(kit.db)).toHaveLength(2);
  });

  it("the library: one row per dish and slot, by its normalised name; a dish's video and rating on every row of it", async () => {
    const { kit } = await boot();
    const add = (d: Parameters<typeof upsertLibrary>[1]) => commit(kit.db, kit.emitChange, (tx, ch) => upsertLibrary(tx, d, "app", ch));
    expect(add({ name: "Lemon rice", slot: "Lunch", origin: "setup_named", days: ["Fri"], contains: ["white_rice"], contains_read: ["white_rice", "egg"] }))
      .toMatchObject({ key: "lemon rice", slot: "Lunch", origin: "setup_named", days: ["Fri"], frequency: null, contains: ["white_rice"], untried: false, offers: 0, disliked: false });
    add({ name: "Lemon Rice", slot: "Agastya's tiffin", frequency: "1/week" });
    add({ name: "Cabbage poriyal", slot: "Lunch", origin: "planner_suggested", suggested: true, untried: true, offers: 1 });
    expect(getLibraryDish(kit.db, "lemon  rice", "agastya's tiffin")).toMatchObject({ origin: "family_added", frequency: "1/week", days: null, contains: [] });
    // The same dish and slot again: only what is given changes.
    add({ name: "lemon rice", slot: "Lunch", frequency: "rarely" });
    expect(getLibraryDish(kit.db, "Lemon rice", "Lunch")).toMatchObject({ frequency: "rarely", days: ["Fri"], origin: "setup_named" });
    expect(listLibrary(kit.db, { slot: "Lunch" }).map((d) => d.name)).toEqual(["Cabbage poriyal", "Lemon rice"]);
    expect(listLibrary(kit.db, { names: ["LEMON RICE"] })).toHaveLength(2);
    commit(kit.db, kit.emitChange, (tx, ch) => updateLibraryByName(tx, "Lemon rice", { video_url: "https://youtu.be/x", rating: "good" }, "app", ch));
    expect(listLibrary(kit.db, { names: ["Lemon rice"] }).map((d) => [d.video_url, d.rating])).toEqual([["https://youtu.be/x", "good"], ["https://youtu.be/x", "good"]]);
    commit(kit.db, kit.emitChange, (tx, ch) => expect(removeLibrary(tx, "Lemon rice", "Agastya's tiffin", "app", ch)).toBe(true));
    expect(listLibrary(kit.db, { names: ["Lemon rice"] })).toHaveLength(1);
  });

  it("rules: added, changed, removed, each with the family's words", async () => {
    const { kit } = await boot();
    const [veg, rice] = commit(kit.db, kit.emitChange, (tx, ch) => [
      addRule(tx, { hard: true, what: "veg", quote: "we're vegetarian" }, "app", ch),
      addRule(tx, { hard: false, what: "swap", who: "Papa", items: ["white_rice"], to: "millets", frequency: "sometimes", quote: "millets are good for him" }, "app", ch)]);
    expect(veg).toMatchObject({ hard: true, what: "veg", who: null, slots: null, days: null, items: null, quote: "we're vegetarian" });
    expect(rice).toMatchObject({ hard: false, what: "swap", who: "Papa", items: ["white_rice"], to: "millets", frequency: "sometimes" });
    commit(kit.db, kit.emitChange, (tx, ch) => updateRule(tx, rice.id, { frequency: "2/week", slots: ["Lunch"] }, "app", ch));
    expect(listRules(kit.db)[1]).toMatchObject({ frequency: "2/week", slots: ["Lunch"], items: ["white_rice"] });
    commit(kit.db, kit.emitChange, (tx, ch) => {
      expect(removeRule(tx, veg.id, "app", ch)).toBe(true);
      expect(updateRule(tx, "nope", { quote: "x" }, "app", ch)).toBeNull();
    });
    expect(listRules(kit.db).map((r) => r.what)).toEqual(["swap"]);
  });

  it("new dishes a week: the setting, 2 until set", async () => {
    const { kit, owner } = await boot();
    expect(newDishesPerWeek(kit.db)).toBe(2);
    expect((await owner("PATCH", "/api/_app/settings", { new_dishes_per_week: 0 })).status).toBe(200);
    expect(newDishesPerWeek(kit.db)).toBe(0);
  });

  it("tells the pages what changed, once the write commits", async () => {
    const { kit } = await boot();
    const told: string[] = [];
    commit(kit.db, (t, _id, op) => told.push(`${t} ${op}`), (tx, ch) =>
      saveSlotDay(tx, { date: "2026-11-30", slot: "Dinner", dishes: [{ dish: "Dal", ingredients: [{ item: "toor dal", amount: 100, unit: "g" }] }] }, "app", ch));
    expect(told).toEqual(["slot_days insert", "slot_dishes insert", "dish_ingredients insert"]);
  });
});
