// scripts/bundle-server.ts — last step of `bun run app:build`. It writes the deploy set into .flock-out/:
//   dist/                 the built pages (vite)
//   server/index.js       the backend as ONE file: hono, drizzle, drizzle-kit's push, zod, the kit and the SDK
//   flock.app.json        the manifest (intents, config, pairing read it from the code dir)
//   row-schema.json       when the app has one
// The platform copies only .flock-out into the app's code dir (flock.app.json "deployDir"), so no deploy carries
// node_modules: an app deploy is about 3.5 MB instead of 79 MB, far under the 100 MB app-size cap.
//
// drizzle-kit loads a driver for each database it can talk to (pg, mysql2, libsql and others), always through a dynamic
// import, and drizzle-orm's adapter for that driver imports the driver package statically. A Flock app uses bun:sqlite
// only, so each of those dynamic imports is replaced by a module that throws when it is loaded: nothing on the sqlite
// path changes, and an app that really needed one would fail its smoke boot, not ship half a driver.
// A bundled backend cannot carry native .node modules or files read at run time next to the source (import.meta.dir).
import { cpSync, existsSync, mkdirSync, rmSync } from "fs";
import { join } from "path";
import type { BunPlugin } from "bun";

export const OUT_DIR = ".flock-out";
export const STUBBED_DRIVERS = [
  "pg", "postgres", "mysql2", "mysql2/promise", "@libsql/client", "better-sqlite3", "@planetscale/database",
  "@neondatabase/serverless", "@vercel/postgres", "@electric-sql/pglite", "@aws-sdk/client-rds-data",
];
const DRIZZLE_ADAPTERS = ["aws-data-api/pg", "pglite", "node-postgres", "postgres-js", "vercel-postgres", "neon-serverless",
  "neon-http", "singlestore", "mysql2", "planetscale-serverless", "d1", "sqlite-proxy", "libsql", "better-sqlite3"];
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");

export const stubDrivers: BunPlugin = {
  name: "flock-stub-drivers",
  setup(build) {
    const names = [...STUBBED_DRIVERS.map(escapeRe), ...DRIZZLE_ADAPTERS.map((d) => `drizzle-orm/${escapeRe(d)}(?:/migrator)?`)];
    // Only dynamic imports: a static import of a driver is a real dependency and must fail the build loudly.
    build.onResolve({ filter: new RegExp(`^(?:${names.join("|")})$`) }, (a) =>
      a.kind === "dynamic-import" ? { path: a.path, namespace: "flock-stub" } : undefined);
    build.onLoad({ filter: /.*/, namespace: "flock-stub" }, (a) => ({
      contents: `throw new Error(${JSON.stringify(`${a.path} is not available in a Flock app: apps use bun:sqlite`)});`,
      loader: "js",
    }));
  },
};

export async function bundleServer(dir: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const out = join(dir, OUT_DIR);
  rmSync(out, { recursive: true, force: true });
  mkdirSync(join(out, "server"), { recursive: true });
  const r = await Bun.build({
    entrypoints: [join(dir, "server", "index.ts")], outdir: join(out, "server"), naming: "index.js",
    target: "bun", minify: true, plugins: [stubDrivers],
  });
  if (!r.success) return { ok: false, error: r.logs.map((l) => String(l)).join("\n") || "bun build failed" };
  if (!existsSync(join(out, "server", "index.js"))) return { ok: false, error: "bun build wrote no server/index.js" };
  if (!existsSync(join(dir, "dist", "index.html"))) return { ok: false, error: "dist/index.html is missing: run vite build first" };
  cpSync(join(dir, "dist"), join(out, "dist"), { recursive: true });
  for (const f of ["flock.app.json", "row-schema.json"]) if (existsSync(join(dir, f))) cpSync(join(dir, f), join(out, f));
  return { ok: true };
}

if (import.meta.main) {
  const r = await bundleServer(process.cwd());
  if (!r.ok) { console.error(r.error); process.exit(1); }
}
