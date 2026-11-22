// What the agent reads to use the app: the manifest's operations and instructions, and the guide. Every operation declared
// has a handler, the guide and the manifest name the fields the code reads, and each routine named has its handler.
import { describe, it, expect } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";
import { FIELDS, FIELDS_SECTION, OPERATION_NAMES, agentOps } from "./agentOps";
import { EVENT_FIELDS, MEMBER_FIELDS } from "./events";
import { ITEM_FIELDS, STEP_FIELDS } from "./calendar";
import { EVENT_TYPES, kindTable } from "./kinds";
import { routines } from "./routines";
import { boot } from "./testkit";

const manifest = JSON.parse(readFileSync(join(import.meta.dir, "..", "flock.app.json"), "utf8"));
const guide = readFileSync(join(import.meta.dir, "agent-guide.md"), "utf8");
const prompt = readFileSync(join(import.meta.dir, "plan-prep-prompt.md"), "utf8");
const instructions: string = manifest.agentInterface.instructions;
const operations: { name: string; description: string }[] = manifest.agentInterface.operations;
const desc = (name: string) => operations.find((o) => o.name === name)!.description;

describe("the agent's interface", () => {
  it("declares guide, add_events, import_events, plan_done and brief, each with a handler, and says what each takes", () => {
    expect(operations.map((o) => o.name).sort()).toEqual([...OPERATION_NAMES].sort());
    expect(OPERATION_NAMES).toEqual(["guide", "add_events", "import_events", "plan_done", "brief"]);
    const handlers = agentOps(() => null as any, () => null as any);
    for (const o of operations) { expect(o.description, o.name).toContain("{"); expect(typeof handlers[o.name], o.name).toBe("function"); }
  });

  it("the manifest and the guide name every field the operations read", () => {
    for (const f of [...EVENT_FIELDS, ...MEMBER_FIELDS, "events", "members", "added_by"]) { expect(desc("add_events"), f).toContain(f); expect(guide, f).toContain(f); }
    for (const f of [...ITEM_FIELDS, "source", "label", "items"]) expect(desc("import_events"), f).toContain(f);
    for (const f of [...STEP_FIELDS, "planId", "event", "type"]) expect(desc("plan_done"), f).toContain(f);
    for (const f of ["kind", "morning", "evening", "todos_due", "changed", "new"]) expect(desc("brief"), f).toContain(f);
    expect(FIELDS.import_events.fields).toEqual(["source", "label", "items"]);
    expect(FIELDS_SECTION).toContain("- add_events { events: [{ title, who?, date?, end_date?, weekdays?, repeat?, monthly_by?, start_time?, end_time?, location?, notes?, reminder?, kind?, added_by? }], members?: [{ name, emoji?, colour? }], added_by? }");
    expect(FIELDS_SECTION).toContain("- plan_done { planId, events: [{ event, type, steps: [{ key, kind, title, due, due_time?, show_from?, why? }] }] }");
    expect(FIELDS_SECTION).toContain("- brief { kind: morning | evening }");
  });

  it("an operation refuses a field it does not take, with its field list", async () => {
    const k = await boot();
    const r = await k.op("brief", { kind: "morning", day: "2026-11-23" });
    expect(r).toMatchObject({ code: "APP_REFUSED", status: 400 });
    expect(r.error).toContain("brief does not take day");
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
    expect(r).toMatchObject({ added: 5, members_added: ["Agastya", "Gowri Shankar", "Ankita"] });
    expect(r.events.map((e: any) => [e.title, e.reminder_minutes, e.added_by])).toEqual([
      ["Skating class", 30, "Shiva"], ["Skating class", 30, "Shiva"], ["Art class", null, "Shiva"], ["Dentist", 60, "Shiva"], ["Grandma's birthday", null, "Shiva"]]);
  });

  it("says the calendar holds events, to-dos come from plan-prep, never a reminder row, and what the app sends itself", () => {
    for (const text of [guide.replace(/\s+/g, " "), instructions]) {
      expect(text).toContain("add_events");
      expect(text).toContain("plan_done");
      expect(text).toMatch(/[Nn]ever write events, members or to-dos|never write events or members/);
      expect(text).toMatch(/never (make )?a reminder row/);
      expect(text).toMatch(/[Ee]very 15 minutes/);
      expect(text).not.toMatch(/evening before"? reminder|reminder: "evening before"/);
    }
    expect(guide).toContain("## The calendar holds events");
    expect(guide).toContain("## What the app sends on its own");
    expect(instructions.length).toBeLessThanOrEqual(1200);
    for (const t of [guide, instructions, prompt, ...operations.map((o) => o.description)]) expect(t).not.toContain("—");
  });

  it("the routines the manifest names have their handlers, run by the app; plan-prep carries the planning prompt", () => {
    expect(manifest.routines.map((r: any) => r.id)).toEqual(["due-reminders", "plan-prep"]);
    expect(manifest.routines[0]).toMatchObject({ id: "due-reminders", handler: "due-reminders", executionMode: "app-relay", trigger: { type: "schedule", cron: "*/15 * * * *" } });
    expect(manifest.routines[1]).toMatchObject({ id: "plan-prep", handler: "plan-prep", executionMode: "app-relay", trigger: { type: "schedule", cron: "20 * * * *" } });
    expect(manifest.routines[1].prompt).toBe(prompt.trimEnd());
    expect(Object.keys(routines).sort()).toEqual(["due-reminders", "plan-prep"]);
    for (const r of manifest.routines) expect(r.description).not.toContain("evening before");
  });

  it("the planning prompt is Calendar Desk's rules for a family: the kinds table as plan_done checks it, ties first, never ask", () => {
    for (const w of ["buy", "pay", "sign and return", "send", "book", "collect", "Nothing is the usual answer", "At most 3 steps", "plan_done", "planId", "show_from", "closed",
      "GET /api/internal/todos", "PATCH /api/internal/todos/<id>", "**Long lead.**", "You never ask", "SAME `key`", "covered by a TODO"]) expect(prompt, w).toContain(w);
    expect(prompt).toContain(`<!-- kinds -->\n${kindTable()}\n<!-- /kinds -->`);
    for (const t of EVENT_TYPES) expect(prompt, t).toContain(`\`${t}\``);
    for (const k of ["sign-and-return", "buy-for-event", "send-to-school", "payment", "documents", "gift"]) expect(prompt, k).toContain(`\`${k}\``);
  });
});
