// Platform client — the app's outbound edge to the Flock platform APIs (§6, §7 of the
// dashboard-tasks-widgets spec). Draft Desk is a task-native app: when a draft is created it
// publishes a `reply-approval` Task the user approves from the dashboard; when a draft is sent or
// discarded it withdraws that Task; and it drives its paired agent through the standard, signed
// intent channel instead of the old hand-placed webhook file.
//
// EVERYTHING here fails soft. The workbench (the /api/drafts surface + SPA) must keep working
// standalone even if the platform edge is unavailable (unconfigured app, missing token, platform
// down). A failed platform call NEVER throws into a route — it logs and returns a typed result.
//
// --- How the app authenticates to the platform (capability-by-reference, §10) ---
// The platform provisions the app at install time (server/src/app-provisioning.ts): it issues a
// scoped app token (stored in the Vault) and drops an agent-webhook reference file into the app's
// data dir. The RAW app token and the RAW webhook signing secret are injected into this process's
// environment by the platform (the same shape skills get FLOCK_API_URL + FLOCK_AUTH_TOKEN). We
// read them from the environment; if they are absent we degrade to standalone mode.
//
//   FLOCK_API_URL        base URL of the platform (loopback), e.g. http://127.0.0.1:35625
//   FLOCK_APP_TOKEN      this app's scoped bearer token (raw)
//   FLOCK_WEBHOOK_SECRET raw HMAC secret for signing agent intents (§6.6, §10 T5)
//   APP_ID               the app's registered id (used to build /api/apps/<id>/... paths)
//   APP_DATA_DIR         durable data home; holds agent-webhook.json (the provisioned reference)
//
// The webhook reference file (APP_DATA_DIR/agent-webhook.json) is written by provisioning and may
// carry a raw `signingSecret` (direct model) OR only a vault `secretRef` (reference model, where
// the platform resolves + verifies the signature server-side and the raw secret is injected via
// FLOCK_WEBHOOK_SECRET). We support both: a raw secret from the file or the env lets us sign
// locally; if only a reference is available and no env secret is present, the intent channel is
// unavailable and we fail soft.

import { readFileSync } from "fs";
import { createHmac } from "crypto";
import type { ActionSpec } from "../../shared/tasks";

const APP_ID = process.env.APP_ID ?? "draft-desk";
const WEBHOOK_REF_FILE = "agent-webhook.json";

function platformBase(): string | null {
  const base = process.env.FLOCK_API_URL;
  if (base && base.length > 0) return base.replace(/\/+$/, "");
  // Loopback fallback (matches the platform's default port). Only used when the platform did not
  // inject FLOCK_API_URL — still points at the local platform, never at a remote host.
  const port = process.env.FLOCK_PLATFORM_PORT;
  return port ? `http://127.0.0.1:${port}` : null;
}

function appToken(): string | null {
  const t = process.env.FLOCK_APP_TOKEN;
  return t && t.length > 0 ? t : null;
}

// Resolve the raw webhook signing secret for intent signing. Priority: the injected env secret,
// then a raw `signingSecret` in the provisioned reference file. A file that carries only a vault
// `secretRef` yields null here — the app cannot read the Vault, so signing must come from the env.
function webhookSecret(): string | null {
  const envSecret = process.env.FLOCK_WEBHOOK_SECRET;
  if (envSecret && envSecret.length > 0) return envSecret;

  const dataDir = process.env.APP_DATA_DIR;
  if (!dataDir) return null;
  try {
    const cfg = JSON.parse(readFileSync(`${dataDir}/${WEBHOOK_REF_FILE}`, "utf8")) as {
      signingSecret?: unknown;
    };
    if (typeof cfg.signingSecret === "string" && cfg.signingSecret.length > 0) {
      return cfg.signingSecret;
    }
  } catch {
    // Missing/reference-only file — fall through to null (intent channel unavailable, soft-fail).
  }
  return null;
}

// Is the platform edge usable at all? (base URL + app token present.) When false, every call
// below no-ops with a typed "skipped" result and the workbench runs standalone.
export function platformConfigured(): boolean {
  return platformBase() !== null && appToken() !== null;
}

const REQUEST_TIMEOUT_MS = 4000;

export type PlatformResult<T = unknown> =
  | { ok: true; skipped?: false; data: T }
  | { ok: false; skipped: true; reason: "not_configured" }
  | { ok: false; skipped?: false; status?: number; reason: string };

// Core authed request to a platform app-facing endpoint. Never throws; a network error, timeout,
// or non-2xx returns a typed failure the caller can log/ignore. The app's own token is the bearer
// (loopback-only capability, §10 T1).
async function platformFetch<T = unknown>(
  path: string,
  init: { method: string; body?: unknown; extraHeaders?: Record<string, string> },
): Promise<PlatformResult<T>> {
  const base = platformBase();
  const token = appToken();
  if (!base || !token) return { ok: false, skipped: true, reason: "not_configured" };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`${base}${path}`, {
      method: init.method,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        ...(init.extraHeaders ?? {}),
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: controller.signal,
    });
    if (!res.ok) {
      return { ok: false, status: res.status, reason: `platform ${res.status}` };
    }
    const data = (await res.json().catch(() => ({}))) as T;
    return { ok: true, data };
  } catch (err: any) {
    return { ok: false, reason: err?.name === "AbortError" ? "timeout" : "unreachable" };
  } finally {
    clearTimeout(timer);
  }
}

// --- Tasks (§7.2) ---

export interface PublishTaskInput {
  sourceRef: string;
  type: string; // "reply-approval"
  title: string;
  priority?: "low" | "normal" | "high";
  deeplink: string;
  context: Record<string, unknown>;
  actions: ActionSpec[];
}

// Publish/update the approval Task for a draft. Upserts on (source_app, sourceRef) server-side.
export function publishTask(input: PublishTaskInput): Promise<PlatformResult> {
  return platformFetch(`/api/apps/${APP_ID}/tasks`, { method: "POST", body: input });
}

// Withdraw the approval Task for a draft (on sent/discard). Idempotent — a 404 (already gone) is
// a benign outcome the caller ignores.
export function withdrawTask(sourceRef: string): Promise<PlatformResult> {
  return platformFetch(`/api/apps/${APP_ID}/tasks/${encodeURIComponent(sourceRef)}`, {
    method: "DELETE",
  });
}

// --- Widgets (§7.4) ---

// Signal the platform that the approvals queue changed so it busts its widget cache + emits a
// widget.invalidated event to the dashboard.
export function invalidateApprovalsWidget(): Promise<PlatformResult> {
  return platformFetch(`/api/apps/${APP_ID}/widgets/approvals/invalidate`, { method: "POST" });
}

// --- Agent intent channel (§6.6 point 2) ---

export type IntentResult =
  | { ok: true; sessionId?: string }
  | { ok: false; skipped: true; reason: "not_configured" | "no_signing_secret" }
  | { ok: false; reason: string };

// Send a typed, HMAC-signed intent to the paired agent. The signature covers the EXACT raw body,
// so we serialize once and sign that. `payload.taskId`, when present, lets the platform reuse the
// task's session. Fails soft: an unconfigured app or a reference-only webhook (no local secret)
// returns a skipped result and the workbench proceeds.
export async function sendIntent(
  intent: string,
  payload: Record<string, unknown>,
): Promise<IntentResult> {
  const base = platformBase();
  const token = appToken();
  if (!base || !token) return { ok: false, skipped: true, reason: "not_configured" };

  const secret = webhookSecret();
  if (!secret) return { ok: false, skipped: true, reason: "no_signing_secret" };

  const rawBody = JSON.stringify({ intent, payload });
  const signature = "sha256=" + createHmac("sha256", secret).update(rawBody).digest("hex");
  const timestamp = String(Date.now());

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`${base}/api/apps/${APP_ID}/agent/intent`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        "x-intent-signature": signature,
        "x-intent-timestamp": timestamp,
      },
      body: rawBody,
      signal: controller.signal,
    });
    if (!res.ok) return { ok: false, reason: `platform ${res.status}` };
    const data = (await res.json().catch(() => ({}))) as { sessionId?: string };
    return { ok: true, sessionId: data.sessionId };
  } catch (err: any) {
    return { ok: false, reason: err?.name === "AbortError" ? "timeout" : "unreachable" };
  } finally {
    clearTimeout(timer);
  }
}

export { APP_ID };
