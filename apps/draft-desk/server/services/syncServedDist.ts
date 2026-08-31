import { cpSync, existsSync, rmSync } from "fs";
import { resolve } from "path";
import { LOCAL_DIST, SERVED_DIST } from "./servedDist";

// --- Deploy-time stale-dist fix ---
//
// The platform serves the app shell from SERVED_DIST (<appRoot>/code/dist), but a redeploy
// rebuilds the SOURCE checkout's dist/ (LOCAL_DIST) and restarts this process WITHOUT copying
// that fresh build into the served dir. So the served shell froze on an old bundle and frontend
// fixes never reached users. The durable fix lives here, not in the build step: a build can't
// resolve the served absolute path (APP_DATA_DIR isn't set at build time), but the running
// process can (via servedDist.ts). Every redeploy restarts the process, so mirroring LOCAL_DIST
// → SERVED_DIST on startup guarantees the served bundle always matches the freshly-built one.
//
// Must run BEFORE buildVersion.ts reads the served version.json — it is invoked from there so the
// dependency (fresh served dir) is satisfied by construction, not by import ordering.
export function syncServedDist(): void {
  // Local dev: the process serves its own build — nothing to mirror.
  if (SERVED_DIST === LOCAL_DIST) return;
  // Nothing built to copy (e.g. first boot before any build) — leave the served dir untouched.
  if (!existsSync(resolve(LOCAL_DIST, "index.html"))) return;

  // Purge the old hashed assets so stale bundles don't accumulate across deploys, then mirror the
  // fresh build over (index.html, version.json, and the new assets/).
  const servedAssets = resolve(SERVED_DIST, "assets");
  if (existsSync(servedAssets)) rmSync(servedAssets, { recursive: true, force: true });
  cpSync(LOCAL_DIST, SERVED_DIST, { recursive: true });
}
