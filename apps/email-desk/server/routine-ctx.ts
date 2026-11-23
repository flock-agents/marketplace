// A routine's context built from the platform alone, for work the app starts itself (lifecycle initialize and tick) that runs
// the same code as a routine run. The paired agent is never woken from it: the wake and the owner message answer "skipped",
// as they do on an unpaired copy, and the routine's state is kept in memory for the call.
import { skipped, type PlatformContext } from "@flock/app-sdk";
import type { RoutineCtx } from "./platform-ext";

export function routineCtxFor(platform: PlatformContext, accountId: string, skillId = "gmail"): RoutineCtx {
  let state: unknown = null;
  const ctx = {
    routine: {
      id: "app", appRoutineId: "app", handler: "app", agentId: platform.pairedAgent?.id ?? "", name: "Email Desk",
      accounts: { [skillId]: accountId }, trigger: {}, values: {},
    },
    trigger: "manual",
    platform,
    connectors: {
      exec: (skill: string, functionName: string, params?: Record<string, unknown>, opts?: { account?: string; timeoutMs?: number; turnId?: string }) =>
        platform.connectors.exec({
          skillId: skill, functionName, params, accountHint: opts?.account ?? accountId, timeoutMs: opts?.timeoutMs, turnId: opts?.turnId,
        }),
    },
    wakeAgent: async () => skipped<any>(),
    notify: async () => skipped<any>(),
    state: { get: () => state, set: (v: unknown) => { state = v; } },
  };
  return ctx as unknown as RoutineCtx;
}
