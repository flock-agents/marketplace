import { resolve } from "path";
import { existsSync } from "fs";

// Resolve the directory whose build is ACTUALLY served to end users, so the version the server
// reports and the shell/assets it serves always describe the SAME build the client loaded.
//
// When deployed, the platform serves <appRoot>/code/dist and gives the process
// APP_DATA_DIR=<appRoot>/data — but the process itself may execute from a DIFFERENT tree (the
// source checkout, via `bun --watch`), whose dist/ can drift from the served copy after a local
// rebuild. Reading the process-local dist would then report a version the user never loaded.
// So prefer the served dir ($APP_DATA_DIR/../code/dist); fall back to the process-local dist for
// undeployed/local-dev runs. Relative resolution only — no hardcoded absolute paths.
// The process-local build — the dist/ inside the source checkout the process runs from. On a
// redeploy the platform rebuilds THIS (and restarts the process) but does not copy it into the
// served dir, so it is the fresh build we mirror across at startup (see syncServedDist.ts).
export const LOCAL_DIST: string = resolve(import.meta.dir, "../../dist");

function resolveServedDist(): string {
  const dataDir = process.env.APP_DATA_DIR;
  if (dataDir) {
    const served = resolve(dataDir, "../code/dist");
    if (existsSync(served)) return served;
  }
  return LOCAL_DIST;
}

export const SERVED_DIST: string = resolveServedDist();
