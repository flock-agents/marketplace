// The base minimum, end to end (owner, 25 Nov): for each household, apply_setup on its chat and then make_plan in the same
// planner, as a live onboarding does; the week scored in code against TRUTH (lib/score-plan.ts) and held to its tier's bar.
//   Tier A, a household without elders, and tier B, elders who eat what everyone eats: every check passes, every run.
//   Tier C, elders with their own diet: the safety checks pass every run; the rest is reported.
// Each household runs REPEAT times (default 3). The app is touched only through lib/adapter.ts.
//
//   bun evals/eval-e2e.ts [--only h1,h13] [--heldout2] [--repeat 3] [--concurrency 4] [--transcripts <dir>] [--out <dir>] [--judge]
import { mkdirSync, writeFileSync, readFileSync, existsSync, mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { appModel, arg, flag, pool, spend, DEFAULT_UPSTREAM, type CallRow } from "./lib/model";
import { ALL_HOUSEHOLDS, pick } from "./households";
import { scorePlan, weekText } from "./lib/score-plan";
import { judgeWeekMany, DEFAULT_JUDGES } from "./lib/judge";
import type { Household } from "./lib/truth";
import type { Transcript } from "./lib/interview";

/** The owner's tiers (25 Nov). A household not listed is not run. */
export const TIERS: Record<string, "A" | "B" | "C"> = {
  "h1-sharma": "A", "h2-iyer": "A", "h6-kulkarni": "A", "h7-menon": "A",
  "h13-familyb": "B", "h14-familyb2": "B",
  "h3-shiva": "C", "h4-reddy": "C", "h5-agarwal": "C", "h8-banerjee": "C",
  // The second held-out set (--heldout2 only).
  "h15-gupta": "A", "h16-pillai": "A", "h17-subramanian": "B",
};
/** Must pass in every tier, every run (owner: nobody without food; no food rule broken). */
export const SAFETY = ["plan_made", "setup_time", "plan_time", "hard_rules", "nobody_without_food", "no_silent_filler"];
/** Must pass in tiers A and B, every run. dish_frequency is held to THEIR_DAYS of its checks, the rest to all. */
// No new-dish budget (owner, 25 Nov: the family's dishes guide the week, at least OWN_SHARE of it; the rest is for variety).
// Kinds model (owner, 25 Nov): no twice-a-week cap (main_twice gone); an item rotates within its kind (no_early_repeat),
// never the next day (not_next_day); a real dish each time (real_dish); a new dish only of the family's kinds (no_new_kind).
export const BASE = ["filled", "attendance", "not_bare", "whole_plate", "no_doubled_staple", "real_dish", "own_share", "no_new_kind",
  "no_early_repeat", "not_next_day", "dish_frequency", "message_clean", "short_new_reasons", "one_question", "new_like",
  // One meaning model (spec §7): linked parts equal the linked meal's item, the plan's unknowns are in its one question, only a
  // box that replaces a meal takes its person off it. (real_dish is above: it now also holds their words for a part.)
  "linked_parts", "unknowns_asked", "box_attendance"];
export const THEIR_DAYS = 0.8;
export const SETUP_MAX_MS = 150_000, PLAN_MAX_MS = 300_000;

const REPEAT = Number(arg("repeat") ?? 3);
const CONC = Number(arg("concurrency") ?? 4);
const MODEL = arg("model") ?? DEFAULT_UPSTREAM;
const TR = arg("transcripts") ?? join(import.meta.dir, "results", "setup-tuned-fresh");
const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "");
const OUT = arg("out") ?? join(import.meta.dir, "results", `e2e-${stamp}`);
const WEEK0 = "2026-11-30";
const log0 = console.log;
if (!flag("verbose")) console.log = (...a: unknown[]) => { if (!String(a[0] ?? "").startsWith("[planner]")) log0(...a); };
const HH = pick(arg("only"), { heldout2: flag("heldout2") }).filter((h) => TIERS[h.id]);

type Rates = Record<string, [number, number]>;
const ok = (r: Rates, k: string) => !r[k] || r[k][0] === r[k][1];
const passed = (tier: "A" | "B" | "C", r: Rates): { pass: boolean; failed: string[] } => {
  const need = tier === "C" ? SAFETY : [...SAFETY, ...BASE];
  const failed = need.filter((k) => (k === "dish_frequency" ? !!r[k] && r[k][0] / r[k][1] < THEIR_DAYS : !ok(r, k)));
  return { pass: !failed.length, failed };
};

async function runOne(h: Household, rep: number) {
  const file = [join(TR, "transcripts", `${h.id}-rep${rep}.json`), join(TR, "transcripts", `${h.id}-rep1.json`)].find(existsSync);
  if (!file) throw new Error(`no transcript for ${h.id} in ${TR}`);
  const tr: Transcript = JSON.parse(readFileSync(file, "utf8"));
  const { bootPlanner, runSetup, runPlan } = await import("./lib/adapter");
  const calls: CallRow[] = [];
  const dataDir = mkdtempSync(join(tmpdir(), "planner-e2e-"));
  try {
    // As Flock runs it: balanced reasons a little, fast does not.
    const k = await bootPlanner({ dataDir, model: appModel({ upstream: { balanced: MODEL, fast: MODEL }, prodTiers: true, sink: calls }) });
    const t0 = Date.now();
    const { res: sres, setup } = await runSetup(k, h, tr.lines);
    const setup_ms = Date.now() - t0;
    const rates: Rates = {}, notes: string[] = [];
    const add = (f: string, good: boolean, why?: string) => { const r = (rates[f] ??= [0, 0]); r[1]++; if (good) r[0]++; else if (why) notes.push(`${f}: ${why}`); };
    add("setup_time", setup_ms <= SETUP_MAX_MS, `setup took ${Math.round(setup_ms / 1000)} s`);
    if (sres?.ok === false) { add("plan_made", false, `apply_setup: ${sres.reason ?? ""} ${sres.say ?? ""}`); return { household: h.id, tier: TIERS[h.id], rep, rates, notes, setup_ms, plan_ms: 0, calls, said: sres?.say }; }
    const t1 = Date.now();
    const { res, plan } = await runPlan(k, h, WEEK0, h.truth.week ?? []);
    const plan_ms = Date.now() - t1;
    add("plan_time", plan_ms <= PLAN_MAX_MS, `plan took ${Math.round(plan_ms / 1000)} s`);
    add("plan_made", plan.ok && plan.slotDays.length > 0, `make_plan: ${res?.reason ?? ""} ${res?.say ?? ""}`);
    // What the plan read of its dishes counts (make_plan reads a dish setup did not): the library after planning.
    const score = scorePlan(h, plan, { ...setup, library: plan.library.length ? plan.library : setup.library }, { failClosed: false });
    for (const [f, [a, n]] of Object.entries(score.rates)) { const r = (rates[f] ??= [0, 0]); r[0] += a; r[1] += n; }
    notes.push(...score.notes);
    const week = weekText(plan);
    let judge: unknown = null;
    if (flag("judge")) { try { judge = await judgeWeekMany(h, week, DEFAULT_JUDGES); } catch (e) { notes.push(`judge failed: ${e}`); } }
    return { household: h.id, tier: TIERS[h.id], rep, rates, notes, setup_ms, plan_ms, calls, said: sres?.said, message: plan.message, week, judge, facts: score.facts, plan, setup };
  } finally { rmSync(dataDir, { recursive: true, force: true }); }
}

// --rescore <results.json>: a scorer change on a past run's saved weeks and setups, no model.
const RESCORE = arg("rescore");
mkdirSync(OUT, { recursive: true });
log0(`Base minimum (e2e): ${HH.length} households x ${REPEAT}, model ${MODEL} (prod tiers), transcripts ${TR}, out ${OUT}`);
const t0 = Date.now();
const jobs = HH.flatMap((h) => Array.from({ length: REPEAT }, (_, i) => ({ h, rep: i + 1 })));
const past: any[] | null = RESCORE ? JSON.parse(readFileSync(RESCORE, "utf8")) : null;
const results = past ? past.map((r) => {
  const h = HH.find((x) => x.id === r.household);
  if (!h || !r.plan) return r;
  const keep = Object.fromEntries(Object.entries(r.rates as Rates).filter(([k]) => ["setup_time", "plan_time", "plan_made"].includes(k)));
  const score = scorePlan(h, r.plan, { ...r.setup, library: r.plan.library.length ? r.plan.library : r.setup.library }, { failClosed: false });
  const rates: Rates = { ...keep, ...score.rates };
  const v = passed(r.tier, rates);
  log0(`  ${r.household} [${r.tier}] rep ${r.rep}: ${v.pass ? "PASS" : `FAIL ${v.failed.join(", ")}`}`);
  return { ...r, rates, notes: score.notes, facts: score.facts, pass: v.pass, failed: v.failed };
}) : await pool(jobs, CONC, async (j) => {
  try {
    const r = await runOne(j.h, j.rep);
    const v = passed(r.tier, r.rates);
    log0(`  ${j.h.id} [${r.tier}] rep ${j.rep}: ${v.pass ? "PASS" : `FAIL ${v.failed.join(", ")}`} (setup ${Math.round(r.setup_ms / 1000)} s, plan ${Math.round(r.plan_ms / 1000)} s)`);
    return { ...r, pass: v.pass, failed: v.failed };
  } catch (e) {
    log0(`  ${j.h.id} rep ${j.rep}: ERROR ${String(e).slice(0, 200)}`);
    return { household: j.h.id, tier: TIERS[j.h.id], rep: j.rep, pass: false, failed: ["error"], rates: {}, notes: [String(e)] };
  }
});
writeFileSync(join(OUT, "results.json"), JSON.stringify(results, null, 1));

// The report: each household's runs, its tier's verdict, then every miss.
const lines = [`# Base minimum (e2e) — ${new Date().toISOString().slice(0, 16)}`, "",
  `model ${MODEL} (prod tiers); ${REPEAT} runs each; ${((Date.now() - t0) / 60000).toFixed(1)} min; spend $${spend.cost.toFixed(3)} (${spend.calls} calls)`, "",
  "| household | tier | runs passed | verdict | failed checks |", "|---|---|---|---|---|"];
const verdicts: Record<string, boolean> = {};
for (const h of HH) {
  const rs = results.filter((r: any) => r.household === h.id);
  const n = rs.filter((r: any) => r.pass).length;
  verdicts[h.id] = n === rs.length;
  lines.push(`| ${h.id} | ${TIERS[h.id]} | ${n}/${rs.length} | ${verdicts[h.id] ? "PASS" : "FAIL"} | ${[...new Set(rs.flatMap((r: any) => r.failed))].join(", ")} |`);
}
for (const t of ["A", "B", "C"] as const) {
  const ids = HH.filter((h) => TIERS[h.id] === t).map((h) => h.id);
  if (ids.length) lines.push("", `**Tier ${t}: ${ids.every((id) => verdicts[id]) ? "PASS" : "FAIL"}** (${ids.filter((id) => verdicts[id]).length}/${ids.length} households)`);
}
lines.push("", "## Misses");
for (const r of results as any[]) if (r.notes?.length) lines.push("", `### ${r.household} rep ${r.rep}`, ...r.notes.slice(0, 40).map((n: string) => `- ${n}`));
lines.push("", "## Weeks");
for (const r of results as any[]) if (r.message) lines.push("", `### ${r.household} rep ${r.rep}`, "```", r.message, "```");
writeFileSync(join(OUT, "summary.md"), lines.join("\n"));
log0(lines.slice(0, 8 + HH.length + 8).join("\n"));
log0(`saved ${join(OUT, "results.json")} and summary.md`);
