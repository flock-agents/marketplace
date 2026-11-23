import { describe, test, expect } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";

const root = join(import.meta.dir, "../..");
const manifest = JSON.parse(readFileSync(join(root, "flock.app.json"), "utf-8"));
const marketplace = JSON.parse(readFileSync(join(root, "flock.marketplace.json"), "utf-8"));
const catalog = JSON.parse(readFileSync(join(root, "../../catalog.json"), "utf-8"));

const INSTRUCTIONS =
  "Use reply_context before writing a reply and create_draft to record it. You never send mail: the person sends it with Send on the card, or by replying send to its line. When they ask for a change, use update_draft.";

describe("Email Desk manifest", () => {
  test("a per-person, deletable, model-using app", () => {
    expect(manifest.slug).toBe("email-desk");
    expect(manifest.usage).toBe("app");
    expect(manifest.bundled).toBe(false);
    expect(manifest.deletable).toBe(true);
    expect(manifest.model).toBe(true);
  });

  test("process config", () => {
    expect(manifest.processConfig).toEqual({
      command: "bun run server/index.ts",
      healthCheckPath: "/health",
      readyPattern: "email-desk listening on",
      readyTimeoutMs: 15000,
      maxRestarts: 3,
    });
  });

  test("requires gmail and a paired agent", () => {
    expect(manifest.config.requires).toEqual({
      skills: ["gmail"],
      agent: { required: true, label: "Agent that drafts your replies", default: { pairDefaultAgent: true } },
    });
  });

  test("lifecycle hooks", () => {
    expect(manifest.lifecycle).toEqual({ initialize: true, tick: true, progress: true });
  });

  test("routines: both per-account on gmail new-mail, app-relay", () => {
    const byId = Object.fromEntries(manifest.routines.map((r: any) => [r.id, r]));
    expect(Object.keys(byId).sort()).toEqual(["follow-up", "memory-extraction"]);
    for (const r of Object.values(byId) as any[]) {
      expect(r.executionMode).toBe("app-relay");
      expect(r.handler).toBe(r.id);
    }
    for (const r of Object.values(byId) as any[]) {
      expect(r.trigger).toEqual({ connectorId: "gmail", eventId: "new-mail" });
      expect(r.eventKinds).toEqual(["email"]);
    }
    const keys = (r: any) => r.configSchema.map((c: any) => c.key);
    expect(keys(byId["memory-extraction"])).toContain("harvestHour");
    expect(keys(byId["follow-up"])).toContain("followUpHour");
  });

  test("publishes the two reading skills", () => {
    expect(manifest.publishedSkills.map((s: any) => s.id)).toEqual(["judge-mail", "write-reply"]);
  });

  test("declares exactly the four agent ops, never send_draft or a platform op", () => {
    const names = manifest.agentInterface.operations.map((o: any) => o.name);
    expect(names).toEqual(["reply_context", "create_draft", "update_draft", "discard_draft"]);
    for (const banned of ["send_draft", "newest_thread_message", "thread_body", "store_thread_body", "last_harvest", "follow_up_kind", "draft_send_recorded", "mailboxes", "bundle_rows"]) {
      expect(names).not.toContain(banned);
    }
    expect(JSON.stringify(manifest)).not.toContain("send_draft");
  });

  test("update_draft takes an optional by: person", () => {
    const op = manifest.agentInterface.operations.find((o: any) => o.name === "update_draft");
    expect(op.payloadSchema.required).toEqual(["id", "body"]);
    expect(op.payloadSchema.properties.by).toEqual({ type: "string", enum: ["person"] });
  });

  test("instructions are verbatim", () => {
    expect(manifest.agentInterface.instructions).toBe(INSTRUCTIONS);
  });

  test("marketplace file and catalog item agree", () => {
    expect(marketplace.version).toBe("3.0.0");
    // R28: the SDK's READ_TURN_MIN_FLOCK, in all three places, so the rc installs on the Flock it ships against.
    expect(marketplace.minFlockVersion).toBe("0.24.0-beta.2");
    expect(manifest.minFlockVersion).toBe("0.24.0-beta.2");
    const item = catalog.items.find((i: any) => i.slug === "email-desk");
    expect(item.minFlockVersion).toBe("0.24.0-beta.2");
    expect(item.type).toBe("app");
    expect(item.usage).toBe("app");
    expect(item.latestVersion).toBe("3.0.0");
    expect(item.path).toBe("apps/email-desk");
    expect(item.personalAssistant).toEqual({ always: true, useCase: "email", skills: ["gmail"] });
  });
});
