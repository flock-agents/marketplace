// Family Butler template: the briefs come from the Family Calendar's `brief` operation and go to the family group
// (contract docs/specs/2026-11-22-family-calendar-3-contract.md, "brief op" and "L4").
//
// Run: bun test templates/family-butler. With a Flock checkout, Flock's own template validator runs too:
// FLOCK_APP_DIR=<flock>/flock-app bun test templates/family-butler.
import { describe, expect, it } from "bun:test";
import { existsSync, readFileSync } from "fs";
import { join } from "path";

const dir = join(import.meta.dir, "..");
const read = (f: string) => readFileSync(join(dir, f), "utf8");
const manifest = JSON.parse(read("flock.template.json"));
const suggestions = JSON.parse(read("SUGGESTIONS.json"));
const catalog = JSON.parse(readFileSync(join(dir, "../../catalog.json"), "utf8"));
const samples = JSON.parse(read("tests/brief-samples.json")).samples as Array<{
  name: string; kind: "morning" | "evening"; payload: any; expect: { nothing?: boolean; mentions?: unknown[]; absent?: string[] };
}>;

const task = (name: string) => manifest.tasks.find((t: any) => t.name === name);
const morning = task("Morning Briefing");
const evening = task("Evening Reminder");

describe("version", () => {
  it("is 1.9.0 in the manifest, the changelog's newest entry and the catalog", () => {
    expect(manifest.version).toBe("1.9.0");
    expect(read("CHANGELOG.md")).toMatch(/^# Changelog\n\n## 1\.9\.0\n/);
    const entry = catalog.items.find((i: any) => i.slug === "family-butler");
    expect(entry.latestVersion).toBe("1.9.0");
    expect(entry.latestTag).toBe("family-butler-v1.9.0");
  });
});

describe("apps", () => {
  it("sets up the Family Calendar, paired with Family Butler, and keeps the Meal Planner", () => {
    expect(manifest.apps).toContainEqual({ slug: "family-calendar", name: "Family Calendar", required: true });
    expect(manifest.apps.map((a: any) => a.slug)).toContain("planner");
    expect(suggestions.apps.map((a: any) => a.slug)).toContain("family-calendar");
  });
});

describe("google-calendar is gone", () => {
  for (const f of ["flock.template.json", "SUGGESTIONS.json", "README.md", "SOUL.md"]) {
    it(`${f} does not name it`, () => {
      expect(read(f)).not.toContain("google-calendar");
    });
  }
  it("no skill, task prompt or suggestion reads a Google calendar", () => {
    expect(manifest.skills.map((s: any) => s.skillId)).not.toContain("google-calendar");
    for (const t of manifest.tasks) expect(t.prompt.toLowerCase()).not.toContain("google");
  });
});

describe("reminders are group TODOs", () => {
  const soul = read("SOUL.md");
  it("the reminders skill is gone and the todos skill is in", () => {
    const ids = manifest.skills.map((s: any) => s.skillId);
    expect(ids).not.toContain("reminders");
    expect(ids).toContain("todos");
    expect(suggestions.skills.map((s: any) => s.slug)).toContain("todos");
    expect(read("README.md")).not.toMatch(/\| reminders \|/);
  });

  it("the SOUL makes 'remind us' a group TODO through the todos call, at the time asked", () => {
    expect(soul).toContain('"remind us about X" is a group TODO');
    expect(soul).toContain("`POST /api/internal/todos`");
    expect(soul).toContain("A day with no time: 9 am, and say the time you set");
    expect(soul).toContain('No date at all: ask once, "When?"');
  });

  it("the SOUL never puts a reminder on the Family Calendar", () => {
    expect(soul).toContain("Never the Family Calendar for a reminder");
    expect(soul).toContain("The calendar is for events (its add_events)");
  });
});

describe("the briefs", () => {
  it("are the two tasks, at 8 am and 9 pm IST", () => {
    expect(manifest.tasks.map((t: any) => t.name)).toEqual(["Morning Briefing", "Evening Reminder"]);
    expect(morning.schedule).toBe("0 8 * * *");
    expect(evening.schedule).toBe("0 21 * * *");
    for (const t of [morning, evening]) expect(t.timezone).toBe("Asia/Kolkata");
  });

  it("the morning one calls brief with kind morning, and only that", () => {
    expect(morning.prompt).toContain("/ops/brief");
    expect(morning.prompt).toContain('{"kind":"morning"}');
    expect(morning.prompt).not.toContain('"kind":"evening"');
  });

  it("the evening one calls brief with kind evening, and only that", () => {
    expect(evening.prompt).toContain("/ops/brief");
    expect(evening.prompt).toContain('{"kind":"evening"}');
    expect(evening.prompt).not.toContain('"kind":"morning"');
  });

  it("each reads the brief once (the call moves the calendar's mark)", () => {
    for (const t of [morning, evening]) expect(t.prompt).toMatch(/Call it once/);
  });

  it("say nothing when every list is empty: NOTHING_NEW, which Flock never posts", () => {
    for (const t of [morning, evening]) {
      expect(t.prompt).toContain("`events`, `changed`, `new` and `todos_due` are all empty, reply exactly NOTHING_NEW");
    }
    expect(morning.prompt).toContain("Weather alone is never a brief");
  });

  it("weather stays in the morning one only", () => {
    expect(morning.prompt.toLowerCase()).toContain("weather");
    expect(evening.prompt.toLowerCase()).not.toContain("weather");
  });

  it("the evening one also tells the changes and new dates (its call moves the mark past them)", () => {
    expect(evening.prompt).toContain("each of `changed`");
    expect(evening.prompt).toContain("each of `new`");
    expect(evening.prompt).toContain("each of `todos_due`");
  });

  it("go to the family group: deliverTo null, so Flock's binding of Family Butler's routines to the Family group decides", () => {
    // A string here would name one channel destination (a Telegram chat), not the group (groups/rooms.ts
    // bindAgentRoutinesToRoom moves every Family Butler cron into the Family group's session).
    for (const t of [morning, evening]) {
      expect(t.deliverTo).toBeNull();
      expect(t.prompt).toContain("for the family group");
    }
  });

  it("run on Family Butler's own model: no task-level model pin, the agent's model left as it is", () => {
    // Flock: a routine with no model passes no modelChoice (model-tiers.ts routineModelOpts), so the turn falls
    // through to the agent's pinned model (model-resolution.ts: routine choice > agent pinned > agent tier).
    expect(manifest.agent.model).toBe("claude-sonnet-4-6");
    for (const t of [morning, evening]) {
      expect(t).not.toHaveProperty("model");
      expect(t.thinkingLevel).toBe("none");
    }
  });

  it("are valid as Flock's validator reads tasks", () => {
    for (const t of manifest.tasks) {
      expect(t.schedule.split(/\s+/)).toHaveLength(5);
      expect(typeof t.prompt).toBe("string");
      expect(typeof t.enabled).toBe("boolean");
      expect(() => new Intl.DateTimeFormat("en", { timeZone: t.timezone })).not.toThrow();
    }
  });
});

describe("sample brief answers (tests/brief-samples.json)", () => {
  const ymd = /^\d{4}-\d{2}-\d{2}$/;
  const hm = /^\d{2}:\d{2}$/;
  for (const s of samples) {
    it(`${s.name}: a well-formed brief answer per the contract`, () => {
      const p = s.payload;
      expect(["morning", "evening"]).toContain(s.kind);
      expect(p.day).toMatch(ymd);
      expect(typeof p.timezone).toBe("string");
      for (const k of ["events", "changed", "new", "todos_due"]) expect(Array.isArray(p[k])).toBe(true);
      for (const e of p.events) {
        expect(typeof e.id).toBe("string");
        expect(typeof e.title).toBe("string");
        if (e.start_time !== null) expect(e.start_time).toMatch(hm);
        if (e.end_time !== null) expect(e.end_time).toMatch(hm);
        expect(["event", "deadline"]).toContain(e.kind);
        expect(["active", "cancelled"]).toContain(e.status);
        expect(Array.isArray(e.sources)).toBe(true);
        expect(typeof e.todos.open).toBe("number");
        expect(e.todos.titles).toHaveLength(e.todos.open);
      }
      for (const c of p.changed) {
        expect(c.date).toMatch(ymd);
        expect(["cancelled", "moved"]).toContain(c.status);
        if (c.status === "moved") expect(c.was).toMatch(ymd);
      }
      for (const n of p.new) {
        expect(n.date).toMatch(ymd);
        expect(Array.isArray(n.sources)).toBe(true);
      }
      for (const t of p.todos_due) {
        expect(t.due).toMatch(ymd);
        if (s.kind === "evening") expect(t.due).toBe(p.day);
      }
      const empty = ["events", "changed", "new", "todos_due"].every((k) => p[k].length === 0);
      expect(!!s.expect.nothing).toBe(empty);
      if (!empty) expect(s.expect.mentions?.length).toBeGreaterThan(0);
    });
  }

  it("cover an empty day, a busy day, a cancelled PTM and a new import", () => {
    const names = samples.map((s) => s.name).join(" | ");
    for (const w of ["empty morning", "busy morning", "cancelled PTM", "new import"]) expect(names).toContain(w);
  });
});

const flockApp = process.env.FLOCK_APP_DIR;
const validatorPath = flockApp ? join(flockApp, "server/src/use-case-templates.ts") : "";
describe.skipIf(!flockApp || !existsSync(validatorPath))("Flock's template validator", () => {
  it("accepts the template as Flock loads it", async () => {
    const { validateUseCaseTemplate } = await import(validatorPath);
    const errors = validateUseCaseTemplate({
      ...manifest,
      id: manifest.slug,
      agent: { ...manifest.agent, claudeMd: read("SOUL.md"), examplePrompts: manifest.agent.examplePrompts ?? [] },
      tasks: manifest.tasks.map((t: any) => ({ ...t, deliverTo: t.deliverTo ?? null })),
    });
    expect(errors).toEqual([]);
  });
});
