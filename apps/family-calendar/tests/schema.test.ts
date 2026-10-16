// The manifest, the schema, the allowed values and the generated catalogue agree. Pure: reads the package's own files, so it runs
// with `bun test tests` from the package (no node_modules), the way the other kit apps' tests do.
import { describe, it, expect } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";
import { REPEATS, COLOURS } from "../server/db/constants";

const ROOT = join(import.meta.dir, "..");
const read = (f: string) => readFileSync(join(ROOT, f), "utf8");
const json = (f: string) => JSON.parse(read(f));
const manifest = json("flock.app.json");
const schema = read("server/db/schema.ts");

describe("family-calendar schema", () => {
  it("declares exactly the tables schema.ts exports, each spreading kitColumns()", () => {
    const tables = [...schema.matchAll(/export const \w+ = sqliteTable\("(\w+)"/g)].map((m) => m[1]);
    expect(tables).toEqual(manifest.tables);
    expect(manifest.tables).toEqual(["members", "events", "reminders"]);
    expect((schema.match(/\.\.\.kitColumns\(\)/g) ?? []).length).toBe(tables.length);
  });

  it("an event needs a title and a date; a reminder a title and when it is due, and repeats `none` unless told", () => {
    expect(schema).toContain('text("title").notNull()');
    expect(schema).toContain('text("date").notNull()');
    expect(schema).toContain('text("due").notNull()');
    expect(schema).toContain(`text("repeat").notNull().default("${REPEATS[0]}")`);
    expect(schema).toContain(`text("colour").notNull().default("${COLOURS[0]}")`);
  });

  it("the repeats and colours are closed lists", () => {
    expect([...REPEATS]).toEqual(["none", "daily", "weekly", "monthly"]);
    expect([...COLOURS]).toEqual(["accent", "info", "success", "warning", "danger"]);   // theme tones, never hex colours
  });

  it("row-schema.json and catalog.json are generated from that schema", () => {
    const rows = json("row-schema.json");
    expect(Object.keys(rows.properties)).toEqual(manifest.tables);
    expect(rows.properties.events.items.required).toEqual(["$key", "title", "date"]);
    expect(rows.properties.reminders.items.required).toEqual(["$key", "title", "due"]);
    expect(rows.properties.members.items.required).toEqual(["$key", "name"]);
    for (const t of manifest.tables) expect(rows.properties[t].items.additionalProperties).toBe(false);
    const catalog = json("catalog.json");
    expect(catalog.name).toBe("family-calendar");
    expect(Object.keys(catalog.tables)).toEqual(manifest.tables);
    expect(catalog.tables.events.columns.title).toMatchObject({ type: "string", required: true, nullable: false });
    expect(catalog.tables.events.columns.start_time).toMatchObject({ type: "string", required: false, nullable: true });
    expect(catalog.tables.events.columns.reminder_minutes).toMatchObject({ type: "integer", required: false, nullable: true });
    expect(catalog.tables.reminders.columns.repeat).toMatchObject({ type: "string", required: false, default: REPEATS[0] });
    expect(catalog.settings).toEqual([]);
    expect(json("settings.json")).toEqual({});
  });

  it("the seed and the e2e fixture only use the declared repeats and colours", () => {
    const seed = read("server/db/seed.ts");
    const repeats = [...seed.matchAll(/repeat:\s*"([^"]+)"/g)].map((m) => m[1]);
    expect(new Set(repeats)).toEqual(new Set(REPEATS));   // one sample of each kind
    for (const c of [...seed.matchAll(/colour:\s*"([^"]+)"/g)].map((m) => m[1])) expect(COLOURS, `seed colour ${c}`).toContain(c);
    const fixture = json("e2e-rows.json");
    expect(Object.keys(fixture)).toEqual(manifest.tables);
    for (const r of fixture.reminders) expect(REPEATS, `fixture repeat ${r.repeat}`).toContain(r.repeat);
    for (const m of fixture.members) expect(COLOURS, `fixture colour ${m.colour}`).toContain(m.colour);
  });

  it("the labels name every page", () => {
    const labels: Record<string, string> = manifest.labels;
    for (const page of manifest.pages) {
      expect(labels[`nav.${page}`], `nav.${page}`).toBeString();
      expect(labels[`title.${page}`], `title.${page}`).toBeString();
    }
    expect(Object.keys(labels).length).toBe(manifest.pages.length * 2);
  });
});
