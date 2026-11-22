// The model, through the Claude CLI in print mode with a borrowed, already-signed-in config dir (no API key), or through an
// OpenAI-compatible endpoint (Flock's gateway: `--model flock-fast` is what staging and prod run) when EVALS_OPENAI_BASE and
// EVALS_OPENAI_KEY are set. No tools: the harness makes the app calls. Each call is one fresh conversation; a retry sends the
// whole exchange so far as the prompt. A call that takes longer than EVALS_TIMEOUT_MS (10 minutes) fails.
import { lstatSync, mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

export const DEFAULT_CONFIG = join(process.env.HOME!, ".flock-wa-onboarding-test/run1/a/data/claude-config");

export type ModelOpts = { model: string; configDir: string; bin?: string; openai?: { base: string; key: string } };

const TIMEOUT_MS = Number(process.env.EVALS_TIMEOUT_MS ?? 600_000);

export function modelOpts(flags: Record<string, string>): ModelOpts {
  const base = process.env.EVALS_OPENAI_BASE, key = process.env.EVALS_OPENAI_KEY;
  if (base && key) return { model: flags.model ?? "flock-fast", configDir: "", openai: { base: base.replace(/\/+$/, ""), key } };
  const configDir = flags["config-dir"] ?? process.env.EVALS_CLAUDE_CONFIG ?? DEFAULT_CONFIG;
  // A symlink to a config dir must never be handed to the CLI: it rewrites the link's target files as its own.
  if (lstatSync(configDir).isSymbolicLink()) throw new Error(`${configDir} is a symlink: pass the real directory`);
  return { model: flags.model ?? "claude-sonnet-5", configDir, bin: process.env.FLOCK_CLAUDE_BIN ?? "claude" };
}

/** The CLI's environment: the borrowed config dir, room for a whole week's JSON, and never an API key from this shell. */
function cliEnv(o: ModelOpts): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && k !== "ANTHROPIC_API_KEY" && !k.startsWith("CLAUDECODE")) env[k] = v;
  return { ...env, CLAUDE_CONFIG_DIR: o.configDir, CLAUDE_CODE_MAX_OUTPUT_TOKENS: "64000" };
}

export type Reply = { text: string; cost: number; ms: number };

export async function ask(o: ModelOpts, system: string, prompt: string): Promise<Reply> {
  if (o.openai) return askOpenAI(o, system, prompt);
  const cwd = mkdtempSync(join(tmpdir(), "planner-evals-cli-"));   // no project files or CLAUDE.md in reach
  try {
    const p = Bun.spawn([o.bin!, "-p", "--model", o.model, "--output-format", "json", "--tools", "", "--no-session-persistence",
      "--system-prompt", system], { cwd, stdin: new Blob([prompt]), stdout: "pipe", stderr: "pipe",
      env: cliEnv(o) });
    const timer = setTimeout(() => p.kill(), TIMEOUT_MS);
    const [out, err] = [await new Response(p.stdout).text(), await new Response(p.stderr).text()];
    await p.exited;
    clearTimeout(timer);
    let j: any;
    try { j = JSON.parse(out); } catch { throw new Error(`claude CLI gave no JSON (exit ${p.exitCode}): ${out.slice(0, 400)} ${err.slice(0, 400)}`); }
    if (j.is_error) throw new Error(`claude CLI error: ${String(j.result).slice(0, 400)}`);
    return { text: String(j.result ?? ""), cost: Number(j.total_cost_usd ?? 0), ms: Number(j.duration_ms ?? 0) };
  } finally { rmSync(cwd, { recursive: true, force: true }); }
}

/** One chat completion from an OpenAI-compatible endpoint; cost from its usage when it says (Flock's gateway does). */
async function askOpenAI(o: ModelOpts, system: string, prompt: string): Promise<Reply> {
  const t0 = Date.now();
  // Rate limited (429) or the gateway busy (5xx): wait as it says, or 10 s, and try again, up to 8 times.
  for (let attempt = 1; ; attempt++) {
    try { return await askOpenAIOnce(o, system, prompt, t0); } catch (e) {
      const m = /answered (429|5\d\d)(?:: .*"retryAfter":(\d+))?/.exec((e as Error).message);
      if (!m || attempt >= 8) throw e;
      await Bun.sleep(1000 * (Number(m[2] ?? 10) + 1));
    }
  }
}

async function askOpenAIOnce(o: ModelOpts, system: string, prompt: string, t0: number): Promise<Reply> {
  const res = await fetch(`${o.openai!.base}/chat/completions`, {
    method: "POST", signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { authorization: `Bearer ${o.openai!.key}`, "content-type": "application/json" },
    body: JSON.stringify({ model: o.model, max_tokens: 32000,
      messages: [{ role: "system", content: system }, { role: "user", content: prompt }] }),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`${o.model} answered ${res.status}: ${body.slice(0, 400)}`);
  let j: any;
  try { j = JSON.parse(body); } catch { throw new Error(`${o.model} gave no JSON: ${body.slice(0, 400)}`); }
  const text = j.choices?.[0]?.message?.content;
  if (typeof text !== "string") throw new Error(`${o.model} gave no message: ${body.slice(0, 400)}`);
  return { text, cost: Number(j.usage?.cost ?? 0), ms: Date.now() - t0 };
}

/** The first JSON value in a reply (a ```json block, or the outermost {...} / [...]). */
export function jsonOf(text: string): any {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fence ? fence[1] : text;
  const start = body.search(/[{[]/);
  if (start < 0) throw new Error("no JSON in the reply");
  const open = body[start], close = open === "{" ? "}" : "]";
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < body.length; i++) {
    const ch = body[i];
    if (inStr) { if (esc) esc = false; else if (ch === "\\") esc = true; else if (ch === '"') inStr = false; continue; }
    if (ch === '"') inStr = true;
    else if (ch === open) depth++;
    else if (ch === close && --depth === 0) return JSON.parse(body.slice(start, i + 1));
  }
  throw new Error("unterminated JSON in the reply");
}

export function flagsOf(argv: string[]): { flags: Record<string, string>; rest: string[] } {
  const flags: Record<string, string> = {}, rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) { const [k, v] = a.slice(2).split("="); flags[k] = v ?? (argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : "true"); }
    else rest.push(a);
  }
  return { flags, rest };
}
