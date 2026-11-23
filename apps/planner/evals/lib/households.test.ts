// The fixtures themselves: every name, slot and quote in TRUTH refers to something in the household, the held-out set is
// kept apart, and TRUTH scores 100% against itself in Eval 1.
import { describe, expect, test } from "bun:test";
import { ALL_HOUSEHOLDS, HELDOUT, HOUSEHOLDS, pick } from "../households";
import { scoreSetup } from "./score-setup";
import { setupOfTruth } from "./truth-setup";
import { expectedSlotDays } from "./score-plan";
import { sameName, WEEK } from "./truth";

describe("households", () => {
  test("ids are unique; held-out never in the tuning set or picked by default", () => {
    const ids = ALL_HOUSEHOLDS.map((h) => h.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const h of HELDOUT) { expect(HOUSEHOLDS).not.toContain(h); expect(pick(undefined)).not.toContain(h); expect(pick(h.id.split("-")[0])).not.toContain(h); }
    expect(pick(undefined, { heldout: true })).toEqual(HELDOUT);
    expect(pick("h9", { heldout: true }).map((h) => h.id)).toEqual(["h9-mehta"]);
  });

  for (const h of ALL_HOUSEHOLDS) describe(h.id, () => {
    const t = h.truth;
    const people = t.people.map((p) => p.name);
    const known = (n: string) => people.some((p) => sameName(p, n));
    const slotNames = t.slots.map((s) => s.name);
    const words = [...h.facts.map((f) => f.text), h.correction.corrected, h.correction.line, ...Object.values(h.household).map((v) => JSON.stringify(v))].join("\n");

    test("people match Flock's household.people", () => {
      const flock = (h.household["household.people"] as { name: string }[]).map((p) => p.name);
      expect(people.sort()).toEqual([...flock].sort());
    });
    test("every person named in slots, absences, rules and family cooks is in the household", () => {
      for (const s of t.slots) for (const p of s.usual_people ?? []) expect(known(p)).toBe(true);
      for (const a of t.away) expect(known(a.person)).toBe(true);
      for (const r of t.rules) if (r.who) expect(known(r.who)).toBe(true);
      for (const c of t.familyCooks) expect(known(c.person)).toBe(true);
      for (const p of t.lunchUnclear ?? []) expect(known(p)).toBe(true);
    });
    test("every slot named by the library, seed, rules, absences and add-ons exists", () => {
      for (const d of t.library) { expect(slotNames).toContain(d.slot); for (const x of d.alsoSlots ?? []) expect(slotNames).toContain(x); }
      for (const r of t.seed) expect(slotNames).toContain(r.slot);
      for (const r of t.rules) for (const s of r.slots ?? []) expect(slotNames).toContain(s);
      for (const a of t.away) for (const s of a.slots) expect(slotNames).toContain(s);
      for (const s of t.slots.filter((x) => x.kind === "addon")) expect(slotNames).toContain(s.addon_of!);
      for (const s of t.slots.filter((x) => x.kind !== "main")) expect(s.match).toBeDefined();
    });
    test("seed dishes are library dishes of their slot", () => {
      for (const r of t.seed) for (const d of r.dishes) expect(t.library.some((x) => x.name === d && x.slot === r.slot)).toBe(true);
    });
    test("every rule's quote and every noted item is something the family said", () => {
      for (const r of t.rules) expect(r.quote.test(words)).toBe(true);
      for (const n of t.noted ?? []) expect(n.re.test(words)).toBe(true);
    });
    test("a hard rule never carries a frequency", () => {
      for (const r of t.rules.filter((x) => x.hard)) expect(r.frequency).toBeUndefined();
    });
    test("household.weekly names household people and weekdays", () => {
      const weekly = (h.household["household.weekly"] ?? []) as { person: string; weekdays: string[] }[];
      expect(weekly.length).toBeGreaterThan(0);
      for (const w of weekly) { expect(known(w.person)).toBe(true); for (const d of w.weekdays) expect(WEEK).toContain(d as any); }
    });
    test("TRUTH scores 100% against itself (Eval 1 self-test)", () => {
      const s = scoreSetup(h, setupOfTruth(h));
      const fails = Object.entries(s.rates).filter(([, [p, n]]) => p < n);
      expect(fails.length ? s.notes : []).toEqual([]);
    });
    test("the week expects a slot-day for every main slot on every day it is not skipped", () => {
      const exp = expectedSlotDays(h, "2026-11-30");
      for (const s of t.slots.filter((x) => x.kind === "main")) for (const day of WEEK)
        if (!(s.skip_days ?? []).some((k) => k.day === day)) {
          const e = exp.find((x) => x.slot === s.name && x.day === day);
          // A slot nobody is at that day (everyone out at lunch) is not expected.
          if (e) expect(e.people.length + e.guests).toBeGreaterThan(0);
        }
    });
  });
});
