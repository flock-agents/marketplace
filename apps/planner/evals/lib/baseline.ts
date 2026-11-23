// A code-only week from TRUTH (no model): each expected slot-day gets the next of its slot's seed rows that keeps the hard
// rules for the people on it and its dishes' days. It is Eval 2's floor and the scorer's end-to-end self-check: what a
// plain rotation of the family's own meals scores, and which households' truth cannot be planned under the per-slot-day
// rule check at all.
import type { PlanOut } from "./result";
import { expectedSlotDays } from "./score-plan";
import { truthTags } from "./truth-setup";
import { hasItem, tagsOfName } from "./vocab";
import { sameName, type Household } from "./truth";

export function baselineWeek(h: Household, monday: string): PlanOut {
  const t = h.truth;
  const turn = new Map<string, number>();
  const tags = (name: string, slot: string) => {
    const d = t.library.find((x) => x.name === name && x.slot === slot) ?? t.library.find((x) => x.name === name);
    return d ? truthTags(d) : tagsOfName(name);
  };
  const slotDays = expectedSlotDays(h, monday).map((e) => {
    if (e.skip) return { date: e.date, slot: e.slot, people: e.people, guests: [], skip: e.skip, dishes: [] };
    const rows = t.seed.filter((r) => r.slot === e.slot);
    const ok = (dishes: string[]) => dishes.every((name) => {
      const d = t.library.find((x) => x.name === name);
      if (d?.days && !d.days.includes(e.day)) return false;
      return t.rules.filter((r) => r.hard && r.items?.length && (!r.days?.length || r.days.includes(e.day)) && (!r.slots?.length || r.slots.includes(e.slot)))
        .every((r) => !(r.who ? e.people.some((p) => sameName(p, r.who!)) : e.people.length) || !r.items!.some((it) => hasItem(tags(name, e.slot), it)));
    });
    const n = turn.get(e.slot) ?? 0;
    let pick = rows.length ? rows[n % rows.length].dishes : [];
    for (let i = 0; i < rows.length; i++) { const r = rows[(n + i) % rows.length]; if (ok(r.dishes)) { pick = r.dishes; turn.set(e.slot, n + i + 1); break; } }
    return { date: e.date, slot: e.slot, people: e.people, guests: e.guests ? [{ count: e.guests }] : [], skip: null, dishes: pick.map((name) => ({ name })) };
  });
  return { ok: true, week_start: monday, slotDays, library: [], unmet: [] };
}
