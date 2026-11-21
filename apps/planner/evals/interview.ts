// Interview-capture eval: bun apps/planner/evals/interview.ts [--fixtures run11] [--repeats 1] [--model claude-sonnet-5]
//   [--config-dir <real claude config dir>]
// The model gets the app's guide and the setup questions (ask + help + the operation each answer is saved with), then each of
// the fixture's answers, as said, in order; it answers with the calls it would make. Its set_house_rules rules are compared
// with the fixture's `rules`. No app is booted: the guide is read from server/agent-guide.md plus the operations' field list.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "fs";
import { join, resolve } from "path";
import { ask, flagsOf, jsonOf, modelOpts } from "./lib/model";
import { compareRules, type Rule } from "./lib/capture";
import { mdTable, pct } from "./lib/common";
import type { Fixture } from "./lib/score";

const { flags } = flagsOf(process.argv.slice(2));
const repeats = Number(flags.repeats ?? 1);
const only = flags.fixtures ? flags.fixtures.split(",") : null;
const mo = modelOpts(flags);
const appDir = resolve(import.meta.dir, "..");
const fixtures: Fixture[] = readdirSync(join(import.meta.dir, "fixtures")).filter((f) => f.endsWith(".json"))
  .map((f) => JSON.parse(readFileSync(join(import.meta.dir, "fixtures", f), "utf8"))).filter((fx: Fixture) => !only || only.includes(fx.id));
const outDir = join(process.env.EVALS_OUT ?? join(import.meta.dir, "results"), `interview-${new Date().toISOString().replace(/[:.]/g, "-")}`);
mkdirSync(outDir, { recursive: true });

// The guide as the agent reads it: the markdown plus the operations' fields (agentOps.ts FIELDS_SECTION, read as text so
// this script needs no assembled app).
const guideMd = readFileSync(join(appDir, "server/agent-guide.md"), "utf8");
const opsSrc = readFileSync(join(appDir, "server/agentOps.ts"), "utf8");
const fieldsBlock = opsSrc.slice(opsSrc.indexOf("export const FIELDS"), opsSrc.indexOf("};", opsSrc.indexOf("export const FIELDS")) + 2);
const manifest = JSON.parse(readFileSync(join(appDir, "flock.app.json"), "utf8"));
const questions: any[] = manifest.setup;

const SYSTEM = `${guideMd}

## Operations and their fields (from the app's code)
${fieldsBlock}

## This run (the eval harness)

You are running the Meal Planner's setup interview for a family. ${manifest.setupOptions?.about ?? ""}
Each question below was asked and the family answered as shown. You have no tools: the harness records the calls. Reply with
ONE JSON object and nothing else: { "calls": [ { "op": "<operation>", "payload": { ... } }, ... ] } — every call you would
make, in order, to save what the family said (set_person, set_cook, set_slots, set_cooking_days, set_house_rules, ...).
set_house_rules' rules list is the whole list each time: the last one is what is kept. Skip shopping apps, orders and plans.`;

function interviewText(fx: Fixture): string {
  const lines = [`Household (from Flock's family list): ${fx.told.family ?? fx.people.map((p) => `${p.name} (${p.relationship})`).join(", ")}`,
    `People and groups: ${fx.people.map((p) => `${p.name}: ${p.relationship}, ${p.group}`).join("; ")}`, ""];
  for (const q of questions) {
    const said = fx.told[q.id];
    if (said === undefined) continue;
    lines.push(`Q (${q.id}): ${q.ask}`);
    if (q.help) lines.push(`   [help: ${q.help}]`);
    if (q.answer?.operation) lines.push(`   [saved with: ${q.answer.operation}]`);
    lines.push(`A: ${said}`, "");
  }
  lines.push("Now reply with the calls.");
  return lines.join("\n");
}

type Rec = { fixture: string; rep: number; verdicts: ReturnType<typeof compareRules>["verdicts"]; extra: Rule[]; calls: any[]; cost: number };
const recs: Rec[] = [];
console.log(`interview eval: ${fixtures.map((f) => f.id).join(", ")} × ${repeats}, model ${mo.model}\n`);
for (const fx of fixtures) for (let rep = 1; rep <= repeats; rep++) {
  process.stdout.write(`${fx.id} #${rep} … `);
  try {
    const prompt = interviewText(fx);
    const reply = await ask(mo, SYSTEM, prompt);
    const calls: any[] = (jsonOf(reply.text).calls ?? []);
    const ruleCalls = calls.filter((c) => c.op === "set_house_rules" && Array.isArray(c.payload?.rules));
    const rules: Rule[] = ruleCalls.length ? ruleCalls[ruleCalls.length - 1].payload.rules : [];
    const personText = calls.filter((c) => c.op === "set_person" || c.op === "set_cook" || (c.op === "set_house_rules" && c.payload?.notes))
      .map((c) => JSON.stringify(c.payload)).join(" ");
    const { verdicts, extra } = compareRules(fx.rules as Rule[], rules, personText);
    recs.push({ fixture: fx.id, rep, verdicts, extra, calls, cost: reply.cost });
    writeFileSync(join(outDir, `${fx.id}-${rep}.json`), JSON.stringify({ prompt, reply: reply.text, calls, verdicts, extra }, null, 1));
    const n = (r: string) => verdicts.filter((v) => v.result === r).length;
    console.log(`captured ${n("captured")}/${verdicts.length}, wrong ${n("wrong")}, note only ${n("note_only")}, missed ${n("missed")}, extra ${extra.length}, $${reply.cost.toFixed(2)}`);
    for (const v of verdicts.filter((v) => v.result !== "captured")) console.log(`   ${v.result.toUpperCase()} ${v.rule}${v.why ? ` — ${v.why}` : ""}`);
  } catch (e) { console.log(`ERROR ${(e as Error).message}`); }
}
const lines = [`# Interview-capture eval ${new Date().toISOString()} — model ${mo.model}`, ""];
for (const fx of fixtures) {
  const rs = recs.filter((r) => r.fixture === fx.id);
  if (!rs.length) continue;
  const all = rs.flatMap((r) => r.verdicts);
  lines.push(`## ${fx.id} — captured ${pct(all.filter((v) => v.result === "captured").length, all.length)}`, "");
  lines.push(mdTable(["expected rule", ...rs.map((r) => `run ${r.rep}`)], fx.rules.map((_, i) => [rs[0].verdicts[i].rule, ...rs.map((r) => `${r.verdicts[i].result}${r.verdicts[i].why ? `: ${r.verdicts[i].why}` : ""}`)])), "");
}
writeFileSync(join(outDir, "summary.md"), lines.join("\n"));
console.log(`\n${lines.join("\n")}\n\nresults: ${outDir}`);
