import { describe, it, expect } from "bun:test";
import { coachRoutine } from "./routines";

type Wake = { message: string; data: unknown };
function context(result: { ok: true } | { ok: false; reason: string } = { ok: true }) {
  const wakes: Wake[] = [];
  return { wakes, ctx: { wakeAgent: async (message: string, data?: unknown) => { wakes.push({ message, data }); return result as never; } } };
}

describe("coachRoutine", () => {
  it("spends no model run until the app is set up", async () => {
    const { wakes, ctx } = context();
    await coachRoutine(() => false, "Time for today's plan.", () => "/a/fit/api")(ctx);
    expect(wakes).toEqual([]);
  });
  it("wakes the coach with the message and the app's API path once set up", async () => {
    const { wakes, ctx } = context();
    await coachRoutine(() => true, "Time for today's plan.", () => "/a/fit/api")(ctx);
    expect(wakes).toEqual([{ message: "Time for today's plan.", data: { api: "/a/fit/api" } }]);
  });
  it("fails the run when the coach cannot be woken", async () => {
    const { ctx } = context({ ok: false, reason: "agent_busy" });
    await expect(coachRoutine(() => true, "x", () => "/a/fit/api")(ctx)).rejects.toThrow("agent_busy");
  });
});
