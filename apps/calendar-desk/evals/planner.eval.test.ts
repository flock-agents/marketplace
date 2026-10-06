/**
 * THE PLAN UPCOMING EVENTS PLANNER, WITH A REAL MODEL, AGAINST EXPECTATIONS WRITTEN FIRST.
 *
 * Compiles the Personal Assistant's real CLAUDE.md with flock's own eval helpers, gives the model that prompt plus
 * planning-instructions.md, the intent's data block and the simulated reply of GET /api/internal/todos, and grades the
 * calls it would make (harness.ts). Skipped unless LIVE_EVALS=1 and FLOCK_APP_DIR (a flock-app checkout) is set:
 *
 *   FLOCK_APP_DIR=/path/to/flock/flock-app FLOCK_EVAL_CLAUDE_CONFIG=~/.flock-<instance>/data/claude-config \
 *     TMUX_TMPDIR=$(mktemp -d) bun run eval
 *
 * (`bun run eval` is `LIVE_EVALS=1 bun test ./evals/planner.eval.test.ts`.) flock's paths.ts refuses a FLOCK_HOME outside
 * the temp dir in a test run, so an unset FLOCK_HOME is set here to a fresh temp dir; a FLOCK_HOME you set must be one.
 *
 * Never symlink a claude-config: borrow its path with FLOCK_EVAL_CLAUDE_CONFIG. A failing case is fixed in
 * planning-instructions.md (then `bun scripts/embed-instructions.ts`), never by loosening a case.
 */
import { describe, test, expect, beforeAll } from "bun:test";
import { mkdtempSync } from "fs"; import { tmpdir } from "os"; import { join } from "path";

const FLOCK = process.env.FLOCK_APP_DIR;
const ENABLED = process.env.LIVE_EVALS === "1" && !!FLOCK;
const RUNS = 2;
const TIMEOUT = 150_000;

// The planning store opens its database on import, and flock's modules want a scratch DATA_DIR and FLOCK_HOME: all are set before any
// import, and only when the evals are enabled, so a disabled run touches nothing.
if (ENABLED) {
  process.env.APP_DATA_DIR ??= mkdtempSync(join(tmpdir(), "calendar-desk-eval-"));
  process.env.DATA_DIR ??= mkdtempSync(join(tmpdir(), "flock-eval-data-"));
  process.env.FLOCK_HOME ??= mkdtempSync(join(tmpdir(), "flock-eval-home-"));
}
if (ENABLED) (await import("./machine-tz")).pinMachineZone();
const PLAN_CASES = ENABLED ? (await import("./fixtures")).PLAN_CASES : [];

let H: typeof import("./harness");
let live: { callInternalLLM: any; compilePaPrompt: (label: string) => Promise<string>; SONNET: string } | null = null;
let PROMPT = "";

beforeAll(async () => {
  if (!ENABLED) return;
  const server = join(FLOCK!, "server");
  const { liveModelAvailable, liveModelRoute } = await import(join(server, "tests/helpers/live-model"));
  if (!liveModelAvailable()) throw new Error("no live model: set FLOCK_EVAL_CLAUDE_CONFIG to an authenticated instance's data/claude-config, or ANTHROPIC_API_KEY");
  console.log(`[calendar-desk-planner-live] real model via ${liveModelRoute()}`);
  const harness = await import(join(server, "tests/evals/pa-brief-harness"));
  const { callInternalLLM } = await import(join(server, "src/internal-llm"));
  live = { callInternalLLM, compilePaPrompt: harness.compilePaPrompt, SONNET: harness.SONNET };
  H = await import("./harness");
  PROMPT = await live.compilePaPrompt("calendar-desk-planner-eval");
});

describe.skipIf(!ENABLED)("Calendar Desk planner (live)", () => {
  if (!ENABLED) test("skipped: set LIVE_EVALS=1 and FLOCK_APP_DIR", () => {});
  for (const c of PLAN_CASES) {
    test(c.id, async () => {
      let passed = 0;
      const failures: string[] = [];
      for (let i = 0; i < RUNS; i++) {
        const pl = await H.plan(c);
        const { text, model } = await live!.callInternalLLM({ taskType: "agent-test", tierOverride: "mid", system: `${PROMPT}\n\n${H.INSTRUCTIONS}${H.HARNESS}`, user: H.userMessage(c, pl), maxTokens: 3000, timeoutMs: 140_000 });
        expect(model).toBe(live!.SONNET);
        const problems = await H.grade(c, pl, H.extractCalls(text));
        if (problems.length) {
          console.log(`[calendar-desk-planner-live] ${c.id} run ${i + 1} FAIL: ${problems.join("; ")}\n${text}`);
          failures.push(...problems.map((p) => `run ${i + 1}: ${p}`));
        } else passed++;
      }
      console.log(`[calendar-desk-planner-live] ${c.id}: ${passed}/${RUNS}`);
      expect(failures).toEqual([]);
    }, TIMEOUT * RUNS);
  }
});
