// Agent intent channel — the replacement for the old hand-placed HMAC webhook file (§6.6, §14.1).
// Where Reply Desk fired a bespoke webhook at a hard-coded agent, Draft Desk drives its PAIRED
// agent through the platform's standard, signed intent channel. The platform routes each typed intent to
// the paired agent's session (reusing the draft's task session when a taskId is supplied), so the
// app never holds an agent token and never hard-codes a webhook binding.
//
// Every trigger fails soft (mirrors the old fire-and-forget contract): a missing pairing, an
// unconfigured platform edge, or a reference-only webhook returns { triggered:false, reason } so
// the caller can revert a draft and the owner never sees an error. The workbench stays usable
// standalone.
//
// Intents (declared in flock.app.json agentInterface.intents):
//   • drafts_requested  — the owner asked for more drafts; the agent scans sources and creates
//                          drafts via the drafts API.
//   • draft_revision_requested — the owner commented on a draft; the agent rewrites it in voice.
//   • draft_send_requested — the owner approved a draft FROM THE WORKBENCH; the agent sends it via
//                          the granted skill and marks it sent. This is the in-app approve path.
//
// Note on the two send paths (both terminate at the same markSent): approving from the DASHBOARD
// runs the Task's script_then_agent action — the platform executor sends deterministically via the
// skill and escalates to the agent only on failure (§9). Approving from the WORKBENCH (the deep
// app UI) fires draft_send_requested so the flow works inside the app too and degrades soft when
// the platform edge is down.

import { sendIntent } from "./platformClient";
import { isPaired } from "./agentIdentity";

// Failure taxonomy the UI distinguishes (§14.1): the owner must be able to tell "no agent is set
// up yet — go pair one in Flock" (not_paired) from "the agent couldn't be reached — try again"
// (unreachable/rejected). `not_paired` is the honest state when the app isn't paired at all.
export type TriggerReason =
  | "not_paired"
  | "not_configured"
  | "no_signing_secret"
  | "rejected"
  | "unreachable";

export type TriggerResult =
  | { triggered: true }
  | { triggered: false; reason: TriggerReason };

function toResult(intent: string, outcome: Awaited<ReturnType<typeof sendIntent>>): TriggerResult {
  if (outcome.ok) return { triggered: true };

  let reason: TriggerReason;
  if ("skipped" in outcome && outcome.skipped) {
    // not_configured means no token/base URL. If we ALSO have no paired agent, the honest, actionable
    // message is "not paired yet" — prefer that so the UI can point the owner at pairing setup.
    reason = outcome.reason === "not_configured" && !isPaired() ? "not_paired" : outcome.reason;
  } else if (outcome.reason === "timeout") {
    // A timeout means the agent session was accepted and is running server-side — treat as success,
    // same as the old webhook's synchronous-endpoint timeout path.
    return { triggered: true };
  } else if (outcome.reason.startsWith("platform 4")) {
    // 404 from the intent route = no active pairing on the platform side; other 4xx = rejected.
    reason = outcome.reason === "platform 404" && !isPaired() ? "not_paired" : "rejected";
  } else {
    reason = "unreachable";
  }

  // Log the reason server-side so a broken pairing/intent is diagnosable (§13 structured logs).
  console.warn(`[agentIntent] intent "${intent}" not delivered: reason=${reason}`);
  return { triggered: false, reason };
}

// Ask the paired agent to scan sources and add more drafts. No taskId — this is a fresh request
// not bound to an existing draft's session.
export async function triggerDraftsRequested(): Promise<TriggerResult> {
  return toResult("drafts_requested", await sendIntent("drafts_requested", {}));
}

// Ask the paired agent to revise one draft the owner commented on. Passing draftId lets the agent
// locate the draft via the drafts API; the platform reuses the draft's task session when one
// exists (payload.taskId maps to it server-side — we pass the draft's task source ref as taskId
// hint via `draftId`; the platform resolves the session from the task the app published).
export async function triggerDraftRevision(draftId: string): Promise<TriggerResult> {
  return toResult("draft_revision_requested", await sendIntent("draft_revision_requested", { draftId, taskId: draftId }));
}

// Ask the paired agent to send one approved draft via its granted skill, then mark it sent. Fired
// on the workbench's in-app approve (the dashboard approve uses the Task action executor instead).
export async function triggerDraftSend(draftId: string): Promise<TriggerResult> {
  return toResult("draft_send_requested", await sendIntent("draft_send_requested", { draftId, taskId: draftId }));
}
