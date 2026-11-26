// Eval 1: user input → constraints (spec §8). For each household: a simulated interview (a persona model answering the
// manifest's questions, one correction), apply_setup on a fresh planner with Flock's household facts (incl.
// household.weekly) and that transcript, then the saved rows (slots, library, rules, seed) scored against TRUTH in code
// (lib/score-setup.ts). The app is touched only through lib/adapter.ts.
//
//   bun evals/eval-setup.ts [--only h1,h3] [--repeat 1] [--concurrency 4] [--out <dir>] [--model <id>] [--persona-model <id>] [--no-think]
//   bun evals/eval-setup.ts --reuse-transcripts <dir>      re-score a setup change on the same chats (<dir>/transcripts/<id>-rep<n>.json)
//   bun evals/eval-setup.ts --rescore <results.json>       a scorer change on a past run's saved setups, no model
//   bun evals/eval-setup.ts --self-test                    TRUTH scored against itself: every field must pass (no model, no app)
//   bun evals/eval-setup.ts --contains                     contains accuracy on the labelled dish set (40 dishes, add_dish's read)
//   bun evals/eval-setup.ts --heldout                      the held-out households h9–h12 instead (milestones only; fresh chats)
import { mkdirSync, writeFileSync, readFileSync, existsSync, mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { appModel, arg, flag, pool, spend, DEFAULT_UPSTREAM, type CallRow } from "./lib/model";
import { interview, type Transcript } from "./lib/interview";
import { ALL_HOUSEHOLDS, pick } from "./households";
import { scoreSetup, pct, totals, type Rates } from "./lib/score-setup";
import { setupOfTruth } from "./lib/truth-setup";
import { CONTAINS_LABELS, scoreContains } from "./lib/contains-labels";
import { misses, table } from "./lib/report";
import type { Household } from "./lib/truth";

const HELD = flag("heldout");
const HH = pick(arg("only"), { heldout: HELD });
const REPEAT = Number(arg("repeat") ?? 1);
const MODEL = arg("model") ?? DEFAULT_UPSTREAM;
const PERSONA = arg("persona-model") ?? DEFAULT_UPSTREAM;
const REUSE = arg("reuse-transcripts");
const CONC = Number(arg("concurrency") ?? 4);
const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "");
const OUT = arg("out") ?? join(import.meta.dir, "results", `setup${HELD ? "-heldout" : ""}-${stamp}`);
const log0 = console.log;
if (!flag("verbose")) console.log = (...a: unknown[]) => { if (!String(a[0] ?? "").startsWith("[planner]")) log0(...a); };
const model = (sink: CallRow[]) => appModel({ upstream: { balanced: MODEL, fast: MODEL }, noThink: flag("no-think"), sink });

if (flag("self-test")) {
  let bad = 0;
  for (const h of HELD ? HH : arg("only") ? HH : ALL_HOUSEHOLDS) {
    const s = scoreSetup(h, setupOfTruth(h));
    const f = Object.entries(s.rates).filter(([, [p, n]]) => p < n);
    if (f.length) bad++;
    log0(`${h.id}: ${f.length ? `FAIL ${f.map(([k, r]) => `${k} ${pct(r)}`).join(", ")}\n  ${s.notes.join("\n  ")}` : `all pass (${Object.keys(s.rates).length} fields)`}`);
  }
  process.exit(bad ? 1 : 0);
}

if (flag("contains")) {
  const { bootPlanner, readContains } = await import("./lib/adapter");
  const dataDir = mkdtempSync(join(tmpdir(), "planner-eval1-contains-"));
  const calls: CallRow[] = [];
  try {
    const k = await bootPlanner({ dataDir, model: model(calls) });
    const got = await readContains(k, CONTAINS_LABELS.map((l) => l.dish));
    if (!got) { log0("the planner has no add_dish op yet: contains accuracy not run"); process.exit(2); }
    const s = scoreContains(got!);
    mkdirSync(OUT, { recursive: true });
    const lines = [`# Eval 1 contains accuracy — ${stamp}`, "", `model ${MODEL}; ${CONTAINS_LABELS.length} labelled dishes; spend $${spend.cost.toFixed(3)} (${spend.calls} calls)`, "",
      ...Object.entries(s.rates).map(([k, r]) => `- ${k}: ${pct(r)}`), "", "| tag | tp | fp | fn | tn | unread |", "|---|---|---|---|---|---|",
      ...Object.entries(s.perTag).map(([t, p]) => `| ${t} | ${p.tp} | ${p.fp} | ${p.fn} | ${p.tn} | ${p.unread} |`), "", "## Misses", "", ...s.notes.map((n) => `- ${n}`)];
    writeFileSync(join(OUT, "contains.json"), JSON.stringify({ kind: "eval1-contains", model: MODEL, got, score: s, spend }, null, 1));
    writeFileSync(join(OUT, "summary.md"), lines.join("\n"));
    log0(lines.join("\n"));
  } finally { rmSync(dataDir, { recursive: true, force: true }); }
  process.exit(0);
}

const RESCORE = arg("rescore");
mkdirSync(join(OUT, "transcripts"), { recursive: true });

async function runOne(h: Household, rep: number) {
  const tfile = (dir: string) => join(dir, "transcripts", `${h.id}-rep${rep}.json`);
  let tr: Transcript;
  if (REUSE) {
    // A repeat past the saved ones reads the first chat again (the same words read again: the setup's own variance).
    const file = existsSync(tfile(REUSE)) ? tfile(REUSE) : join(REUSE, "transcripts", `${h.id}-rep1.json`);
    if (!existsSync(file)) throw new Error(`no transcript ${tfile(REUSE)}`);
    tr = JSON.parse(readFileSync(file, "utf8"));
  } else tr = await interview(h, { model: PERSONA });
  writeFileSync(tfile(OUT), JSON.stringify(tr, null, 1));
  const { bootPlanner, runSetup } = await import("./lib/adapter");
  const calls: CallRow[] = [];
  const dataDir = mkdtempSync(join(tmpdir(), "planner-eval1-"));
  try {
    const k = await bootPlanner({ dataDir, model: model(calls) });
    const t0 = Date.now();
    const { res, setup } = await runSetup(k, h, tr.lines);
    const ms = Date.now() - t0;
    const score = res?.ok === false ? { rates: {} as Rates, info: {} as Rates, notes: [`apply_setup failed: ${res.reason ?? ""} ${res.say ?? ""}`] } : scoreSetup(h, setup, { transcript: tr.lines });
    return { household: h.id, title: h.title, rep, ok: res?.ok !== false, setup_ms: ms, calls, rates: score.rates, info: score.info, notes: score.notes,
      said: res?.said ?? res?.say, setup, transcript: tr.lines };
  } finally { rmSync(dataDir, { recursive: true, force: true }); }
}

const jobs = HH.flatMap((h) => Array.from({ length: REPEAT }, (_, i) => ({ h, rep: i + 1 })));
const t0 = Date.now();
log0(`Eval 1 (setup${HELD ? ", HELD-OUT" : ""}): ${HH.length} households x ${REPEAT}, model ${MODEL}${flag("no-think") ? " (no think)" : ""}, persona ${REUSE ? `reused from ${REUSE}` : PERSONA}, out ${OUT}`);
const past = RESCORE ? (JSON.parse(readFileSync(RESCORE, "utf8")).results as any[]) : null;
const results = await pool(jobs, CONC, async ({ h, rep }) => {
  if (past) {
    const r = past.find((x) => x.household === h.id && x.rep === rep);
    if (!r?.setup) return { household: h.id, rep, ok: false, error: "not in the rescored run", rates: {}, info: {}, notes: [] } as any;
    const sc = r.ok ? scoreSetup(h, r.setup, { transcript: r.transcript }) : { rates: {}, info: {}, notes: ["apply_setup failed"] };
    return { ...r, ...sc };
  }
  try {
    const r = await runOne(h, rep);
    const f = Object.entries(r.rates).filter(([, [p, n]]) => p < n).map(([k, x]) => `${k} ${x[0]}/${x[1]}`);
    log0(`  ${h.id} rep ${rep}: ${r.ok ? "" : "SETUP FAILED "}${f.length ? `misses: ${f.join(", ")}` : "all pass"} (${(r.setup_ms / 1000).toFixed(0)}s)`);
    return r;
  } catch (e: any) {
    log0(`  ${h.id} rep ${rep}: ERROR ${e?.message ?? e}`);
    return { household: h.id, title: h.title, rep, ok: false, error: String(e?.stack ?? e), rates: {} as Rates, info: {} as Rates, notes: [] as string[] } as any;
  }
});

const label = (r: any) => `${r.household}${REPEAT > 1 ? ` #${r.rep}` : ""}`;
const lines = [`# Eval 1 (setup${HELD ? ", held-out" : ""}) — ${new Date().toISOString().slice(0, 16)}`, "",
  `model ${MODEL}${flag("no-think") ? " (no think)" : ""}; persona ${REUSE ? `transcripts from ${REUSE}` : PERSONA}${RESCORE ? `; rescored from ${RESCORE}` : ""}; repeat ${REPEAT}; ${((Date.now() - t0) / 60000).toFixed(1)} min; spend $${spend.cost.toFixed(3)} (${spend.calls} calls)`, "",
  ...table(results.map((r) => ({ label: label(r), failed: !r.ok, rates: r.rates }))),
  "Informational (not gating):", "", ...table(results.map((r) => ({ label: label(r), rates: r.info ?? {} }))),
  ...misses(results.map((r) => ({ label: label(r), notes: r.notes ?? [], error: r.error })))];
writeFileSync(join(OUT, "results.json"), JSON.stringify({ kind: "eval1", heldout: HELD, model: MODEL, persona: PERSONA, repeat: REPEAT, totals: totals(results.map((r) => r.rates)), spend, results }, null, 1));
writeFileSync(join(OUT, "summary.md"), lines.join("\n"));
log0(`\n${lines.join("\n")}\nsaved ${OUT}/results.json and summary.md`);
process.exit(0);
