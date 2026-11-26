// Eval 2's scorecard (spec §8): one planned week (result.ts PlanOut) against TRUTH, in code. Gating fields are pass rates;
// `tracked` fields (shape: dish count vs history) are reported, never gating (spec §1 non-goals). Hard rules are checked
// per person on each slot-day against what each dish contains, failing closed: a tag nobody read counts as a break.
import type { PlanOut, PlanSlotDay, SavedDish, SetupOut } from "./result";
import { meanDishes, staplesOf, type HistoryRow } from "./history";
import { truthTags, weeklyPeople } from "./truth-setup";
import { canonTag, hasItem, PARENT, tagsOfName } from "./vocab";
import { slotMap, type Rates } from "./score-setup";
import { isBareKindWord, isStapleKind, kindOf, mainTagsOf } from "./catalog";
import {
  WEEK, dateOf, dayOf, dishNameOf, frequencyRange, plain, sameName, sameNames, schoolLunchAway, weekdayOfDate,
  type Household, type Skip, type TruthDish, type TruthRule, type TruthSlot, type Weekday,
} from "./truth";


/** The scorer's own words for a plate (owner, 25 Nov base minimum). Bread or rice, on its own or in a dish's name. */
const BREAD_RICE = ["roti", "rotis", "bhakar", "bhaat", "bhat", "poli", "chapatis", "rotli", "fulka", "luchi", "kulcha", "chapati", "chapathi", "phulka", "paratha", "parotta", "puri", "poori", "bhakri", "naan", "luchi", "rice", "chawal", "appam", "dosa", "idiyappam", "thepla", "bread", "kulcha", "bhature", "ragi", "millet"];
/** A one-pot dish is a whole plate on its own. */
const ONE_POT = ["khichdi", "khichuri", "pulao", "pulav", "biryani", "pongal", "bisibele", "bisi", "tehri", "upma", "poha", "chawal", "noodles", "pasta", "thali",
  // A dosa-family dish is a meal with its chutney or sambar.
  "dosa", "uthappam", "uttapam", "idli", "pesarattu", "adai", "appam", "idiyappam", "paniyaram"];
/** A dish that is only a staple (a plate of these alone is bare). */
const PLAIN_STAPLES = ["roti", "rotis", "bhakri", "bhakar", "bhaat", "bhat", "poli", "rotli", "fulka", "chapati", "phulka", "rice", "plain", "steamed", "curd", "dahi", "salad", "papad", "pickle", "achar", "raita", "buttermilk", "chaas", "bread"];
export const OWN_SHARE = 0.3;
/** A dish that is mostly onion, by its name (owner rule 7: onion, pyaaz, kanda, vengayam, ulli). */
const MOSTLY_ONION = /\b(onions?|pyaa?z|pyaza|kanda|vengaya\w*|ulli)\b/i;
/** A dish's note says it is made without onion and garlic, or the person's portion kept aside (owner rule 7). */
/** A dish's note says it is made without something for this person (decided 21: "make without cashews for Anya"), or for the
 *  whole house when no one is named ("make without peanuts"). */
const withoutNoted = (note: string | null | undefined, person: string): boolean =>
  !!note && note.split(/;\s*/).some((n) => /\bwithout\b/i.test(n)
    && (new RegExp(`\\b${person.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(n) || !/\bfor\b/i.test(n)));
const onionNoted = (note: string | null | undefined, person: string): boolean =>
  !!note && note.split(/;\s*/).some((n) => /without onion/i.test(n) && /portion aside/i.test(n) && new RegExp(`\\b${person.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(n));
export const NEW_WHY_MAX = 60;

export type ExpectedSlotDay = { day: Weekday; date: string; slot: string; people: string[]; guests: number; guestItems: string[]; skip: Skip | null; fastingWithFood: string[] };

const lc = (s: string) => s.trim().toLowerCase();

/** The slot-days TRUTH expects for the week (spec §5.1): each slot on its days, its usual people minus weekly absences,
 *  ± the week's stays and trips, minus anyone fasting without fasting food, its recurring skip (an add-on follows its
 *  main slot), and the week's guests. A slot-day with nobody on it is not expected. */
export function expectedSlotDays(h: Household, monday: string): ExpectedSlotDay[] {
  const t = h.truth, out: ExpectedSlotDay[] = [];
  const mainOf = (s: TruthSlot) => (s.kind === "addon" ? t.slots.find((x) => x.name === s.addon_of) ?? s : s);
  for (const s of t.slots.filter((x) => !x.optional)) {
    const base = mainOf(s);
    for (const day of s.days?.length ? s.days : WEEK) {
      let people = weeklyPeople(h, s, day);
      for (const e of t.week ?? []) {
        if (e.kind === "guests" || !e.days.includes(day)) continue;
        const hits = e.slots?.length ? e.slots.includes(s.name) || e.slots.includes(base.name) : s.kind !== "custom" || e.kind === "away";
        if (!hits) continue;
        // A stay adds the person to the shared slots only (an add-on is someone's own meal).
        if (e.kind === "stay" && s.kind === "main" && !people.some((p) => sameName(p, e.person))) people = [...people, e.person];
        if (e.kind === "away") people = people.filter((p) => !sameName(p, e.person));
      }
      // A school-going child is away at the weekday lunch (owner, 26 Nov), whatever TRUTH says about coming home.
      if (s.kind === "main" && /^lunch$/i.test(s.name)) people = people.filter((p) => !schoolLunchAway(h, p, day));
      const fasting = t.rules.filter((r) => r.hard && r.what === "fasting" && r.who && r.days?.includes(day) && (!r.slots?.length || r.slots.includes(s.name) || r.slots.includes(base.name)));
      const withFood = fasting.filter((r) => r.fasting_food?.length).map((r) => r.who!);
      people = people.filter((p) => !fasting.some((r) => !r.fasting_food?.length && sameName(r.who!, p)));
      const skip = (base.skip_days ?? []).find((x) => x.day === day)?.skip ?? null;
      const g = (t.week ?? []).filter((e): e is Extract<typeof e, { kind: "guests" }> => e.kind === "guests" && e.day === day && e.slot === s.name);
      const guests = g.reduce((a, e) => a + e.count, 0);
      if (!people.length && !guests && !skip) continue;
      out.push({ day, date: dateOf(monday, day), slot: s.name, people, guests, guestItems: g.flatMap((e) => e.items ?? []), skip, fastingWithFood: withFood.filter((p) => people.some((x) => sameName(x, p))) });
    }
  }
  return out;
}

export type PlanScore = { rates: Rates; tracked: Rates; notes: string[]; facts: Record<string, number | string> };

/** Score one week. `loaded`: the setup the planner was given (TRUTH, or TRUTH with a defect): its library's
 *  `contains_read` decides which tags were known (fail-closed), its seed the staples. Scoring is always against TRUTH. */
/** `o.failClosed` (default true): a dish never read for a rule's item counts as a break (Eval 2 tests that the planner fails
 *  closed). The end-to-end eval sets it false: there the question is whether a forbidden food was served, judged from the
 *  dish's read and its name; an unread one is counted in facts.unread, not as a break. */
export function scorePlan(h: Household, plan0: PlanOut, loaded: SetupOut, o: { failClosed?: boolean } = {}): PlanScore {
  // The planner's own slot names read as TRUTH's ("School tiffin" is the household's "Snack box"), as Eval 1 maps them.
  const names = new Map([...slotMap(h.truth.slots, (loaded.slots ?? []) as any)].map(([tn, sn]) => [lc(sn), tn]));
  const asTruth = (x: string) => names.get(lc(x)) ?? x;
  const plan: PlanOut = { ...plan0, slotDays: plan0.slotDays.map((sd) => ({ ...sd, slot: asTruth(sd.slot) })), library: plan0.library.map((d) => ({ ...d, slot: asTruth(d.slot) })) };
  loaded = { ...loaded, library: loaded.library.map((d) => ({ ...d, slot: asTruth(d.slot) })) };
  const t = h.truth, rates: Rates = {}, tracked: Rates = {}, notes: string[] = [], facts: PlanScore["facts"] = {};
  const add = (field: string, ok: boolean, why?: string, into = rates) => { const r = (into[field] ??= [0, 0]); r[1]++; if (ok) r[0]++; else if (why) notes.push(`${field}: ${why}`); };
  const exp = expectedSlotDays(h, plan.week_start);
  const at = (date: string, slot: string) => plan.slotDays.find((x) => x.date === date && lc(x.slot) === lc(slot));
  const truthNames = [...new Set(t.library.map((d) => d.name))];
  const history: HistoryRow[] = loaded.seed.map((r) => ({ slot: r.slot, dishes: r.dishes, date: null }));
  // The seed is the only history a fresh eval week has (planned rows never count); `daily` dishes are staples too. A staple is
  // the family's: TRUTH's seed makes them as well as the loaded one (in the end-to-end eval the loaded seed is what setup saved,
  // and a seed row setup missed must not turn the family's every-day dish into one that must rotate).
  // Only the rotation checks (section 5) use that union; the older checks keep the loaded seed's staples.
  const truthHistory: HistoryRow[] = t.seed.map((r) => ({ slot: r.slot, dishes: r.dishes, date: null }));
  const staples = new Map(t.slots.map((s) => [s.name, staplesOf(history, s.name, t.library.filter((d) => d.slot === s.name && d.frequency === "daily").map((d) => d.name))]));
  const truthStaples = new Map(t.slots.map((s) => [s.name, staplesOf(truthHistory, s.name)]));
  const isStaple = (slot: string, dish: string) => !!staples.get(slot)?.has(plain(dish));
  const isFamilyStaple = (slot: string, dish: string) => isStaple(slot, dish) || !!truthStaples.get(slot)?.has(plain(dish));
  const dayOfSd = (sd: PlanSlotDay) => weekdayOfDate(sd.date);
  const cooked = plan.slotDays.filter((x) => !x.skip && x.dishes.length);
  const words = (x: string) => plain(x).split(" ").filter(Boolean);
  const hasWord = (x: string, list: readonly string[]) => words(x).some((w) => list.includes(w));
  // One staple word ("Rice", "Phulka"), or plain or steamed rice; "Curd rice" is a dish.
  const isBareStapleName = (x: string) => { const w = words(x); return (w.length === 1 && PLAIN_STAPLES.includes(w[0])) || (w.length === 2 && ["plain", "steamed"].includes(w[0]) && PLAIN_STAPLES.includes(w[1])); };

  // ── 1. Slot-days: filled, skips kept, nothing stray, the right people ──
  for (const e of exp) {
    const sd = at(e.date, e.slot);
    if (e.skip) { add("skips_kept", !sd || (!!sd.skip && !sd.dishes.length), `${e.day} ${e.slot}: has dishes though ${e.skip}`); continue; }
    // An add-on is filled only as often as its dishes allow (owner 23 Nov, spec §5.2): an empty add-on day is right.
    if (t.slots.find((x) => x.name === e.slot)?.kind === "addon" && (!sd || (!sd.skip && !sd.dishes.length))) continue;
    add("filled", !!sd && !sd.skip && sd.dishes.length > 0, `${e.day} ${e.slot}: ${!sd ? "no slot-day" : sd.skip ? `marked ${sd.skip}` : "no dish"}`);
    if (!sd || sd.skip) continue;
    // Weekday lunch nobody said of (TRUTH's lunchUnclear): planned with or without that person, both are right.
    const unclear = lc(e.slot) === "lunch" && !["Sat", "Sun"].includes(e.day) ? (t.lunchUnclear ?? []) : [];
    const drop = (xs: string[]) => xs.filter((x) => !unclear.some((u) => sameName(u, x)));
    add("attendance", sameNames(drop(e.people), drop(sd.people)), `${e.day} ${e.slot}: for ${JSON.stringify(sd.people)} (want ${JSON.stringify(e.people)})`);
    if (e.guests || sd.guests.length) add("guests", sd.guests.reduce((a, g) => a + g.count, 0) === e.guests, `${e.day} ${e.slot}: guests ${JSON.stringify(sd.guests)} (want ${e.guests})`);
  }
  const stray = cooked.filter((x) => !exp.some((e) => e.date === x.date && lc(e.slot) === lc(x.slot) && !e.skip));
  add("no_stray", !stray.length, stray.map((x) => `${dayOfSd(x)} ${x.slot}`).join(", "));

  // ── 2. Hard rules, person by person (fail-closed) ──
  const libRow = (lib: SavedDish[], name: string, slot?: string) =>
    lib.find((d) => plain(d.name) === plain(name) && (!slot || lc(d.slot) === lc(slot))) ?? lib.find((d) => plain(d.name) === plain(name));
  /** What a planned dish has, and which tags are known. TRUTH's own dishes: TRUTH's tags, known as far as the loaded
   *  library read them. Other dishes: the planner's read. The eval's vocabulary of the planned name always counts. */
  const dishFacts = (name: string, slot: string): { tags: Set<string>; known: Set<string> } => {
    // "Dal without onion and garlic", "Chivda (no peanuts)": what a name says it is made without is not in it.
    const tags = tagsOfName(name.replace(/\(?\b(without|no|minus|sans)\b[^()]*\)?/gi, " "));
    const tn = dishNameOf(name, truthNames);
    const tdish = tn ? t.library.find((d) => d.name === tn && lc(d.slot) === lc(slot)) ?? t.library.find((d) => d.name === tn) : undefined;
    const exact = tdish && plain(tdish.name) === plain(name);
    if (tdish && exact) truthTags(tdish).forEach((x) => tags.add(x));
    const row = libRow(loaded.library, name, slot) ?? libRow(plan.library, name, slot);
    // A family dish has what the family's TRUTH says (a house that cooks without peanuts: its poha has none), not the planner's read.
    if (row && !(tdish && exact)) row.contains.map(canonTag).forEach((x) => tags.add(x));
    return { tags, known: new Set((row?.contains_read ?? []).map(canonTag)) };
  };
  const knows = (known: Set<string>, item: string) => { for (let x: string | undefined = canonTag(item); x; x = PARENT[x]) if (known.has(x)) return true; return false; };
  const binds = (r: TruthRule, sd: PlanSlotDay, e?: ExpectedSlotDay) => {
    const day = dayOfSd(sd);
    if (r.days?.length && !r.days.includes(day)) return [];
    const slot = t.slots.find((s) => lc(s.name) === lc(sd.slot));
    const base = slot?.kind === "addon" ? slot.addon_of : undefined;
    if (r.slots?.length && !r.slots.some((x) => lc(x) === lc(sd.slot) || (!!base && lc(x) === lc(base)))) return [];
    const there = [...new Set([...sd.people, ...(e?.people ?? [])])];
    return r.who ? there.filter((p) => sameName(p, r.who!)) : there;
  };
  let breaks = 0, unread = 0;
  for (const r of t.rules.filter((x) => x.hard && x.what !== "note" && x.what !== "cap")) {
    const bad: string[] = [];
    for (const sd of cooked) {
      const e = exp.find((x) => x.date === sd.date && lc(x.slot) === lc(sd.slot));
      const who = binds(r, sd, e);
      if (!who.length) continue;
      if (r.what === "fasting") {
        if (!r.fasting_food?.length) for (const p of who) bad.push(`${dayOfSd(sd)} ${sd.slot}: ${p} is fasting but planned for`);
        continue;
      }
      const items = r.what === "veg" ? ["meat", "fish", ...(r.items ?? [])] : r.what === "no_eggs" ? ["egg"] : r.items ?? [];
      if (!["avoid", "veg", "no_eggs", "egg", "swap"].includes(r.what)) continue;
      for (const d of sd.dishes) {
        const eaters = who.filter((p) => !(d.not_for ?? []).some((x) => sameName(x, p)));
        if (!eaters.length) continue;
        const f = dishFacts(d.name, sd.slot);
        for (const it of items) {
          // Owner rule 7 (decided 5): onion and garlic never block a dish; it is made without, or their portion kept aside, as
          // the dish's note says for each of them. Only a dish that is mostly onion breaks the rule.
          if (canonTag(it) === "onion_garlic" && !MOSTLY_ONION.test(d.name) && eaters.every((p) => onionNoted(d.note, p))) continue;
          // Decided 21: a catalog dish whose MAIN ingredients keep the rule is theirs when the note says it is made without the
          // rest for each of them (suji upma without cashews). A main ingredient that breaks it is a break.
          const main = mainTagsOf(d.name);
          if (main && !hasItem(new Set(main), it) && eaters.every((p) => withoutNoted(d.note, p))) continue;
          if (hasItem(f.tags, it)) bad.push(`${dayOfSd(sd)} ${sd.slot}: ${d.name} has ${it} (${eaters.join(", ")})`);
          else if (!knows(f.known, it)) { if (o.failClosed !== false) bad.push(`${dayOfSd(sd)} ${sd.slot}: ${d.name}: ${it} unread (fail-closed)`); else unread++; }
        }
      }
    }
    // A dish the app marks not for a person (code's not_for) spares their rule on it, as long as they still have a dish of
    // their own there beside the staples (owner, 23 Nov: a fish lunch with dal for the vegetarian grandmother passes).
    if (["avoid", "veg", "no_eggs", "egg"].includes(r.what)) for (const sd of cooked) {
      const e = exp.find((x) => x.date === sd.date && lc(x.slot) === lc(sd.slot));
      const mains = sd.dishes.filter((d) => !isStaple(sd.slot, d.name));
      for (const p of binds(r, sd, e)) {
        // Their own add-on beside this slot that day (her own dinner beside the family's) feeds them there.
        const own = cooked.find((x) => x.date === sd.date && x.people.some((y) => sameName(y, p))
          && t.slots.some((s) => s.kind === "addon" && lc(s.name) === lc(x.slot) && lc(s.addon_of ?? "") === lc(sd.slot)));
        if (own?.dishes.some((d) => !(d.not_for ?? []).some((x) => sameName(x, p)))) continue;
        const theirs = sd.dishes.filter((d) => !(d.not_for ?? []).some((x) => sameName(x, p)));
        if (!theirs.length || (mains.length && !theirs.some((d) => mains.includes(d)))) bad.push(`${dayOfSd(sd)} ${sd.slot}: nothing for ${p}${theirs.length ? " but staples" : ""}`);
      }
    }
    const uniq = [...new Set(bad)];
    breaks += uniq.length;
    add("hard_rules", !uniq.length, `${r.title}: ${uniq.slice(0, 4).join("; ")}${uniq.length > 4 ? ` (+${uniq.length - 4})` : ""}`);
  }
  // Guests' own rules (a vegan guest), on their slot-day only.
  for (const e of exp.filter((x) => x.guestItems.length)) {
    const sd = at(e.date, e.slot);
    if (!sd || sd.skip) continue;
    const bad = sd.dishes.filter((d) => e.guestItems.some((it) => hasItem(dishFacts(d.name, sd.slot).tags, it)));
    // A guest needs at least one dish they can eat; dishes they can't are fine beside it.
    add("guest_rules", bad.length < sd.dishes.length, `${e.day} ${e.slot}: nothing for the guests (${e.guestItems.join(", ")})`);
  }
  facts.hard_breaks = breaks;
  facts.unread_items = unread;

  // ── 3. Dishes from the slot's library, a staple, or an allowed new dish ──
  const newNames = new Set<string>();
  const newSlot = new Map<string, string>();   // new dish → the first slot it is placed at
  for (const sd of cooked) for (const d of sd.dishes) {
    const inLib = loaded.library.some((x) => lc(x.slot) === lc(sd.slot) && plain(x.name) === plain(d.name));
    const isNew = !!d.new || plan.library.some((x) => plain(x.name) === plain(d.name) && x.origin === "planner_suggested");
    if (isNew && !inLib) { newNames.add(plain(d.name)); if (!newSlot.has(plain(d.name))) newSlot.set(plain(d.name), sd.slot); }
    add("from_library", inLib || isStaple(sd.slot, d.name) || isNew, `${dayOfSd(sd)} ${sd.slot}: ${d.name} is not in ${sd.slot}'s library`);
  }
  // Owner 24 Nov (spec §5.2): a slot short of known dishes, which the planner asks the family about, gets its own new dishes
  // for its shortfall, beside the setting: its places (cooked slot-days × its usual non-staple count) less what its known
  // non-staple dishes can still fill this week (each up to its frequency's most days, else 2, less its days at other
  // slots), in dishes of up to 2 days each. Only the new dishes past that count against the setting.
  const asked = (slot: string) => (plan.asked ?? []).some((u) => lc(u).includes(lc(slot)));
  const shortAllowance = (slot: string): number => {
    if (!asked(slot) || t.slots.find((s) => s.name === slot)?.kind === "addon") return 0;
    const n = cooked.filter((sd) => lc(sd.slot) === lc(slot)).length;
    const rows = history.filter((r) => r.slot === slot && r.dishes.length).map((r) => r.dishes.filter((d) => !isStaple(slot, d)).length).sort((a, b) => a - b);
    const m = rows.length ? Math.max(1, rows[Math.floor((rows.length - 1) / 2)]) : 1;
    const elsewhere = (name: string) => new Set(cooked.filter((sd) => lc(sd.slot) !== lc(slot) && sd.dishes.some((d) => dishNameOf(d.name, truthNames) === name)).map((sd) => sd.date)).size;
    const supply = t.library.filter((d) => d.slot === slot && d.frequency !== "daily" && !isStaple(slot, d.name))
      .reduce((a, d) => a + Math.max(0, Math.min(n, frequencyRange(d.frequency)[1] - elsewhere(d.name))), 0);
    return Math.ceil(Math.max(0, n * m - supply) / Math.max(1, Math.min(2, Math.ceil(n / 2))));
  };
  const budget = loaded.settings?.new_dishes_per_week ?? 2;
  const bySlot = new Map<string, number>();
  for (const s of newSlot.values()) bySlot.set(s, (bySlot.get(s) ?? 0) + 1);
  const allowances = [...bySlot.keys()].map((s) => [s, shortAllowance(s)] as const).filter(([, a]) => a > 0);
  const counted = [...bySlot].reduce((a, [s, c]) => a + Math.max(0, c - shortAllowance(s)), 0);
  add("new_budget", counted <= budget, `${newNames.size} new dishes (${[...newNames].join(", ")}), setting ${budget}${allowances.length ? `, short slots' own: ${allowances.map(([s, a]) => `${s} ${a}`).join(", ")}` : ""}`);
  facts.new_dishes = newNames.size;

  // ── 4. The family's own words on a dish (frequency, days, daily), counted in days across all slots ──
  // Owner, 25 Nov (kinds model rule 3): the old twice-a-week cap (default_cap, main_twice) is gone; only what the family said
  // about a dish still limits it.
  // Owner rule 3 (class 1): words said of a category ("pasta on Sundays", "kurma twice a week": a kind or sub-kind's own word,
  // no one dish) hold for every item of it, whatever its name ("Macaroni" is a pasta).
  const categoryOf = (name: string) => { const k = kindOf(name); return k && k.by !== "item" && !isStapleKind(k.kind) ? k : null; };
  const placements = (name: string) => {
    const cat = categoryOf(name);
    const isIt = (x: string) => { if (dishNameOf(x, truthNames) === name) return true; const k = cat && kindOf(x); return !!k && k.kind === cat!.kind && (!cat!.sub || k.sub === cat!.sub); };
    return cooked.flatMap((sd) => sd.dishes.filter((d) => isIt(d.name)).map(() => sd));
  };
  for (const name of truthNames) {
    const rows = t.library.filter((d) => d.name === name);
    const freq = rows.find((d) => d.frequency)?.frequency, days = rows.find((d) => d.days)?.days;
    if (freq === "daily") {
      // Owner, 23 Nov: a dish said for every day is on every slot-day of its slot (a hard check).
      for (const r of rows) for (const sd of cooked.filter((x) => lc(x.slot) === lc(r.slot)))
        add("daily_dishes", sd.dishes.some((d) => dishNameOf(d.name, truthNames) === name), `${dayOfSd(sd)} ${sd.slot}: no ${name} (every day)`);
      continue;
    }
    if (!freq && !days) continue;
    // The family's words on a dish hold across the day's meals (owner rule 3; lead, 26 Nov: "uthappam sometimes" is 2–3 in all),
    // except at a meal where the family has that dish, or for a category word that category, as their own with no such words:
    // "dal sometimes" of dinner does not count the lunch dal, nor "uthappam sometimes" of dinner breakfast's own dosas.
    const said = new Set(rows.filter((d) => d.frequency || d.days).map((d) => lc(d.slot)));
    const cat = categoryOf(name);
    const sameCat = (x: string) => { const k = cat && categoryOf(x); return !!k && k.kind === cat!.kind && (!cat!.sub || k.sub === cat!.sub); };
    const ownThere = (slot: string) => t.library.some((d) => lc(d.slot) === lc(slot) && (d.name === name || sameCat(d.name)));
    const ps = placements(name).filter((sd) => said.has(lc(sd.slot)) || !ownThere(sd.slot));
    // Counted in days (spec §2.1: "≤2 days", "2–3/wk"): dal at lunch and dinner on Monday is one day. Never more often than
    // said; fewer is fine (owner, 25 Nov: "people want variety"). Only on its days when they named days.
    const n = new Set(ps.map((sd) => sd.date)).size;
    const okCount = !freq || n <= frequencyRange(freq)[1];
    const okDays = !days || ps.every((sd) => days.includes(dayOfSd(sd)));
    add("dish_frequency", okCount && okDays, `${name} (${[freq, days?.join(",")].filter(Boolean).join(", ")}) on ${ps.map((sd) => `${dayOfSd(sd)} ${sd.slot}`).join(", ") || "no day"}`);
  }

  // ── 5. Rotation (owner, 25 Nov, kinds model rule 3), staples exempt ──
  //   no_early_repeat: an item comes back in its slot (Lunch and Dinner together for a kind the family has at both) only once
  //     every other item of the family's of its kind there has been used this week, unless their words allow it;
  //   not_next_day: the same item never on consecutive days in its slot group, nor at lunch and dinner the same day.
  const truthKind = (d: TruthDish) => (d.kind ? { kind: d.kind, sub: d.sub ?? null } : kindOf(d.name));
  /** The kind of a planned dish: TRUTH's for one of the family's dishes by its name, else the catalog's, else the kind of the
   *  family dish it is a way of ("Bhindi sabzi" of their "Bhindi"). */
  const kindAt = (name: string, slot: string): string | null => {
    const exactRow = t.library.find((d) => plain(d.name) === plain(name) && lc(d.slot) === lc(slot)) ?? t.library.find((d) => plain(d.name) === plain(name));
    if (exactRow) return truthKind(exactRow)?.kind ?? null;
    const cat = kindOf(name);
    if (cat) return cat.kind;
    const tn = dishNameOf(name, truthNames);
    const row = tn ? t.library.find((d) => d.name === tn && lc(d.slot) === lc(slot)) ?? t.library.find((d) => d.name === tn) : undefined;
    return row ? truthKind(row)?.kind ?? null : null;
  };
  const exempt = (slot: string, name: string) => isFamilyStaple(slot, name) || isStapleKind(kindAt(name, slot)) || isBareStapleName(name);
  /** The family's words that let a dish come back: a frequency, days, or daily (the dish_frequency check holds their count). */
  const saidRow = (name: string) => { const tn = dishNameOf(name, truthNames); return tn ? t.library.find((d) => d.name === tn && (d.frequency || d.days)) : undefined; };
  /** The family's words as setup read them (lead, 25 Nov): a dish of theirs saved as had every day or usually at that slot
   *  ("idli most days") may come day after day there. */
  const setupOften = (name: string, slot: string) => loaded.library.some((d) => lc(d.slot) === lc(slot) && plain(d.name) === plain(name) && (d.frequency === "daily" || d.frequency === "usually"));
  const famKinds = (slot: string) => new Set(t.library.filter((d) => lc(d.slot) === lc(slot)).map((d) => truthKind(d)?.kind).filter((x): x is string => !!x));
  const LD = ["lunch", "dinner"];
  const sharedLD = (kind: string | null) => !!kind && LD.every((s) => famKinds(s).has(kind));
  type Use = { date: string; slot: string; id: string; name: string; kind: string | null };
  const uses: Use[] = [];
  for (const sd of cooked) for (const d of sd.dishes) {
    if (exempt(sd.slot, d.name)) continue;
    uses.push({ date: sd.date, slot: sd.slot, id: plain(d.name).replace(/\bvegetable\b/g, "veg"), name: d.name, kind: kindAt(d.name, sd.slot) });
  }
  const groupOf = (u: Use) => (LD.includes(lc(u.slot)) && sharedLD(u.kind) ? "Lunch+Dinner" : u.slot);
  const groupSlots = (g: string) => (g === "Lunch+Dinner" ? ["Lunch", "Dinner"] : [g]);
  /** A house-wide hard rule keeps this dish off that day ("no meat on weekdays"): it is no option there. */
  const houseBlocks = (d: TruthDish, day: Weekday, slot: string) => t.rules.some((r) => r.hard && !r.who && ["avoid", "veg", "no_eggs"].includes(r.what)
    && (!r.days?.length || r.days.includes(day)) && (!r.slots?.length || r.slots.some((x) => lc(x) === lc(slot)))
    && (r.what === "veg" ? ["meat", "fish", ...(r.items ?? [])] : r.what === "no_eggs" ? ["egg"] : r.items ?? []).some((it) => hasItem(truthTags(d), it)));
  const days1 = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
  const byGroup = new Map<string, Use[]>();
  for (const u of uses) { const g = `${groupOf(u)}|${u.id}`; (byGroup.get(g) ?? byGroup.set(g, []).get(g)!).push(u); }
  for (const [g, us0] of byGroup) {
    const us = [...us0].sort((a, b) => a.date.localeCompare(b.date) || LD.indexOf(lc(a.slot)) - LD.indexOf(lc(b.slot)));
    if (us.length < 2) continue;
    const group = g.split("|")[0], first = us[0], said = saidRow(first.name);
    // Next day, or lunch and dinner the same day. Their words allow it only when they said it for most days (usually, daily,
    // 5+ a week) or named both days.
    const often = (!!said?.frequency && frequencyRange(said.frequency)[0] >= 4) || setupOften(first.name, first.slot);
    const close = us.slice(1).map((u, i) => [us[i], u] as const).filter(([a, b]) => { const gap = days1(a.date, b.date); return gap === 1 || (gap === 0 && a.slot !== b.slot); })
      .filter(([a, b]) => !often && !(said?.days?.includes(dayOfSd({ date: a.date } as PlanSlotDay)) && said.days.includes(dayOfSd({ date: b.date } as PlanSlotDay))));
    add("not_next_day", !close.length, `${group}: ${first.name} on ${close.map(([a, b]) => `${weekdayOfDate(a.date)} ${a.slot} and ${weekdayOfDate(b.date)} ${b.slot}`).join("; ")}`);
    if (said || !first.kind) continue;
    // Another of the family's items of this kind in the group, unused all week, that could have gone there instead.
    const second = us[1], day = weekdayOfDate(second.date);
    const usedNames = new Set(cooked.filter((sd) => groupSlots(group).some((x) => lc(x) === lc(sd.slot))).flatMap((sd) => sd.dishes.map((d) => dishNameOf(d.name, truthNames))).filter(Boolean));
    const options = t.library.filter((d) => groupSlots(group).some((x) => lc(x) === lc(d.slot)) && truthKind(d)?.kind === first.kind && !d.days?.length
      && plain(d.name) !== first.id && dishNameOf(first.name, truthNames) !== d.name && !isBareKindWord(d.name) && !exempt(d.slot, d.name) && !houseBlocks(d, day, second.slot));
    const unused = [...new Set(options.filter((d) => !usedNames.has(d.name)).map((d) => d.name))];
    add("no_early_repeat", !unused.length, `${group}: ${first.name} back on ${day} while ${unused.join(", ")} (${first.kind}) unused this week`);
  }
  // Lunch and dinner the same day, for an item whose kind is not shared (the group above did not see both).
  for (const date of [...new Set(cooked.map((x) => x.date))]) {
    const at2 = (slot: string) => uses.filter((u) => u.date === date && lc(u.slot) === slot && groupOf(u) !== "Lunch+Dinner");
    const both = at2("lunch").filter((u) => at2("dinner").some((v) => v.id === u.id) && !(saidRow(u.name)?.frequency && frequencyRange(saidRow(u.name)!.frequency)[0] >= 4) && !setupOften(u.name, u.slot));
    if (both.length) add("not_next_day", false, `${weekdayOfDate(date)}: ${both.map((u) => u.name).join(", ")} at lunch and dinner`);
  }

  // ── 6. Soft rules with a frequency, counted across slots; cook limits (cap) ──
  for (const r of t.rules.filter((x) => !x.hard && x.frequency && (x.what === "swap" || x.what === "require"))) {
    const want = r.what === "swap" ? [r.to ?? ""] : r.items ?? [];
    const hits = cooked.filter((sd) => (!r.who || sd.people.some((p) => sameName(p, r.who!))) && (!r.slots?.length || r.slots.includes(sd.slot))
      && sd.dishes.some((d) => want.some((it) => hasItem(dishFacts(d.name, sd.slot).tags, it) || new RegExp(`\\b${it}`, "i").test(`${d.name} ${d.note ?? ""}`) || new RegExp(`\\b${it}`, "i").test(sd.note ?? ""))));
    const [min, max] = frequencyRange(r.frequency);
    add("soft_frequency", hits.length >= min && hits.length <= max, `${r.title}: ${hits.length} times (want ${min}–${max})`);
  }
  for (const r of t.rules.filter((x) => x.what === "cap" && x.per_meal)) {
    for (const sd of cooked.filter((x) => (!r.slots?.length || r.slots.includes(x.slot)) && (!r.days?.length || r.days.includes(dayOfSd(x))))) {
      const n = sd.dishes.filter((d) => !isStaple(sd.slot, d.name)).length;
      add("cap_rules", n <= r.per_meal!, `${dayOfSd(sd)} ${sd.slot}: ${n} dishes besides staples (${r.title}: at most ${r.per_meal})`);
    }
  }

  // ── 7. The base minimum (owner, 25 Nov): whole plates, no doubled staple, real dishes, mostly their own food and no new kind,
  //    nobody without food, a clean message. Its own word lists (the scorer reads dish names
  //    the way a person would, apart from the planner's code).
  const isBareStaple = isBareStapleName;
  // Decided 8: the one-pot rice kinds (khichdi, biryani, flavoured rice) are each a whole plate, whatever the dish's name.
  const onePotKind = (x: string) => ["Khichdi", "Biryani", "Flavoured rice", "Pulao"].includes(kindOf(x)?.kind ?? "");
  const carb = (x: string) => hasWord(x, BREAD_RICE) || hasWord(x, ONE_POT) || onePotKind(x);
  for (const sd of cooked) {
    const ds = sd.dishes.map((d) => d.name);
    // An add-on plate holds only the difference ("Dadu's dinner: Phulka"): a staple alone is right there.
    const addon = t.slots.find((x) => lc(x.name) === lc(sd.slot))?.kind === "addon";
    if (!addon) add("not_bare", !ds.every(isBareStaple), `${dayOfSd(sd)} ${sd.slot}: only ${ds.join(", ")}`);
    if (/^(lunch|dinner)$/i.test(sd.slot)) {
      const onePot = ds.some((x) => hasWord(x, ONE_POT) || onePotKind(x) || (carb(x) && words(x).length > 1 && !isBareStaple(x)));
      const whole = ds.some(carb) && (ds.length >= 2 ? ds.some((x) => !isBareStaple(x)) : onePot);
      add("whole_plate", whole, `${dayOfSd(sd)} ${sd.slot}: ${ds.join(", ")}`);
    }
    // A plain staple beside a dish that already has it ("Dal rice, Rice"; "Roti with aloo gobi, Roti"), or the same twice.
    const doubled = ds.filter((x) => isBareStaple(x) && (ds.filter((y) => plain(y) === plain(x)).length > 1
      || ds.some((y) => y !== x && !isBareStaple(y) && words(x).every((w) => words(y).includes(w)))));
    add("no_doubled_staple", !doubled.length, `${dayOfSd(sd)} ${sd.slot}: ${doubled.join(", ")} beside ${ds.join(", ")}`);
  }
  // A real dish (owner, 25 Nov): never a bare kind or sub-kind word ("Sabzi", "Dal", "Curry", "Poriyal"), unless it is the
  // family's own dish they named for every day or for set days (a fixed dish in their words: "eggs every morning").
  for (const sd of cooked) for (const d of sd.dishes) {
    const fixed = () => t.library.some((x) => plain(x.name) === plain(d.name) && lc(x.slot) === lc(sd.slot) && (x.frequency === "daily" || !!x.days?.length));
    add("real_dish", !isBareKindWord(d.name) || fixed(), `${dayOfSd(sd)} ${sd.slot}: "${d.name}" is a kind, not a dish`);
  }
  // Their own food: a family dish, or a particular way of one ("Bhindi sabzi" of their "Sabzi").
  const variantOf = (entry: string, dish: string) => { const e = words(entry), d = words(dish); return e.length > 0 && d.length > e.length && e.every((w) => d.includes(w)); };
  /** Lead's rule (25 Nov, owner to confirm): a part the family named as a category ("dal", "sabzi", "sambar", "a poriyal": a
   *  bare kind or sub-kind word in their library at a slot) is filled from the catalog's items of it, and those items are
   *  theirs. A sub-kind word ("Sambar") makes that sub-kind's items theirs; a kind's own sub-kind word ("Sabzi", "Dal") makes
   *  the kind's items in the family's sub-kinds at that slot theirs; a kind-level word ("Curry") the whole kind's. */
  const categoryOwn = (x: string, slot: string): boolean => {
    const hit = kindOf(x);
    if (!hit) return false;
    for (const row of t.library.filter((d) => lc(d.slot) === lc(slot) && isBareKindWord(d.name))) {
      const cat = kindOf(row.name);
      if (!cat || cat.kind !== hit.kind) continue;
      if (!cat.sub) return true;
      const subs = new Set([cat.sub, ...t.library.filter((d) => lc(d.slot) === lc(slot)).map((d) => truthKind(d)).filter((k) => k?.kind === hit.kind && k.sub).map((k) => k!.sub!)]);
      if (hit.sub && subs.has(hit.sub)) return true;
    }
    return false;
  };
  const own = (x: string, slot: string) => !!dishNameOf(x, truthNames) || truthNames.some((n) => variantOf(n, x)) || categoryOwn(x, slot);
  // At least OWN_SHARE of the week's non-staple items are the family's own (kinds model rule 4).
  const all = cooked.flatMap((x) => x.dishes.filter((d) => !exempt(x.slot, d.name)).map((d) => ({ name: d.name, slot: x.slot })));
  const mine = all.filter((x) => own(x.name, x.slot));
  if (all.length) add("own_share", mine.length / all.length >= OWN_SHARE, `${Math.round((100 * mine.length) / all.length)}% of non-staples their own (want ${OWN_SHARE * 100}%): not theirs ${[...new Set(all.filter((x) => !mine.includes(x)).map((x) => x.name))].join(", ")}`);
  // Never a new kind (kinds model rule 4): a dish that is not the family's is of a kind their own dishes at that meal are of.
  // A new dish the catalog cannot place fails (nothing says it is like theirs).
  const seenNew = new Set<string>();
  for (const sd of cooked) for (const d of sd.dishes) {
    if (own(d.name, sd.slot) || exempt(sd.slot, d.name) || seenNew.has(`${lc(sd.slot)}|${plain(d.name)}`)) continue;
    seenNew.add(`${lc(sd.slot)}|${plain(d.name)}`);
    const k = kindOf(d.name)?.kind ?? null, theirs = famKinds(sd.slot);
    add("no_new_kind", !!k && theirs.has(k), `${sd.slot}: ${d.name} is ${k ? `a ${k}` : "of no kind the catalog knows"}${k ? `; their ${sd.slot} kinds: ${[...theirs].join(", ")}` : ""}`);
  }
  // Nobody without food: no "nothing to eat" left, and a fasting person's food is there.
  const hungry = plan.unmet.filter((u) => /nothing to eat|no food|without food/i.test(u));
  add("nobody_without_food", !hungry.length, hungry.slice(0, 3).join("; "));
  // The message: no planner reasoning in a day's note, short reasons for new dishes, at most one question.
  const msg = plan.message ?? "";
  const leaks = msg.split("\n").filter((l) => /^(breakfast|lunch|dinner|.*'s (tiffin|breakfast|lunch|dinner)):/i.test(l.trim()) && /\b(not for \w+[;,]|instead|because|safe|avoid|so that|he has|she has|replac)/i.test(l.split(/\.\s/).slice(1).join(". ")));
  add("message_clean", !leaks.length, leaks.slice(0, 2).join(" | "));
  const newPart = /New this week:([^\n]*)/i.exec(msg)?.[1] ?? "";
  const longWhy = [...newPart.matchAll(/\(([^)]*)\)/g)].map((m) => m[1]).filter((w) => w.length > NEW_WHY_MAX);
  add("short_new_reasons", !longWhy.length, `${longWhy.length} reasons over ${NEW_WHY_MAX} characters: ${longWhy[0]?.slice(0, 90) ?? ""}`);
  // Every new dish is like a dish of theirs at that meal (owner, 25 Nov: "not suddenly pasta"): the message says which.
  const newItems = newPart.split(/;\s*/).map((x) => x.trim().replace(/\.$/, "")).filter(Boolean);
  if (newItems.length) add("new_like", newItems.every((x) => /\(like your [^)]+\)/i.test(x)), `new dishes without a dish of theirs: ${newItems.filter((x) => !/\(like your /i.test(x)).join("; ")}`);
  const questions = msg.split("\n").filter((l) => l.trim().endsWith("?"));
  add("one_question", questions.length <= 1, `${questions.length} questions: ${questions.slice(0, 2).join(" | ")}`);

  // ── Tracked, not gating: shape against the slot's own history ──
  for (const s of t.slots.filter((x) => !x.optional)) {
    const want = meanDishes(history, s.name);
    const sds = cooked.filter((x) => lc(x.slot) === lc(s.name));
    if (want === null || !sds.length) continue;
    const got = sds.reduce((a, x) => a + x.dishes.length, 0) / sds.length;
    facts[`shape_${s.name}`] = `${got.toFixed(1)} vs ${want.toFixed(1)}`;
    for (const sd of sds) add("shape", Math.abs(sd.dishes.length - want) <= 1, undefined, tracked);
  }
  facts.dishes = cooked.reduce((a, x) => a + x.dishes.length, 0);
  facts.family_dish_share = facts.dishes ? Math.round((100 * cooked.flatMap((x) => x.dishes).filter((d) => dishNameOf(d.name, truthNames)).length) / (facts.dishes as number)) : 0;
  facts.unmet = plan.unmet.length;
  facts.flagged = plan.unmet.length || /only \d+ .* known|only know \d+|don't know|tell me (a few|more)/i.test(plan.message ?? "") ? 1 : 0;
  return { rates, tracked, notes, facts };
}

/** The week as text, for the judge and the report: each day, each slot-day with its people and dishes. */
export function weekText(plan: PlanOut): string {
  return WEEK.map((day) => {
    const sds = plan.slotDays.filter((x) => weekdayOfDate(x.date) === day);
    return `${day}: ${sds.map((x) => `${x.slot} [${[...x.people, ...x.guests.map((g) => `${g.count} guest${g.count > 1 ? "s" : ""}`)].join(", ")}]: ${x.skip ? `(${x.skip.replace("_", " ")})` : x.dishes.map((d) => `${d.name}${d.not_for?.length ? ` (not for ${d.not_for.join(", ")})` : ""}${d.note ? ` (${d.note})` : ""}`).join(", ") || "(nothing)"}${x.note ? ` — ${x.note}` : ""}`).join(" | ")}`;
  }).join("\n");
}
export { dayOf };
