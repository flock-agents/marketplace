import { resolve } from "path";
import { readFileSync } from "fs";
import { SERVED_DIST } from "./servedDist";
import { syncServedDist } from "./syncServedDist";

// A redeploy rebuilds the source dist but does NOT copy it into the served dir; mirror the fresh
// build across BEFORE we read its version.json, so the version reported and the shell served both
// describe the just-built bundle (not a frozen one). See syncServedDist.ts.
syncServedDist();

// The CURRENT deployed build's version, read once from the SERVED dist's version.json and cached
// in memory at startup. vite writes that file at build time from the SAME value it bakes into the
// client bundle as __APP_VERSION__ (see vite.config.ts), so the client's "my version" and the
// server's "current build" come from one source and match for a given build. Reading the SERVED
// dir (not the process-local one) guarantees this even when the process runs from a source tree
// whose dist/ has drifted — see servedDist.ts. Redeploys restart the process, so the cache is
// refreshed on every deploy.
const VERSION_FILE = resolve(SERVED_DIST, "version.json");

function readBuildVersion(): string | null {
  try {
    const parsed = JSON.parse(readFileSync(VERSION_FILE, "utf-8")) as { version?: unknown };
    return typeof parsed.version === "string" ? parsed.version : null;
  } catch {
    // Missing/malformed (e.g. running before a build) — degrade to null; clients then never
    // detect a spurious change and simply don't auto-reload.
    return null;
  }
}

export const BUILD_VERSION: string | null = readBuildVersion();
