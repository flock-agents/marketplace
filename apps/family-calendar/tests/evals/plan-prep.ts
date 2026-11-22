/**
 * The plan-prep prompt against a real model, graded by the cases in plan-cases.ts (expectations written before the prompt).
 * Not part of the app's tests (`bun test tests` runs *.test.ts only); run it by hand from the repo root:
 *
 *   EVALS_OPENAI_BASE=https://staging-api.flockagents.ai/v1 EVALS_OPENAI_KEY=<a Flock model key> \
 *     bun apps/family-calendar/tests/evals/plan-prep.ts [--model flock-fast] [--repeats 2] [--cases a,b] [--together]
 *
 * The wake is built as Flock builds an app routine's wake (app-routine-runs.ts: the routine's manifest prompt, then the
 * handler's message, then "Data from the app:" and the JSON), with the payload shape of server/calendar.ts planPrep. The model
 * has no tools: it writes the plan_done call it would make in a ```calls block, which is checked by the rules plan_done keeps
 * (server/calendar.ts stepRefusal) and by the case. Calls run one after another; a 429 waits and tries again.
 * `--together` also runs all ten events in one wake, as an hourly run with many new imports would.
 */
import { readFileSync } from "fs";
import { join } from "path";
import { CASES, TODAY, type PlanCase } from "./plan-cases";

const ROOT = join(import.meta.dir, "..", "..");
const manifest = JSON.parse(readFileSync(join(ROOT, "flock.app.json"), "utf8"));
const routine = manifest.routines.find((r: { id: string }) => r.id === "plan-prep");
const PROMPT: string = routine.prompt;
// The handler's message (server/calendar.ts PLAN_MESSAGE), read from the source so the two never drift.
const PLAN_MESSAGE = /export const PLAN_MESSAGE = "([^"]+)"/.exec(readFileSync(join(ROOT, "server", "calendar.ts"), "utf8"))![1];

const args = process.argv.slice(2);
const flag = (n: string, d?: string) => { const i = args.indexOf(`--${n}`); return i < 0 ? d : args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : "true"; };
const MODEL = flag("model", "flock-fast")!, REPEATS = Number(flag("repeats", "2")), ONLY = flag("cases")?.split(","), TOGETHER = flag("together") === "true";
const BASE = process.env.EVALS_OPENAI_BASE?.replace(/\/+$/, ""), KEY = process.env.EVALS_OPENAI_KEY;
if (!BASE || !KEY) { console.error("Set EVALS_OPENAI_BASE and EVALS_OPENAI_KEY (an OpenAI-compatible endpoint: Flock's model gateway)."); process.exit(2); }

const SYSTEM = [
  "You are Family Butler, a family's assistant in Flock. Apps wake you with work; you act on an app through the api tool, calling its operations.",
  "",
  "## Evaluation harness",
  "You have no tools in this evaluation. Do not call anything. Write the one plan_done call you would make as ONE fenced block opened with ```calls,",
  'holding a JSON array with one entry {"method":"POST","path":"/api/apps/family-calendar/ops/plan_done","body":{...}}, the body being the object you',
  "would send. Think first if you like, then write the block once and stop.",
].join("\n");

type Event = PlanCase["event"] & { ref: string; id: string; kind: string };
function wake(planId: string, events: Event[]): string {
  const payload = { planId, today: TODAY, nowLocal: "10:00", timezone: "Asia/Kolkata", events };
  return `[Scheduled Task: ${routine.name}] ${PROMPT}\n\n${PLAN_MESSAGE}\n\nData from the app:\n\`\`\`json\n${JSON.stringify(payload, null, 2)}\n\`\`\``;
}

async function ask(user: string): Promise<{ text: string; ms: number }> {
  for (let attempt = 1; ; attempt++) {
    const t0 = Date.now();
    const res = await fetch(`${BASE}/chat/completions`, {
      method: "POST", signal: AbortSignal.timeout(300_000),
      headers: { authorization: `Bearer ${KEY}`, "content-type": "application/json" },
      body: JSON.stringify({ model: MODEL, max_tokens: 8000, messages: [{ role: "system", content: SYSTEM }, { role: "user", content: user }] }),
    });
    const body = await res.text();
    if ((res.status === 429 || res.status >= 500) && attempt < 8) {
      const wait = Math.min(60_000, Number(res.headers.get("retry-after") ?? 0) * 1000 || 5_000 * 2 ** (attempt - 1));
      console.log(`  (${res.status}, waiting ${Math.round(wait / 1000)} s)`);
      await Bun.sleep(wait);
      continue;
    }
    if (!res.ok) throw new Error(`${MODEL} answered ${res.status}: ${body.slice(0, 300)}`);
    const text = JSON.parse(body).choices?.[0]?.message?.content;
    if (typeof text !== "string") throw new Error(`${MODEL} gave no message: ${body.slice(0, 300)}`);
    return { text, ms: Date.now() - t0 };
  }
}

/** The plan_done body in the reply: the first ```calls block's POST to plan_done. */
function reportOf(text: string): any | null {
  const m = /```calls\s*\n([\s\S]*?)```/.exec(text);
  if (!m) return null;
  try {
    const v = JSON.parse(m[1]);
    const calls = Array.isArray(v) ? v : [v];
    return calls.find((c) => /\/ops\/plan_done$/.test(String(c?.path ?? "")))?.body ?? null;
  } catch { return null; }
}

const KEY_RE = /^[a-z0-9-]{1,40}$/, DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
/** What plan_done would refuse (server/calendar.ts stepRefusal), and what the case expects. [] = pass. */
function grade(c: PlanCase, steps: any[] | undefined): string[] {
  const p: string[] = [];
  if (!Array.isArray(steps)) return [`${c.id}: the event is not in the report (or steps is not a list)`];
  const e = c.event;
  const open = new Set(e.steps.filter((s) => !s.closed).map((s) => s.key));
  for (const s of steps) {
    if (!s || typeof s !== "object") { p.push("a step is not an object"); continue; }
    if (!KEY_RE.test(s.key ?? "")) p.push(`key ${JSON.stringify(s.key)} is not lowercase-hyphens`);
    if (typeof s.title !== "string" || !s.title.trim()) p.push("a step has no title");
    if (!DATE_RE.test(s.due ?? "")) p.push(`${s.key}: due ${JSON.stringify(s.due)} is not a date`);
    else {
      if (s.due > e.date) p.push(`${s.key}: due ${s.due} is after the event (${e.date})`);
      if (s.due < TODAY) p.push(`${s.key}: due ${s.due} is before today`);
      if (s.show_from != null && (!DATE_RE.test(s.show_from) || s.show_from > s.due)) p.push(`${s.key}: show_from ${s.show_from} is not on or before due`);
    }
    if (e.steps.some((x) => x.closed && x.key === s.key)) p.push(`${s.key}: a closed key made again`);
    if (!open.has(s.key)) open.add(s.key);
  }
  if (open.size > 3) p.push(`${open.size} open steps (at most 3)`);
  const n = steps.length;
  if (n < c.steps[0] || n > c.steps[1]) p.push(`${n} steps (expected ${c.steps[0]} to ${c.steps[1]}): ${steps.map((s) => s.title).join(" | ") || "none"}`);
  const titles = steps.map((s) => String(s.title ?? "").toLowerCase());
  for (const group of c.mustMention ?? []) if (!titles.some((t) => group.some((w) => t.includes(w)))) p.push(`no step mentions ${group.join("/")}`);
  for (const w of c.never ?? []) for (const t of titles) if (t.includes(w)) p.push(`a step mentions "${w}": ${t}`);
  if (c.dueBy) for (const s of steps) if (c.dueBy.words.some((w) => String(s.title).toLowerCase().includes(w)) && s.due > c.dueBy.date) p.push(`${s.key}: due ${s.due}, expected by ${c.dueBy.date}`);
  if (c.redate) {
    const s = steps.find((x) => x.key === c.redate);
    if (!s) p.push(`the moved event's step ${c.redate} was not re-dated with its key`);
    else if (s.due > e.date) p.push(`${c.redate} re-dated to ${s.due}, after the new date ${e.date}`);
    const extra = steps.filter((x) => x.key !== c.redate);
    if (extra.length) p.push(`new steps on a move: ${extra.map((x) => x.key).join(", ")}`);
  }
  return p.map((x) => `${c.id}: ${x}`);
}

const cases = CASES.filter((c) => !ONLY || ONLY.includes(c.id));
const asEvent = (c: PlanCase, i: number): Event => ({ ref: `e${i + 1}`, id: `ev-${c.id}`, ...c.event });
const tally = new Map<string, { pass: number; runs: number; fails: string[] }>();
const note = (id: string, problems: string[]) => { const t = tally.get(id) ?? { pass: 0, runs: 0, fails: [] }; t.runs++; if (!problems.length) t.pass++; else t.fails.push(...problems); tally.set(id, t); };

console.log(`plan-prep eval: ${cases.length} cases x ${REPEATS} on ${MODEL}${TOGETHER ? ", and all together" : ""}`);
for (const c of cases) for (let r = 1; r <= REPEATS; r++) {
  const planId = `p-eval-${c.id}-${r}`;
  const { text, ms } = await ask(wake(planId, [asEvent(c, 0)]));
  const body = reportOf(text);
  const problems = !body ? [`${c.id}: no plan_done call in the reply`] : body.planId !== planId ? [`${c.id}: planId ${body.planId}`] : grade(c, body.events?.find((x: any) => x?.event === "e1")?.steps);
  note(c.id, problems);
  console.log(`${problems.length ? "FAIL" : "pass"} ${c.id} #${r} (${(ms / 1000).toFixed(1)} s)${problems.length ? `\n  ${problems.join("\n  ")}` : ""}`);
  if (problems.length && process.env.EVALS_VERBOSE) console.log(text);
}
if (TOGETHER) for (let r = 1; r <= REPEATS; r++) {
  const planId = `p-eval-all-${r}`;
  const { text, ms } = await ask(wake(planId, cases.map(asEvent)));
  const body = reportOf(text);
  console.log(`together #${r} (${(ms / 1000).toFixed(1)} s)`);
  cases.forEach((c, i) => {
    const problems = !body ? [`${c.id}: no plan_done call`] : grade(c, body.events?.find((x: any) => x?.event === `e${i + 1}`)?.steps);
    note(`${c.id} (together)`, problems);
    if (problems.length) console.log(`  FAIL ${problems.join("\n  ")}`);
  });
}
console.log("\ncase | passed");
let all = 0, passed = 0;
for (const [id, t] of tally) { console.log(`${id} | ${t.pass}/${t.runs}`); all += t.runs; passed += t.pass; }
console.log(`total | ${passed}/${all}`);
