// The LLM judge for Eval 2: a strong model reads the family (TRUTH in words) and one planned week, blind to which code made
// it, and scores "does this look like this family's week" 1–5 on five axes. Pairwise mode: two weeks for the same family,
// shown in a fixed per-household random order, and which fits better.
import { chatJson } from "./model";
import type { Household } from "./truth";

export const DEFAULT_JUDGE = "anthropic/claude-sonnet-5.5";
/** The second vendor's judge (spec §8: blind judges from two vendors); --judge-models overrides both. */
export const DEFAULT_JUDGES = [DEFAULT_JUDGE, "openai/gpt-5"];
export const AXES = ["fits_dishes", "meal_shape", "variety", "per_person", "overall"] as const;
export type JudgeScore = Record<(typeof AXES)[number], number> & { worst: string };

/** The family as a judge needs it: who, who cooks, each slot with its people and days, who is away when, the rules, what
 *  each slot's meals looked like (the seed) and their dishes per slot. */
export function familyText(h: Household): string {
  const t = h.truth;
  const dish = (d: (typeof t.library)[number]) => `${d.name}${d.frequency ? ` [${d.frequency}]` : ""}${d.days ? ` [on ${d.days.join(", ")}]` : ""}`;
  const slots = t.slots.filter((s) => !s.optional);
  return [
    `People: ${t.people.map((p) => `${p.name} (${p.group}${p.age ? `, ${p.age}` : ""})`).join(", ")}.`,
    t.cook ? `Cook ${t.cook.name}: ${t.cook.days.join(", ")}, ${t.cook.visits.map((v) => `${v.meals.join(" + ")} at ${v.at}`).join("; ")}.` : "No paid cook.",
    ...t.familyCooks.map((c) => `${c.person} cooks on ${c.days.join(", ")}.`),
    ...slots.map((s) => `Slot ${s.name}${s.kind === "addon" ? ` (beside ${s.addon_of}: only what is different)` : ""}: for ${s.usual_people?.join(", ") || "everyone"}${s.days ? `, on ${s.days.join(", ")}` : ""}${s.skip_days?.length ? `; ${s.skip_days.map((k) => `${k.day} ${k.skip.replace("_", " ")}`).join(", ")}` : ""}.`),
    ...t.away.map((a) => `${a.person} is not at ${a.slots.join(", ")} on ${a.days.join(", ")}.`),
    `Food rules: ${t.rules.filter((r) => r.hard).map((r) => r.title).join("; ") || "none"}.`,
    ...(t.rules.some((r) => !r.hard) ? [`Preferences: ${t.rules.filter((r) => !r.hard).map((r) => `${r.title}${r.frequency ? ` (${r.frequency})` : ""}`).join("; ")}.`] : []),
    `Their past meals per slot: ${[...new Set(t.seed.map((r) => r.slot))].map((s) => `${s}: ${t.seed.filter((r) => r.slot === s).map((r) => `"${r.dishes.join(", ")}"`).join("; ")}`).join(". ")}.`,
    `Their dishes: ${slots.map((s) => `${s.name}: ${t.library.filter((d) => d.slot === s.name).map(dish).join(", ")}`).join(". ")}.`,
    ...t.judgeNotes.map((n) => `Note: ${n}`),
  ].join("\n");
}

const SYSTEM = `You judge a week's meal plan for one Indian family. You get the family (people, who cooks, their meal slots with who eats
at each, their food rules, their past meals per slot, their own dishes) and the week planned for them: each slot of each
day with, in brackets, who it is for, then its dishes. Judge only whether this looks like THIS family's week, as the family would see it.
Score each 1-5 (5: they would accept it as is; 3: usable with several changes; 1: they would reject it):
- fits_dishes: built from their own dishes and their kind of food, not generic or another region's.
- meal_shape: each meal shaped like their past meals of that slot (their parts and staple, a light or full breakfast as they eat it).
- variety: sensible rotation, no main dish too often, occasional dishes occasional, day-bound dishes on their days.
- per_person: the right people at each slot (office lunches, fasts, guests, stays); each person's own slot and rules kept; fasts and allergies kept.
- overall: would they use this week.
Answer JSON only: {"fits_dishes": n, "meal_shape": n, "variety": n, "per_person": n, "overall": n, "worst": "<the one worst thing, under 25 words>"}`;

/** Several blind judges (spec §8: two vendors), each axis averaged; each judge's own scores kept. */
export async function judgeWeekMany(h: Household, week: string, models: string[]): Promise<JudgeScore & { by: Record<string, JudgeScore | string> }> {
  const by: Record<string, JudgeScore | string> = {};
  await Promise.all(models.map(async (m) => { try { by[m] = await judgeWeek(h, week, m); } catch (e) { by[m] = `failed: ${String(e).slice(0, 120)}`; } }));
  const ok = Object.values(by).filter((x): x is JudgeScore => typeof x !== "string");
  if (!ok.length) throw new Error(`every judge failed: ${JSON.stringify(by)}`);
  const out: any = { worst: ok.map((x) => x.worst).filter(Boolean).join(" | "), by };
  for (const a of AXES) out[a] = Math.round((10 * ok.reduce((s, x) => s + x[a], 0)) / ok.length) / 10;
  return out;
}

export async function judgeWeek(h: Household, week: string, model = DEFAULT_JUDGE): Promise<JudgeScore> {
  const j = await chatJson({ model, system: SYSTEM, user: `FAMILY\n${familyText(h)}\n\nTHE WEEK\n${week}`, maxTokens: 4000, temperature: 0 });
  const out: any = { worst: String(j?.worst ?? "") };
  for (const a of AXES) out[a] = Math.max(1, Math.min(5, Number(j?.[a]) || 1));
  return out;
}

const PAIR = `You compare two week meal plans (A and B) made for the same Indian family. You get the family (people, who cooks,
their slots, rules, their past meals per slot, their dishes) and both weeks. Which week would this family rather have?
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
