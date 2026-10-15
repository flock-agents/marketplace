import { describe, it, expect } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";
import { SETTINGS } from "../server/db/constants";

// The server declares its settings from constants.ts; the plan and the catalogue read the kit fields of flock.app.json. The two
// lists must be the same.
describe("bookings settings", () => {
  it("flock.app.json lists exactly the settings the server declares to mountKit, with today's defaults", () => {
    const meta = JSON.parse(readFileSync(join(import.meta.dir, "..", "flock.app.json"), "utf8"));
    // `rules` (the declarative twin of a check) live in settings.json, not flock.app.json
    expect(meta.settings).toEqual(JSON.parse(JSON.stringify(SETTINGS)).map(({ rules: _r, ...d }: Record<string, unknown>) => d));
    expect(meta.settings.map((s: { key: string }) => s.key)).toEqual(["hours", "slot_minutes"]);
    expect(meta.settings.find((s: { key: string }) => s.key === "slot_minutes").default).toBe(30);
  });
});
