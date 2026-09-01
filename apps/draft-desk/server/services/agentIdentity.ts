// Paired-agent identity, read from the platform-injected environment. When Draft Desk is actively
// paired with an agent, the platform injects FLOCK_AGENT_ID + FLOCK_AGENT_NAME into this app's
// subprocess; both are ABSENT when the app is unconfigured, unpaired, or disabled. The UI uses this
// to render the real agent's name (instead of the legacy stored "milo" discriminator) and to show
// an honest "not connected to an agent yet" state.

export interface AgentIdentity {
  agentId: string;
  agentName: string;
}

// The paired agent's identity, or null when the app is not paired (env absent). A present id with a
// missing name falls back to a neutral display name so we never surface an empty label.
export function pairedAgent(): AgentIdentity | null {
  const agentId = process.env.FLOCK_AGENT_ID;
  if (!agentId || agentId.length === 0) return null;
  const agentName = process.env.FLOCK_AGENT_NAME;
  return { agentId, agentName: agentName && agentName.length > 0 ? agentName : "Agent" };
}

// True when the app is paired with an agent (an agent will actually act on drafts).
export function isPaired(): boolean {
  return pairedAgent() !== null;
}
