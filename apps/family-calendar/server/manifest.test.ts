// What the agent reads to use the app: the manifest's operations and instructions, and the guide. Every operation declared
// has a handler, the guide and the manifest name the fields the code reads, and the routine named has its handler.
import { describe, it, expect } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";
import { FIELDS_SECTION, OPERATION_NAMES } from "./agentOps";
import { EVENT_FIELDS, MEMBER_FIELDS } from "./events";
import { routines } from "./routines";
import { boot } from "./testkit";

const manifest = JSON.parse(readFileSync(join(import.meta.dir, "..", "flock.app.json"), "utf8"));
const guide = readFileSync(join(import.meta.dir, "agent-guide.md"), "utf8");
const instructions: string = manifest.agentInterface.instructions;
const operations: { name: string; description: string }[] = manifest.agentInterface.operations;

describe("the agent's interface", () => {
  it("declares guide and add_events, each with a handler, and says what each takes", () => {
    expect(operations.map((o) => o.name).sort()).toEqual([...OPERATION_NAMES].sort());
    expect(OPERATION_NAMES).toEqual(["guide", "add_events"]);
    for (const o of operations) expect(o.description, o.name).toContain("{");
  });

  it("the manifest and the guide name every field add_events reads", () => {
    const d = operations.find((o) => o.name === "add_events")!.description;
    for (const f of [...EVENT_FIELDS, ...MEMBER_FIELDS, "events", "members"]) { expect(d, f).toContain(f); expect(guide, f).toContain(f); }
    expect(FIELDS_SECTION).toContain("- add_events { events: [{ title, who?, date?, weekdays?, repeat?, start_time?, end_time?, location?, notes?, reminder? }], members?: [{ name, emoji?, colour? }] }");
  });

  it("the guide operation answers the guide with the fields at its end, and its own example is taken as written", async () => {
    const k = await boot({ now: () => new Date(2026, 10, 20, 17, 30) });
    const g = (await k.op("guide")).guide as string;
    expect(g).toStartWith("# Family Calendar: the agent's guide");
    expect(g.trimEnd().endsWith(FIELDS_SECTION)).toBe(true);
    // The example in the guide is a call the app accepts: an example that is refused teaches the wrong shape.
    const example = /```\nadd_events (\{[\s\S]*?\})\n```/.exec(guide)![1];
    const r = await k.op("add_events", new Function(`return (${example})`)());
    expect(r.error).toBeUndefined();
    expect(r).toMatchObject({ added: 4, members_added: ["Agastya", "Gowri Shankar", "Ankita"] });
  });

  it("says events are not reminders, to use add_events and not the data route, and what the app sends itself", () => {
    for (const text of [guide.replace(/\s+/g, " "), instructions]) {
      expect(text).toContain("add_events");
      expect(text).toMatch(/[Nn]ever write events, members or (their )?reminders/);
      expect(text).toMatch(/[Ee]very 15 minutes/);
    }
    expect(guide).toContain("## Events and reminders are different things");
    expect(guide).toContain("## What the app sends on its own");
    expect(instructions.length).toBeLessThanOrEqual(1200);
    expect(guide).not.toContain("—");
    expect(instructions).not.toContain("—");
  });

  it("the routine the manifest names has its handler, every 15 minutes, run by the app", () => {
    expect(manifest.routines).toHaveLength(1);
    expect(manifest.routines[0]).toMatchObject({ id: "due-reminders", handler: "due-reminders", executionMode: "app-relay", trigger: { type: "schedule", cron: "*/15 * * * *" } });
    expect(Object.keys(routines)).toEqual(["due-reminders"]);
  });
});
