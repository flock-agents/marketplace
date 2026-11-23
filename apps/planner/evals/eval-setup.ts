// Eval 1: user input → constraints. For each household of the fixed set: a simulated interview (text only, a persona model
// answering the manifest's questions, one correction), then apply_setup on a fresh planner database with Flock's household
// facts and that transcript, then the saved rows scored field by field against TRUTH in code (lib/score-setup.ts).
//
//   bun evals/eval-setup.ts [--only h1,h3] [--repeat 1] [--out <dir>] [--reuse-transcripts <dir>] [--rescore <results.json>] [--concurrency 4]
//                           [--model deepseek/deepseek-v4-flash] [--persona-model <id>] [--no-think] [--self-test]
//
// --reuse-transcripts <dir>: read <dir>/transcripts/<household>-rep<n>.json instead of making new chats (re-score a setup
// change on the same words). --self-test: score TRUTH's own setup (no model): every field must pass.
import { mkdirSync, writeFileSync, readFileSync, existsSync, mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { boot } from "../server/testkit";
import { appModel, arg, flag, pool, spend, DEFAULT_UPSTREAM, type CallRow } from "./lib/model";
import { interview, type Transcript } from "./lib/interview";
import { pick } from "./households";
import { scoreSetup, totals, pct, type Rates } from "./lib/score-setup";
import { setupOfDb, setupOfTruth } from "./lib/setup";
import type { Household } from "./lib/truth";

const HH = pick(arg("only"));
const REPEAT = Number(arg("repeat") ?? 1);
const MODEL = arg("model") ?? DEFAULT_UPSTREAM;
const PERSONA = arg("persona-model") ?? DEFAULT_UPSTREAM;
const REUSE = arg("reuse-transcripts");
const CONC = Number(arg("concurrency") ?? 4);
const OUT = arg("out") ?? join(import.meta.dir, "results", `setup-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, "")}`);
const quiet = !flag("verbose");

// The app's own logs ("[planner] apply_setup: ...") interleave across households: kept out of the console unless --verbose.
const log0 = console.log;
if (quiet) console.log = (...a: unknown[]) => { if (!String(a[0] ?? "").startsWith("[planner]")) log0(...a); };

if (flag("self-test")) {
  let bad = 0;
  for (const h of HH) {
    const s = scoreSetup(h, setupOfTruth(h));
    const fails = Object.entries(s.rates).filter(([, [p, n]]) => p < n);
    if (fails.length) bad++;
    log0(`${h.id}: ${fails.length ? `FAIL ${fails.map(([k, r]) => `${k} ${pct(r)}`).join(", ")}\n  ${s.notes.join("\n  ")}` : "all pass"}`);
  }
  process.exit(bad ? 1 : 0);
}

// --rescore <results.json>: score the setups a past run saved again (a scorer change), no model.
const RESCORE = arg("rescore");
mkdirSync(join(OUT, "transcripts"), { recursive: true });

async function runOne(h: Household, rep: number) {
  const tfile = (dir: string) => join(dir, "transcripts", `${h.id}-rep${rep}.json`);
  let tr: Transcript;
  if (REUSE) {
    // A repeat past the saved ones reads the first chat again (the same words, read again: the setup's own variance).
    const file = existsSync(tfile(REUSE)) ? tfile(REUSE) : join(REUSE, "transcripts", `${h.id}-rep1.json`);
    if (!existsSync(file)) throw new Error(`no transcript ${tfile(REUSE)}`);
    tr = JSON.parse(readFileSync(file, "utf8"));
  } else tr = await interview(h, { model: PERSONA });
  writeFileSync(tfile(OUT), JSON.stringify(tr, null, 1));
  const calls: CallRow[] = [];
  const dataDir = mkdtempSync(join(tmpdir(), "planner-eval1-"));
  try {
    const k = await boot({ dataDir, model: appModel({ upstream: { balanced: MODEL, fast: MODEL }, noThink: flag("no-think"), sink: calls }) });
    const household = { ...h.household, "household.speaker": h.owner };
    const t0 = Date.now();
    const res = await k.op("apply_setup", { household, transcript: tr.lines });
    const ms = Date.now() - t0;
    const setup = await setupOfDb(k);
    const score = res.ok ? scoreSetup(h, setup) : { rates: {} as Rates, notes: [`apply_setup failed: ${res.reason} ${res.say ?? ""}`] };
    return { household: h.id, title: h.title, rep, ok: res.ok === true, setup_ms: ms, calls, rates: score.rates, notes: score.notes,
      said: res.said ?? res.say, noted: res.noted ?? [], dropped: res.dropped ?? [], setup, profile: res.profile, transcript: tr.lines };
  } finally { rmSync(dataDir, { recursive: true, force: true }); }
}

const jobs = HH.flatMap((h) => Array.from({ length: REPEAT }, (_, i) => ({ h, rep: i + 1 })));
const t0 = Date.now();
log0(`Eval 1 (setup): ${HH.length} households x ${REPEAT}, model ${MODEL}${flag("no-think") ? " (no think)" : ""}, persona ${REUSE ? `reused from ${REUSE}` : PERSONA}, out ${OUT}`);
const past = RESCORE ? JSON.parse(readFileSync(RESCORE, "utf8")).results as any[] : null;
const results = await pool(jobs, CONC, async ({ h, rep }) => {
  if (past) {
    const r = past.find((x) => x.household === h.id && x.rep === rep);
    if (!r?.setup) return { household: h.id, title: h.title, rep, ok: false, error: "not in the rescored run", rates: {} as Rates, notes: [] as string[] } as any;
    const sc = r.ok ? scoreSetup(h, r.setup) : { rates: {} as Rates, notes: [`apply_setup failed`] };
    return { ...r, rates: sc.rates, notes: sc.notes };
  }
  try {
    const r = await runOne(h, rep);
    const fails = Object.entries(r.rates).filter(([, [p, n]]) => p < n).map(([k, x]) => `${k} ${x[0]}/${x[1]}`);
    log0(`  ${h.id} rep ${rep}: ${r.ok ? "" : "SETUP FAILED "}${fails.length ? `misses: ${fails.join(", ")}` : "all pass"} (${(r.setup_ms / 1000).toFixed(0)}s)`);
    return r;
  } catch (e: any) {
    log0(`  ${h.id} rep ${rep}: ERROR ${e?.message ?? e}`);
    return { household: h.id, title: h.title, rep, ok: false, error: String(e?.stack ?? e), rates: {} as Rates, notes: [] as string[] } as any;
  }
});

// ── The scorecard ──
const tot = totals(results.map((r) => r.rates));
const fields = Object.keys(tot);
const lines: string[] = [];
lines.push(`# Eval 1 (setup) — ${new Date().toISOString().slice(0, 16)}`, "", `model ${MODEL}${flag("no-think") ? " (no think)" : ""}; persona ${REUSE ? `transcripts from ${REUSE}` : PERSONA}${RESCORE ? `; rescored from ${RESCORE} (time and spend are the rescore's)` : ""}; repeat ${REPEAT}; ${((Date.now() - t0) / 60000).toFixed(1)} min; spend $${spend.cost.toFixed(3)} (${spend.calls} calls)`, "");
lines.push(`| household | ${fields.join(" | ")} |`, `|---|${fields.map(() => "---").join("|")}|`);
for (const r of results) lines.push(`| ${r.household}${REPEAT > 1 ? ` #${r.rep}` : ""}${r.ok ? "" : " (FAILED)"} | ${fields.map((f) => (r.rates[f] ? `${r.rates[f][0]}/${r.rates[f][1]}` : "–")).join(" | ")} |`);
lines.push(`| **total** | ${fields.map((f) => pct(tot[f])).join(" | ")} |`, "");
lines.push("## Misses", "");
for (const r of results) if (r.notes.length || r.error) lines.push(`### ${r.household}${REPEAT > 1 ? ` #${r.rep}` : ""}`, ...(r.error ? [`- ERROR ${r.error.split("\n")[0]}`] : []), ...r.notes.map((n: string) => `- ${n}`), "");
const kinds = new Map<string, number>();
for (const r of results) for (const n of r.notes) { const k = n.split(":")[0]; kinds.set(k, (kinds.get(k) ?? 0) + 1); }
lines.push("## Top failure kinds", "", ...[...kinds].sort((a, b) => b[1] - a[1]).map(([k, n]) => `- ${k}: ${n}`), "");
writeFileSync(join(OUT, "results.json"), JSON.stringify({ kind: "eval1", model: MODEL, persona: PERSONA, repeat: REPEAT, totals: tot, spend, results }, null, 1));
writeFileSync(join(OUT, "summary.md"), lines.join("\n"));
log0(`\n${lines.join("\n")}\nsaved ${OUT}/results.json and summary.md`);
process.exit(0);
