// GET /api/agent-info — the paired agent's identity for the UI (§6 pairing). Returns
// { agentId, agentName } when the app is paired (platform-injected FLOCK_AGENT_ID/NAME present),
// or { agentId: null, agentName: null, paired: false } when unpaired — so the frontend can render
// the real agent name in the revision trail + revision affordance, and degrade honestly to a
// "not connected to an agent yet" state otherwise. No secret is exposed — only the display id/name.

import { Hono } from "hono";
import { pairedAgent } from "../services/agentIdentity";

const agentInfo = new Hono();

agentInfo.get("/", (c) => {
  const agent = pairedAgent();
  if (!agent) return c.json({ paired: false, agentId: null, agentName: null });
  return c.json({ paired: true, agentId: agent.agentId, agentName: agent.agentName });
});

export default agentInfo;
