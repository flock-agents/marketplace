// The model call Flock gives an app (the manifest's top-level `"model": true`): one structured request, answered with JSON
// that fits a schema, metered to the family by Flock. Everything in the app that asks a model goes through ModelCall, so a
// test hands in a fake and the wiring to the SDK is the one line in sdkModel.

/** What the app asks. `tier`: "fast" for cheap, many-times work (a day's ingredients), "balanced" for the week's menu. */
export type ModelRequest = { system: string; user: string; schema?: object; tier: "fast" | "balanced" | "best"; maxTokens?: number; purpose?: string };
/** A stop that is the family's to fix (no credits, the day's budget spent, too many calls): never tried again in a run. */
export const STOP_CODES = ["not_declared", "daily_budget", "out_of_credits", "rate_limited", "bad_request"] as const;
/** bad_request: Flock refused the request's shape (a bug here, never tried again). Flock's daily cap comes as rate_limited. */
export type ModelFailure = "not_declared" | "daily_budget" | "out_of_credits" | "rate_limited" | "bad_request" | "invalid_output" | "timeout" | "unavailable";
export type ModelResult = { ok: true; json?: unknown; text?: string; model: string } | { ok: false; code: ModelFailure; message: string };
export type ModelCall = (req: ModelRequest) => Promise<ModelResult>;

/** A platform with no model call on it (an older Flock's SDK, a run with no platform): Flock's contract maps it to unavailable. */
export const NO_MODEL: ModelCall = async () => ({ ok: false, code: "unavailable", message: "this Flock gives the app no model call" });

/** The SDK's model call on a platform context (an operation's `ctx.platform`, a routine's `ctx.platform`, `flock.platform`):
 *  `platform.model?.json(req)`, optional on the SDK's PlatformContext. Wired here and nowhere else. */
export function sdkModel(platform: unknown): ModelCall {
  const model = (platform as { model?: { json?: (req: ModelRequest) => Promise<ModelResult> } } | null | undefined)?.model;
  if (typeof model?.json !== "function") return NO_MODEL;
  return async (req) => {
    try { return await model.json!(req); } catch (e) { return { ok: false, code: "unavailable", message: e instanceof Error ? e.message : String(e) }; }
  };
}

/** Does this platform give the app a model call at all (an older Flock's SDK does not). */
export const hasModel = (platform: unknown): boolean =>
  typeof (platform as { model?: { json?: unknown } } | null | undefined)?.model?.json === "function";

/** The line the family reads when a stop leaves the week unplanned. */
export function stopSaid(code: ModelFailure): string {
  switch (code) {
    case "out_of_credits": return "I couldn't plan next week's meals: your Flock credits have run out. Top them up and tell me \"plan the week\".";
    case "daily_budget": return "I couldn't plan next week's meals: today's spending limit is reached. Tell me \"plan the week\" tomorrow, or raise the limit.";
    case "rate_limited": return "I couldn't plan next week's meals just now: too many requests at once. Tell me \"plan the week\" in a little while.";
    case "not_declared": return "I couldn't plan next week's meals: this version of Flock can't plan them yet. Update Flock and tell me \"plan the week\".";
    default: return "I couldn't plan next week's meals just now. Tell me \"plan the week\" in a little while.";
  }
}
