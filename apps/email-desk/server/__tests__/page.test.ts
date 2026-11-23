// The app's own page (routes/page.ts) is its settings: `/` serves the built SPA from dist/, `/assets/*` its files, and the
// old separate settings page is gone.
import { describe, test, expect, beforeAll } from "bun:test";
import { Hono } from "hono";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { pageRoutes } from "../routes/page";

const INDEX = '<!doctype html><html><head><script type="module" src="./assets/index-abc.js"></script></head><body><div id="root"></div></body></html>';

describe("the app's page", () => {
  let dist: string;
  beforeAll(() => {
    dist = mkdtempSync(join(tmpdir(), "email-desk-dist-"));
    mkdirSync(join(dist, "assets"));
    writeFileSync(join(dist, "index.html"), INDEX);
    writeFileSync(join(dist, "assets", "index-abc.js"), "console.log(1)");
    writeFileSync(join(dist, "secret.txt"), "not an asset");
  });
  const app = () => new Hono().route("/", pageRoutes(dist));

  test("/ serves the built SPA as HTML, with no person needed (Flock's install asks the root for a page)", async () => {
    const res = await app().request("/");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(await res.text()).toBe(INDEX);
  });

  test("its built files are served with their type", async () => {
    const res = await app().request("/assets/index-abc.js");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("javascript");
  });

  test("nothing outside dist/assets, and no settings page", async () => {
    expect((await app().request("/assets/../secret.txt")).status).toBe(404);
    expect((await app().request("/assets/%2e%2e/secret.txt")).status).toBe(404);
    expect((await app().request("/assets/missing.js")).status).toBe(404);
    expect((await app().request("/settings")).status).toBe(404);
  });

  test("an unbuilt page says so", async () => {
    const empty = mkdtempSync(join(tmpdir(), "email-desk-nodist-"));
    expect((await new Hono().route("/", pageRoutes(empty)).request("/")).status).toBe(503);
  });

  test("the page's words: plain, no dashes, and only the person sees it", () => {
    const src = readFileSync(join(import.meta.dir, "..", "..", "src", "App.tsx"), "utf-8");
    expect(src).toContain("Only you can see this page.");
    expect(src).not.toMatch(/[—–]/);
    expect(existsSync(join(import.meta.dir, "..", "..", "public", "settings.html"))).toBe(false);
  });
});
