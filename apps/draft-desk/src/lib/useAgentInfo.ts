import { useEffect, useState } from "react";
import type { AgentInfo, IntentFailureReason } from "../../shared/types";
import { api } from "./api";

// Fetch the paired agent's identity once. Returns null while loading or if the fetch fails (the UI
// then falls back to a neutral "your agent" label rather than blocking). `paired:false` is a real,
// loaded state the UI uses to show the honest "not connected to an agent yet" affordance.
export function useAgentInfo(): AgentInfo | null {
  const [info, setInfo] = useState<AgentInfo | null>(null);
  useEffect(() => {
    let alive = true;
    api
      .agentInfo()
      .then((i) => { if (alive) setInfo(i); })
      .catch(() => { if (alive) setInfo(null); });
    return () => { alive = false; };
  }, []);
  return info;
}

// The display name for the paired agent, or a neutral fallback when unknown/unpaired. Used for the
// revision-trail author label and the revision affordance copy.
export function agentDisplayName(info: AgentInfo | null): string {
  return info?.paired && info.agentName ? info.agentName : "your agent";
}

// Turn an intent-delivery failure reason into a clear owner-facing message that distinguishes
// "no agent set up yet" from a transient reachability problem (§14.1). `agentName` personalizes it.
export function intentFailureMessage(reason: IntentFailureReason | undefined, agentName: string): string {
  switch (reason) {
    case "not_paired":
      return "No agent is connected yet — set one up in Flock, then try again.";
    case "not_configured":
      return `${agentName} isn't fully connected yet — finish setup in Flock, then try again.`;
    case "no_signing_secret":
      return `Couldn't securely reach ${agentName} — reconnect the app in Flock, then try again.`;
    case "rejected":
      return `${agentName} rejected the request. Try again, or re-pair the app in Flock.`;
    case "unreachable":
    default:
      return `Couldn't reach ${agentName} right now — try again in a moment.`;
  }
}
