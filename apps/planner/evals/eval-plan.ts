// Eval 2: constraints → plan. For each household: a fresh planner database loaded through the app's own routes with TRUTH
// (no model in the setup), make_plan for one week, the week scored in code against TRUTH (lib/score-plan.ts), then an LLM
// judge's 1–5 scores, blind (lib/judge.ts).
//
//   bun evals/eval-plan.ts [--only h1,h3] [--week 2026-11-30] [--out <dir>] [--concurrency 4] [--model <id>] [--no-think]
//                          [--no-judge] [--judge-model anthropic/claude-sonnet-5.5]
//   bun evals/eval-plan.ts --from-eval1 <eval1 results.json>      plan from what Eval 1's apply_setup saved (still scored vs TRUTH)
//   bun evals/eval-plan.ts --perturb [kind,kind] [--only h3,h1,h2] robustness: TRUTH with one defect at a time (setup.ts PERTURBATIONS)
//   bun evals/eval-plan.ts --compare a/results.json b/results.json pairwise judge of two runs' weeks, per household
//   bun evals/eval-plan.ts --rescore <results.json>                 score a past run's saved weeks again (a scorer change), judge kept
import { mkdirSync, writeFileSync, readFileSync, mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { boot } from "../server/testkit";
import { appModel, arg, flag, pool, spend, DEFAULT_UPSTREAM, type CallRow } from "./lib/model";
import { HOUSEHOLDS, pick } from "./households";
import { loadSetup, perturb, personalDishOwner, PERTURBATIONS, setupOfTruth, type Perturbation, type Setup } from "./lib/setup";
import { readWeek, scorePlan, weekOf, weekText } from "./lib/score-plan";
import { AXES, DEFAULT_JUDGE, judgePair, judgeWeek, type JudgeScore } from "./lib/judge";
import { pct, totals, type Rates } from "./lib/score-setup";
import type { Household } from "./lib/truth";

const WEEK = arg("week") ?? "2026-11-30";
const MODEL = arg("model") ?? DEFAULT_UPSTREAM;
const JUDGE = arg("judge-model") ?? DEFAULT_JUDGE;
const CONC = Number(arg("concurrency") ?? 4);
const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "");
const log0 = console.log;
if (!flag("verbose")) console.log = (...a: unknown[]) => { if (!String(a[0] ?? "").startsWith("[planner]")) log0(...a); };

// ── Pairwise compare of two result files ──
if (flag("compare")) {
  const i = process.argv.indexOf("--compare");
  const [a, b] = [process.argv[i + 1], process.argv[i + 2]].map((f) => JSON.parse(readFileSync(f, "utf8")));
  const key = (r: any) => `${r.household}|${r.perturb ?? ""}`;
  const pairs = a.results.filter((r: any) => r.week && b.results.some((x: any) => key(x) === key(r) && x.week));
  const res = await pool(pairs, CONC, async (r: any, n) => {
    const h = HOUSEHOLDS.find((x) => x.id === r.household)!;
    const other = b.results.find((x: any) => key(x) === key(r));
    const v = await judgePair(h, r.week, other.week, (n + h.id.length) % 2 === 0, JUDGE);
    log0(`${key(r)}: ${v.better === "first" ? "A (first file)" : v.better === "second" ? "B (second file)" : "tie"} — ${v.why}`);
    return v.better;
  });
  log0(`\nfirst file better ${res.filter((x) => x === "first").length}, second ${res.filter((x) => x === "second").length}, tie ${res.filter((x) => x === "tie").length} (judge ${JUDGE}, $${spend.cost.toFixed(3)})`);
  process.exit(0);
}

// ── Re-score a past run's weeks (a scorer change), keeping its judge scores: no model ──
const RESCORE = arg("rescore");
const past = RESCORE ? JSON.parse(readFileSync(RESCORE, "utf8")) : null;
if (past) {
  for (const r of past.results) {
    const h = HOUSEHOLDS.find((x) => x.id === r.household);
    if (!h || !r.week) continue;
    const meals = r.meals ?? weekOf(r.week, past.week);
    const extraPersonal = r.perturb === "personal_dish" ? { name: "Curd rice", slots: ["Dinner"], for: [personalDishOwner(h)] } : undefined;
    const sc = scorePlan(h, meals, new Map(Object.entries(r.slot_names ?? {})), { unmet: r.unmet, message: r.message }, { extraPersonal });
    // A run saved before `meals` was kept has only the week's text: no ingredients, so the checks that read ingredients
    // (hard rules, soft frequency) keep the run's own scores and notes.
    const kept = r.meals ? [] : ["hard_rules", "soft_frequency"];
    for (const f of kept) { if (r.rates?.[f]) sc.rates[f] = r.rates[f]; else delete sc.rates[f]; }
    const notes = [...sc.notes.filter((n) => !kept.some((f) => n.startsWith(`${f}:`))), ...(r.notes ?? []).filter((n: string) => n.startsWith("judge failed") || kept.some((f) => n.startsWith(`${f}:`)))];
    Object.assign(r, { rates: sc.rates, notes, facts: sc.facts });
  }
}

// ── The runs ──
type Job = { h: Household; setup: Setup; perturb?: Perturbation; source: string };
const jobs: Job[] = [];
const FROM = arg("from-eval1");
if (FROM) {
  const e1 = JSON.parse(readFileSync(FROM, "utf8"));
  for (const r of e1.results) {
    const h = HOUSEHOLDS.find((x) => x.id === r.household);
    if (h && r.setup && pick(arg("only")).includes(h)) jobs.push({ h, setup: r.setup, source: `eval1 rep ${r.rep}` });
  }
} else if (flag("perturb")) {
  const after = process.argv[process.argv.indexOf("--perturb") + 1];
  const kinds = (after && !after.startsWith("--") ? after.split(",") : Object.keys(PERTURBATIONS)) as Perturbation[];
  for (const h of pick(arg("only") ?? "h3,h1,h2")) for (const kind of kinds) jobs.push({ h, setup: perturb(h, setupOfTruth(h), kind), perturb: kind, source: `truth + ${kind}` });
} else for (const h of pick(arg("only"))) jobs.push({ h, setup: setupOfTruth(h), source: "truth" });

const mode: string = past ? past.mode : FROM ? "from-eval1" : flag("perturb") ? "perturb" : "truth";
const OUT = past ? join(RESCORE!, "..") : arg("out") ?? join(import.meta.dir, "results", `plan-${mode}-${stamp}`);
mkdirSync(OUT, { recursive: true });

async function runOne(j: Job) {
  const calls: CallRow[] = [];
  const dataDir = mkdtempSync(join(tmpdir(), "planner-eval2-"));
  try {
    const k = await boot({ dataDir, model: appModel({ upstream: { balanced: MODEL, fast: MODEL }, noThink: flag("no-think"), sink: calls }) });
    const refused = await loadSetup(k, j.setup);
    const t0 = Date.now();
    const plan = await k.op("make_plan", { week_start: WEEK });
    const ms = Date.now() - t0;
    const { meals, slotNames } = await readWeek(k, j.h, WEEK);
    const extraPersonal = j.perturb === "personal_dish" ? { name: "Curd rice", slots: ["Dinner"], for: [personalDishOwner(j.h)] } : undefined;
    const score = scorePlan(j.h, meals, slotNames, plan, { extraPersonal });
    const week = weekText(meals);
    let judge: JudgeScore | null = null;
    if (!flag("no-judge") && !j.perturb && meals.length) { try { judge = await judgeWeek(j.h, week, JUDGE); } catch (e) { score.notes.push(`judge failed: ${e}`); } }
    return { household: j.h.id, title: j.h.title, perturb: j.perturb, source: j.source, ok: plan.ok === true, plan_ms: ms, refused,
      rates: score.rates, notes: score.notes, facts: score.facts, judge, unmet: plan.unmet ?? [], message: plan.message ?? plan.say, week, meals, slot_names: Object.fromEntries(slotNames),
      calls: calls.length, cost: calls.reduce((a, c) => a + c.cost, 0) };
  } finally { rmSync(dataDir, { recursive: true, force: true }); }
}

const t0 = Date.now();
if (!past) log0(`Eval 2 (plan, ${mode}): ${jobs.length} runs, week ${WEEK}, model ${MODEL}${flag("no-think") ? " (no think)" : ""}, judge ${flag("no-judge") ? "off" : JUDGE}, out ${OUT}`);
const results: any[] = past ? past.results : await pool(jobs, CONC, async (j) => {
  const label = `${j.h.id}${j.perturb ? ` / ${j.perturb}` : ""}`;
  try {
    const r = await runOne(j);
    const fails = Object.entries(r.rates).filter(([, [p, n]]) => p < n).map(([k, x]) => `${k} ${x[0]}/${x[1]}`);
    log0(`  ${label}: ${r.ok ? "" : "PLAN FAILED "}${fails.join(", ") || "all pass"}${r.judge ? `; judge overall ${r.judge.overall}` : ""} (${(r.plan_ms / 1000).toFixed(0)}s, $${r.cost.toFixed(3)})`);
    return r;
  } catch (e: any) {
    log0(`  ${label}: ERROR ${e?.message ?? e}`);
    return { household: j.h.id, perturb: j.perturb, ok: false, error: String(e?.stack ?? e), rates: {} as Rates, notes: [] as string[], facts: {} } as any;
  }
});

// ── The scorecard ──
const lines: string[] = [];
const minutes = ((Date.now() - t0) / 60000).toFixed(1);
lines.push(`# Eval 2 (plan, ${mode}) — ${new Date().toISOString().slice(0, 16)}`, "", `week ${WEEK}; model ${MODEL}${flag("no-think") ? " (no think)" : ""}; judge ${flag("no-judge") ? "off" : JUDGE}; ${past ? `re-scored from the saved weeks (the run: ${past.minutes ?? "?"} min, $${(past.spend?.cost ?? 0).toFixed(3)})` : `${minutes} min; spend $${spend.cost.toFixed(3)} (${spend.calls} calls)`}`, "");
const groups = mode === "perturb" ? Object.keys(PERTURBATIONS).filter((p) => results.some((r) => r.perturb === p)) : [""];
for (const g of groups) {
  const rs = results.filter((r) => (r.perturb ?? "") === g);
  const tot = totals(rs.map((r) => r.rates));
  const fields = Object.keys(tot);
  if (g) lines.push(`## ${g}: ${PERTURBATIONS[g as Perturbation]}`, "");
  const factCols = ["family_dish_share", "unmet", "flagged"];
  lines.push(`| household | ${fields.join(" | ")} | ${factCols.join(" | ")}${g ? "" : ` | ${AXES.join(" | ")}`} |`, `|---|${[...fields, ...factCols, ...(g ? [] : AXES)].map(() => "---").join("|")}|`);
  for (const r of rs) lines.push(`| ${r.household}${r.ok ? "" : " (FAILED)"} | ${fields.map((f) => (r.rates[f] ? `${r.rates[f][0]}/${r.rates[f][1]}` : "–")).join(" | ")} | ${factCols.map((f) => r.facts?.[f] ?? "–").join(" | ")}${g ? "" : ` | ${AXES.map((a) => r.judge?.[a] ?? "–").join(" | ")}`} |`);
  const avg = (a: string) => { const xs = rs.map((r) => r.judge?.[a]).filter((x) => typeof x === "number"); return xs.length ? (xs.reduce((s: number, x: number) => s + x, 0) / xs.length).toFixed(1) : "–"; };
  lines.push(`| **total** | ${fields.map((f) => pct(tot[f])).join(" | ")} | | | ${rs.filter((r) => r.facts?.flagged).length}/${rs.length}${g ? "" : ` | ${AXES.map(avg).join(" | ")}`} |`, "");
}
lines.push("## Misses", "");
for (const r of results) {
  if (!r.notes?.length && !r.error && !r.judge?.worst) continue;
  lines.push(`### ${r.household}${r.perturb ? ` / ${r.perturb}` : ""}`, ...(r.error ? [`- ERROR ${r.error.split("\n")[0]}`] : []), ...(r.refused?.length ? [`- refused while loading: ${r.refused.join("; ")}`] : []),
    ...r.notes.map((n: string) => `- ${n}`), ...(r.judge?.worst ? [`- judge: ${r.judge.worst}`] : []), ...(r.unmet?.length ? [`- planner said unmet: ${r.unmet.join("; ")}`] : []), "");
}
const kinds = new Map<string, number>();
for (const r of results) for (const n of r.notes ?? []) { const k = n.split(":")[0]; kinds.set(k, (kinds.get(k) ?? 0) + 1); }
lines.push("## Top failure kinds", "", ...[...kinds].sort((a, b) => b[1] - a[1]).map(([k, n]) => `- ${k}: ${n}`), "");
writeFileSync(join(OUT, "results.json"), JSON.stringify(past ? past : { kind: "eval2", mode, week: WEEK, model: MODEL, judge: JUDGE, minutes: Number(minutes), spend, results }, null, 1));
writeFileSync(join(OUT, "summary.md"), lines.join("\n"));
log0(`\n${lines.join("\n")}\nsaved ${OUT}/results.json and summary.md`);
process.exit(0);
