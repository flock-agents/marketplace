import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Single source of truth for a build's version, computed ONCE per build. Base-36 timestamp
// plus a short random suffix so back-to-back rebuilds still differ. This one value is both
// baked into the client bundle (`__APP_VERSION__`) and emitted to `dist/version.json`, so the
// version a running client considers "mine" and the version the server reports for the current
// build always match for a given build. See docs/design.md → "Build versioning & auto-update".
const buildVersion = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

// Emit dist/version.json as part of the bundle (Rollup writes it into outDir — no cwd/path
// assumptions). GET /api/version reads this file; the client polls that endpoint.
const emitVersionJson = {
  name: "draft-desk-emit-version",
  apply: "build" as const,
  generateBundle() {
    // @ts-expect-error — Rollup plugin `this` context provides emitFile at build time.
    this.emitFile({
      type: "asset",
      fileName: "version.json",
      source: JSON.stringify({ version: buildVersion }) + "\n",
    });
  },
};

// base "./" — assets are served under /a/draft-desk/, never the domain root.
export default defineConfig({
  base: "./",
  define: { __APP_VERSION__: JSON.stringify(buildVersion) },
  plugins: [react(), emitVersionJson],
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
