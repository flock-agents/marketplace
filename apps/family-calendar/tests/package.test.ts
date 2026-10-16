// The package has the shape of a marketplace kit app: the two manifests agree, the files Flock's assemble and the planner read are
// there, and nothing that only a checkout has (node_modules, build output, the 1.x layout) is.
import { describe, it, expect } from "bun:test";
import { existsSync, readFileSync } from "fs";
import { join } from "path";

const ROOT = join(import.meta.dir, "..");
const read = (f: string) => readFileSync(join(ROOT, f), "utf8");
const json = (f: string) => JSON.parse(read(f));
const manifest = json("flock.app.json");
const market = json("flock.marketplace.json");
const SEMVER = /^\d+\.\d+\.\d+$/;

describe("family-calendar package", () => {
  it("is a private fullstack kit app that assembles, with the platform fields the installer expects", () => {
    expect(manifest.version).toMatch(SEMVER);
    expect(manifest.minFlockVersion).toMatch(SEMVER);
    expect(manifest).toMatchObject({
      name: "Family Calendar", type: "fullstack", access: "private", spa: true, apiPrefix: "/api", assemble: true,
      buildCommand: "bun run app:build", buildDir: "dist", deployDir: ".flock-out",
      processConfig: { command: "bun", args: ["server/index.js"], healthCheckPath: "/api/health" },
      config: { requires: { agent: { required: true } } },
      pages: ["week", "events", "reminders"], tables: ["members", "events", "reminders"], objects: ["calendar"], nav: "auto", chat: "side",
    });
    expect(manifest.icon).toBe("icon.svg");
    expect(existsSync(join(ROOT, "icon.svg"))).toBe(true);
    expect(manifest.description).toBe("Family events, schedules, and reminders at a glance");
  });

  it("the marketplace manifest names the same package at the same version", () => {
    expect(market.name).toBe("family-calendar");
    expect(market.version).toBe(manifest.version);
    expect(market.minFlockVersion).toMatch(SEMVER);
  });

  it("says what it is for and what to use instead", () => {
    expect(manifest.useCases.for.length).toBeGreaterThanOrEqual(3);
    expect(manifest.useCases.notFor.length).toBeGreaterThanOrEqual(2);
    for (const other of ["bookings", "itinerary", "checklist"]) expect(manifest.useCases.notFor.join("\n"), other).toContain(other);
  });

  it("has the package files, the package and lock named by the slug, the title token Flock fills at serve time, no installed modules", () => {
    for (const f of ["ARCHITECTURE.md", "CHANGELOG.md", "bun.lock", "package.json", "tsconfig.json", "vite.config.ts", "index.html",
      "src/main.tsx", "src/App.tsx", "server/index.ts", "server/db/schema.ts", "server/db/constants.ts", "server/db/seed.ts",
      "row-schema.json", "catalog.json", "settings.json", "e2e-rows.json"])
      expect(existsSync(join(ROOT, f)), f).toBe(true);
    for (const gone of ["template.json", "TEMPLATE.md", "README.md", "frontend", "shared", "node_modules", "dist", ".flock-out"]) expect(existsSync(join(ROOT, gone)), gone).toBe(false);
    expect(json("package.json").name).toBe("family-calendar");
    expect(read("bun.lock")).toContain('"name": "family-calendar",');   // the lock names the root package: bun install --frozen-lockfile must find the same name
    expect(json("package.json").scripts["app:build"]).toBe("bun install && tsc --noEmit && vite build && bun scripts/bundle-server.ts");
    expect(read("index.html")).toContain("<title>__APP_NAME__</title>");
    expect(read("CHANGELOG.md")).toContain(`## ${manifest.version}`);
  });

  it("ARCHITECTURE.md carries the shared kit block, then this app's own section", () => {
    const arch = read("ARCHITECTURE.md");
    expect(arch.startsWith("# Family Calendar: architecture\n")).toBe(true);
    expect(arch).toContain("## What a kit app is");
    expect(arch).toContain("## This app: Family Calendar");
  });
});
