// apps/calendar-desk/server/__tests__/manifest.test.ts
import { describe, test, expect } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";

const manifest = JSON.parse(readFileSync(join(import.meta.dir, "../../flock.app.json"), "utf-8"));

describe("Calendar Desk manifest lifecycle", () => {
  test("initializes an account only after Email Desk has (its dated facts come from Email Desk's read)", () => {
    expect(manifest.lifecycle.initializeAfter).toEqual(["email-desk"]);
  });

  test("says why it is waiting, in plain words", () => {
    expect(manifest.lifecycle.waiting).toEqual({ title: "Calendar", message: "Waiting for your inbox to be read first" });
  });

  test("the hooks it declared before are unchanged", () => {
    expect(manifest.lifecycle.initialize).toBe(true);
    expect(manifest.lifecycle.tick).toBe(true);
    expect(manifest.lifecycle.progress).toBe(true);
  });
});
