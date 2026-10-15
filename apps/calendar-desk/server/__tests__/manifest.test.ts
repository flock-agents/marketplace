// apps/calendar-desk/server/__tests__/manifest.test.ts
import { describe, test, expect } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";
import { kindTable } from "../kinds";

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

describe("Calendar Desk manifest planning", () => {
  test("the plan_events intent carries planning-instructions.md verbatim (run scripts/embed-instructions.ts after editing it)", () => {
    const intent = manifest.agentInterface.intents.find((i: any) => i.name === "plan_events");
    expect(intent.instructions).toBe(readFileSync(join(import.meta.dir, "../../planning-instructions.md"), "utf8"));
    expect(intent.payloadSchema.required).toEqual(["planId", "events"]);
  });
  test("the prompt's kind table is rendered from kindTable(), in the .md and in the embedded copy", () => {
    const intent = manifest.agentInterface.intents.find((i: any) => i.name === "plan_events");
    const md = readFileSync(join(import.meta.dir, "../../planning-instructions.md"), "utf8");
    for (const text of [md, intent.instructions]) {
      const m = text.match(/<!-- kinds -->\n([\s\S]*?)\n<!-- \/kinds -->/);
      expect(m).not.toBeNull();
      expect(m![1]).toContain(kindTable());
    }
  });
  test("the instructions never mention the retired question, and explain the place pattern (amendment 1)", () => {
    const text = manifest.agentInterface.intents.find((i: any) => i.name === "plan_events").instructions as string;
    expect(text).not.toMatch(/`asked`|"answered"|held back|one-time question|Calendar Desk's question|wants the reminder/);
    expect(text).toContain("`pattern`");
    expect(text).toMatch(/only when none of the above exist/);
    expect(text).not.toMatch(/—/);
  });
  test("the plan_events rules fit Flock's per-intent limit (64k from flock 9f17f6213; 20k before dropped them silently)", () => {
    const intent = manifest.agentInterface.intents.find((i: any) => i.name === "plan_events");
    expect(intent.instructions.length).toBeLessThanOrEqual(64_000);
  });
  test("the plan_events_done description names each event's type and each step's kind", () => {
    const d = manifest.agentInterface.operations.find((o: any) => o.name === "plan_events_done").description as string;
    expect(d).toMatch(/event:'e1', ?type,/);
    expect(d).toMatch(/steps:\[\{key, ?kind, ?title/);
  });
  test("declares the hourly Plan upcoming events routine and the plan_events_done operation", () => {
    expect(manifest.routines.find((r: any) => r.id === "event-planning")).toMatchObject({ name: "Plan upcoming events", trigger: { type: "schedule", cron: "30 * * * *" }, executionMode: "app-relay" });
    expect(manifest.agentInterface.operations.find((o: any) => o.name === "plan_events_done")).toMatchObject({ invoke: "ops/plan_events_done" });
  });
});
