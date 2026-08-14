#!/usr/bin/env bun
/**
 * Keep-alive check for BigBasket browser session.
 * Params: (none)
 */
import {
  errorJson,
  requireBrowserSession,
  browserNavigate,
  type GroceryServiceConfig,
} from "../../_shared/_grocery_helpers";
import { writeFileSync } from "fs";

const config: GroceryServiceConfig = {
  name: "BigBasket",
  baseUrl: "https://www.bigbasket.com",
  loginPattern: /bigbasket\.com\/signin|bigbasket\.com\/login/i,
};

const SKILL_ID = process.env.SKILL_ID || "bigbasket";
const BROWSER_SESSION = process.env.BROWSER_SESSION || "bigbasket";
const FLOCK_API = process.env.FLOCK_API_URL || "http://localhost:35625";
const FLOCK_AUTH_TOKEN = process.env.FLOCK_AUTH_TOKEN || "";
const FLOCK_AGENT_ID = process.env.FLOCK_AGENT_ID || "";
const STATUS_FILE = `/tmp/skill-${SKILL_ID}-keepalive.json`;

function writeStatus(status: string, detail: string): string {
  const now = new Date().toISOString().replace(/\.\d+Z$/, "Z");
  return JSON.stringify({
    service: SKILL_ID,
    session: BROWSER_SESSION,
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
  const statusJson = writeStatus("unreachable", "Could not reach BigBasket");
  writeFileSync(STATUS_FILE, statusJson);
  console.log(statusJson);
  process.exit(1);
}

const finalUrl = (result as any)?.url || "";

if (config.loginPattern.test(finalUrl)) {
  try {
    await fetch(`${FLOCK_API}/api/internal/browser-sessions/${BROWSER_SESSION}/mark-outdated`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${FLOCK_AUTH_TOKEN}`,
      },
      body: JSON.stringify({
        agentId: FLOCK_AGENT_ID,
        reason: "Keep-alive: BigBasket session expired — redirected to login",
      }),
    });
  } catch { /* ignore */ }

  const statusJson = writeStatus("expired", "Session redirected to login — marked as outdated");
  writeFileSync(STATUS_FILE, statusJson);
  console.log(statusJson);
  process.exit(1);
}

const statusJson = writeStatus("healthy", "Session active — cookies refreshed");
writeFileSync(STATUS_FILE, statusJson);
console.log(statusJson);
