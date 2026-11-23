// Nothing runs until the app knows the family: a person at home, or a 2.0 profile carried over and waiting to be structured.
import { describe, it, expect } from "bun:test";
import type { Database } from "bun:sqlite";
import { boot } from "./testkit";
import { familyKnown, gateRoutines, migrateOldProfile, profilePending, routinesMayRun } from "./gate";

/** A 2.0 install's household profile, as the kit stored it: one `_settings` row, the value as it was written. */
function oldProfile(sqlite: Database, value: string) {
  sqlite.run(`INSERT INTO _settings (id, created_at, updated_at, updated_by, key, value, scope) VALUES ('s1', '', '', 'app', 'household.profile', ?, 'owner')`, [value]);
}

describe("migrateOldProfile", () => {
  it("migrates a 2.0 household.profile into house.profile_to_structure once", async () => {
    const { kit, rows } = await boot();
    oldProfile(kit.sqlite, JSON.stringify({ people: "2 adults, 1 child", food: "veg" }));
    expect(migrateOldProfile(kit.sqlite)).toBe("migrated");
    expect(rows("house")).toHaveLength(1);
    expect(rows("house")[0].profile_to_structure).toContain("2 adults, 1 child");
    expect(rows("house")[0].profile_to_structure).toBe(JSON.stringify({ people: "2 adults, 1 child", food: "veg" }, null, 1));
    expect(migrateOldProfile(kit.sqlite)).toBe("already");
    expect(rows("house")).toHaveLength(1);
    expect(profilePending(kit.sqlite)).toBe(true);
  });

  it("carries a profile stored as a plain string over as it is", async () => {
    const { kit, rows } = await boot();
    oldProfile(kit.sqlite, JSON.stringify("2 adults and Agastya (6). Veg on Tuesdays."));
    expect(migrateOldProfile(kit.sqlite)).toBe("migrated");
    expect(rows("house")[0].profile_to_structure).toBe("2 adults and Agastya (6). Veg on Tuesdays.");
  });

  it("carries text that was never JSON over as it is", async () => {
    const { kit, rows } = await boot();
    oldProfile(kit.sqlite, "2 adults, 1 child; veg");
    expect(migrateOldProfile(kit.sqlite)).toBe("migrated");
    expect(rows("house")[0].profile_to_structure).toBe("2 adults, 1 child; veg");
  });

  it("does nothing on an install with no profile, or an empty one", async () => {
    const fresh = await boot();
    expect(migrateOldProfile(fresh.kit.sqlite)).toBe("none");
    expect(profilePending(fresh.kit.sqlite)).toBe(false);
    for (const empty of ["{}", '""', "null", ""]) {
      const { kit, rows } = await boot();
      oldProfile(kit.sqlite, empty);
      expect(migrateOldProfile(kit.sqlite)).toBe("none");
      expect(rows("house").every((h) => h.profile_to_structure === null)).toBe(true);
    }
  });

  it("keeps the house the family already filled, and leaves a family with people alone", async () => {
    const { kit, op, rows } = await boot();
    oldProfile(kit.sqlite, JSON.stringify({ people: "2 adults" }));
    await op("set_cook", { name: "Lakshmi", days: ["Mon"], arrival: "07:30" });
    expect(migrateOldProfile(kit.sqlite)).toBe("migrated");
    expect(rows("house")).toHaveLength(1);
    expect(rows("house")[0]).toMatchObject({ cook_name: "Lakshmi", profile_to_structure: JSON.stringify({ people: "2 adults" }, null, 1) });

    const known = await boot();
    oldProfile(known.kit.sqlite, JSON.stringify({ people: "2 adults" }));
    await known.op("set_person", { name: "Meera", group: "adult" });
    expect(migrateOldProfile(known.kit.sqlite)).toBe("already");
    expect(profilePending(known.kit.sqlite)).toBe(false);
  });

  it("the carried profile is structured once the agent saves someone at home, and it does not come back", async () => {
    const { kit, op } = await boot();
    oldProfile(kit.sqlite, JSON.stringify({ people: "2 adults, 1 child" }));
    migrateOldProfile(kit.sqlite);
    expect(profilePending(kit.sqlite)).toBe(true);
    await op("set_person", { name: "Meera", group: "adult" });
    expect(profilePending(kit.sqlite)).toBe(false);
    expect(migrateOldProfile(kit.sqlite)).toBe("already");
    expect(profilePending(kit.sqlite)).toBe(false);
  });
});

describe("gateRoutines", () => {
  it("gateRoutines: silent with no family and no pending profile, runs once a person exists", async () => {
    const { kit, op } = await boot();
    const ran: string[] = [];
    const routines = gateRoutines({ a: () => { ran.push("a"); }, b: async () => { ran.push("b"); } });
    const ctx = { kit: { sqlite: kit.sqlite } };
    await routines.a(ctx); await routines.b(ctx);
    expect(ran).toEqual([]);
    expect(familyKnown(kit.sqlite)).toBe(false);
    await op("set_cook", { name: "Lakshmi", days: ["Mon"], arrival: "07:30" });   // a house row alone is not a family
    await routines.a(ctx);
    expect(ran).toEqual([]);
    await op("set_person", { name: "Meera", group: "adult" });
    expect(familyKnown(kit.sqlite)).toBe(true);
    await routines.a(ctx); await routines.b(ctx);
    expect(ran).toEqual(["a", "b"]);
  });

  it("goes silent again when the last person is removed", async () => {
    const { kit, op } = await boot();
    await op("set_person", { name: "Meera", group: "adult" });
    await op("set_person", { name: "Meera", remove: true });
    expect(familyKnown(kit.sqlite)).toBe(false);
    expect(routinesMayRun(kit.sqlite)).toBe(false);
  });

  it("runs with no person yet while a carried-over profile waits to be structured", async () => {
    const { kit } = await boot();
    oldProfile(kit.sqlite, JSON.stringify({ people: "2 adults, 1 child" }));
    migrateOldProfile(kit.sqlite);
    const ran: string[] = [];
    await gateRoutines({ weekly: () => { ran.push("weekly"); } }).weekly({ kit: { sqlite: kit.sqlite } });
    expect(ran).toEqual(["weekly"]);
  });

  it("a routine's own result and context pass through the gate", async () => {
    const { kit, op } = await boot();
    await op("set_person", { name: "Meera", group: "adult" });
    const seen: unknown[] = [];
    const ctx = { kit: { sqlite: kit.sqlite }, routine: { trigger: "scheduled" } };
    await gateRoutines({ a: (c: typeof ctx) => { seen.push(c.routine.trigger); } }).a(ctx);
    expect(seen).toEqual(["scheduled"]);
  });
});
