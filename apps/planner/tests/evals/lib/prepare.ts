// Assemble the planner the way Flock's test harness does (the helper run-app-tests.ts: assembleApp, the cached node_modules,
// supplyAppSdk / supplyAppKit, bun install) into a scratch dir, with evals/ copied in, then run an inner eval script there so
// it can import the app's own server/testkit.ts. The scratch dir and its FLOCK_HOME are removed afterwards.
import { cpSync, existsSync, mkdtempSync, rmSync } from "fs";
import { join, resolve } from "path";
import { tmpdir } from "os";

const HOME = process.env.HOME!;
export const FLOCK = process.env.FLOCK ?? join(HOME, "Developer/flock-wa-onboarding/flock-app");
export const NM_CACHE = process.env.NM_CACHE ?? join(HOME, ".flock-wa-onboarding-test/helpers/mp-apps/nm");
/** The apps folder holding this planner (the worktree's own apps/). */
export const SOURCES = process.env.SOURCES ?? resolve(import.meta.dir, "../../../..");

export async function runInAssembledApp(inner: string, args: string[]): Promise<number> {
  const flockHome = mkdtempSync(join(tmpdir(), "planner-evals-home-"));
  const work = mkdtempSync(join(tmpdir(), "planner-evals-"));
  process.env.FLOCK_HOME = flockHome;
  try {
    const { assembleApp } = await import(join(FLOCK, "packages/app-build-tools/assemble.ts"));
    const { supplyAppKit, supplyAppSdk } = await import(join(FLOCK, "server/src/app-packages.ts"));
    const target = join(work, "app");
    assembleApp({ template: "planner", id: "t-planner", name: "Test planner", target, packagesDir: join(FLOCK, "packages"), sourcesDir: SOURCES, git: false });
    const cache = join(NM_CACHE, "planner");
    if (existsSync(cache)) cpSync(cache, join(target, "node_modules"), { recursive: true });
    supplyAppSdk(target); supplyAppKit(target);
    cpSync(resolve(import.meta.dir, ".."), join(target, "evals"), { recursive: true, filter: (p) => !p.includes("/results/") });
    const quiet = { stdout: "pipe", stderr: "pipe" } as const;
    if (!existsSync(cache)) {
      const i = Bun.spawnSync(["bun", "install"], { cwd: target, ...quiet });
      if (i.exitCode) { console.error(i.stderr.toString()); return 1; }
    }
    const p = Bun.spawn(["bun", join(target, "evals", inner), ...args], { cwd: target, stdout: "inherit", stderr: "inherit",
      env: { ...process.env, EVALS_OUT: process.env.EVALS_OUT ?? resolve(import.meta.dir, "../results") } });
    return await p.exited;
  } finally {
    rmSync(work, { recursive: true, force: true });
    rmSync(flockHome, { recursive: true, force: true });
  }
}
