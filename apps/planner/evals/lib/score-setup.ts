// Eval 1's scorecard (spec §8): apply_setup's rows (result.ts SetupOut) against TRUTH, field by field, in code. Every field
// is a pass rate over the things it counts; a field that does not apply to a household counts nothing there. `info` fields
// are reported but not gating (the persona may not name every dish).
import type { SavedPart, SavedRule, SavedSlot, SavedTarget, SetupOut } from "./result";
import { canonTag, itemCovers, tagsOfName } from "./vocab";
import { catalogKindNamed, isBareKindWord, kindOf as catalogKindOf } from "./catalog";
import { weeklyPeople } from "./truth-setup";
import {
  MAIN_SLOTS, WEEK, dayOf, dishNameOf, namelessCook, plain, sameDays, sameFrequency, sameName, sameNames, sameSet,
  type Household, type TruthPart, type TruthRule, type TruthSlot, type TruthTarget, type Weekday,
} from "./truth";

export type Rates = Record<string, [number, number]>;
export type SetupScore = { rates: Rates; info: Rates; notes: string[] };

const lc = (s: string) => s.trim().toLowerCase();

/** truth slot name → saved slot name. A main slot by its name; a custom or add-on slot by its name or its pattern, one
 *  saved slot per truth slot, same-kind first. */
export function slotMap(truth: TruthSlot[], saved: SavedSlot[]): Map<string, string> {
  const out = new Map<string, string>(), used = new Set<string>();
  const take = (t: TruthSlot, s?: SavedSlot) => { if (s) { out.set(t.name, s.name); used.add(s.name); } };
  for (const t of truth) take(t, saved.find((s) => !used.has(s.name) && lc(s.name) === lc(t.name)));
  for (const t of truth.filter((x) => !out.has(x.name) && x.kind !== "main" && x.match)) {
    const cands = saved.filter((s) => !used.has(s.name) && s.kind !== "main" && t.match!.test(s.name));
    take(t, cands.find((s) => s.kind === t.kind && (!t.addon_of || lc(s.addon_of ?? "") === lc(t.addon_of))) ?? cands.find((s) => s.kind === t.kind) ?? cands[0]);
  }
  return out;
}

/** A rule in one form: veg / no_eggs / egg as avoid with their items, `only` on some days as avoid on the other days. */
export function effective(r: { what: string; items?: string[] | null; days?: string[] | null }): { what: string; items: string[]; days: Weekday[] | null } {
  const days = r.days?.length ? r.days.map(dayOf) : null;
  const items = (r.items ?? []).map(canonTag);
  switch (r.what) {
    case "veg": return { what: "avoid", items: [...new Set(["meat", "fish", ...items])], days };
    case "egg": return { what: "avoid", items: [...new Set(["meat", "fish", ...items])], days };
    case "no_eggs": return { what: "avoid", items: [...new Set(["egg", ...items])], days };
    case "only": return days ? { what: "avoid", items, days: WEEK.filter((d) => !days.includes(d)) } : { what: "only", items, days };
    default: return { what: r.what, items, days };
  }
}

/** The family's own words: every reply, and Flock's household facts. Normalised for substring checks. */
export const normWords = (s: string) => ` ${s.toLowerCase().replace(/[’']/g, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim()} `;
export function familyWords(h: Household, transcript: string[] = []): string {
  return normWords([...transcript.filter((l) => l.startsWith("A:")).map((l) => l.slice(2)), JSON.stringify(h.household)].join(" \n "));
}

type Ctx = { h: Household; map: Map<string, string>; back: Map<string, string> };
const truthSlotName = (c: Ctx, saved: string) => c.back.get(saved) ?? saved;
const whoOk = (c: Ctx, t: TruthRule, s: SavedRule) => {
  if (t.who) return !!s.who && sameName(t.who, s.who);
  if (!s.who) return true;
  // A rule of a person's own slot (a child's tiffin) may name that person.
  return !!t.slots?.length && t.slots.every((x) => c.h.truth.slots.find((y) => y.name === x)?.usual_people?.some((p) => sameName(p, s.who!)));
};
const slotsOk = (c: Ctx, t: TruthRule, s: SavedRule) => {
  const saved = (s.slots ?? []).map((x) => truthSlotName(c, x));
  if (!t.slots?.length) return !saved.length || sameSet(saved.map(lc), c.h.truth.slots.filter((x) => !x.optional).map((x) => lc(x.name)));
  return sameSet(t.slots.map(lc), saved.map(lc));
};
const kindsOf = (t: TruthRule) => new Set([effective(t).what, t.what, ...(t.also ?? [])]);

/** Is truth rule `t` saved: the saved rules of its kind, person, days and slots together cover its items (a vegetarian
 *  grandmother saved as veg + no_eggs covers meat, fish, egg). Fasting: same person, days, slots, and food-or-none. */
export function ruleSaved(c: Ctx, t: TruthRule, rules: SavedRule[]): SavedRule[] {
  const te = effective(t), kinds = kindsOf(t);
  const scoped = rules.filter((s) => {
    const se = effective(s);
    return (kinds.has(se.what) || kinds.has(s.what)) && whoOk(c, t, s) && sameDays(te.days, se.days) && slotsOk(c, t, s);
  });
  if (!scoped.length) return t.who ? [] : perPerson(c, t, rules);
  if (t.what === "fasting") return scoped.filter((s) => !!s.fasting_food?.length === !!t.fasting_food?.length);
  if (t.what === "note") return [];
  if (!te.items.length) return scoped;
  const items = scoped.flatMap((s) => effective(s).items);
  if (!te.items.every((ti) => items.some((si) => itemCovers(si, ti)))) return [];
  if (t.what === "swap" && t.to) return scoped.filter((s) => !s.to || s.what !== "swap" || itemCovers(canonTag(s.to), canonTag(t.to!)) || lc(s.to).includes(lc(t.to!)) || effective({ what: "x", items: [s.to] }).items.some((x) => itemCovers(x, canonTag(t.to!))));
  return scoped;
}

/** A whole-house avoid kept as one rule per person: met when, for every person at home, the saved rules that hold for them
 *  on the truth's days (theirs or the house's, every day or on those days) cover its items. "The three of us eat chicken only
 *  on Sunday" saved per person, with the vegetarian grandparents' own veg rules, keeps "no meat Mon–Sat" for the house. */
function perPerson(c: Ctx, t: TruthRule, rules: SavedRule[]): SavedRule[] {
  const te = effective(t);
  if (te.what !== "avoid" || !te.items.length || t.slots?.length) return [];
  const used = new Set<SavedRule>();
  for (const p of c.h.truth.people) {
    const hold = rules.filter((s) => {
      const se = effective(s);
      if (se.what !== "avoid" || (s.who && !sameName(s.who, p.name)) || s.slots?.length) return false;
      return !se.days || (!!te.days && te.days.every((d) => se.days!.includes(d)));
    });
    const items = hold.flatMap((s) => effective(s).items);
    if (!te.items.every((ti) => items.some((si) => itemCovers(si, ti)))) return [];
    hold.forEach((s) => used.add(s));
  }
  // Only per-person rules make this a different shape from the plain match: at least one must name a person.
  return [...used].some((s) => s.who) ? [...used] : [];
}

/** A soft rule (or a note) found: a saved rule of that person whose quote says it, or whose items cover it. */
export function softSaved(c: Ctx, t: TruthRule, rules: SavedRule[]): SavedRule[] {
  const structural = t.what === "note" ? [] : ruleSaved(c, t, rules);
  if (structural.length) return structural;
  return rules.filter((s) => whoOk(c, t, s) && (t.quote.test(s.quote) || t.quote.test(JSON.stringify(s.items ?? [])) || (!!t.items?.length && (s.items ?? []).some((i) => t.items!.some((ti) => itemCovers(i, ti) || itemCovers(ti, i))))));
}

/** A TRUTH target is a saved one (spec §5.2): the same type and words; an item's kind is compared only when TRUTH gives it. */
const targetIs = (t: TruthTarget, x: SavedTarget): boolean =>
  "ingredient" in t ? x.type === "ingredient" && canonTag(x.tag) === canonTag(t.ingredient)
  : "item" in t ? x.type === "item" && plain(x.item) === plain(t.item) && (!t.kind || lc(x.kind ?? "") === lc(t.kind))
  : "sub" in t ? x.type === "sub" && lc(x.kind) === lc(t.kind) && lc(x.sub) === lc(t.sub)
  : x.type === "kind" && lc(x.kind) === lc(t.kind);
/** A saved rule holds all of TRUTH's targets (and gives, for a swap) when TRUTH states them; one saved untyped does not. */
const hasTargets = (t: TruthRule, x: SavedRule): boolean =>
  (!t.targets?.length || (!!x.targets?.length && t.targets.every((tt) => x.targets!.some((xt) => targetIs(tt, xt)))))
  && (!t.gives || (!!x.gives && targetIs(t.gives, x.gives)));

/** A saved rule the family said: it loosely matches a truth rule or a noted item (same person, the words or an item). */
function explained(c: Ctx, s: SavedRule): boolean {
  for (const t of c.h.truth.rules) {
    if (t.who && !(s.who && sameName(t.who, s.who))) continue;
    if (t.quote.test(s.quote)) return true;
    if (t.what === "fasting" && s.what === "fasting") return true;
    const ti = effective(t).items, si = effective(s).items;
    if (si.some((a) => ti.some((b) => itemCovers(a, b) || itemCovers(b, a)))) return true;
  }
  return (c.h.truth.noted ?? []).some((n) => (!n.who || (s.who && sameName(n.who, s.who))) && n.re.test(s.quote));
}

export function scoreSetup(h: Household, s: SetupOut, o: { transcript?: string[] } = {}): SetupScore {
  const t = h.truth, rates: Rates = {}, info: Rates = {}, notes: string[] = [];
  const add = (field: string, ok: boolean, why?: string, into = rates) => {
    const r = (into[field] ??= [0, 0]); r[1]++; if (ok) r[0]++; else if (why) notes.push(`${field}: ${why}`);
  };
  const required = t.slots.filter((x) => !x.optional);
  const map = slotMap(t.slots, s.slots);
  const back = new Map([...map].map(([a, b]) => [b, a]));
  const c: Ctx = { h, map, back };
  const everyone = t.people.map((p) => p.name);

  // ── Slots ──
  for (const ts of required) {
    const name = map.get(ts.name), got = s.slots.find((x) => x.name === name);
    add("slots_present", !!got, `${ts.name} missing (saved: ${s.slots.map((x) => x.name).join(", ")})`);
    if (!got) continue;
    add("slot_kind", got.kind === ts.kind && (ts.kind !== "addon" || (!!got.addon_of && lc(got.addon_of) === lc(map.get(ts.addon_of!) ?? ts.addon_of!))),
      `${got.name}: ${got.kind}${got.addon_of ? ` of ${got.addon_of}` : ""} (want ${ts.kind}${ts.addon_of ? ` of ${ts.addon_of}` : ""})`);
    const want = ts.usual_people ?? [];
    const peopleOk = want.length ? sameNames(want, got.usual_people) : !got.usual_people.length || sameNames(everyone, got.usual_people);
    add("slot_people", peopleOk, `${got.name} for ${JSON.stringify(got.usual_people)} (want ${want.length ? JSON.stringify(want) : "everyone"})`);
    add("slot_days", sameDays(ts.days, got.days), `${got.name} on ${JSON.stringify(got.days)} (want ${JSON.stringify(ts.days ?? "every day")})`);
    const sk = (xs: { day: string; skip: string }[] = []) => xs.map((x) => `${dayOf(x.day)} ${x.skip}`);
    add("skip_days", sameSet(sk(ts.skip_days), sk(got.skip_days)), `${got.name} skips ${JSON.stringify(sk(got.skip_days))} (want ${JSON.stringify(sk(ts.skip_days))})`);
  }
  const optionalNames = new Set(t.slots.filter((x) => x.optional).map((x) => map.get(x.name)).filter(Boolean));
  const extra = s.slots.filter((x) => !back.has(x.name) && !optionalNames.has(x.name));
  add("no_extra_slots", !extra.length, `not said: ${extra.map((x) => x.name).join(", ")}`);

  // ── Weekday attendance (when the adapter can read it) ──
  if (s.attendance) {
    for (const ts of required.filter((x) => x.kind === "main" && (x.name === "Lunch" || t.away.some((a) => a.slots.includes(x.name))))) {
      const got = s.attendance[map.get(ts.name) ?? ts.name];
      for (const day of WEEK) {
        const want = weeklyPeople(h, ts, day), have = got?.[day];
        add("attendance", !!have && sameNames(want, have), `${ts.name} ${day}: ${JSON.stringify(have)} (want ${JSON.stringify(want)})`);
      }
    }
  }
  add("lunch_unclear", sameNames(t.lunchUnclear ?? [], s.lunch_unclear), `asked about ${JSON.stringify(s.lunch_unclear)} (want ${JSON.stringify(t.lunchUnclear ?? [])})`);

  // ── Cook and family cooks ──
  if (t.cook) {
    // A TRUTH cook named only by her role ("Cook") is nameless: the saved one must be too (spec §6.3: never a role as a name).
    const nameOk = !!s.cook && (namelessCook(t.cook.name) ? !s.cook.name : !!s.cook.name && sameName(s.cook.name, t.cook.name));
    add("cook_days", nameOk && sameDays(t.cook.days, s.cook!.days), JSON.stringify(s.cook && { name: s.cook.name, days: s.cook.days }));
    // A visit TRUTH gives no time for (the household did not say when she comes) is not compared; the ones with a time are.
    const timed = t.cook.visits.filter((v) => v.at);
    const visitsOk = !!s.cook && (s.cook.visits.length === t.cook.visits.length || timed.length < t.cook.visits.length) && timed.every((v) => s.cook!.visits.some((x) => x.at === v.at && sameSet(v.meals.map(lc), (x.meals ?? []).map(lc))));
    add("cook_times", visitsOk, `${JSON.stringify(s.cook?.visits)} (want ${JSON.stringify(t.cook.visits)})`);
  } else add("cook_days", !s.cook || (!!s.cook.name && t.people.some((p) => sameName(p.name, s.cook!.name!))), `a paid cook saved: ${s.cook?.name ?? "(no name)"}`);
  for (const fc of t.familyCooks) {
    const days = fc.days.filter((d) => !t.cook?.days.includes(d));
    const ok = days.every((d) => s.family_cooks.some((x) => sameName(x.person, fc.person) && x.days.map(dayOf).includes(d)));
    add("family_cooks", ok, `${fc.person} on ${days.join(",")}: ${JSON.stringify(s.family_cooks)}`);
  }

  // ── Library ──
  const said = t.library.filter((d) => !d.unsaid);
  // Saved rows are recognised among every truth dish (an unsaid "Curd" is not "Curd rice"); only said ones are required.
  const names = [...new Set(t.library.map((d) => d.name))];
  const aka = new Map(t.library.flatMap((d) => (d.aka ?? []).map((a) => [a, d.name] as const)));
  const nameOf = (x: string) => { const n = dishNameOf(x, [...names, ...aka.keys()]); return n ? aka.get(n) ?? n : null; };
  const rowsOf = (name: string) => s.library.filter((x) => nameOf(x.name) === name);
  const slotsOfTruth = (name: string) => t.library.filter((d) => d.name === name).flatMap((d) => [d.slot, ...(d.alsoSlots ?? [])]).map(lc);
  const kindOf = (slot: string) => t.slots.find((x) => lc(x.name) === lc(slot))?.kind ?? "main";
  for (const name of new Set(said.map((d) => d.name))) add("dish_coverage", rowsOf(name).length > 0, undefined, info);
  for (const d of said) {
    const rows = rowsOf(d.name);
    if (!rows.length) continue;
    const at = rows.filter((x) => [d.slot, ...(d.alsoSlots ?? [])].some((y) => lc(truthSlotName(c, x.slot)) === lc(y)));
    add("placement", at.length > 0, `${d.name} at ${rows.map((x) => x.slot).join(",")} (want ${d.slot})`);
    // A person's own dish (a custom or add-on slot's) is saved there and not on the shared slot.
    if (kindOf(d.slot) !== "main") {
      const shared = rows.filter((x) => kindOf(truthSlotName(c, x.slot)) === "main" && !slotsOfTruth(d.name).includes(lc(truthSlotName(c, x.slot))));
      add("personal_placement", at.length > 0 && !shared.length, `${d.name} (${d.slot}'s) saved at ${rows.map((x) => x.slot).join(",")}`);
    }
    if (d.frequency || d.days) {
      // Several saved rows may be this one dish ("Aloo paratha" and "Paratha", "Maacher jhol" and "Rui fish curry"): one of them
      // on its slot carrying the frequency and days is enough.
      const ok = (row: (typeof rows)[number]) => sameFrequency(row.frequency, d.frequency) && (!d.days || sameDays(d.days, row.days)) && (!!d.days || !row.days?.length);
      const row = (at.length ? at : rows).find(ok) ?? at[0] ?? rows[0];
      add("dish_frequency", ok(row), `${d.name}: saved ${JSON.stringify({ frequency: row.frequency, days: row.days })} (want ${JSON.stringify({ frequency: d.frequency ?? null, days: d.days ?? null })})`);
    }
  }
  // Every saved row of a family dish on one of its own slots; a shared dish never saved as a person's own.
  for (const x of s.library) {
    const name = nameOf(x.name);
    if (!name) continue;
    const slot = lc(truthSlotName(c, x.slot));
    add("rows_on_right_slot", slotsOfTruth(name).includes(slot), `${x.name} saved at ${x.slot} (want ${slotsOfTruth(name).join(",")})`);
    if (kindOf(slot) !== "main" && !slotsOfTruth(name).includes(slot)) add("no_wrong_personal", false, `${x.name} saved as ${x.slot}'s`);
    const td = t.library.find((d) => d.name === name && lc(d.slot) === slot);
    if (td && !td.frequency && !td.days) add("no_unsaid_frequency", !x.frequency && !x.days?.length, `${x.name} at ${x.slot} saved with ${JSON.stringify({ frequency: x.frequency, days: x.days })}`);
  }
  if (!rates.no_wrong_personal) add("no_wrong_personal", true);

  // ── One meaning model (spec §5.1, §5.3, §7): a category word is never a library row, nor a filling a kind ──
  const truthParts = (t.meals ?? []).flatMap((m) => m.templates.flatMap((tp) => tp.parts));
  const partWords = new Set(truthParts.flatMap((p) => ("words" in p && p.words ? [plain(p.words)] : [])));
  // Their dishes: a fixed-dishes part's, and a kind part's one dish (their word "pithla" is the dish Pithla).
  const itemDishes = new Set(truthParts.flatMap((p) => ("items" in p ? p.items.map(plain) : "dish" in p && p.dish ? [plain(p.dish)] : [])));
  if (partWords.size) for (const x of s.library) add("real_dish", !partWords.has(plain(x.name)) || itemDishes.has(plain(x.name)), `${x.name} saved as a dish at ${x.slot}: it is their word for a part`);
  // A filling said with a kind ("paratha with egg or cheese inside") is an item of that kind, never a kind of the family's own.
  const fillings = new Set(truthParts.flatMap((p) => ("items" in p ? p.items.flatMap((it) => plain(it).split(" ").filter((w) => tagsOfName(w).size > 0)) : [])));
  if (fillings.size) {
    const ownKinds = [...new Set(s.slots.flatMap((sl) => [...(sl.kinds ?? []).filter((k) => k.own).map((k) => k.name),
      ...(sl.templates ?? []).flatMap((tp) => tp.parts.flatMap((p) => ("kind" in p && !("from" in p) && !catalogKindNamed(p.kind) ? [p.kind] : [])))]))];
    const bad = ownKinds.filter((k) => fillings.has(plain(k)));
    add("no_filling_kind", !bad.length, `a filling saved as a kind of their own: ${bad.join(", ")}`);
  }

  // ── Rules ──
  for (const r of t.rules) {
    if (r.hardAny) {
      const got = ruleSaved(c, r, s.rules).filter((x) => r.per_meal == null || x.per_meal === r.per_meal);
      add("soft_rules", got.length > 0 || softSaved(c, r, s.rules).some((x) => r.per_meal == null || x.per_meal === r.per_meal), `missing: ${r.title}`);
    } else if (r.hard) {
      const got = ruleSaved(c, r, s.rules);
      // Where TRUTH names what the rule is about (a kind, an item, a swap's item), the saved rule's typed targets are compared too.
      const typed = got.some((x) => hasTargets(r, x));
      add("hard_rules", got.length > 0 && typed, got.length ? `${r.title}: saved targets ${JSON.stringify(got.map((x) => ({ targets: x.targets, gives: x.gives })))} (want ${JSON.stringify({ targets: r.targets, gives: r.gives })})` : `missing: ${r.title}`);
      if (got.length) add("hard_soft", got.every((x) => x.hard), `${r.title} saved as soft`);
    } else {
      const got = softSaved(c, r, s.rules);
      add("soft_rules", got.length > 0, `missing: ${r.who ?? "house"}: ${r.title}`);
      if (got.length) add("hard_soft", got.some((x) => !x.hard), `${r.title} saved as hard: ${JSON.stringify(got.map((x) => `${x.what} ${JSON.stringify(x.items)}`))}`);
      if (got.length && r.frequency) add("rule_frequency", got.some((x) => sameFrequency(x.frequency, r.frequency)), `${r.title}: frequency ${JSON.stringify(got.map((x) => x.frequency))} (want ${r.frequency})`);
    }
  }
  const unsaid = s.rules.filter((x) => !explained(c, x));
  add("no_unsaid_rules", !unsaid.length, `not said: ${JSON.stringify(unsaid.map((x) => ({ what: x.what, who: x.who, items: x.items, quote: x.quote })))}`);
  for (const x of s.rules.filter((y) => y.hard)) add("hard_no_frequency", !x.frequency, `hard ${x.what} ${JSON.stringify(x.items)} saved with frequency ${x.frequency}`);
  if (o.transcript) {
    const words = familyWords(h, o.transcript);
    for (const x of s.rules) add("rule_quotes", !!x.quote.trim() && words.includes(normWords(x.quote)), `quote not in their words: "${x.quote}"`);
  }
  for (const n of t.noted ?? []) {
    const kept = s.unplaced.some((u) => n.re.test(`${u.text} ${u.quote ?? ""}`)) || s.rules.some((x) => n.re.test(x.quote) && !x.days?.length && (!n.who || (!!x.who && sameName(n.who, x.who))));
    const invented = s.rules.some((x) => x.what === "fasting" && n.re.test(x.quote) && !!x.days?.length && x.days.every((d) => WEEK.includes(dayOf(d))));
    add("noted", kept && !invented, invented ? `${n.id} saved as a weekday fast` : `${n.id} not kept`);
  }

  // ── Kinds model (owner, 25 Nov): the cuisine profile, and each meal's templates in kinds terms ──
  // Read through the adapter (house.cuisines, slots.kinds / templates); a field the adapter cannot read (undefined) is not
  // scored, one not read yet (null) scores its misses.
  if (t.cuisines?.length && s.cuisines !== undefined) {
    const got = [...new Set((s.cuisines ?? []).map(lc))], want = t.cuisines.map(lc), also = (t.cuisinesAlso ?? []).map(lc);
    for (const x of want) add("cuisines", got.includes(x), `${x} not in the profile (read ${JSON.stringify(got)})`);
    for (const x of got) if (!want.includes(x) && !also.includes(x)) add("cuisines", false, `${x} read, not theirs (want ${JSON.stringify(want)})`);
  }
  for (const meal of t.meals ?? []) {
    const got = s.slots.find((x) => x.name === map.get(meal.slot));
    if (!got || got.templates === undefined) continue;
    for (const tt of meal.templates) {
      const hit = (got.templates ?? []).find((st) => sameParts(tt.parts, st.parts));
      add("templates", !!hit, `${meal.slot}: [${partsText(tt.parts)}] not saved (saved: ${(got.templates ?? []).map((x) => `[${partsText(x.parts)}]`).join(" ") || "none"})`);
      // Where TRUTH names a sub-kind (sambar and rasam), the saved part names it too: reported, not gating.
      if (hit) { const subs = (ps: readonly (TruthPart | SavedPart)[]) => ps.flatMap((p) => ("kind" in p && !("from" in p) && p.sub ? [`${lc(p.kind)}/${lc(p.sub)}`] : [])).sort();
        if (subs(tt.parts).length) add("template_subs", subs(tt.parts).every((x) => subs(hit.parts).includes(x)), `${meal.slot}: [${partsText(tt.parts)}] saved as [${partsText(hit.parts)}]`, info); }
    }
    for (const k of meal.staples ?? []) add("template_staples", !!got.kinds?.some((x) => lc(x.name) === lc(k) && x.staple), `${meal.slot}: ${k} not a staple (kinds ${JSON.stringify(got.kinds ?? null)})`);
  }

  // ── Seed history ──
  for (const slot of [...new Set(t.seed.map((x) => x.slot))]) {
    const saved = map.get(slot) ?? slot;
    add("seed_present", s.seed.some((x) => lc(x.slot) === lc(saved) && x.dishes.length > 0), `no seed for ${slot}`);
  }
  // History keeps the family's words (spec §5.3: a category word is no library row, but a past plate says "rice, sambar"):
  // a seed dish is the slot's when it is one of its library dishes, a word of its TRUTH template parts, or a coarse kind's
  // own word ("Bhaji", "Fish") of a kind those parts name.
  const kindParts = (slot: string) => (t.meals ?? []).filter((m) => lc(m.slot) === lc(slot)).flatMap((m) => m.templates.flatMap((tp) => tp.parts))
    .flatMap((p) => ("kind" in p && !("from" in p) ? [p] : []));
  const seedWord = (slot: string, d: string) => {
    const ps = kindParts(slot), w = plain(d), hit = catalogKindOf(d);
    return ps.some((p) => [p.kind, ...(p.sub ? [p.sub, ...p.sub.split("/")] : []), ...(p.words ? [p.words] : [])].map(plain).includes(w))
      || (isBareKindWord(d) && !!hit && ps.some((p) => p.kind === hit.kind));
  };
  for (const row of s.seed) {
    const slot = truthSlotName(c, row.slot);
    const own = row.dishes.filter((d) => { const n = nameOf(d); return (!!n && slotsOfTruth(n).includes(lc(slot))) || seedWord(slot, d); });
    add("seed_on_slot", own.length * 2 >= row.dishes.length, `${row.slot} seed ${JSON.stringify(row.dishes)}: mostly not ${row.slot} dishes`);
  }
  return { rates, info, notes };
}

/** A template's parts as text: "Rice, Rice curry/Sambar, items(Rajma chawal), from Lunch/Sabzi". */
const partsText = (ps: readonly (TruthPart | SavedPart)[]) => ps.map((p) => ("items" in p ? `items(${p.items.join(", ")})` : "from" in p ? `from ${p.from}${p.kind ? `/${p.kind}` : ""}` : `${p.kind}${p.sub ? `/${p.sub}` : ""}${p.words ? ` "${p.words}"` : ""}${p.dish ? ` =${p.dish}` : ""}`)).join(", ");
/** The same plate in kinds terms, part for part: a kind part by its kind (sub-kinds are not compared here: template_subs reports
 *  them) and, where TRUTH gives them, its `words` and `dish`; a linked part by its meal and kind; a fixed-dishes part of TRUTH by
 *  a saved one holding one of its dishes. */
export function sameParts(want: readonly (TruthPart | SavedPart)[], got: readonly (TruthPart | SavedPart)[] = []): boolean {
  if (want.length !== got.length) return false;
  const key = (p: TruthPart | SavedPart) => ("items" in p ? "items" : "from" in p ? `from ${lc(p.from)} ${lc(p.kind ?? "")}` : lc(p.kind));
  const fits = (w: TruthPart | SavedPart, g: TruthPart | SavedPart): boolean => {
    // Lead's OD5 ruling: a named catalog dish said alone ("egg curry on saturdays") may be saved {kind, dish} (its kind's other
    // items offered as new): it is TRUTH's items(X) when its dish is X and its kind is X's (catalog or none known).
    if ("items" in w && "kind" in g && !("from" in g) && g.dish) {
      const k = catalogKindOf(g.dish)?.kind;
      return w.items.some((x) => plain(x) === plain(g.dish!)) && (!k || lc(k) === lc(g.kind));
    }
    if (key(w) !== key(g)) return false;
    if ("items" in w) return w.items.some((x) => !!dishNameOf(x, (g as { items: string[] }).items));
    if ("from" in w) return true;
    const gk = g as { words?: string; dish?: string };
    return (!w.words || plain(gk.words ?? "") === plain(w.words)) && (!w.dish || plain(gk.dish ?? "") === plain(w.dish));
  };
  const used = new Set<number>();
  return want.every((w) => { const i = got.findIndex((g, j) => !used.has(j) && fits(w, g)); if (i < 0) return false; used.add(i); return true; });
}

/** Field rates summed over households. */
export function totals(scores: Rates[]): Rates {
  const out: Rates = {};
  for (const r of scores) for (const [k, [p, n]] of Object.entries(r)) { const o = (out[k] ??= [0, 0]); o[0] += p; o[1] += n; }
  return out;
}
export const pct = ([p, n]: [number, number]) => (n ? `${Math.round((100 * p) / n)}% (${p}/${n})` : "n/a");
export { MAIN_SLOTS };
