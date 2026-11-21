// Compares the rules an interview saved with the rules a correct interview would save (a fixture's `rules`). Tolerant:
// synonyms and category-vs-listing in items are fine; who/days/slots must be right; `cap` needs its per_week or per_meal, `swap` a `to`.
import { CATEGORIES, expandLenient, hasPhrase, words } from "./terms";

export type Rule = { kind?: string; who?: string; days?: string[]; slots?: string[]; items?: string[]; to?: string; per_week?: number; per_meal?: number; note?: string };
export type Verdict = { rule: string; result: "captured" | "wrong" | "note_only" | "missed"; why?: string; got?: Rule };

const DAY: Record<string, string> = { mon: "Mon", monday: "Mon", tue: "Tue", tues: "Tue", tuesday: "Tue", wed: "Wed", wednesday: "Wed", thu: "Thu",
  thur: "Thu", thurs: "Thu", thursday: "Thu", fri: "Fri", friday: "Fri", sat: "Sat", saturday: "Sat", sun: "Sun", sunday: "Sun" };
const days = (d?: string[]) => [...new Set((d ?? []).map((x) => DAY[x.trim().toLowerCase()] ?? x.trim()))].sort().join(",");
const lc = (s?: string) => (s ?? "").trim().toLowerCase();
const slots = (s?: string[]) => [...new Set((s ?? []).map((x) => lc(x).replace(/[’']/g, "'")))].sort().join(",");

/** What a legacy kind means as items, so `veg` and `avoid @meat @fish` compare equal. */
const LEGACY_AS: Record<string, { kind: string; items: string[] }> = {
  veg: { kind: "avoid", items: ["@meat", "@fish"] }, no_meat: { kind: "avoid", items: ["@meat", "@fish"] },
  egg: { kind: "avoid", items: ["@meat", "@fish"] }, no_eggs: { kind: "avoid", items: ["@egg"] },
  no_onion_garlic: { kind: "avoid", items: ["onion", "garlic"] },
};
const normal = (r: Rule): Rule => (r.kind && LEGACY_AS[r.kind] && !r.items?.length ? { ...r, ...LEGACY_AS[r.kind] } : r);

/** Every word an item list stands for: a category is its members plus its own name. */
function itemTerms(items: string[]): string[] {
  return expandLenient(items.filter((i) => typeof i === "string"));
}
/** How much of `want` the `got` items cover: each wanted item (a category counts as one) is covered when a got term names it
 *  or one of its members, either way round. */
function coverage(want: string[], got: string[]): number {
  if (!want.length) return 1;
  const g = itemTerms(got);
  const names = (t: string) => g.some((x) => hasPhrase(x, t) || hasPhrase(t, x));
  const covered = want.filter((w) => {
    if (!w.startsWith("@")) return names(w);
    // A category: named itself, or two of its members beyond the items listed beside it ("onion, garlic, @root_veg" needs
    // more than onion and garlic).
    const own = w.slice(1).replace(/_/g, " ");
    if (g.some((x) => hasPhrase(x, own))) return true;
    const members = (CATEGORIES[w.slice(1)] ?? []).filter((m) => !want.includes(m));
    return members.filter(names).length >= Math.min(2, members.length);
  });
  return covered.length / want.length;
}
const mentions = (text: string, want: Rule) => {
  const terms = itemTerms(want.items ?? []).filter((t) => words(t).join(" ").length > 3);
  return terms.some((t) => hasPhrase(text, t)) || (!!want.note && words(want.note).filter((w) => w.length >= 4 && !["have", "with", "only", "that", "this", "must"].includes(w)).filter((w) => hasPhrase(text, w)).length >= 2);
};

/** Each expected rule: captured, wrong (found, a field off), note_only (only in an `other` rule or a person's text), missed. */
export function compareRules(expected: Rule[], gotRaw: Rule[], personText: string): { verdicts: Verdict[]; extra: Rule[] } {
  const got = gotRaw.map(normal);
  const used = new Set<number>();
  const verdicts = expected.map((e0): Verdict => {
    const e = normal(e0);
    const label = `${e0.kind}${e0.who ? ` ${e0.who}` : ""}${e0.days ? ` ${e0.days.join("/")}` : ""}${e0.slots ? ` [${e0.slots.join("/")}]` : ""}: ${(e0.items ?? []).join(", ") || e0.note}`;
    if (e.kind === "other") {
      const hit = got.findIndex((g) => mentions(`${g.note ?? ""} ${(g.items ?? []).join(" ")}`, e) && (!e.who || lc(g.who) === lc(e.who) || hasPhrase(g.note ?? "", e.who!)));
      if (hit >= 0) { used.add(hit); return { rule: label, result: "captured", got: gotRaw[hit] }; }
      return { rule: label, result: mentions(personText, e) ? "note_only" : "missed" };
    }
    // The best candidate: same polarity (a ban, or a must), most item coverage, then the most fields agreeing.
    const NEG = ["avoid", "swap", "cap"], side = (k?: string) => (NEG.includes(k ?? "") ? "neg" : "pos");
    let best = -1, bestCov = 0, bestScore = -1;
    got.forEach((g, i) => {
      if (g.kind === "other" || g.kind === "fasting" || side(g.kind) !== side(e.kind)) return;
      const c = coverage(e.items ?? [], g.items ?? []);
      if (c < 0.5) return;
      const score = c * 10 + (g.kind === e.kind ? 2 : 0) + (lc(g.who) === lc(e.who) ? 2 : 0) + (days(g.days) === days(e.days) ? 1 : 0)
        + (slots(g.slots) === slots(e.slots) ? 1 : 0) - (used.has(i) ? 5 : 0);
      if (score > bestScore) { best = i; bestCov = c; bestScore = score; }
    });
    if (best >= 0 && bestCov >= 0.5) {
      const g = got[best]; used.add(best);
      const off: string[] = [];
      if (g.kind !== e.kind) off.push(`kind ${g.kind} (want ${e.kind})`);
      if (lc(g.who) !== lc(e.who)) off.push(`who ${g.who ?? "everyone"} (want ${e.who ?? "everyone"})`);
      if (days(g.days) !== days(e.days)) off.push(`days ${days(g.days) || "every day"} (want ${days(e.days) || "every day"})`);
      if (slots(g.slots) !== slots(e.slots)) off.push(`slots ${slots(g.slots) || "all"} (want ${slots(e.slots) || "all"})`);
      if (e.kind === "only" && bestCov < 1) off.push(`items cover ${Math.round(bestCov * 100)}% of the allowed list`);
      if (e.kind === "cap" && g.per_week !== e.per_week) off.push(`per_week ${g.per_week} (want ${e.per_week})`);
      if (e.kind === "cap" && g.per_meal !== e.per_meal) off.push(`per_meal ${g.per_meal} (want ${e.per_meal})`);
      if (e.kind === "swap" && !g.to) off.push("no `to`");
      return off.length ? { rule: label, result: "wrong", why: off.join("; "), got: gotRaw[best] } : { rule: label, result: "captured", got: gotRaw[best] };
    }
    const asOther = got.findIndex((g) => (g.kind === "other" || g.kind === "fasting") && mentions(`${g.note ?? ""} ${(g.items ?? []).join(" ")}`, e));
    if (asOther >= 0) { used.add(asOther); return { rule: label, result: "note_only", why: "kept as an unchecked note", got: gotRaw[asOther] }; }
    return { rule: label, result: mentions(personText, e) ? "note_only" : "missed", ...(mentions(personText, e) ? { why: "only in a person's notes" } : {}) };
  });
  return { verdicts, extra: gotRaw.filter((_, i) => !used.has(i)) };
}
