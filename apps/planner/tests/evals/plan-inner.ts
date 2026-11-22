// The plan eval, run inside the assembled app (plan.ts puts it there). For each fixture, N times: a real planner app on a
// fresh database, seeded through the agent's own operations; the planning model writes the week as the agent does on the
// weekly run (agent-guide.md): one cooking day a call (plan_week final, keep_rest), each refusal fed back for that day (up to
// --day-rounds calls a day), then the closing plan_week; a refused close is fixed by sending only the meals it names (up to
// --rounds calls). `--whole`: the older way, the whole week in one reply, sent again whole when refused. The saved week is
// scored with the fixture's own expectations.
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
const dayRounds = Number(flags["day-rounds"] ?? 4);
const whole = flags.whole === "true";
const menuFirst = flags["no-menu"] !== "true";
const menuRounds = Number(flags["menu-rounds"] ?? 4);
const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const weekdayOf = (date: string) => WEEKDAY[new Date(`${date}T00:00:00Z`).getUTCDay()];
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

const DAY_FRAME = `

## This run (the eval harness)

You are the meal agent on the weekly run, as the guide says. You have no tools here: the harness makes the app calls for you.
When asked for the menu, reply with ONE JSON object and nothing else: { "meals": [ ...every meal of the week, dishes by name
and for only, no ingredients... ], "repeats_ok"?: true }; the harness sends it as plan_menu { week_start, meals }. If the app
refuses, you get its answer: send the whole menu again, fixed.
Each time you are asked for a day, reply with ONE JSON object and nothing else:
{ "meals": [ ...that day's meals only... ] }, each meal as plan_week takes it ({ date, slot, ordered_in?, note?, dishes?: [{ name,
for: ["everyone"] or [names], portion_note?, ingredients: [{ item, amount, unit }] }] }). The harness sends it as
plan_week { week_start, mode: "final", keep_rest: true, meals }. If the app refuses, you get its answer: send that day again, fixed.
After the last day the harness makes the closing plan_week { week_start, mode: "final" }. If it is refused, reply with
{ "meals": [ ...only the meals you change, each meal whole... ], "repeats_ok"?: true } (repeats_ok only when the family asked
for a dish more than once); the harness sends them with keep_rest and closes again.`;

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

const refusalText = (r: any) =>
  `The app refused (${r.code}): ${r.error}${r.detail?.rule_breaks ? `\nrule_breaks: ${JSON.stringify(r.detail.rule_breaks)}` : ""}`;

/** The weekly run as the agent makes it: a day a call, refusals fed back for that day, then the close and its fixes. */
async function byDay(k: any, fx: Fixture, guide: string, ctx: any, transcript: string[], refusals: string[]) {
  let rounds = 0, cost = 0, ms = 0;
  const call = async (asked: string): Promise<any | null> => {
    transcript.push(asked);
    rounds++;
    const reply = await ask(mo, guide + DAY_FRAME, transcript.join("\n\n"));
    cost += reply.cost; ms += reply.ms;
    try {
      const payload = jsonOf(reply.text);
      transcript.push(`Your reply:\n${JSON.stringify(Array.isArray(payload) ? { meals: payload } : payload)}`);
      return Array.isArray(payload) ? { meals: payload } : payload;
    } catch (e) {
      const said = `Your reply was not valid JSON (${(e as Error).message}).`;
      refusals.push(said); transcript.push(`Your reply:\n${reply.text.slice(0, 2000)}`, said);
      return null;
    }
  };
  if (menuFirst) {
    let asked = `First the whole week's menu: every meal of every cooking day (the extra slots too), each dish by name with its for (and a portion_note where one person's portion differs), no ingredients, as { "meals": [...] }.`;
    for (let n = 0; n < menuRounds; n++) {
      const payload = await call(asked);
      if (!payload) { asked = "Send the menu again as the JSON object only."; continue; }
      const r = await k.op("plan_menu", { week_start: fx.week_start, meals: payload.meals, ...(payload.repeats_ok === true ? { repeats_ok: true } : {}) });
      if (!r?.error) { transcript.push(`The app took the menu. ${r.next ?? ""}`); break; }
      const said = refusalText(r);
      refusals.push(said);
      asked = `${said}\n\nSend the whole menu again, fixed, as the same JSON object.`;
    }
  }
  const days = Array.from({ length: 7 }, (_, i) => addDays(fx.week_start, i))
    .filter((d) => d >= fx.today && (ctx.context?.house?.cooking_days ?? fx.cooking_days).map((x: string) => x.slice(0, 3).toLowerCase()).includes(weekdayOf(d).toLowerCase()));
  for (const date of days) {
    let asked = menuFirst
      ? `Give ${weekdayOf(date)} ${date} its ingredients: every meal of that day from the menu (the same dishes, names and for), each dish with its ingredients, as { "meals": [...] }.`
      : `Plan ${weekdayOf(date)} ${date}: every meal of that day (its extra slots too), as { "meals": [...] }.`;
    for (let n = 0; n < dayRounds; n++) {
      const payload = await call(asked);
      if (!payload) { asked = `Send ${weekdayOf(date)} ${date} again as the JSON object only.`; continue; }
      const r = await k.op("plan_week", { week_start: fx.week_start, mode: "final", keep_rest: true, meals: payload.meals });
      if (!r?.error) {
        // The app took the day but names the dishes it now repeats: the agent fixes that day while it is on it.
        if (r?.note && n < dayRounds - 1) { asked = `The app took it, and says: ${r.note}\n\nSend ${weekdayOf(date)} ${date} again, fixed, as the same JSON object.`; continue; }
        transcript.push(r?.note ? `The app took it, and says: ${r.note}` : "The app took it."); break;
      }
      const said = refusalText(r);
      refusals.push(said);
      asked = `${said}\n\nSend ${weekdayOf(date)} ${date} again, fixed, as the same JSON object.`;
    }
  }
  let r = await k.op("plan_week", { week_start: fx.week_start, mode: "final" });
  for (let n = 0; r?.error && n < maxRounds; n++) {
    const said = refusalText(r);
    refusals.push(said);
    const payload = await call(`The closing plan_week was refused. ${said}\n\nReply with only the meals you change, each meal whole, as { "meals": [...], "repeats_ok"?: true }.`);
    if (!payload) continue;
    if (payload.meals?.length) {
      const w = await k.op("plan_week", { week_start: fx.week_start, mode: "final", keep_rest: true, meals: payload.meals });
      if (w?.error) { r = w; continue; }
    }
    r = await k.op("plan_week", { week_start: fx.week_start, mode: "final", ...(payload.repeats_ok === true ? { repeats_ok: true } : {}) });
  }
  return { rounds, accepted: !r?.error, cost, ms };
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
    if (!whole) {
      const r = await byDay(k, fx, guide, ctx, transcript, refusals);
      rounds = r.rounds; accepted = r.accepted; cost = r.cost; ms = r.ms;
    }
    while (whole && rounds < maxRounds && !accepted) {
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
console.log(`plan eval: ${fixtures.map((f) => f.id).join(", ")} × ${repeats}, model ${mo.model}, ${whole ? `whole week, up to ${maxRounds} rounds` : `${menuFirst ? `menu first (up to ${menuRounds} calls), then ` : ""}a day a call, up to ${dayRounds} calls a day + ${maxRounds} to close`}\n`);
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
