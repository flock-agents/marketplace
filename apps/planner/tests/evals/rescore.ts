// Re-score a plan eval's saved weeks with the current fixtures and scorer (no model, no app):
//   bun apps/planner/tests/evals/rescore.ts <results/plan-... dir>
import { readdirSync, readFileSync } from "fs";
import { join } from "path";
import { scoreWeek, type Fixture } from "./lib/score";
const dir = process.argv[2];
const fixtures = new Map<string, Fixture>(readdirSync(join(import.meta.dir, "fixtures")).filter((f) => f.endsWith(".json"))
  .map((f) => JSON.parse(readFileSync(join(import.meta.dir, "fixtures", f), "utf8"))).map((fx: Fixture) => [fx.id, fx]));
const tally = new Map<string, { pass: number; n: number }>();
for (const f of readdirSync(dir).filter((f) => f.endsWith(".json")).sort()) {
  const run = JSON.parse(readFileSync(join(dir, f), "utf8"));
  const fx = fixtures.get(run.fixture)!;
  const out = scoreWeek(fx, run.week);
  const failed = out.filter((o) => !o.pass);
  console.log(`${f}: ${out.length - failed.length}/${out.length} pass, rounds ${run.rounds}, refusals ${run.refusals.length}`);
  for (const o of failed) console.log(`   FAIL ${o.id}: ${o.breaks.slice(0, 4).join(" | ")}${o.breaks.length > 4 ? ` (+${o.breaks.length - 4})` : ""}`);
  for (const o of out) { const t = tally.get(`${fx.id}/${o.id}`) ?? { pass: 0, n: 0 }; t.n++; if (o.pass) t.pass++; tally.set(`${fx.id}/${o.id}`, t); }
}
console.log("\nfailing assertions (pass/runs):");
for (const [k, t] of tally) if (t.pass < t.n) console.log(`  ${k}: ${t.pass}/${t.n}`);
