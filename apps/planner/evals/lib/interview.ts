// The planner's interview, text only: the manifest's setup questions in order, each `when` read against facts worked out
// from the household (approximate: children, elders, the cook, grocery apps), Flock's sign-in, read-back and closing
// questions left out. A persona model answers each question in one or two short WhatsApp messages; the household's
// correction is sent once, as its own reply, after the question it follows. The transcript is the lines Flock keeps:
// "Q: <question as sent>" and "A: <reply word for word>".
import { readFileSync } from "fs";
import { join } from "path";
import { chatJson } from "./model";
import type { Household } from "./truth";

const MANIFEST = JSON.parse(readFileSync(join(import.meta.dir, "../../flock.app.json"), "utf8"));
/** Questions Flock asks that are not about the household: sign-ins, the order read-back, the end. */
const SKIP = new Set(["connectLater", "orderFindings", "final"]);

// ── Flock's `when` (flock-app onboarding-interview/engine/facts.ts holds) and its two household lines (brief.ts) ──
const TERM = /^(!?)([a-zA-Z][a-zA-Z0-9_.]*)(?:\s+(has|=|!=)\s+(.+))?$/;
const isFilled = (v: unknown) => !(v === undefined || v === null || v === false || v === 0 || v === "" || (Array.isArray(v) && !v.length) || (typeof v === "object" && v && !Array.isArray(v) && !Object.keys(v).length));
const norm = (x: unknown) => String(x).trim().toLowerCase();
function holdsWord(v: unknown, word: string): boolean {
  const w = norm(word);
  if (Array.isArray(v)) return v.some((x) => (x && typeof x === "object" ? Object.values(x).some((f) => norm(f) === w) : norm(x) === w));
  return typeof v === "string" ? new RegExp(`(^|[^a-z])${w}([^a-z]|$)`, "i").test(v) : false;
}
export function holds(when: string | undefined, read: (n: string) => unknown): boolean {
  if (!when) return true;
  for (const raw of when.split(/\s+and\s+/)) {
    const m = raw.trim().match(TERM);
    if (!m) return false;
    const [, neg, name, op, word] = m;
    const v = read(name);
    const ok = !op ? isFilled(v) : op === "has" ? holdsWord(v, word.trim()) : (norm(v ?? "") === norm(word.trim())) === (op === "=");
    if (neg ? ok : !ok) return false;
  }
  return true;
}
const andList = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);
function peopleLine(people: unknown): string {
  const xs = (Array.isArray(people) ? people : []).map((p: any) => `${p.name}${typeof p.age === "number" ? ` (${p.age})` : ""}`);
  return xs.length ? `I have ${andList(xs)} eating at home.` : "";
}
function cookLine(help: unknown): string {
  const cooks = (Array.isArray(help) ? help : []).filter((h: any) => String(h?.role ?? "").toLowerCase() === "cook");
  if (!cooks.length) return "";
  const name = cooks.map((c: any) => c.name).find(Boolean) ?? "The cook";
  const days = cooks.map((c: any) => c.days).find(Boolean);
  const visits = cooks.map((c: any) => `${andList(c.meals ?? []) || "comes"}${c.times ? ` at ${c.times}` : ""}`);
  return `${name} cooks${days ? ` ${days}` : ""}: ${visits.join(", ")}.`;
}

/** The facts a question's `when` reads, at that point of the interview: Flock's household facts, the grocery apps, and the
 *  cook's days and visits once the cook question has been answered. */
function factsReader(h: Household, asked: Set<string>) {
  const t = h.truth;
  const elders = (h.household["household.elders"] as string[] | undefined) ?? [];
  const dietText = h.facts.find((f) => f.id === "diet")?.text ?? "";
  const elderWords = [...elders, ...((h.household["household.people"] as any[]) ?? []).filter((p) => p.group === "elder").map((p) => p.relation)].filter(Boolean);
  return (name: string): unknown => {
    if (name.startsWith("household.")) return h.household[name];
    if (name === "groceryApps") return h.groceryApps;
    if (name === "cook.days") return asked.has("cook") && t.cook ? t.cook.days.map((d) => d.toLowerCase()) : undefined;
    if (name === "cook.visits") return asked.has("cook") && t.cook ? t.cook.visits : undefined;
    if (name === "dietElders") return asked.has("diet") && elderWords.some((w) => new RegExp(`\\b${w}\\b`, "i").test(dietText)) ? true : undefined;
    return undefined;
  };
}

/** The questions this household is asked, in order: for each id, the first variant whose `when` holds. */
export function questionsFor(h: Household): { id: string; ask: string }[] {
  const asked = new Set<string>(), out: { id: string; ask: string }[] = [];
  const read = factsReader(h, asked);
  const ids = [...new Set((MANIFEST.setup as any[]).map((q) => q.id))].filter((id) => !SKIP.has(id));
  for (const id of ids) {
    const q = (MANIFEST.setup as any[]).find((x) => x.id === id && holds(x.when, read));
    asked.add(id);
    if (!q) continue;
    const ask = String(q.ask).replace("{{householdPeople}}", peopleLine(h.household["household.people"])).replace("{{householdCook}}", cookLine(h.household["household.help"])).trim();
    out.push({ id, ask });
  }
  return out;
}

/** The persona: the sim's owner style (flock-sim scripts/fake-whatsapp/sim/persona.ts), for one interview question. */
function personaSystem(h: Household, corrected: boolean): string {
  const facts = h.facts.map((f) => `- ${corrected && f.id === h.correction.fact ? h.correction.corrected : f.text}`).join("\n");
  return `${h.intro}, chatting on WhatsApp with "Butler", a new family assistant that is setting up a meal planner by asking you
questions. You are a real, slightly hurried person, not a tester.

YOUR FAMILY AND HOME (the truth; never contradict it, never invent other facts):
${facts}

HOW YOU WRITE:
- One or two WhatsApp messages for this question, short and natural, like texting: usually under 25 words each, never more
  than 45. No lists, no JSON, no markdown.
- Answer only what was asked. Don't recite everything you know; at most one closely related extra fact, and only
  sometimes. Facts nobody asked about stay unsaid (the Butler should ask for them).
- Sometimes your answer is a bit partial or casual (e.g. "zepto mostly"), that's fine, but never wrong. Keep the names of
  dishes and people as in the facts, and say a dish's days or how often when the facts give them.
- If a question was already answered by you earlier, say so briefly ("told you already, ...") and repeat the gist.
- If a question reads back something about your home, check it against the truth: say it's right, or what to fix.
- Sign-ins: whenever the Butler offers to sign in / connect to an app, you say "later" in passing, and still answer the question.

OUTPUT: a JSON object {"messages": ["<first message>", "<optional second message>"]}.`;
}

export type Transcript = { household: string; lines: string[]; questions: number; model: string; at: string };

/** One simulated interview. */
export async function interview(h: Household, o: { model: string; temperature?: number }): Promise<Transcript> {
  const lines: string[] = [];
  let corrected = false;
  const qs = questionsFor(h);
  for (const q of qs) {
    const recent = lines.slice(-12).join("\n");
    const j = await chatJson({ model: o.model, system: personaSystem(h, corrected), maxTokens: 400, temperature: o.temperature ?? 0.7, noThink: true,
      user: `${recent ? `The chat so far (latest last):\n${recent}\n\n` : ""}Butler's new question:\n${q.ask}` });
    const msgs = (Array.isArray(j?.messages) ? j.messages : [j?.message]).filter((m: unknown): m is string => typeof m === "string" && !!m.trim()).slice(0, 2);
    lines.push(`Q: ${q.ask.replace(/\n+/g, " ")}`);
    for (const m of msgs.length ? msgs : ["ok"]) lines.push(`A: ${m.trim().replace(/\n+/g, " ")}`);
    if (q.id === h.correction.after && !corrected) { lines.push(`A: ${h.correction.line}`); corrected = true; }
  }
  if (!corrected) lines.push(`A: ${h.correction.line}`);
  return { household: h.id, lines, questions: qs.length, model: o.model, at: new Date().toISOString() };
}
