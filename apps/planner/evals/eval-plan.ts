// Eval 2: constraints → plan (spec §8). For each household: TRUTH loaded into a fresh planner as rows (slots, library with
// contains, rules, seed history; no model), make_plan for one week with the week's dated facts and guests, the week
// scored in code against TRUTH (lib/score-plan.ts), then blind judges from two vendors (lib/judge.ts). The app is
// touched only through lib/adapter.ts.
//
//   bun evals/eval-plan.ts [--only h1,h3] [--week 2026-11-30] [--concurrency 4] [--out <dir>] [--model <id>] [--no-think]
//                          [--no-judge] [--judge-models anthropic/claude-sonnet-5.5,openai/gpt-5]
//   bun evals/eval-plan.ts --baseline                     a code-only rotation of the seed (no model, no app): the floor
//   bun evals/eval-plan.ts --perturb [kind,kind]          robustness: TRUTH with one defect at a time (truth-setup.ts PERTURBATIONS)
//   bun evals/eval-plan.ts --from-eval1 <results.json>    plan from what Eval 1's apply_setup saved (still scored vs TRUTH)
//   bun evals/eval-plan.ts --compare a/results.json b/results.json   pairwise judge of two runs' weeks
//   bun evals/eval-plan.ts --rescore <results.json>       a scorer change on a past run's saved weeks, judges kept, no model
//   bun evals/eval-plan.ts --heldout                      the held-out households h9–h12 instead (milestones only)
import { mkdirSync, writeFileSync, readFileSync, mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { appModel, arg, flag, pool, spend, DEFAULT_UPSTREAM, type CallRow } from "./lib/model";
import { ALL_HOUSEHOLDS, pick } from "./households";
import { perturb, PERTURBATIONS, setupOfTruth, type Perturbation } from "./lib/truth-setup";
import { scorePlan, weekText } from "./lib/score-plan";
import { baselineWeek } from "./lib/baseline";
import { AXES, DEFAULT_JUDGES, judgePair, judgeWeekMany } from "./lib/judge";
import { totals, type Rates } from "./lib/score-setup";
import { misses, table } from "./lib/report";
import type { PlanOut, SetupOut } from "./lib/result";
import type { Household } from "./lib/truth";

const WEEK0 = arg("week") ?? "2026-11-30";
const MODEL = arg("model") ?? DEFAULT_UPSTREAM;
const JUDGES = arg("judge-models")?.split(",").map((s) => s.trim()).filter(Boolean) ?? DEFAULT_JUDGES;
const CONC = Number(arg("concurrency") ?? 4);
const HELD = flag("heldout");
const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "");
const log0 = console.log;
if (!flag("verbose")) console.log = (...a: unknown[]) => { if (!String(a[0] ?? "").startsWith("[planner]")) log0(...a); };
const byId = (id: string) => ALL_HOUSEHOLDS.find((x) => x.id === id);

// ── Pairwise compare of two result files ──
if (flag("compare")) {
  const i = process.argv.indexOf("--compare");
  const [a, b] = [process.argv[i + 1], process.argv[i + 2]].map((f) => JSON.parse(readFileSync(f, "utf8")));
  const key = (r: any) => `${r.household}|${r.perturb ?? ""}`;
  const pairs = a.results.filter((r: any) => r.week && b.results.some((x: any) => key(x) === key(r) && x.week));
  const res = await pool(pairs, CONC, async (r: any, n) => {
    const h = byId(r.household)!;
    const other = b.results.find((x: any) => key(x) === key(r));
    const v = await judgePair(h, r.week, other.week, (n + h.id.length) % 2 === 0, JUDGES[0]);
    log0(`${key(r)}: ${v.better === "first" ? "A (first file)" : v.better === "second" ? "B (second file)" : "tie"} — ${v.why}`);
    return v.better;
  });
  log0(`\nfirst better ${res.filter((x) => x === "first").length}, second ${res.filter((x) => x === "second").length}, tie ${res.filter((x) => x === "tie").length} (judge ${JUDGES[0]}, $${spend.cost.toFixed(3)})`);
  process.exit(0);
}

// ── The runs ──
type Job = { h: Household; setup: SetupOut; perturb?: Perturbation; moved?: string[]; source: string };
const jobs: Job[] = [];
const RESCORE = arg("rescore");
const past = RESCORE ? JSON.parse(readFileSync(RESCORE, "utf8")) : null;
const FROM = arg("from-eval1");
if (FROM) {
  for (const r of JSON.parse(readFileSync(FROM, "utf8")).results) {
    const h = byId(r.household);
    if (h && r.setup && pick(arg("only"), { heldout: HELD }).includes(h)) jobs.push({ h, setup: r.setup, source: `eval1 rep ${r.rep}` });
  }
} else if (flag("perturb")) {
  const after = process.argv[process.argv.indexOf("--perturb") + 1];
  const kinds = (after && !after.startsWith("--") ? after.split(",") : Object.keys(PERTURBATIONS)) as Perturbation[];
  for (const h of pick(arg("only") ?? (HELD ? undefined : "h3,h1,h2"), { heldout: HELD })) for (const kind of kinds) {
    const { setup, moved } = perturb(h, setupOfTruth(h), kind);
    jobs.push({ h, setup, perturb: kind, moved, source: `truth + ${kind}` });
  }
} else for (const h of pick(arg("only"), { heldout: HELD })) jobs.push({ h, setup: setupOfTruth(h), source: "truth" });

const mode: string = past ? past.mode : flag("baseline") ? "baseline" : FROM ? "from-eval1" : flag("perturb") ? "perturb" : "truth";
const OUT = past ? join(RESCORE!, "..") : arg("out") ?? join(import.meta.dir, "results", `plan-${mode}${HELD ? "-heldout" : ""}-${stamp}`);
mkdirSync(OUT, { recursive: true });
const judging = !past && !flag("no-judge") && mode !== "perturb" && mode !== "baseline";

async function runOne(j: Job) {
  const calls: CallRow[] = [];
  let plan: PlanOut, refused: string[] = [], ms = 0;
  if (mode === "baseline") plan = baselineWeek(j.h, WEEK0);
  else {
    const { bootPlanner, loadSetup, runPlan } = await import("./lib/adapter");
    const dataDir = mkdtempSync(join(tmpdir(), "planner-eval2-"));
    try {
      const k = await bootPlanner({ dataDir, model: appModel({ upstream: { balanced: MODEL, fast: MODEL }, noThink: flag("no-think"), sink: calls }) });
      refused = loadSetup(k, j.setup);
      const t0 = Date.now();
      const r = await runPlan(k, j.h, WEEK0, j.h.truth.week ?? []);
      ms = Date.now() - t0;
      plan = r.plan;
      refused.push(...r.refused);
    } finally { rmSync(dataDir, { recursive: true, force: true }); }
  }
  const score = scorePlan(j.h, plan, j.setup);
  const week = weekText(plan);
  let judge: any = null;
  if (judging && plan.slotDays.length) { try { judge = await judgeWeekMany(j.h, week, JUDGES); } catch (e) { score.notes.push(`judge failed: ${e}`); } }
  return { household: j.h.id, title: j.h.title, perturb: j.perturb, moved: j.moved, source: j.source, ok: plan.ok, plan_ms: ms, refused,
    rates: score.rates, tracked: score.tracked, notes: score.notes, facts: score.facts, judge, unmet: plan.unmet, message: plan.message, week, plan, loaded: j.setup,
    calls: calls.length, cost: calls.reduce((a, c) => a + c.cost, 0) };
}

const t0 = Date.now();
if (!past) log0(`Eval 2 (plan, ${mode}${HELD ? ", HELD-OUT" : ""}): ${jobs.length} runs, week ${WEEK0}, model ${mode === "baseline" ? "none" : MODEL}${flag("no-think") ? " (no think)" : ""}, judges ${judging ? JUDGES.join(" + ") : "off"}, out ${OUT}`);
const results: any[] = past
  ? past.results.map((r: any) => {
    const h = byId(r.household);
    if (!h || !r.plan || !r.loaded) return r;
    const s = scorePlan(h, r.plan, r.loaded);
    return { ...r, rates: s.rates, tracked: s.tracked, notes: [...s.notes, ...(r.notes ?? []).filter((n: string) => n.startsWith("judge failed"))], facts: s.facts };
  })
  : await pool(jobs, CONC, async (j) => {
    const lab = `${j.h.id}${j.perturb ? ` / ${j.perturb}` : ""}`;
    try {
      const r = await runOne(j);
      const f = Object.entries(r.rates).filter(([, [p, n]]) => p < n).map(([k, x]) => `${k} ${x[0]}/${x[1]}`);
      log0(`  ${lab}: ${r.ok ? "" : "PLAN FAILED "}${f.join(", ") || "all pass"}${r.judge ? `; judges overall ${r.judge.overall}` : ""}${mode === "baseline" ? "" : ` (${(r.plan_ms / 1000).toFixed(0)}s, $${r.cost.toFixed(3)})`}`);
      return r;
    } catch (e: any) {
      log0(`  ${lab}: ERROR ${e?.message ?? e}`);
      return { household: j.h.id, perturb: j.perturb, ok: false, error: String(e?.stack ?? e), rates: {} as Rates, tracked: {}, notes: [] as string[], facts: {} } as any;
    }
  });

// ── The scorecard ──
const minutes = ((Date.now() - t0) / 60000).toFixed(1);
const lines = [`# Eval 2 (plan, ${mode}${HELD ? ", held-out" : ""}) — ${new Date().toISOString().slice(0, 16)}`, "",
  `week ${WEEK0}; model ${mode === "baseline" ? "none (code-only rotation of the seed)" : MODEL}${flag("no-think") ? " (no think)" : ""}; judges ${judging ? JUDGES.join(" + ") : past ? "kept from the run" : "off"}; ${past ? "re-scored from the saved weeks" : `${minutes} min; spend $${spend.cost.toFixed(3)} (${spend.calls} calls)`}`, ""];
const groups = mode === "perturb" ? (Object.keys(PERTURBATIONS) as Perturbation[]).filter((p) => results.some((r) => r.perturb === p)) : [""];
const factCols = ["hard_breaks", "new_dishes", "family_dish_share", "unmet", "flagged"];
const judged = results.some((r) => r.judge);
for (const g of groups) {
  const rs = results.filter((r) => (r.perturb ?? "") === g);
  if (g) lines.push(`## ${g}: ${PERTURBATIONS[g as Perturbation]}`, "");
  const jcols = judged && !g ? AXES.map((a) => `judge_${a}`) : [];
  lines.push(...table(rs.map((r) => ({ label: r.household, failed: !r.ok, rates: r.rates,
    extra: { ...Object.fromEntries(factCols.map((c) => [c, r.facts?.[c] ?? "–"])), ...Object.fromEntries(AXES.map((a) => [`judge_${a}`, r.judge?.[a] ?? "–"])) } })), [...factCols, ...jcols]));
  if (jcols.length) {
    const avg = (a: string) => { const xs = rs.map((r) => r.judge?.[a]).filter((x) => typeof x === "number"); return xs.length ? (xs.reduce((s: number, x: number) => s + x, 0) / xs.length).toFixed(1) : "–"; };
    lines.push(`Judges' average: ${AXES.map((a) => `${a} ${avg(a)}`).join(", ")}`, "");
  }
  lines.push("Tracked, not gating (shape: dish count per slot-day within ±1 of the slot's history):", "", ...table(rs.map((r) => ({ label: r.household, rates: r.tracked ?? {} }))));
}
lines.push(...misses(results.map((r) => ({ label: `${r.household}${r.perturb ? ` / ${r.perturb}` : ""}`, error: r.error,
  notes: [...(r.refused?.length ? [`refused while loading: ${r.refused.join("; ")}`] : []), ...(r.notes ?? []), ...(r.judge?.worst ? [`judge: ${r.judge.worst}`] : []), ...(r.unmet?.length ? [`planner said unmet: ${r.unmet.join("; ")}`] : [])] }))));
writeFileSync(join(OUT, "results.json"), JSON.stringify(past ? { ...past, results } : { kind: "eval2", mode, heldout: HELD, week: WEEK0, model: MODEL, judges: judging ? JUDGES : [], minutes: Number(minutes), spend, totals: totals(results.map((r) => r.rates)), results }, null, 1));
writeFileSync(join(OUT, "summary.md"), lines.join("\n"));
log0(`\n${lines.join("\n")}\nsaved ${OUT}/results.json and summary.md`);
process.exit(0);
