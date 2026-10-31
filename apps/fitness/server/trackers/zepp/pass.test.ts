import { describe, it, expect } from "bun:test";
import { syncPass, type CallZepp } from "./pass";
import { syncPlan } from "./ingest";
import type { SyncStore } from "../store";
import type { ToolReply } from "../tool-result";

const NOW = new Date("2026-10-21T01:00:00.000Z");   // 6:30 AM in Kolkata, 21 Oct
const reply = (data: unknown): ToolReply => ({ ok: true, data: { structuredContent: data } });

function store(): SyncStore & { added: string[] } {
  const added: string[] = [];
  return {
    added,
    findReading: () => null,
    hasEvent: () => false,
    addReading: async (r) => { added.push(r.label); },
    updateReading: async () => {},
    addEvent: async () => {},
  };
}

describe("syncPass", () => {
  it("calls each planned Zepp action once, in turn, with its own arguments", async () => {
    const calls: { tool: string; args: Record<string, unknown> }[] = [];
    let inFlight = 0, most = 0;
    const call: CallZepp = async (tool, args) => {
      calls.push({ tool, args });
      most = Math.max(most, ++inFlight);
      await Promise.resolve();
      inFlight--;
      return reply({ status: "ok" });
    };
    await syncPass(call, store(), NOW);
    expect(calls).toEqual(Object.values(syncPlan(NOW).calls));
    expect(most).toBe(1);
  });
  it("files what the actions returned", async () => {
    const s = store();
    const call: CallZepp = async (tool) =>
      tool === "zepp_daily_summary" ? reply({ status: "ok", days: [{ date: "2026-10-20", steps: 8412 }] }) : reply({ status: "ok" });
    expect(await syncPass(call, s, NOW)).toMatchObject({ ok: true, added: 1 });
    expect(s.added).toEqual(["Steps"]);
  });
  it("fails the pass when every action is refused", async () => {
    const call: CallZepp = async () => ({ ok: false, reason: "Skill is not granted to this app" });
    expect(await syncPass(call, store(), NOW)).toMatchObject({ ok: false, message: "Zepp sync failed: Skill is not granted to this app" });
  });
});
