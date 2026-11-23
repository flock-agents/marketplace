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
import { CASES, MEMBERS, TODAY, type PlanCase } from "./plan-cases";
import { EVENT_TYPES, kindSpec, type EventType } from "../../server/kinds";

const ROOT = join(import.meta.dir, "..", "..");
const manifest = JSON.parse(readFileSync(join(ROOT, "flock.app.json"), "utf8"));
const routine = manifest.routines.find((r: { id: string }) => r.id === "plan-prep");
const PROMPT: string = routine.prompt;
// The handler's message (server/calendar.ts PLAN_MESSAGE), read from the source so the two never drift.
const PLAN_MESSAGE = /export const PLAN_MESSAGE = "([^"]+)"/.exec(readFileSync(join(ROOT, "server", "calendar.ts"), "utf8"))![1];

const args = process.argv.slice(2);
const flag = (n: string, d?: string) => { const i = args.indexOf(`--${n}`); return i < 0 ? d : args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : "true"; };
const MODEL = flag("model", "flock-fast")!, REPEATS = Number(flag("repeats", "2")), ONLY = flag("cases")?.split(","), TOGETHER = flag("together") === "true" || flag("together-only") === "true";
const SINGLES = flag("together-only") !== "true";
const BASE = process.env.EVALS_OPENAI_BASE?.replace(/\/+$/, ""), KEY = process.env.EVALS_OPENAI_KEY;
if (!BASE || !KEY) { console.error("Set EVALS_OPENAI_BASE and EVALS_OPENAI_KEY (an OpenAI-compatible endpoint: Flock's model gateway)."); process.exit(2); }

const SYSTEM = [
  "You are Family Butler, a family's assistant in Flock. Apps wake you with work; you act on an app through the api tool, calling its operations.",
  "",
  "## Evaluation harness",
  "You have no tools in this evaluation. Where your instructions tell you to call flock-api, do not call anything: the reply to the GET is given to you",
  "below the data block, and every other call you would make (each PATCH tie, and the plan_done report) you write instead as an entry of ONE JSON array",
  'inside one fenced block opened with ```calls, each entry {"method":"PATCH"|"POST","path":"/api/...","body":{...}} with the body as the object you would',
  "send. Write the report once, then stop.",
].join("\n");

const APP = "family-calendar";
type Event = PlanCase["event"] & { ref: string; event: string; id: string };
/** The wake as Flock sends it (the routine's prompt, the handler's message, the data), then the GET's reply as the harness gives it. */
function wake(planId: string, events: Event[], habits: PlanCase["habits"], todos: NonNullable<PlanCase["todos"]>): string {
  const payload = { planId, appId: APP, today: TODAY, nowLocal: "10:00", timezone: "Asia/Kolkata", members: MEMBERS, habits: habits ?? {}, events };
  return `[Scheduled Task: ${routine.name}] ${PROMPT}\n\n${PLAN_MESSAGE}\n\nData from the app:\n\`\`\`json\n${JSON.stringify(payload, null, 2)}\n\`\`\``
    + `\n\nReply to \`GET /api/internal/todos\`:\n\`\`\`json\n${JSON.stringify({ todos }, null, 2)}\n\`\`\``;
}

async function ask(user: string): Promise<{ text: string; ms: number }> {
  for (let attempt = 1; ; attempt++) {
    const t0 = Date.now();
    let res: Response;
    try {
      res = await fetch(`${BASE}/chat/completions`, {
        method: "POST", signal: AbortSignal.timeout(300_000),
        headers: { authorization: `Bearer ${KEY}`, "content-type": "application/json" },
        body: JSON.stringify({ model: MODEL, max_tokens: 32000, messages: [{ role: "system", content: SYSTEM }, { role: "user", content: user }] }),
      });
    } catch (err) {
      // A call that timed out or dropped is tried again, as a 429 is.
      if (attempt < 8) { console.log(`  (${(err as Error).name}, trying again)`); continue; }
      throw err;
    }
    const body = await res.text();
    if ((res.status === 429 || res.status >= 500) && attempt < 8) {
      const wait = Math.min(60_000, Number(res.headers.get("retry-after") ?? 0) * 1000 || 5_000 * 2 ** (attempt - 1));
      console.log(`  (${res.status}, waiting ${Math.round(wait / 1000)} s)`);
      await Bun.sleep(wait);
      continue;
    }
    if (!res.ok) throw new Error(`${MODEL} answered ${res.status}: ${body.slice(0, 300)}`);
    const choice = JSON.parse(body).choices?.[0];
    const text = choice?.message?.content;
    // A model that spends its whole output on thinking gives no message: a failed run, not a crash of the eval.
    if (typeof text !== "string" && choice?.finish_reason === "length") return { text: "(no reply: the model ran out of output tokens)", ms: Date.now() - t0 };
    if (typeof text !== "string") throw new Error(`${MODEL} gave no message: ${body.slice(0, 300)}`);
    return { text, ms: Date.now() - t0 };
  }
}

/** The calls in the reply: every ```calls block, joined; the plan_done body and the ties (todo id -> pointer). */
function callsOf(text: string): { report: any | null; ties: { todo: string; event: string }[] } {
  const calls: any[] = [];
  for (const m of text.matchAll(/```calls\s*\n([\s\S]*?)```/g)) { try { const v = JSON.parse(m[1]); calls.push(...(Array.isArray(v) ? v : [v])); } catch { /* unreadable block */ } }
  const report = calls.find((c) => /\/ops\/plan_done$/.test(String(c?.path ?? "")))?.body ?? null;
  const ties = calls.flatMap((c) => { const m = /\/api\/internal\/todos\/([^/?]+)$/.exec(String(c?.path ?? "")); return m && String(c?.method).toUpperCase() === "PATCH" ? [{ todo: m[1], event: c.body?.event }] : []; });
  return { report, ties };
}

const KEY_RE = /^[a-z0-9-]{1,40}$/, DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
/** What plan_done would refuse (server/calendar.ts stepRefusal), and what the case expects. [] = pass. */
function grade(c: PlanCase, entry: any, ties: { todo: string; event: string }[], pointer: string): string[] {
  const p: string[] = [];
  const steps = entry?.steps;
  if (!Array.isArray(steps)) return [`${c.id}: the event is not in the report (or steps is not a list)`];
  const e = c.event;
  const type = entry.type as EventType;
  if (!EVENT_TYPES.includes(type)) p.push(`type ${JSON.stringify(type)} is not a type`);
  else if (!c.type.includes(type)) p.push(`typed ${type}, expected ${c.type.join(" or ")}`);
  for (const s of steps) {
    const spec = kindSpec(String(s?.kind));
    if (!spec) p.push(`${s?.key}: kind ${JSON.stringify(s?.kind)} is not in the table`);
    else if (EVENT_TYPES.includes(type) && !spec.types.includes(type)) p.push(`${s.key}: ${spec.kind} does not fit a ${type}`);
    if (c.kinds?.allowed && !c.kinds.allowed.includes(s?.kind)) p.push(`${s?.key}: a ${s?.kind} step (allowed: ${c.kinds.allowed.join(", ")})`);
    if (s?.due_time != null && !/^\d{2}:\d{2}$/.test(s.due_time)) p.push(`${s.key}: due_time ${s.due_time}`);
  }
  for (const k of c.kinds?.required ?? []) if (!steps.some((s: any) => s?.kind === k)) p.push(`no ${k} step`);
  const mine = ties.filter((t) => t.event === pointer).map((t) => t.todo);
  for (const id of c.tie ?? []) if (!mine.includes(id)) p.push(`TODO ${id} was not tied`);
  for (const id of c.noTie ?? []) if (ties.some((t) => t.todo === id)) p.push(`TODO ${id} was tied, and is not about this event`);
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
    const s = steps.find((x) => x.key === c.redate!.key);
    if (!s) p.push(`the moved event's step ${c.redate.key} was not re-dated with its key`);
    else {
      if (s.due > e.date) p.push(`${c.redate.key} re-dated to ${s.due}, after the new date ${e.date}`);
      if (c.redate.due && s.due !== c.redate.due) p.push(`${c.redate.key} re-dated to ${s.due}, expected ${c.redate.due}`);
      if (c.redate.due_time && s.due_time !== c.redate.due_time) p.push(`${c.redate.key} due_time ${s.due_time ?? "(none)"}, expected ${c.redate.due_time}`);
    }
    const extra = steps.filter((x) => x.key !== c.redate!.key);
    if (extra.length) p.push(`new steps on a move: ${extra.map((x) => x.key).join(", ")}`);
  }
  return p.map((x) => `${c.id}: ${x}`);
}

const cases = CASES.filter((c) => !ONLY || ONLY.includes(c.id));
const asEvent = (c: PlanCase, i: number): Event => ({ ref: `e${i + 1}`, event: `${APP}:ev-${c.id}`, id: `ev-${c.id}`, ...c.event });
const todosOf = (list: PlanCase[]) => list.flatMap((c) => c.todos ?? []);
const tally = new Map<string, { pass: number; runs: number; fails: string[] }>();
const note = (id: string, problems: string[]) => { const t = tally.get(id) ?? { pass: 0, runs: 0, fails: [] }; t.runs++; if (!problems.length) t.pass++; else t.fails.push(...problems); tally.set(id, t); };

console.log(`plan-prep eval: ${cases.length} cases x ${REPEATS} on ${MODEL}${TOGETHER ? ", and all together" : ""}`);
if (SINGLES) for (const c of cases) for (let r = 1; r <= REPEATS; r++) {
  const planId = `p-eval-${c.id}-${r}`;
  const ev = asEvent(c, 0);
  const { text, ms } = await ask(wake(planId, [ev], c.habits, c.todos ?? []));
  const { report: body, ties } = callsOf(text);
  const problems = !body ? [`${c.id}: no plan_done call in the reply`] : body.planId !== planId ? [`${c.id}: planId ${body.planId}`] : grade(c, body.events?.find((x: any) => x?.event === "e1"), ties, ev.event);
  note(c.id, problems);
  console.log(`${problems.length ? "FAIL" : "pass"} ${c.id} #${r} (${(ms / 1000).toFixed(1)} s)${problems.length ? `\n  ${problems.join("\n  ")}` : ""}`);
  if (problems.length && process.env.EVALS_VERBOSE) console.log(text);
}
if (TOGETHER) for (let r = 1; r <= REPEATS; r++) {
  const planId = `p-eval-all-${r}`;
  // Cases with habits of their own (a kind switched off) are left out of the all-together run: habits are the family's, for every event.
  const together = cases.filter((c) => !c.habits);
  const evs = together.map(asEvent);
  const { text, ms } = await ask(wake(planId, evs, {}, todosOf(together)));
  const { report: body, ties } = callsOf(text);
  console.log(`together #${r} (${(ms / 1000).toFixed(1)} s)`);
  if (!body && process.env.EVALS_VERBOSE) console.log(text);
  together.forEach((c, i) => {
    const problems = !body ? [`${c.id}: no plan_done call`] : grade(c, body.events?.find((x: any) => x?.event === `e${i + 1}`), ties, evs[i].event);
    note(`${c.id} (together)`, problems);
    if (problems.length) console.log(`  FAIL ${problems.join("\n  ")}`);
  });
}
console.log("\ncase | passed");
let all = 0, passed = 0;
for (const [id, t] of tally) { console.log(`${id} | ${t.pass}/${t.runs}`); all += t.runs; passed += t.pass; }
console.log(`total | ${passed}/${all}`);
