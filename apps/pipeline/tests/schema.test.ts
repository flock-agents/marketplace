// The manifest, the schema, the stages and the generated catalogue agree. Pure: reads the package's own files, so it runs with
// `bun test tests` from the package (no node_modules), the way the other kit apps' tests do.
import { describe, it, expect } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";
import { STAGES } from "../server/db/constants";

const ROOT = join(import.meta.dir, "..");
const read = (f: string) => readFileSync(join(ROOT, f), "utf8");
const json = (f: string) => JSON.parse(read(f));
const manifest = json("flock.app.json");
const schema = read("server/db/schema.ts");
const stages: string[] = [...STAGES];

describe("pipeline schema", () => {
  it("declares exactly the tables schema.ts exports, each spreading kitColumns()", () => {
    const tables = [...schema.matchAll(/export const \w+ = sqliteTable\("(\w+)"/g)].map((m) => m[1]);
    expect(tables).toEqual(manifest.tables);
    expect(manifest.tables).toEqual(["deals"]);
    expect((schema.match(/\.\.\.kitColumns\(\)/g) ?? []).length).toBe(tables.length);
  });

  it("a deal needs a title and starts at the first stage", () => {
    expect(schema).toContain('text("title").notNull()');
    expect(schema).toContain(`text("stage").notNull().default("${stages[0]}")`);
  });

  it("the stages are a closed list, left to right, ending in the two outcomes", () => {
    expect(stages).toEqual(["Lead", "Talking", "Proposal", "Won", "Lost"]);
    expect(new Set(stages).size).toBe(stages.length);
  });

  it("row-schema.json and catalog.json are generated from that schema, with the stages as the enum", () => {
    const rows = json("row-schema.json");
    expect(Object.keys(rows.properties)).toEqual(manifest.tables);
    const deal = rows.properties.deals.items;
    expect(deal.required).toEqual(["$key", "title"]);
    expect(deal.properties.stage.enum).toEqual(stages);
    expect(deal.additionalProperties).toBe(false);
    const catalog = json("catalog.json");
    expect(catalog.name).toBe("pipeline");
    expect(Object.keys(catalog.tables)).toEqual(manifest.tables);
    expect(catalog.tables.deals.columns.title).toMatchObject({ type: "string", required: true, nullable: false });
    expect(catalog.tables.deals.columns.stage).toMatchObject({ type: "string", required: false, default: stages[0], enum: stages });
    expect(catalog.settings).toEqual([]);
    expect(json("settings.json")).toEqual({});
  });

  it("the seed and the e2e fixture only use the declared stages", () => {
    const seeded = [...read("server/db/seed.ts").matchAll(/stage:\s*"([^"]+)"/g)].map((m) => m[1]);
    expect(seeded.length).toBeGreaterThan(0);
    for (const s of seeded) expect(stages, `seed stage ${s}`).toContain(s);
    const fixture = json("e2e-rows.json");
    expect(Object.keys(fixture)).toEqual(manifest.tables);
    for (const row of fixture.deals) if (row.stage !== undefined) expect(stages, `fixture stage ${row.stage}`).toContain(row.stage);
  });

  it("the labels name the noun, every page and every stage, with the stored value as each stage's fallback", () => {
    const labels: Record<string, string> = manifest.labels;
    expect(labels["noun.one"]).toBe("deal");
    expect(labels["noun.many"]).toBe("deals");
    for (const page of manifest.pages) {
      expect(labels[`nav.${page}`], `nav.${page}`).toBeString();
      expect(labels[`title.${page}`], `title.${page}`).toBeString();
    }
    for (const s of stages) expect(labels[`stage.${s}`], `stage.${s}`).toBe(s);
    expect(manifest.titleFromName).toBe("title.board");
  });
});
