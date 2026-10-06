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

describe("Calendar Desk manifest planning", () => {
  test("the plan_events intent carries planning-instructions.md verbatim (run scripts/embed-instructions.ts after editing it)", () => {
    const intent = manifest.agentInterface.intents.find((i: any) => i.name === "plan_events");
    expect(intent.instructions).toBe(readFileSync(join(import.meta.dir, "../../planning-instructions.md"), "utf8"));
    expect(intent.payloadSchema.required).toEqual(["planId", "events"]);
  });
  test("declares the hourly Plan upcoming events routine and the plan_events_done operation", () => {
    expect(manifest.routines.find((r: any) => r.id === "event-planning")).toMatchObject({ name: "Plan upcoming events", trigger: { type: "schedule", cron: "30 * * * *" }, executionMode: "app-relay" });
    expect(manifest.agentInterface.operations.find((o: any) => o.name === "plan_events_done")).toMatchObject({ invoke: "ops/plan_events_done" });
  });
});
