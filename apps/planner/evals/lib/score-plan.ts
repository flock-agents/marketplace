// Eval 2's scorecard (spec §8): one planned week (result.ts PlanOut) against TRUTH, in code. Gating fields are pass rates;
// `tracked` fields (shape: dish count vs history) are reported, never gating (spec §1 non-goals). Hard rules are checked
// per person on each slot-day against what each dish contains, failing closed: a tag nobody read counts as a break.
import type { PlanOut, PlanSlotDay, SavedDish, SetupOut } from "./result";
import { meanDishes, staplesOf, type HistoryRow } from "./history";
import { truthTags, weeklyPeople } from "./truth-setup";
import { canonTag, hasItem, PARENT, tagsOfName } from "./vocab";
import { slotMap, type Rates } from "./score-setup";
import {
  WEEK, dateOf, dayOf, dishNameOf, frequencyRange, plain, sameName, sameNames, weekdayOfDate,
  type Household, type Skip, type TruthRule, type TruthSlot, type Weekday,
} from "./truth";


/** The scorer's own words for a plate (owner, 25 Nov base minimum). Bread or rice, on its own or in a dish's name. */
const BREAD_RICE = ["roti", "rotis", "bhakar", "bhaat", "bhat", "poli", "chapatis", "rotli", "fulka", "luchi", "kulcha", "chapati", "chapathi", "phulka", "paratha", "parotta", "puri", "poori", "bhakri", "naan", "luchi", "rice", "chawal", "appam", "dosa", "idiyappam", "thepla", "bread", "kulcha", "bhature", "ragi", "millet"];
/** A one-pot dish is a whole plate on its own. */
const ONE_POT = ["khichdi", "khichuri", "pulao", "pulav", "biryani", "pongal", "bisibele", "bisi", "tehri", "upma", "poha", "chawal", "noodles", "pasta", "thali",
  // A dosa-family dish is a meal with its chutney or sambar.
  "dosa", "uthappam", "uttapam", "idli", "pesarattu", "adai", "appam", "idiyappam", "paniyaram"];
/** A dish that is only a staple (a plate of these alone is bare). */
const PLAIN_STAPLES = ["roti", "rotis", "bhakri", "bhakar", "bhaat", "bhat", "poli", "rotli", "fulka", "chapati", "phulka", "rice", "plain", "steamed", "curd", "dahi", "salad", "papad", "pickle", "achar", "raita", "buttermilk", "chaas", "bread"];
/** What goes beside a main and may come every day like a staple (owner: "staples are fine"): never a main for the twice-a-week rule. */
const ACCOMPANIMENTS = ["chutney", "pickle", "achar", "papad", "raita", "salad", "curd", "dahi", "buttermilk", "chaas", "kachumber", "koshimbir"];
export const OWN_SHARE = 0.3;
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
  // The seed is the only history a fresh eval week has (planned rows never count); `daily` dishes are staples too.
  const staples = new Map(t.slots.map((s) => [s.name, staplesOf(history, s.name, t.library.filter((d) => d.slot === s.name && d.frequency === "daily").map((d) => d.name))]));
  const isStaple = (slot: string, dish: string) => !!staples.get(slot)?.has(plain(dish));
  const dayOfSd = (sd: PlanSlotDay) => weekdayOfDate(sd.date);
  const cooked = plan.slotDays.filter((x) => !x.skip && x.dishes.length);

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

  // ── 4. Frequency and days per dish, counted across all slots ──
  /** A slot TRUTH's own dishes cannot fill within the default rules, when the planner says so in unmet (spec §5.2: the
   *  library is too thin): its non-staple dishes with no frequency or days (k), 2 days each, are fewer than its places (n
   *  cooked slot-days × m, its usual non-staple count). Such a slot may bring a dish back on an even share of its days,
   *  ceil(n·m / k), and within floor(k / m) days of itself, and no sooner. null: the slot can be filled. */
  const thin = (slot: string): { cap: number; gap: number } | null => {
    const k = t.library.filter((d) => d.slot === slot && !d.frequency && !d.days && !isStaple(slot, d.name)).length;
    const n = exp.filter((e) => e.slot === slot && !e.skip).length;
    const rows = history.filter((r) => r.slot === slot && r.dishes.length).map((r) => r.dishes.filter((d) => !isStaple(slot, d)).length).sort((a, b) => a - b);
    const m = rows.length ? Math.max(1, rows[Math.floor((rows.length - 1) / 2)]) : 1;
    // The planner says so in unmet (before 23 Nov) or asks about the slot (owner 23 Nov: "I only know N dishes for <slot>").
    if (!k || k * 2 >= n * m || ![...plan.unmet, ...(plan.asked ?? [])].some((u) => lc(u).includes(lc(slot)))) return null;
    return { cap: Math.ceil((n * m) / k), gap: Math.max(1, Math.floor(k / m)) };
  };
  /** The default cap of a dish (2 days), more only when every slot it is a non-staple at is thin. */
  const capOf = (slots: string[]): number => {
    let cap = 2;
    for (const slot of slots) {
      const th = thin(slot);
      if (!th) return 2;
      cap = Math.max(cap, th.cap);
    }
    return cap;
  };
  const placements = (name: string) => cooked.flatMap((sd) => sd.dishes.filter((d) => dishNameOf(d.name, truthNames) === name).map(() => sd));
  for (const name of truthNames) {
    const rows = t.library.filter((d) => d.name === name);
    const freq = rows.find((d) => d.frequency)?.frequency, days = rows.find((d) => d.days)?.days;
    if (freq === "daily") {
      // Owner, 23 Nov: a dish said for every day is on every slot-day of its slot (a hard check).
      for (const r of rows) for (const sd of cooked.filter((x) => lc(x.slot) === lc(r.slot)))
        add("daily_dishes", sd.dishes.some((d) => dishNameOf(d.name, truthNames) === name), `${dayOfSd(sd)} ${sd.slot}: no ${name} (every day)`);
      continue;
    }
    const ps = placements(name);
    const counted = ps.filter((sd) => !isStaple(sd.slot, name));
    if (freq || days) {
      // Room: the slot-days this dish could go to this week (its slots, its days, not skipped).
      const room = exp.filter((e) => !e.skip && rows.some((d) => lc(d.slot) === lc(e.slot)) && (!days || days.includes(e.day))).length;
      const [min, max] = frequencyRange(freq);
      // Counted in days (spec §2.1: "≤2 days", "2–3/wk"): dal at lunch and dinner on Monday is one day.
      const n = new Set(ps.map((sd) => sd.date)).size;
      // Never more often than said; fewer is fine (owner, 25 Nov: "people want variety").
      const okCount = !freq || n <= max;
      void min; void room;
      const okDays = !days || ps.every((sd) => days.includes(dayOfSd(sd)));
      add("dish_frequency", okCount && okDays, `${name} (${[freq, days?.join(",")].filter(Boolean).join(", ")}) on ${ps.map((sd) => `${dayOfSd(sd)} ${sd.slot}`).join(", ") || "no day"}`);
    } else if (new Set(counted.map((sd) => sd.date)).size > capOf(rows.map((d) => d.slot).filter((x) => !isStaple(x, name)))) add("default_cap", false, `${name} (no frequency, not a staple) on ${new Set(counted.map((sd) => sd.date)).size} days: ${counted.map((sd) => `${dayOfSd(sd)} ${sd.slot}`).join(", ")}`);
    else if (ps.length) add("default_cap", true);
  }

  // ── 5. Repeat window per slot (staples exempt), and no same main twice a day across main slots ──
  for (const s of t.slots.filter((x) => !x.optional)) {
    const w = Math.min(plan.relaxed?.[s.name] ?? 3, thin(s.name)?.gap ?? 3);
    const sds = cooked.filter((x) => lc(x.slot) === lc(s.name)).sort((a, b) => a.date.localeCompare(b.date));
    const last = new Map<string, string>();
    const bad: string[] = [];
    for (const sd of sds) for (const d of sd.dishes) {
      if (isStaple(s.name, d.name)) continue;
      const k = plain(d.name), prev = last.get(k);
      if (prev && (Date.parse(sd.date) - Date.parse(prev)) / 86400000 < w) bad.push(`${d.name} ${weekdayOfDate(prev)} and ${dayOfSd(sd)}`);
      last.set(k, sd.date);
    }
    if (sds.length) add("repeat_window", !bad.length, `${s.name} (window ${w}): ${bad.join("; ")}`);
  }
  const mainNames = t.slots.filter((x) => x.kind === "main").map((x) => lc(x.name));
  for (const date of [...new Set(cooked.map((x) => x.date))]) {
    const seen = new Map<string, string>(), bad: string[] = [];
    for (const sd of cooked.filter((x) => x.date === date && mainNames.includes(lc(x.slot)))) for (const d of sd.dishes) {
      if (isStaple(sd.slot, d.name)) continue;
      const k = plain(d.name);
      if (seen.has(k) && seen.get(k) !== sd.slot) bad.push(`${d.name} at ${seen.get(k)} and ${sd.slot}`);
      seen.set(k, sd.slot);
    }
    add("same_day_repeat", !bad.length, `${weekdayOfDate(date)}: ${bad.join("; ")}`);
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

  // ── 7. The base minimum (owner, 25 Nov): whole plates, no doubled staple, mostly their own food, a main at most twice a
  //    week at breakfast and dinner, nobody without food, a clean message. Its own word lists (the scorer reads dish names
  //    the way a person would, apart from the planner's code).
  const words = (x: string) => plain(x).split(" ").filter(Boolean);
  const hasWord = (x: string, list: readonly string[]) => words(x).some((w) => list.includes(w));
  // One staple word ("Rice", "Phulka"), or plain or steamed rice; "Curd rice" is a dish.
  const isBareStaple = (x: string) => { const w = words(x); return (w.length === 1 && PLAIN_STAPLES.includes(w[0])) || (w.length === 2 && ["plain", "steamed"].includes(w[0]) && PLAIN_STAPLES.includes(w[1])); };
  const carb = (x: string) => hasWord(x, BREAD_RICE) || hasWord(x, ONE_POT);
  for (const sd of cooked) {
    const ds = sd.dishes.map((d) => d.name);
    // An add-on plate holds only the difference ("Dadu's dinner: Phulka"): a staple alone is right there.
    const addon = t.slots.find((x) => lc(x.name) === lc(sd.slot))?.kind === "addon";
    if (!addon) add("not_bare", !ds.every(isBareStaple), `${dayOfSd(sd)} ${sd.slot}: only ${ds.join(", ")}`);
    if (/^(lunch|dinner)$/i.test(sd.slot)) {
      const onePot = ds.some((x) => hasWord(x, ONE_POT) || (carb(x) && words(x).length > 1 && !isBareStaple(x)));
      const whole = ds.some(carb) && (ds.length >= 2 ? ds.some((x) => !isBareStaple(x)) : onePot);
      add("whole_plate", whole, `${dayOfSd(sd)} ${sd.slot}: ${ds.join(", ")}`);
    }
    // A plain staple beside a dish that already has it ("Dal rice, Rice"; "Roti with aloo gobi, Roti"), or the same twice.
    const doubled = ds.filter((x) => isBareStaple(x) && (ds.filter((y) => plain(y) === plain(x)).length > 1
      || ds.some((y) => y !== x && !isBareStaple(y) && words(x).every((w) => words(y).includes(w)))));
    add("no_doubled_staple", !doubled.length, `${dayOfSd(sd)} ${sd.slot}: ${doubled.join(", ")} beside ${ds.join(", ")}`);
  }
  // Their own food: a family dish, or a particular way of one ("Bhindi sabzi" of their "Sabzi").
  const variantOf = (entry: string, dish: string) => { const e = words(entry), d = words(dish); return e.length > 0 && d.length > e.length && e.every((w) => d.includes(w)); };
  const own = (x: string) => !!dishNameOf(x, truthNames) || truthNames.some((n) => variantOf(n, x)) || isBareStaple(x);
  const all = cooked.flatMap((x) => x.dishes.map((d) => d.name));
  if (all.length) add("own_share", all.filter(own).length / all.length >= OWN_SHARE, `${Math.round((100 * all.filter(own).length) / all.length)}% their own (want ${OWN_SHARE * 100}%): not theirs ${[...new Set(all.filter((x) => !own(x)))].join(", ")}`);
  // A main at breakfast or dinner at most twice a week, unless the family's own words say more often.
  for (const slot of ["Breakfast", "Dinner"]) {
    const sds = cooked.filter((x) => lc(x.slot) === lc(slot));
    const days = new Map<string, Set<string>>();
    // Sambar is a main beside rice, else a side (owner, 25 Nov): beside idli or dosa it may come every morning.
    const side = (x: string, plate: string[]) => hasWord(x, ACCOMPANIMENTS) || (hasWord(x, ["sambar", "sambhar"]) && !plate.some((y) => y !== x && hasWord(y, ["rice", "chawal", "bhaat", "bhat", "annam", "sadam"])));
    for (const sd of sds) for (const d of sd.dishes) if (!isBareStaple(d.name) && !side(d.name, sd.dishes.map((x) => x.name))) (days.get(plain(d.name)) ?? days.set(plain(d.name), new Set()).get(plain(d.name))!).add(sd.date);
    for (const [name, ds] of days) {
      // The family's own dish, or the one it is a particular way of ("scrambled eggs" of their eggs every morning): its own words.
      const ofIt = (d: { name: string }) => plain(d.name) === name || variantOf(d.name, name);
      const rows = t.library.filter((d) => lc(d.slot) === lc(slot) && ofIt(d));
      const said = Math.max(0, ...rows.map((row) => frequencyRange(row.frequency)?.[1] ?? (row.days?.length ? row.days.length : 0)));
      if (ds.size > Math.max(2, said)) add("main_twice", false, `${slot}: ${name} on ${ds.size} days`);
    }
    if (sds.length) add("main_twice", true);
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
