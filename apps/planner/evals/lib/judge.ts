// The LLM judge for Eval 2: a strong model reads the family (TRUTH in words) and one planned week, blind to which code made
// it, and scores "does this look like this family's week" 1–5 on five axes. Pairwise mode: two weeks for the same family,
// shown in a fixed per-household random order, and which fits better.
import { chatJson } from "./model";
import type { Household } from "./truth";

export const DEFAULT_JUDGE = "anthropic/claude-sonnet-5.5";
export const AXES = ["fits_dishes", "meal_shape", "variety", "per_person", "overall"] as const;
export type JudgeScore = Record<(typeof AXES)[number], number> & { worst: string };

/** The family as a judge needs it: who, who cooks, the rules, what each meal looks like in their words, their dishes. */
export function familyText(h: Household): string {
  const t = h.truth;
  const dish = (d: (typeof t.dishes)[number]) => `${d.name}${d.for ? ` (only ${d.for.join(", ")})` : ""}${d.often ? ` [${d.often}]` : ""}${d.per_week ? ` [${d.per_week}x/week]` : ""}${d.days ? ` [on ${d.days.join(", ")}]` : ""}`;
  const slots = [...new Set(t.dishes.flatMap((d) => d.slots))];
  return [
    `People: ${t.people.map((p) => `${p.name} (${p.group}${p.age ? `, ${p.age}` : ""})`).join(", ")}.`,
    t.cook ? `Cook ${t.cook.name}: ${t.cook.days.join(", ")}, ${t.cook.visits.map((v) => `${v.meals.join(" + ")} at ${v.at}`).join("; ")}.` : "No paid cook.",
    ...t.homeCook.map((c) => `${c.by} cooks ${c.slots ? c.slots.join(" and ") : "all meals"} on ${c.days.join(", ")}.`),
    ...t.extraSlots.map((s) => `Extra meal: ${s.name}${s.days ? ` on ${s.days.join(", ")}` : ""}${s.for ? ` for ${s.for.join(", ")}` : ""}.`),
    ...t.orderIn.map((o) => `${o.day} ${o.slot}: ${o.note} (nothing to cook).`),
    `Food rules: ${t.hardRules.map((r) => r.title).join("; ")}.`,
    ...(t.softNotes.length ? [`Preferences: ${t.softNotes.map((n) => `${n.who ? `${n.who}: ` : ""}${n.text}`).join("; ")}.`] : []),
    `What each meal looks like, in their words: ${t.examples.map((e) => `${e.slot}: "${e.words}"`).join("; ") || "(not said)"}.`,
    `Their dishes: ${slots.map((s) => `${s}: ${t.dishes.filter((d) => d.slots.includes(s)).map(dish).join(", ")}`).join(". ")}.`,
    ...t.judgeNotes.map((n) => `Note: ${n}`),
  ].join("\n");
}

const SYSTEM = `You judge a week's meal plan for one Indian family. You get the family (people, who cooks, their food rules, what
each meal looks like in their own words, their own dishes) and the week planned for them: each meal with its dishes and,
in brackets, who eats each dish. Judge only whether this looks like THIS family's week, as the family would see it.
Score each 1-5 (5: they would accept it as is; 3: usable with several changes; 1: they would reject it):
- fits_dishes: built from their own dishes and their kind of food, not generic or another region's.
- meal_shape: each meal shaped like their words (lunch with their parts and staple, a light or full breakfast as they eat it).
- variety: sensible rotation, no main dish too often, occasional dishes occasional, day-bound dishes on their days.
- per_person: every person fed at every meal they eat; personal dishes and rules for the right person; fasts and allergies kept.
- overall: would they use this week.
Answer JSON only: {"fits_dishes": n, "meal_shape": n, "variety": n, "per_person": n, "overall": n, "worst": "<the one worst thing, under 25 words>"}`;

export async function judgeWeek(h: Household, week: string, model = DEFAULT_JUDGE): Promise<JudgeScore> {
  const j = await chatJson({ model, system: SYSTEM, user: `FAMILY\n${familyText(h)}\n\nTHE WEEK\n${week}`, maxTokens: 4000, temperature: 0 });
  const out: any = { worst: String(j?.worst ?? "") };
  for (const a of AXES) out[a] = Math.max(1, Math.min(5, Number(j?.[a]) || 1));
  return out;
}

const PAIR = `You compare two week meal plans (A and B) made for the same Indian family. You get the family (people, who cooks,
rules, what each meal looks like in their words, their dishes) and both weeks. Which week would this family rather have?
Weigh: their own dishes and meal shape, every person fed and rules kept, sensible variety. Answer JSON only:
{"better": "A" | "B" | "tie", "why": "<under 30 words>"}`;

/** Which of two weeks fits the family better; `aFirst` shows the first week as A (callers flip it per household). */
export async function judgePair(h: Household, first: string, second: string, aFirst: boolean, model = DEFAULT_JUDGE): Promise<{ better: "first" | "second" | "tie"; why: string }> {
  const [A, B] = aFirst ? [first, second] : [second, first];
  const j = await chatJson({ model, system: PAIR, user: `FAMILY\n${familyText(h)}\n\nWEEK A\n${A}\n\nWEEK B\n${B}`, maxTokens: 3000, temperature: 0 });
  const b = String(j?.better ?? "tie").toUpperCase();
  const better = b === "TIE" ? "tie" : (b === "A") === aFirst ? "first" : "second";
  return { better, why: String(j?.why ?? "") };
}
