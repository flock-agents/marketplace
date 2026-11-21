// The plan eval, run inside the assembled app (plan.ts puts it there). For each fixture, N times: a real planner app on a
// fresh database, seeded through the agent's own operations; the planning model writes the week; plan_week final by the
// agent, refusals fed back (up to --rounds model calls); the saved week scored with the fixture's own expectations.
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
// @ts-ignore: resolved in the assembled app, where evals/ sits beside server/
import { boot } from "../server/testkit";
import { ask, flagsOf, jsonOf, modelOpts } from "./lib/model";
import { scoreWeek, type Fixture, type Outcome } from "./lib/score";
import { addDays, LEGACY_KINDS, mdTable, pct, type RunRecord } from "./lib/common";

const { flags } = flagsOf(process.argv.slice(2));
const repeats = Number(flags.repeats ?? 3);
const maxRounds = Number(flags.rounds ?? 3);
const only = flags.fixtures ? flags.fixtures.split(",") : null;
const mo = modelOpts(flags);
const fxDir = join(import.meta.dir, "fixtures");
const fixtures: Fixture[] = readdirSync(fxDir).filter((f) => f.endsWith(".json")).map((f) => JSON.parse(readFileSync(join(fxDir, f), "utf8")))
  .filter((fx: Fixture) => !only || only.includes(fx.id));
const outDir = join(process.env.EVALS_OUT!, `plan-${new Date().toISOString().replace(/[:.]/g, "-")}`);
mkdirSync(outDir, { recursive: true });

const FRAME = `

## This run (the eval harness)

You are the meal agent on the weekly run. You have no tools here: the harness makes the app calls for you. Reply with ONE JSON
object and nothing else: { "meals": [ ...every meal of the week... ], "repeats_ok"?: true }, each meal as plan_week takes it ({ date, slot,
ordered_in?, note?, dishes?: [{ name, for: ["everyone"] or [names], portion_note?, ingredients: [{ item, amount, unit }] }] }). The harness sends it
as plan_week { week_start, mode: "final", meals } and then the closing plan_week { week_start, mode: "final", repeats_ok }
(repeats_ok only when you send it). If the app
refuses either, you get its answer and send the whole week again, fixed.`;

async function seed(k: any, fx: Fixture): Promise<{ notes: string[] }> {
  const notes: string[] = [];
  const must = async (name: string, payload: object) => {
    const r = await k.op(name, payload);
    if (r?.error) throw new Error(`${fx.id}: ${name} refused: ${r.error}`);
    return r;
  };
  for (const p of fx.people) await must("set_person", p);
  await must("set_slots", { extra_slots: fx.slots.extra_slots, order_in: fx.slots.order_in });
  await must("set_cook", fx.cook);
  await must("set_cooking_days", { days: fx.cooking_days });
  // The rules as the contract has them; an app that does not take the new shape gets them as its own kinds and notes.
  const r = await k.op("set_house_rules", { rules: fx.rules });
  if (r?.error) {
    notes.push(`set_house_rules refused the contract shape: ${r.error}`);
    const legacy = fx.rules.map((x) => LEGACY_KINDS.includes(x.kind) && !x.who && !x.items
      ? { kind: x.kind, ...(x.days ? { days: x.days } : {}), ...(x.note ? { note: x.note } : {}) }
      : { kind: "other", ...(x.days ? { days: x.days } : {}), note: `${x.note ?? ""} [${[x.kind, x.who && `who ${x.who}`, x.slots && `slots ${x.slots.join("/")}`,
          x.items && `items ${x.items.join(", ")}`, x.to && `to ${x.to}`, x.per_week && `max ${x.per_week} a week`, x.per_meal && `max ${x.per_meal} dishes a meal`].filter(Boolean).join("; ")}]`.trim() });
    await must("set_house_rules", { rules: legacy, notes: fx.rules.map((x) => x.note).filter(Boolean) });
    notes.push("sent as legacy kinds + other notes");
  } else {
    const saved = (await k.owner("GET", "/api/family")).body.house.rules;
    const dropped = JSON.stringify(saved).includes('"items"') ? "" : " (the app kept kind/days/note only: who/slots/items dropped)";
    notes.push(`set_house_rules took the contract shape${dropped}`);
  }
  const prev = addDays(fx.week_start, -7);
  if (fx.last_week.length) {
    const meals = fx.last_week.map((m) => m.ordered_in ? { date: m.date, slot: m.slot, ordered_in: true, ...(m.note ? { note: m.note } : {}) }
      : { date: m.date, slot: m.slot, dishes: (m.dishes ?? []).map((name) => ({ name })) });
    const w = await k.owner("POST", `/api/weeks/${prev}/plan`, { mode: "final", meals });
    if (w.status >= 400) throw new Error(`${fx.id}: last week refused: ${JSON.stringify(w.body)}`);
  }
  return { notes };
}

async function once(fx: Fixture, guide: string, rep: number): Promise<RunRecord> {
  const dataDir = mkdtempSync(join(tmpdir(), "planner-evals-db-"));
  try {
    const k = await boot({ dataDir, now: () => new Date(`${fx.today}T11:00:00+05:30`) });
    const { notes } = await seed(k, fx);
    const ctx = await k.op("plan_week", { week_start: fx.week_start, mode: "draft" });
    if (!ctx?.context) throw new Error(`${fx.id}: plan_week draft gave no context: ${JSON.stringify(ctx).slice(0, 300)}`);
    const opening = `The weekly run woke you to plan next week. week_start: ${fx.week_start} (today is ${fx.today}).\n` +
      `plan_week { week_start: "${fx.week_start}", mode: "draft" } answered:\n${JSON.stringify(ctx, null, 1)}\n\nWrite the whole week now.`;
    const transcript: string[] = [opening];
    const refusals: string[] = [];
    let rounds = 0, accepted = false, cost = 0, ms = 0;
    while (rounds < maxRounds && !accepted) {
      rounds++;
      // --dry: no model, a one-meal stub, to check the seeding and the scoring end to end.
      const reply = flags.dry ? { text: JSON.stringify({ meals: [{ date: fx.week_start, slot: "Breakfast", dishes: [{ name: "Plain idli", for: ["everyone"], ingredients: [{ item: "idli batter", amount: 500, unit: "g" }] }] }] }), cost: 0, ms: 0 }
        : await ask(mo, guide + FRAME, transcript.join("\n\n"));
      cost += reply.cost; ms += reply.ms;
      let payload: any;
      try { payload = jsonOf(reply.text); } catch (e) {
        const said = `Your reply was not valid JSON (${(e as Error).message}). Reply with the JSON object only.`;
        refusals.push(said); transcript.push(`Your reply:\n${reply.text.slice(0, 2000)}`, said); continue;
      }
      const meals = Array.isArray(payload) ? payload : payload.meals;
      transcript.push(`Your reply:\n${JSON.stringify(Array.isArray(payload) ? { meals } : payload)}`);
      let r = await k.op("plan_week", { week_start: fx.week_start, mode: "final", meals });
      const repeatsOk = !Array.isArray(payload) && payload.repeats_ok === true;
      if (!r?.error) r = await k.op("plan_week", { week_start: fx.week_start, mode: "final", ...(repeatsOk ? { repeats_ok: true } : {}) });
      if (r?.error) {
        const said = `The app refused (${r.code}): ${r.error}${r.detail?.rule_breaks ? `\nrule_breaks: ${JSON.stringify(r.detail.rule_breaks)}` : ""}`;
        refusals.push(said);
        transcript.push(`${said}\n\nSend the whole week again, fixed, as the same JSON object.`);
      } else accepted = true;
    }
    const week = (await k.owner("GET", `/api/weeks/${fx.week_start}`)).body;
    const outcomes = scoreWeek(fx, week);
    const rec: RunRecord = { fixture: fx.id, rep, rounds, accepted, refusals, seed_notes: notes, outcomes, cost, ms };
    writeFileSync(join(outDir, `${fx.id}-${rep}.json`), JSON.stringify({ ...rec, week, transcript }, null, 1));
    return rec;
  } finally { rmSync(dataDir, { recursive: true, force: true }); }
}

const guideOp = async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "planner-evals-db-"));
  try { return (await (await boot({ dataDir })).op("guide")).guide as string; } finally { rmSync(dataDir, { recursive: true, force: true }); }
};
const guide = await guideOp();
const records: RunRecord[] = [];
console.log(`plan eval: ${fixtures.map((f) => f.id).join(", ")} × ${repeats}, model ${mo.model}, up to ${maxRounds} rounds\n`);
for (const fx of fixtures) for (let rep = 1; rep <= repeats; rep++) {
  process.stdout.write(`${fx.id} #${rep} … `);
  try {
    const r = await once(fx, guide, rep);
    records.push(r);
    const failed = r.outcomes.filter((o) => !o.pass);
    console.log(`${r.outcomes.length - failed.length}/${r.outcomes.length} pass, rounds ${r.rounds}, ${r.accepted ? "accepted" : "NOT accepted"}, refusals ${r.refusals.length}, $${r.cost.toFixed(2)}`);
    for (const n of r.seed_notes) console.log(`   seed: ${n.slice(0, 200)}`);
    for (const x of r.refusals) console.log(`   refused: ${x.slice(0, 300).replace(/\n/g, " ")}`);
    for (const o of failed) console.log(`   FAIL ${o.id}${o.heuristic ? " (heuristic)" : ""}${o.soft ? " (soft)" : ""}: ${o.breaks.slice(0, 4).join(" | ")}${o.breaks.length > 4 ? ` (+${o.breaks.length - 4})` : ""}`);
  } catch (e) { console.log(`ERROR ${(e as Error).message}`); }
}

// Summary: per fixture, per assertion pass rate.
const lines: string[] = [`# Plan eval ${new Date().toISOString()} — model ${mo.model}, ${repeats} repeat(s)`, ""];
for (const fx of fixtures) {
  const rs = records.filter((r) => r.fixture === fx.id);
  if (!rs.length) continue;
  const all = rs.flatMap((r) => r.outcomes);
  lines.push(`## ${fx.id} — ${pct(all.filter((o) => o.pass).length, all.length)} of assertions; all-pass runs ${rs.filter((r) => r.outcomes.every((o) => o.pass)).length}/${rs.length}; rounds ${rs.map((r) => r.rounds).join(",")}; accepted ${rs.filter((r) => r.accepted).length}/${rs.length}`, "");
  lines.push(mdTable(["assertion", "pass rate", "says"], fx.expect.map((e) => {
    const os = rs.map((r) => r.outcomes.find((o) => o.id === e.id)!).filter(Boolean) as Outcome[];
    return [e.id + (e.heuristic ? " *" : "") + (e.soft ? " (soft)" : ""), `${os.filter((o) => o.pass).length}/${os.length}`, e.says];
  })), "");
}
lines.push("`*` heuristic (dish-name lists for time/texture). Per-run detail: the JSON files beside this summary.");
writeFileSync(join(outDir, "summary.md"), lines.join("\n"));
console.log(`\n${lines.join("\n")}\n\nresults: ${outDir}`);
