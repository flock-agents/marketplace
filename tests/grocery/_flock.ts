// What the grocery tests borrow from a Flock checkout (FLOCK_APP_DIR=<flock>/flock-app).
//
// The grocery skills' scripts import Flock's shared skill helpers as `../../_shared/<name>`: an
// installed skill sits next to Flock's own `skills/_shared/`, which this repo does not have. With
// FLOCK_APP_DIR set, those imports are pointed at `<FLOCK_APP_DIR>/skills/_shared/` (the Bun plugin
// below), and the page tests drive Chromium with that checkout's playwright-core. Without it, every
// test that imports a script is skipped (the file checks still run) and the reason is printed once.
import { plugin } from "bun";
import { existsSync, readFileSync } from "fs";
import { join } from "path";

export const appDir = process.env.FLOCK_APP_DIR || "";
export const sharedDir = appDir ? join(appDir, "skills", "_shared") : "";
/** Flock's shared skill helpers, as the grocery scripts need them (real input arrived in Flock 0.24.0). */
export const hasShared = !!sharedDir && existsSync(join(sharedDir, "_realInput.ts"));
export const playwrightPath = appDir ? join(appDir, "node_modules", "playwright-core") : "";
export const canBrowse = hasShared && existsSync(playwrightPath);

/** A skill script's import of Flock's shared helpers: `"../../_shared/<name>"`. */
const SHARED_IMPORT = /(["'])(?:\.\.\/)+_shared\//g;
/** This repo's skill scripts. */
const SKILL_SCRIPT = /\/skills\/[^/]+\/scripts\/[^/]+\.ts$/;

if (hasShared) {
  // Bun's runtime plugins do not re-resolve a relative import, so each skill script is loaded with
  // its `../../_shared/` imports pointed at the checkout's `skills/_shared/`.
  plugin({
    name: "flock-skills-shared",
    setup(build) {
      build.onLoad({ filter: SKILL_SCRIPT }, ({ path }) => ({
        contents: readFileSync(path, "utf8").replace(SHARED_IMPORT, `$1${sharedDir}/`),
        loader: "ts",
      }));
    },
  });
}

let told = false;
/** Says once why the script tests are skipped. */
export function sayWhySkipped(): void {
  if (told) return;
  told = true;
  if (!hasShared) console.warn(`[tests/grocery] script tests skipped: ${appDir ? `${sharedDir} has no _realInput.ts (needs Flock 0.24.0 or later)` : "FLOCK_APP_DIR is not set"}. Run: FLOCK_APP_DIR=<flock>/flock-app bun test ./tests/grocery`);
  else if (!canBrowse) console.warn(`[tests/grocery] page tests skipped: no playwright-core in ${appDir}/node_modules (run bun install there).`);
}
