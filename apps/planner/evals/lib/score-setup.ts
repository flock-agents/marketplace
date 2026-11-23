// Eval 1's scorecard: a setup (as the planner's rows hold it) against TRUTH, field by field, in code. Every field is a pass
// rate over the things it counts (a household's two hard rules are two of "hard_rules"); a field that does not apply to a
// household counts nothing there.
import type { Setup } from "./setup";
import { itemCovers, oftenMax, sameName, truthDishOf, WEEK, type HardRule, type Household, type SoftNote } from "./truth";

export type Rates = Record<string, [number, number]>;
export type SetupScore = { rates: Rates; notes: string[] };

const setEq = (a: readonly string[] = [], b: readonly string[] = []) => a.length === b.length && a.every((x) => b.some((y) => y.toLowerCase() === x.toLowerCase()));
const daysEq = (a?: readonly string[], b?: readonly string[]) => setEq(a?.length ? a : WEEK, b?.length ? b : WEEK);
const namesEq = (a: readonly string[] = [], b: readonly string[] = []) => a.length === b.length && a.every((x) => b.some((y) => sameName(x, y)));
type Saved = Setup["rules"][number];

/** A saved rule as the planner checks it: the older kinds as avoid with their items (rules.ts checkedAs). */
function asChecked(r: Saved): Saved {
  const items = r.kind === "veg" || r.kind === "no_meat" || r.kind === "egg" ? ["@meat", "@fish"] : r.kind === "no_eggs" ? ["@egg"] : r.kind === "no_onion_garlic" ? ["onion", "garlic"] : null;
  return items ? { ...r, kind: "avoid", items } : r;
}
const whoOk = (truthWho: string | undefined, saved: string | undefined) => (truthWho ? !!saved && sameName(truthWho, saved) : !saved);

/** The saved slot name a truth slot word is (an extra slot by its pattern). */
function slotOk(h: Household, truthSlot: string, saved: string): boolean {
  if (truthSlot.toLowerCase() === saved.toLowerCase()) return true;
  const t = h.truth.extraSlots.find((s) => s.name === truthSlot);
  return !!t && t.match.test(saved);
}

/** Is this hard rule saved, as a rule the planner checks. */
export function hardRuleSaved(h: Household, hr: HardRule, rules: Saved[]): boolean {
  if (hr.words) return rules.some((r) => whoOk(hr.rule.who, r.who) && hr.words!.test(JSON.stringify(r)));
  const c = hr.check;
  if (!c) return false;
  if (c.kind === "fasting")
    return rules.some((r) => r.kind === "fasting" && whoOk(c.who, r.who) && daysEq(c.days, r.days) && setEq(c.slots, r.slots ?? []));
  const kinds = ["avoid", ...(hr.alsoKinds ?? []), ...(c.kind === "swap" ? ["swap", "avoid", "cap"] : [])];
  // A rule of a person's own meal (a child's tiffin) may name that person.
  const slotOwner = (who?: string) => !c.who && c.kind === "avoid" && !!c.slots?.length && !!who
    && c.slots.every((x) => h.truth.extraSlots.find((t) => t.name === x)?.for?.some((p) => sameName(p, who)));
  const scoped = rules.map(asChecked).filter((r) => kinds.includes(r.kind) && (whoOk(c.who, r.who) || slotOwner(r.who))
    && (c.kind === "swap" || (daysEq(c.days, r.days) && (c.slots?.length ? !!r.slots?.length && c.slots.every((t) => r.slots!.some((s) => slotOk(h, t, s))) : !r.slots?.length))));
  const items = scoped.flatMap((r) => r.items ?? []);
  return c.items.every((t) => items.some((s) => itemCovers(s, t)));
}

/** Is a saved rule one of the family's: it loosely matches a hard rule or a soft note (same person, an item or the words). */
function explained(h: Household, r: Saved): boolean {
  const text = JSON.stringify([r.note ?? "", r.items ?? [], r.to ?? "", r.days ?? []]);
  for (const hr of h.truth.hardRules) {
    const who = hr.rule.who;
    if (who && !(r.who && sameName(who, r.who))) continue;
    if (hr.words?.test(text)) return true;
    const c = hr.check;
    if (!c) continue;
    if (c.kind === "fasting" && r.kind === "fasting") return true;
    if (c.kind !== "fasting" && (asChecked(r).items ?? []).some((s) => c.items.some((t) => itemCovers(s, t)))) return true;
  }
  return h.truth.softNotes.some((n) => (!n.who || (r.who && sameName(n.who, r.who))) && n.re.test(text));
}
const softFound = (n: SoftNote, rules: Saved[]) => rules.some((r) => (!n.who || (r.who && sameName(n.who, r.who))) && n.re.test(JSON.stringify([r.note ?? "", r.items ?? [], r.to ?? ""])));
const isHomeCookNote = (r: Saved) => r.kind === "other" && /\bcooks?\b/i.test(r.note ?? "");

export function scoreSetup(h: Household, s: Setup): SetupScore {
  const t = h.truth, rates: Rates = {}, notes: string[] = [];
  const add = (field: string, ok: boolean, why?: string) => {
    const r = (rates[field] ??= [0, 0]); r[1]++; if (ok) r[0]++; else if (why) notes.push(`${field}: ${why}`);
  };
  // People
  add("people", t.people.length === s.people.length && t.people.every((p) => s.people.some((x) => sameName(x.name, p.name) && x.group === p.group)),
    JSON.stringify(s.people.map((p) => `${p.name}/${p.group}`)));
  // The cook
  if (t.cook) {
    add("cook_days", !!s.cook && sameName(s.cook.name, t.cook.name) && daysEq(t.cook.days, s.cook.days), JSON.stringify(s.cook && { name: s.cook.name, days: s.cook.days }));
    add("cook_times", !!s.cook && s.cook.visits.length === t.cook.visits.length && t.cook.visits.every((v) => s.cook!.visits.some((x) => x.at === v.at && setEq(v.meals, x.meals ?? []))),
      `${JSON.stringify(s.cook?.visits)} (want ${JSON.stringify(t.cook.visits)})`);
  } else add("cook_days", !s.cook || t.people.some((p) => sameName(p.name, s.cook!.name)), `a paid cook saved: ${s.cook?.name}`);
  // Who cooks on the cook's days off (or every day, with no cook)
  for (const c of t.homeCook) {
    const off = c.days.filter((d) => !t.cook?.days.includes(d));
    if (!off.length) continue;
    const ok = t.cook
      ? off.every((d) => s.rules.some((r) => isHomeCookNote(r) && (r.days ?? []).includes(d) && new RegExp(`\\b${c.by}\\b`, "i").test(r.note ?? "")))
      : (!!s.cook && sameName(s.cook.name, c.by)) || s.rules.some((r) => new RegExp(`\\b${c.by}\\b`, "i").test(r.note ?? "") && /cook/i.test(r.note ?? ""));
    add("home_cook", ok, `${c.by} on ${off.join(",")}: ${JSON.stringify(s.rules.filter(isHomeCookNote).map((r) => `${r.days?.join(",")} ${r.note}`))}`);
  }
  // Extra slots
  const matched = new Set<string>();
  for (const ts of t.extraSlots) {
    const got = s.extraSlots.find((x) => x.name.toLowerCase() === ts.name.toLowerCase()) ?? s.extraSlots.find((x) => ts.match.test(x.name));
    add("slots_present", !!got, `${ts.name} missing`);
    if (!got) continue;
    matched.add(got.name);
    add("slot_days", daysEq(ts.days, got.days), `${got.name} days ${JSON.stringify(got.days ?? "every day")}`);
    add("slot_for", ts.for ? namesEq(ts.for, got.for ?? []) : !got.for?.length, `${got.name} for ${JSON.stringify(got.for ?? "everyone")}`);
  }
  add("no_extra_slots", s.extraSlots.every((x) => matched.has(x.name)), `unexpected ${JSON.stringify(s.extraSlots.filter((x) => !matched.has(x.name)).map((x) => x.name))}`);
  // Meals ordered in or eaten out
  const oi = (xs: { day: string; slot: string }[]) => xs.map((o) => `${o.day} ${o.slot}`.toLowerCase()).sort().join("|");
  add("order_in", oi(t.orderIn) === oi(s.orderIn), `${JSON.stringify(s.orderIn.map((o) => `${o.day} ${o.slot}`))} (want ${JSON.stringify(t.orderIn.map((o) => `${o.day} ${o.slot}`))})`);
  // Rules
  for (const hr of t.hardRules) add("hard_rules", hardRuleSaved(h, hr, s.rules), `missing: ${hr.title}`);
  const unsaid = s.rules.filter((r) => !isHomeCookNote(r) && !explained(h, r));
  add("no_unsaid_rules", !unsaid.length, `not said: ${JSON.stringify(unsaid)}`);
  for (const n of t.softNotes) add("soft_notes", softFound(n, s.rules), `missing: ${n.who ?? "house"}: ${n.text}`);
  // A soft note kept soft: not turned into a rule the planner enforces at every meal ("less oil" as never oil).
  for (const n of t.softNotes) {
    const hard = s.rules.filter((r) => ["avoid", "only", "cap"].includes(r.kind) && (!n.who || (r.who && sameName(n.who, r.who))) && n.re.test(JSON.stringify([r.note ?? "", r.items ?? [], r.to ?? ""])));
    add("soft_kept_soft", !hard.length, `${n.who ?? "house"}: "${n.text}" saved as ${hard.map((r) => `${r.kind} ${JSON.stringify(r.items ?? [])}`).join(", ")}`);
  }
  for (const n of t.softNotes.filter((x) => x.often))
    add("rule_frequency", s.rules.some((r) => (!n.who || (r.who && sameName(n.who, r.who))) && n.re.test(JSON.stringify([r.note ?? "", r.items ?? [], r.to ?? ""]))
      && (r.often === n.often || (!!n.per_week && r.per_week != null && r.per_week >= n.per_week[0] && r.per_week <= n.per_week[1]))),
      `${n.who}: "${n.text}" saved without often=${n.often}`);
  // Dishes
  const wrong: string[] = [];
  for (const d of s.dishes) {
    if (!d.for?.length) continue;
    const td = truthDishOf(d.name, t.dishes);
    if (!td?.for) wrong.push(`${d.name} [${d.for.join("+")}]`);
  }
  add("dish_no_wrong_restriction", !wrong.length, `restricted though everyone's: ${wrong.join(", ")}`);
  for (const td of t.dishes.filter((x) => x.for)) {
    const got = s.dishes.find((d) => truthDishOf(d.name, t.dishes) === td);
    add("personal_dishes", !!got && namesEq(td.for, got.for ?? []), `${td.name} for ${td.for!.join("+")}: ${got ? `saved for ${JSON.stringify(got.for ?? "everyone")}` : "not saved"}`);
  }
  for (const td of t.dishes) {
    const got = s.dishes.find((d) => truthDishOf(d.name, t.dishes) === td);
    add("dish_coverage", !!got);
    if (got) add("dish_slots", td.slots.some((ts) => got.slots.some((x) => slotOk(h, ts, x))), `${td.name} at ${got.slots.join(",")} (want ${td.slots.join(",")})`);
    if (td.often || td.per_week || td.days) {
      const ok = !!got && (!td.often || got.often === td.often || (oftenMax(td.often) !== null && got.per_week !== undefined && got.per_week <= oftenMax(td.often)!))
        && (!td.per_week || got.per_week === td.per_week) && (!td.days || setEq(td.days, got.days ?? []));
      add("dish_frequency", ok, `${td.name} (${[td.often, td.per_week && `${td.per_week}/wk`, td.days?.join(",")].filter(Boolean).join(", ")}): ${got ? `saved ${JSON.stringify({ often: got.often, per_week: got.per_week, days: got.days })}` : "not saved"}`);
    }
  }
  // Meal examples: one for each main meal the family described
  for (const slot of ["Breakfast", "Lunch", "Dinner"]) {
    if (!t.examples.some((e) => e.slot === slot)) continue;
    add("meal_examples", s.examples.some((e) => e.slot.toLowerCase() === slot.toLowerCase()), `no ${slot} example`);
  }
  return { rates, notes };
}

/** Field rates summed over households. */
export function totals(scores: Rates[]): Rates {
  const out: Rates = {};
  for (const r of scores) for (const [k, [p, n]] of Object.entries(r)) { const o = (out[k] ??= [0, 0]); o[0] += p; o[1] += n; }
  return out;
}
export const pct = ([p, n]: [number, number]) => (n ? `${Math.round((100 * p) / n)}% (${p}/${n})` : "n/a");
