// Offline test of apply_setup on past simulated interviews: for each run, a fresh planner database, apply_setup with that
// run's household facts and its meals transcript, then make_plan for one week, graded in code. The model is a Flock tier's
// upstream reached through OpenRouter with Flock's app-model contract (schema in the system prompt, temperature 0.4, one
// retry on an answer that does not fit the schema). The live gateway's flock-balanced is deepseek/deepseek-v4-flash (sim
// fws.log, 23 Nov): pass it with --balanced and --fast. --no-think sends reasoning { enabled: false } (a gateway route
// set to reasoning "off"); without it the model thinks as it likes (a route with no reasoning setting).
//
//   bun scripts/setup-eval.ts --runs <dir,dir,...> [--repeat 3] [--week 2026-11-30] [--out <dir>] [--balanced <id>] [--fast <id>] [--no-think]
import { readFileSync, mkdirSync, writeFileSync, mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { homedir, tmpdir } from "os";
import { boot } from "../server/testkit";
import type { ModelRequest, ModelResult } from "../server/model";

const arg = (n: string) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : undefined; };
const RUNS = (arg("runs") ?? "").split(",").filter(Boolean);
const REPEAT = Number(arg("repeat") ?? 3);
const WEEK = arg("week") ?? "2026-11-30";
const OUT = arg("out") ?? join(tmpdir(), `setup-eval-${Date.now()}`);
const NO_THINK = process.argv.includes("--no-think");
const UPSTREAM = { balanced: arg("balanced") ?? "google/gemini-3.5-flash-lite", fast: arg("fast") ?? "google/gemini-3.1-flash-lite" };
mkdirSync(OUT, { recursive: true });

// ── The model: Flock's app-model contract over OpenRouter ──

const KEY = (() => {
  const env = readFileSync(join(homedir(), "Developer/flock/flock-web-services/.env"), "utf8");
  const m = /^OPENROUTER_API_KEY=(.*)$/m.exec(env);
  if (!m) throw new Error("no OPENROUTER_API_KEY");
  return m[1].trim().replace(/^["']|["']$/g, "");
})();

/** flock-app/server/src/app-model.ts jsonIn. */
function jsonIn(text: string): unknown {
  const t = text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  const fence = /```(?:json)?[ \t]*\n?([\s\S]*?)```/i.exec(t);
  for (const x of [t, ...(fence ? [fence[1].trim()] : [])]) {
    try { return JSON.parse(x); } catch { /* look inside */ }
  }
  for (const body of fence ? [fence[1], t] : [t]) {
    for (const [open, close] of [["{", "}"], ["[", "]"]] as const) {
      const b = body.lastIndexOf(close);
      for (let a = body.indexOf(open), n = 0; a >= 0 && a < b && n < 20; a = body.indexOf(open, a + 1), n++) {
        try { return JSON.parse(body.slice(a, b + 1)); } catch { /* the next opening */ }
      }
    }
  }
  throw new Error(`no JSON in the output (len=${text.length} end=${JSON.stringify(text.slice(-80))})`);
}
const isObj = (v: unknown): v is Record<string, any> => !!v && typeof v === "object" && !Array.isArray(v);
const typeOf = (v: unknown) => (v === null ? "null" : Array.isArray(v) ? "array" : typeof v === "number" ? (Number.isInteger(v) ? "integer" : "number") : typeof v);
/** flock-app/server/src/app-model.ts schemaProblems, the subset the planner's schemas use. */
function schemaProblems(s: any, v: unknown, path = "$", out: string[] = []): string[] {
  if (out.length >= 8 || !isObj(s)) return out;
  const at = (m: string) => out.push(`${path}: ${m}`);
  if (Array.isArray(s.anyOf) && !s.anyOf.some((x: any) => schemaProblems(x, v, path).length === 0)) at("matches none of the allowed shapes");
  if (s.type !== undefined) {
    const types = Array.isArray(s.type) ? s.type : [s.type];
    if (!types.some((t: string) => t === typeOf(v) || (t === "number" && typeOf(v) === "integer"))) { at(`must be ${types.join(" or ")}, got ${typeOf(v)}`); return out; }
  }
  if (Array.isArray(s.enum) && !s.enum.some((e: unknown) => JSON.stringify(e) === JSON.stringify(v))) at(`must be one of ${JSON.stringify(s.enum)}`);
  if (Array.isArray(v) && isObj(s.items)) v.forEach((x, n) => schemaProblems(s.items, x, `${path}[${n}]`, out));
  if (isObj(v)) {
    for (const k of s.required ?? []) if (!(k in v)) at(`"${k}" is required`);
    for (const [k, x] of Object.entries(v)) if (isObj(s.properties) && k in s.properties) schemaProblems(s.properties[k], x, `${path}.${k}`, out);
  }
  return out;
}

const calls: { purpose: string; tier: string; ms: number; ok: boolean; attempts: number; out: number; think: number }[] = [];
async function chat(model: string, system: string, user: string, maxTokens: number, usage: { out: number; think: number }): Promise<string> {
  let last = "";
  for (let i = 0; i < 4; i++) {
    try {
      const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST", headers: { authorization: `Bearer ${KEY}`, "content-type": "application/json" },
        body: JSON.stringify({ model, max_tokens: maxTokens, temperature: 0.4, messages: [{ role: "system", content: system }, { role: "user", content: user }],
          usage: { include: true }, ...(NO_THINK ? { reasoning: { enabled: false } } : {}) }),
        signal: AbortSignal.timeout(390_000),
      });
      const j: any = await r.json();
      const content = j?.choices?.[0]?.message?.content;
      usage.out += j?.usage?.completion_tokens ?? 0; usage.think += j?.usage?.completion_tokens_details?.reasoning_tokens ?? 0;
      if (r.ok && typeof content === "string" && content.trim()) return content;
      last = JSON.stringify(j?.error ?? j).slice(0, 300);
    } catch (e) { last = String(e); }
    await Bun.sleep(2000 * (i + 1));
  }
  throw new Error(last);
}
async function model(req: ModelRequest, sink?: typeof calls): Promise<ModelResult> {
  const t0 = Date.now(), upstream = UPSTREAM[req.tier];
  const system = req.schema ? `${req.system}\n\nOutput ONLY one JSON value matching this JSON Schema: no prose, no code fence.\n${JSON.stringify(req.schema)}` : req.system;
  let problem = "", attempts = 0;
  const usage = { out: 0, think: 0 };
  const done = (r: ModelResult) => {
    const row = { purpose: req.purpose ?? "", tier: req.tier, ms: Date.now() - t0, ok: r.ok, attempts, ...usage };
    calls.push(row); sink?.push(row);
    if (!r.ok && req.purpose?.startsWith("setup")) console.log(`[eval] setup call failed: ${r.code} ${r.message.slice(0, 400)}`);
    return r;
  };
  for (let attempt = 0; attempt < (req.schema ? 2 : 1); attempt++) {
    attempts++;
    let text: string;
    try { text = await chat(upstream, system, attempt === 0 ? req.user : `${req.user}\n\nYour last output could not be used (${problem}). Output only the JSON.`, Math.min(req.maxTokens ?? 4000, 16000), usage); }
    catch (e) { return done({ ok: false, code: "unavailable", message: String(e) }); }
    if (!req.schema) return done({ ok: true, text, model: upstream });
    let json: unknown;
    try { json = jsonIn(text); } catch (e) { problem = String(e); continue; }
    const ps = schemaProblems(req.schema, json);
    if (!ps.length) return done({ ok: true, json, model: upstream });
    problem = `it does not match the schema: ${ps.join("; ")}`;
  }
  return done({ ok: false, code: "invalid_output", message: problem });
}

// ── A past run: its household facts and its meals transcript ──

type Msg = { who: string; text: string };
function messages(file: string): Msg[] {
  const out: Msg[] = [];
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = /^\[\d\d:\d\d:\d\dZ (\w+)\] ?(.*)$/.exec(line);
    if (m) out.push({ who: m[1], text: m[2] });
    else if (out.length) out[out.length - 1].text += `\n${line}`;
  }
  return out;
}
/** From the first meals question ("hardest part of meals") to the plan message: each reply with the question before it. */
function transcriptOf(msgs: Msg[]): { lines: string[]; replies: string[] } {
  const start = msgs.findIndex((m) => m.who === "Butler" && /hardest part of meals/i.test(m.text));
  if (start < 0) throw new Error("no meals question");
  let end = msgs.findIndex((m, i) => i > start && m.who === "Butler" && /Give me a few minutes|Next week is planned/.test(m.text));
  if (end < 0) end = msgs.length;
  const lines: string[] = [], replies: string[] = [];
  let q: string | null = msgs[start].text;
  for (const m of msgs.slice(start + 1, end)) {
    if (m.who === "Butler") { q = m.text; continue; }
    if (q) lines.push(`Q: ${q.trim().replace(/\n+/g, " ")}`);
    q = null;
    lines.push(`A: ${m.text.trim().replace(/\n+/g, " ")}`);
    replies.push(m.text);
  }
  return { lines, replies };
}

type Expect = { diet: boolean; tiffin: boolean; snack: "none" | "everyone" | "Shiva+Ankita"; fast: boolean; sugar: boolean; mushroom: boolean; eggs: boolean; nut: boolean; rice: boolean; corr730: boolean; satOrder: boolean; sunOut: boolean };
function expectOf(replies: string[]): Expect {
  const said = replies.join("\n");
  const has = (re: RegExp) => re.test(said);
  return { diet: has(/vegetarian/i), tiffin: has(/tiffin/i),
    // Unnamed is everyone (owner, 23 Nov): a snack said without names is everyone's.
    snack: !has(/snack/i) ? "none" : has(/snack for Shiva and Ankita|Shiva and Ankita have an evening snack/i) ? "Shiva+Ankita" : "everyone",
    fast: has(/fasts? thursday/i), sugar: has(/no sugar/i), mushroom: has(/no mushroom/i), eggs: has(/no eggs/i), nut: has(/nut[- ]free/i),
    rice: has(/no rice at night|less rice/i), corr730: has(/7:30/), satOrder: has(/saturday dinner/i), sunOut: has(/sunday lunch|lunch out/i) };
}

// ── One run ──

const GS = "Gowri Shankar";
const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const WEEK_DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const dateOf = (i: number) => { const d = new Date(`${WEEK}T00:00:00`); d.setDate(d.getDate() + i); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

async function runOne(dir: string, rep: number) {
  const name = dir.split("/").pop()!;
  const record = JSON.parse(readFileSync(join(dir, "interview-owner.json"), "utf8"));
  // Flock knows who is writing: the owner's name goes with the facts.
  const household = { "household.speaker": "Shiva", ...Object.fromEntries(Object.entries(record.facts ?? {}).filter(([k]) => k.startsWith("household."))) };
  const { lines, replies } = transcriptOf(messages(join(dir, "owner.txt")));
  const ex = expectOf(replies);
  const dataDir = mkdtempSync(join(tmpdir(), "setup-eval-db-"));
  const before = calls.length;
  const mine: typeof calls = [];
  const myModel = (req: ModelRequest) => model(req, mine);
  void before;
  const k = await boot({ dataDir, model: myModel });
  const t0 = Date.now();
  const setup = await k.op("apply_setup", { household, transcript: lines });
  const setupMs = Date.now() - t0;
  const fam = (await k.owner("GET", "/api/family")).body;
  const h = fam.house;
  const c: Record<string, boolean | null> = {};
  const notes: string[] = [];
  c.setup_ok = setup.ok === true;
  // People
  const ppl = fam.people.map((p: any) => [p.name, p.group]);
  c.people = eq([...ppl].sort(), [["Agastya", "child"], ["Ankita", "adult"], [GS, "elder"], ["Shiva", "adult"]]);
  if (!c.people) notes.push(`people: ${JSON.stringify(ppl)}`);
  // Cook
  c.cook_days = h.cook_name === "Lakshmi" && eq(h.cook_days, ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]);
  const morning = h.cook_visits.find((v: any) => v.meals?.includes("Breakfast")) ?? h.cook_visits[0];
  const evening = h.cook_visits.find((v: any) => v.meals?.includes("Dinner"));
  c.cook_times = (ex.corr730 ? morning?.at === "07:30" : morning?.at === "07:00") && !h.cook_visits.some((v: any) => v.at === (ex.corr730 ? "07:00" : "07:30")) && evening?.at === "18:00";
  if (!c.cook_days || !c.cook_times) notes.push(`cook: ${h.cook_name} ${JSON.stringify(h.cook_days)} ${JSON.stringify(h.cook_visits)}`);
  // Slots
  const tiffin = h.extra_slots.filter((s: any) => /tiffin/i.test(s.name));
  // Mon–Fri only where the family said the tiffin's days.
  const tiffinDays = replies.some((r) => /tiffin[^.]*(mon|monday)/i.test(r));
  c.tiffin = !ex.tiffin ? tiffin.length === 0 : tiffin.length === 1 && (!tiffinDays || eq(tiffin[0].days, ["Mon", "Tue", "Wed", "Thu", "Fri"])) && eq(tiffin[0].for, ["Agastya"]);
  const snack = h.extra_slots.filter((s: any) => /snack/i.test(s.name));
  const snackWho = snack[0] ? (snack[0].for?.length ? snack[0].for.join("+") : "everyone") : "none";
  const snackDays = snack[0] ? (snack[0].days?.length ? snack[0].days.join(",") : "every day") : "";
  // Mon–Sat is right too where the old interview read the snack back as Mon–Sat and the family said it was right.
  const readBackSat = lines.some((l) => /^Q:.*snack Mon–Sat/i.test(l));
  c.snack = ex.snack === "none" ? snack.length === 0 : snack.length === 1 && (!snack[0].days?.length || snack[0].days.length === 7 || (readBackSat && snack[0].days.length === 6 && !snack[0].days.includes("Sun")))
    && snackWho === ex.snack;
  c.no_extra_slots = h.extra_slots.length === tiffin.length + snack.length;
  if (!c.no_extra_slots || !c.tiffin || !c.snack) notes.push(`slots: ${JSON.stringify(h.extra_slots)}`);
  const ord = h.order_in.map((o: any) => `${o.day} ${o.slot}`);
  c.order_in = (!ex.sunOut || ord.includes("Sun Lunch")) && (!ex.satOrder || ord.includes("Sat Dinner")) && ord.length === [ex.sunOut, ex.satOrder].filter(Boolean).length;
  if (!c.order_in) notes.push(`order_in: ${JSON.stringify(h.order_in)}`);
  // Rules
  const R = h.rules as any[];
  const items = (r: any) => (r.items ?? []).map((i: string) => i.toLowerCase());
  const hasItem = (r: any, re: RegExp) => items(r).some((i: string) => re.test(i));
  const forGS = (r: any) => r.who === GS;
  c.r_veg = ex.diet ? R.some((r) => r.kind === "veg" || (r.kind === "avoid" && !r.who && hasItem(r, /@meat/))) : null;
  c.r_eggs = ex.eggs ? R.some((r) => (r.kind === "no_eggs" && !r.days?.length) || (r.kind === "avoid" && !r.who && hasItem(r, /egg/))) : null;
  c.r_mushroom = ex.mushroom ? R.some((r) => r.kind === "avoid" && !r.who && hasItem(r, /mushroom/)) : null;
  c.r_nut_tiffin = ex.nut ? R.some((r) => r.kind === "avoid" && hasItem(r, /nut|peanut/) && ((r.slots ?? []).some((s: string) => /tiffin/i.test(s)) || r.who === "Agastya")) : null;
  c.r_fast = ex.fast ? R.some((r) => r.kind === "fasting" && forGS(r) && eq(r.days, ["Thu"]) && (r.slots ?? []).includes("Breakfast") && (r.slots ?? []).includes("Lunch") && !(r.slots ?? []).includes("Dinner")) : null;
  c.r_sugar = ex.sugar ? R.some((r) => forGS(r) && ["avoid", "swap"].includes(r.kind) && hasItem(r, /sweet|sugar/)) : null;
  c.r_rice = ex.rice ? R.some((r) => forGS(r) && ["avoid", "swap", "cap"].includes(r.kind) && hasItem(r, /rice/)) : null;
  // Quotes of the rules saved: in the family's replies exactly (normalised), else loose.
  const plain = (s: string) => s.toLowerCase().replace(/[’']/g, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  const said = replies.map(plain).join(" | ") + " | " + plain(JSON.stringify(household));
  const loose = (setup.rules ?? []).filter((r: any) => r.quote && !said.includes(plain(r.quote))).map((r: any) => r.quote);
  if (loose.length) notes.push(`loose quotes (kept by the fuzzy match): ${JSON.stringify(loose)}`);
  // The plan
  const t1 = Date.now();
  const plan = setup.ok ? await k.op("make_plan", { week_start: WEEK }) : { ok: false, reason: "no setup" };
  const planMs = Date.now() - t1;
  c.plan_ok = plan.ok === true;
  if (!plan.ok) notes.push(`plan: ${plan.reason ?? plan.error} ${plan.say ?? ""}`);
  const meals = k.rows("plan_meals").filter((m) => m.date >= WEEK && m.date <= dateOf(6));
  const dishes = k.rows("dishes");
  const dItems = k.rows("dish_items");
  const dishesOf = (m: any) => dishes.filter((d) => d.meal_id === m.id);
  const missing: string[] = [];
  if (plan.ok) {
    for (let i = 0; i < 7; i++) {
      const day = WEEK_DAYS[i], date = dateOf(i);
      const want = ["Breakfast", "Lunch", "Dinner", ...h.extra_slots.filter((s: any) => !s.days?.length || s.days.includes(day)).map((s: any) => s.name)];
      for (const slot of want) {
        const m = meals.find((x) => x.date === date && x.slot === slot);
        const ordered = h.order_in.some((o: any) => o.day === day && o.slot === slot);
        // A meal everyone at it fasts at is no meal (makePlan.slotNeeds).
        if (!m) { if (!(ex.fast && day === "Thu")) missing.push(`${day} ${slot}`); continue; }
        if (ordered ? !m.ordered_in : !dishesOf(m).length) missing.push(`${day} ${slot}${ordered ? " (not ordered in)" : ""}`);
      }
    }
  }
  c.plan_complete = plan.ok ? missing.length === 0 : false;
  // Every day is planned (owner, 23 Nov): Sunday, the cook's day off, has its breakfast and dinner cooked at home.
  const sun = meals.filter((m) => m.date === dateOf(6));
  c.sunday_cooked = plan.ok ? ["Breakfast", "Dinner"].every((s) => sun.some((m) => m.slot === s && !m.ordered_in && dishesOf(m).length)) : false;
  if (missing.length) notes.push(`meals without dishes: ${missing.join(", ")}`);
  const thu = meals.filter((m) => m.date === dateOf(3) && ["Breakfast", "Lunch"].includes(m.slot));
  const gsEats = thu.flatMap(dishesOf).filter((d) => { const f = d.for_people ? JSON.parse(d.for_people) : null; return !f || f.includes("everyone") || f.includes(GS); });
  c.plan_fast = ex.fast ? plan.ok && gsEats.length === 0 : null;
  if (ex.fast && gsEats.length) notes.push(`Thu fast broken: ${gsEats.map((d) => `${d.name} ${d.for_people}`).join("; ")}`);
  const bad = dishes.filter((d) => meals.some((m) => m.id === d.meal_id)).filter((d) => /\b(egg|omelette|omelet|anda|mushroom)/i.test(d.name)
    || dItems.some((i) => i.dish_id === d.id && /\b(egg|mushroom)/i.test(i.item)));
  // Only a family that said no eggs or no mushrooms is checked for them (seed 13 said nothing: an omelette is fine there).
  c.plan_no_egg_mushroom = !ex.eggs && !ex.mushroom ? null : plan.ok ? bad.length === 0 : false;
  if (bad.length) notes.push(`egg/mushroom dishes: ${bad.map((d) => d.name).join(", ")}`);
  // The setup's readers run at once: a part's time is its calls' (a retry follows its first try), the setup's the slowest part.
  const sc = mine.filter((x) => x.purpose.startsWith("setup"));
  const parts = [...new Set(sc.map((x) => x.purpose))].map((purpose) => { const xs = sc.filter((x) => x.purpose === purpose);
    return { part: purpose.replace(/^setup: (the )?/, ""), ms: xs.reduce((a, x) => a + x.ms, 0), attempts: xs.reduce((a, x) => a + x.attempts, 0), out: xs.reduce((a, x) => a + x.out, 0), think: xs.reduce((a, x) => a + x.think, 0), ok: xs.at(-1)!.ok }; });
  const setupCall = parts.length ? { ms: Math.max(...parts.map((x) => x.ms)), attempts: parts.reduce((a, x) => a + x.attempts, 0) } : undefined;
  // The week's lunches and dinners with who eats each dish, and the dish book they were planned from, to read by eye.
  const forOf = (d: any) => { const f = d.for_people ? JSON.parse(d.for_people) : null; return !f || f.includes("everyone") ? "all" : f.join("+"); };
  const week = WEEK_DAYS.map((day, i) => ["Lunch", "Dinner"].map((slot) => {
    const m = meals.find((x) => x.date === dateOf(i) && x.slot === slot);
    return `${day} ${slot}: ${!m ? "-" : m.ordered_in ? "ordered in" : dishesOf(m).map((d) => `${d.name} [${forOf(d)}]`).join(", ")}`;
  })).flat();
  const book = k.rows("dish_book").filter((b) => b.slots).map((b) => `${b.name} @${JSON.parse(b.slots).join(",")}${b.eaten_by ? ` [${JSON.parse(b.eaten_by).join("+")}]` : ""}`);
  rmSync(dataDir, { recursive: true, force: true });
  const row = { run: name, rep, setup_ms: setupCall?.ms ?? setupMs, setup_wall_ms: setupMs, setup_attempts: setupCall?.attempts ?? 0, parts, plan_ms: planMs, checks: c, snack: `${snackWho} ${snackDays}`.trim(),
    expected_snack: ex.snack, notes, said: setup.said ?? setup.say ?? setup.error, noted: setup.noted ?? [], dropped: setup.dropped ?? [], rules: (setup.rules ?? []).map((r: any) => `${r.saved_as}${r.who ? ` ${r.who}` : ""}${r.items ? ` [${r.items.join(",")}]` : ""}${r.slots ? ` @${r.slots.join(",")}` : ""}${r.days ? ` ${r.days.join(",")}` : ""}${r.per_meal ? ` per_meal=${r.per_meal}` : ""} "${r.quote}"`),
    plan_message: plan.message?.split("\n").slice(0, 3).join(" / "), unmet: plan.unmet ?? [], week, book, examples: (h.meal_examples ?? []).map((x: any) => `${x.slot}${x.group ? ` (${x.group})` : ""}: ${x.words}`) };
  writeFileSync(join(OUT, `${name}-rep${rep}.json`), JSON.stringify({ ...row, transcript: lines, profile: setup.profile }, null, 1));
  return row;
}

const results: Awaited<ReturnType<typeof runOne>>[] = [];
for (let rep = 1; rep <= REPEAT; rep++) {
  const batch = await Promise.all(RUNS.map((d) => runOne(d, rep).catch((e) => ({ run: d.split("/").pop()!, rep, error: String(e?.stack ?? e) }) as any)));
  for (const r of batch) {
    results.push(r);
    if (r.error) { console.log(`\n### ${r.run} rep ${rep}: ERROR ${r.error}`); continue; }
    const fails = Object.entries(r.checks).filter(([, v]) => v === false).map(([k]) => k);
    console.log(`\n### ${r.run} rep ${rep}: ${fails.length ? `FAIL ${fails.join(", ")}` : "ALL PASS"}  setup ${(r.setup_ms / 1000).toFixed(1)}s (wall ${(r.setup_wall_ms / 1000).toFixed(1)}s, attempts ${r.setup_attempts}), plan ${(r.plan_ms / 1000).toFixed(0)}s, snack: ${r.snack} (expected ${r.expected_snack})`);
    console.log(`  parts: ${r.parts.map((x: any) => `${x.part} ${(x.ms / 1000).toFixed(1)}s x${x.attempts} out=${x.out} think=${x.think}${x.ok ? "" : " FAILED"}`).join(" | ")}`);
    for (const n of r.notes) console.log(`  ! ${n}`);
    for (const d of r.dropped) console.log(`  dropped: ${d}`);
    console.log(`  rules: ${r.rules.join(" | ")}`);
    console.log(`  read-back:\n    ${String(r.said).split("\n").join("\n    ")}`);
    console.log(`  dish book: ${r.book.join(" | ")}`);
    console.log(`  meal examples: ${r.examples.join(" || ")}`);
    console.log(`  lunches and dinners:\n    ${r.week.join("\n    ")}`);
  }
}
writeFileSync(join(OUT, "results.json"), JSON.stringify(results, null, 1));
console.log(`\nsaved ${OUT}/results.json`);
process.exit(0);
