// The planner's interview, text only: the manifest's setup questions in order, each `when` read against facts worked out
// from the household (its household.* facts, the grocery apps, the childSame answer), placeholders filled as Flock fills them
// (spec §10: {{you}}, {{cookName}}, {{children}}, {{lunchKnown}}), Flock's sign-in, read-back and closing
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
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri"];

/** The speaker's name: the one `household.people` entry with relation "self", else `household.speaker`, else the owner. */
function speakerOf(h: Household): string {
  const people = (h.household["household.people"] as { name: string; relation?: string }[] | undefined) ?? [];
  return people.find((p) => p.relation === "self")?.name ?? (h.household["household.speaker"] as string | undefined) ?? h.owner;
}

/** `{{lunchKnown}}`, as Flock's brief.ts lunchKnownLine words it: who is out on weekdays, by place (school with its end time),
 *  the speaker as "you" and first, then who has lunch at home. Null when nobody is out on a weekday. */
export function lunchKnownLine(h: Household): string | null {
  const weekly = (h.household["household.weekly"] ?? []) as { person: string; where?: string; weekdays?: string[]; to?: string }[];
  const away = weekly.filter((w) => typeof w.where === "string" && !/^(home|at home)$/i.test(w.where.trim()) && !/class/i.test(w.where)
    && (w.weekdays ?? []).some((d) => WEEKDAYS.includes(d)));
  if (!away.length) return null;
  const me = speakerOf(h).toLowerCase();
  const youFirst = (names: string[]) => [...names.filter((n) => n.toLowerCase() === me).slice(0, 1).map(() => "you"), ...names.filter((n) => n.toLowerCase() !== me)];
  const till = (t?: string) => {
    if (!t || !/^\d{1,2}:\d{2}$/.test(t.trim())) return "";
    const [hh, mm] = t.trim().split(":").map(Number);
    return ` till ${hh % 12 || 12}${mm ? `:${String(mm).padStart(2, "0")}` : ""}`;
  };
  const byPlace = new Map<string, string[]>(), awayNames: string[] = [];
  for (const w of away) {
    if (!awayNames.some((a) => a.toLowerCase() === w.person.toLowerCase())) awayNames.push(w.person);
    const place = /school/i.test(w.where!) ? `at school${till(w.to)}` : `at the ${w.where!.trim().toLowerCase()}`;
    byPlace.set(place, [...new Set([...(byPlace.get(place) ?? []), w.person])]);
  }
  const verb = (who: string[], many: string, one: string) => (who.length > 1 || who[0] === "you" ? many : one);
  const clauses = [...byPlace].map(([place, who0]) => { const who = youFirst(who0); return `${andList(who)} ${verb(who, "are", "is")} ${place}`; });
  const people = ((h.household["household.people"] as { name: string }[] | undefined) ?? []).map((p) => p.name);
  const home = youFirst(people.filter((n) => !awayNames.some((a) => a.toLowerCase() === n.toLowerCase())));
  const homeClause = home.length ? `${andList(home)} ${verb(home, "have", "has")} lunch at home` : "";
  return `On weekdays ${andList(clauses)}${homeClause ? `; ${homeClause}` : ""}.`;
}

/** The placeholders Flock fills (spec §10): `{{you}}`, `{{cookName}}` (her name, else "your cook"), `{{children}}` (the
 *  names joined), `{{lunchKnown}}`. Null: Flock has no value, the question's fallback is asked. */
function placeholder(h: Household, name: string): string | null {
  switch (name) {
    case "you": return "you";
    case "cookName": {
      const cooks = ((h.household["household.help"] as { role?: string; name?: string }[] | undefined) ?? []).filter((x) => String(x.role ?? "").toLowerCase() === "cook");
      return cooks.map((c) => c.name).find(Boolean) ?? "your cook";
    }
    case "children": { const xs = (h.household["household.children"] as string[] | undefined) ?? []; return xs.length ? andList(xs) : null; }
    case "lunchKnown": return lunchKnownLine(h);
    default: return null;
  }
}

/** A question's text as Flock sends it: its ask with every placeholder filled, else its fallback. */
function filled(h: Household, q: { ask: string; fallback?: string }): string {
  let missing = false;
  const ask = q.ask.replace(/\{\{(\w+)\}\}/g, (_, n: string) => { const v = placeholder(h, n); if (v === null) missing = true; return v ?? ""; }).trim();
  return missing && q.fallback ? q.fallback : ask;
}

/** The facts a question's `when` reads: Flock's household facts, the grocery apps, and `childDiffers` once the childSame
 *  question has been answered (the household's childSame fact says whether a child differs). */
function factsReader(h: Household, asked: Set<string>) {
  return (name: string): unknown => {
    if (name.startsWith("household.")) return h.household[name];
    if (name === "groceryApps") return h.groceryApps;
    if (name === "childDiffers") return asked.has("childSame") && h.facts.find((f) => f.id === "childSame")?.differs ? [true] : undefined;
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
    out.push({ id, ask: filled(h, q) });
  }
  return out;
}

/** The persona: the sim's owner style (flock-sim scripts/fake-whatsapp/sim/persona.ts), for one interview question. */
function personaSystem(h: Household, corrected: boolean): string {
  const facts = h.facts.map((f) => `- ${corrected && f.id === h.correction?.fact ? h.correction!.corrected : f.text}`).join("\n");
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
  dishes and people as in the facts, and say a dish's days or how often when the facts give them. Never add a how often or
  a day the facts don't give ("most days", "twice", "on weekdays", "sometimes" on a dish the facts list plainly): that
  would be a new fact.
- If a question was already answered by you earlier, say so briefly ("told you already, ...") and repeat the gist.
- If a question reads back something about your home, check it against the truth: say it's right, or what to fix.
- Sign-ins: whenever the Butler offers to sign in / connect to an app, you say "later" in passing, and still answer the question.

OUTPUT: a JSON object {"messages": ["<first message>", "<optional second message>"]}.`;
}

export type Transcript = { household: string; lines: string[]; questions: number; model: string; at: string };

/** One simulated interview. A household with fixed lines (`transcript`) is not simulated: its lines are the chat. */
export async function interview(h: Household, o: { model: string; temperature?: number }): Promise<Transcript> {
  if (h.transcript) return { household: h.id, lines: [...h.transcript], questions: h.transcript.filter((l) => l.startsWith("Q:")).length, model: "fixed", at: new Date().toISOString() };
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
    if (h.correction && q.id === h.correction.after && !corrected) { lines.push(`A: ${h.correction.line}`); corrected = true; }
  }
  if (h.correction && !corrected) lines.push(`A: ${h.correction.line}`);
  return { household: h.id, lines, questions: qs.length, model: o.model, at: new Date().toISOString() };
}
