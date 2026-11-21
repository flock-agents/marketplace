// The model, through the Claude CLI in print mode with a borrowed, already-signed-in config dir (no API key). No tools: the
// harness makes the app calls. Each call is one fresh conversation; a retry sends the whole exchange so far as the prompt.
import { lstatSync, mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

export const DEFAULT_CONFIG = join(process.env.HOME!, ".flock-wa-onboarding-test/run1/a/data/claude-config");

export type ModelOpts = { model: string; configDir: string; bin?: string };

export function modelOpts(flags: Record<string, string>): ModelOpts {
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
  const cwd = mkdtempSync(join(tmpdir(), "planner-evals-cli-"));   // no project files or CLAUDE.md in reach
  try {
    const p = Bun.spawn([o.bin!, "-p", "--model", o.model, "--output-format", "json", "--tools", "", "--no-session-persistence",
      "--system-prompt", system], { cwd, stdin: new Blob([prompt]), stdout: "pipe", stderr: "pipe",
      env: cliEnv(o) });
    const [out, err] = [await new Response(p.stdout).text(), await new Response(p.stderr).text()];
    await p.exited;
    let j: any;
    try { j = JSON.parse(out); } catch { throw new Error(`claude CLI gave no JSON (exit ${p.exitCode}): ${out.slice(0, 400)} ${err.slice(0, 400)}`); }
    if (j.is_error) throw new Error(`claude CLI error: ${String(j.result).slice(0, 400)}`);
    return { text: String(j.result ?? ""), cost: Number(j.total_cost_usd ?? 0), ms: Number(j.duration_ms ?? 0) };
  } finally { rmSync(cwd, { recursive: true, force: true }); }
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
