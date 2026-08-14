#!/usr/bin/env bun
/**
 * Zepto — keep-alive: check session health and refresh cookies.
 * Params: (none)
 */
import {
  requireBrowserSession,
  errorJson,
  browserNavigate,
  type GroceryServiceConfig,
} from "../../_shared/_grocery_helpers";

const config: GroceryServiceConfig = {
  name: "Zepto",
  baseUrl: "https://www.zeptonow.com",
  loginPattern: /zeptonow\.com\/auth|zeptonow\.com\/login/i,
};

const SKILL_ID = process.env.SKILL_ID || "zepto";
const BROWSER_SESSION_NAME = process.env.BROWSER_SESSION || "zepto";
const FLOCK_API = process.env.FLOCK_API_URL || "http://localhost:35625";
const FLOCK_AUTH_TOKEN = process.env.FLOCK_AUTH_TOKEN || "";
const FLOCK_AGENT_ID = process.env.FLOCK_AGENT_ID || "";

function writeStatus(status: string, detail: string): string {
  const now = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  return JSON.stringify({
    service: SKILL_ID,
    session: BROWSER_SESSION_NAME,
    status,
    detail,
    checkedAt: now,
  });
}

requireBrowserSession();

let result: any;
try {
  result = await browserNavigate(config, config.baseUrl);
} catch {
  const statusJson = writeStatus("unreachable", "Could not reach Zepto");
  console.log(statusJson);
  process.exit(1);
}

const finalUrl: string = result.url || "";

if (config.loginPattern.test(finalUrl)) {
  // Mark session as outdated
  try {
    await fetch(`${FLOCK_API}/api/internal/browser-sessions/${BROWSER_SESSION_NAME}/mark-outdated`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${FLOCK_AUTH_TOKEN}`,
      },
      body: JSON.stringify({
        agentId: FLOCK_AGENT_ID,
        reason: "Keep-alive: Zepto session expired — redirected to login",
      }),
    });
  } catch {
    // ignore
  }

  const statusJson = writeStatus("expired", "Session redirected to login — marked as outdated");
  console.log(statusJson);
  process.exit(1);
}

const statusJson = writeStatus("healthy", "Session active — cookies refreshed");
console.log(statusJson);
