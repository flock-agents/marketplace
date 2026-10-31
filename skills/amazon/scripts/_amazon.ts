/**
 * Amazon.in — what read-products and read-variants share: Flock's browser (one persistent session, product
 * pages read 5 tabs at a time through readPages), and a run that always closes its session before it
 * answers, refusals included.
 */
import { FLOCK_API, emitResult } from "../../_shared/_helpers";
import { errorJson } from "../../_shared/_grocery_helpers";
import { readProductPageSource } from "./_product-read";
import type { PageRead } from "./_cards";

export const PARAMS = JSON.parse(process.env.SKILL_PARAMS || "{}");
const sessionName = process.env.BROWSER_SESSION || "";
export const agentId = process.env.FLOCK_AGENT_ID || "";

/** A refusal to report: thrown inside the run, so the session closes before the script exits. */
export class Fail extends Error { constructor(public code: string, msg: string) { super(msg); } }
export const fail = (code: string, msg: string): never => { throw new Fail(code, msg); };

export const isAsin = (a: unknown) => typeof a === "string" && /^[A-Z0-9]{10}$/.test(a);
export const dp = (asin: string) => `https://www.amazon.in/dp/${asin}`;
export const json = (s: unknown): any => { try { return typeof s === "string" ? JSON.parse(s) : s; } catch { return null; } };
const signedOut = (url: unknown) => /amazon\.in\/ap\/(signin|register)/.test(String(url ?? "").split(/[?#]/)[0]);

async function browserFetch(body: Record<string, unknown>): Promise<any> {
  const resp = await fetch(`${FLOCK_API}/api/internal/browser-fetch`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${process.env.FLOCK_AUTH_TOKEN || ""}` },
    body: JSON.stringify({ sessionName, agentId, ...body }),
  });
  const text = await resp.text();
  const parsed = json(text) ?? { content: text };
  if (resp.status === 429) fail("RATE_LIMITED", "Amazon is limiting requests. Try again in a few minutes.");
  if (resp.status >= 400) {
    const code = [String(parsed?.error ?? ""), String(parsed?.code ?? ""), String(parsed?.error_code ?? "")];
    if (code.includes("prep_stop")) fail("PREP_STOP", String(parsed?.error ?? "Flock stopped this read while the card is prepared."));
    if (code.includes("session_not_ready")) fail("SESSION_NOT_READY", "The Amazon.in browser session is not ready. Log in via the dashboard.");
    fail("CRAWL_ERROR", `Flock's browser could not read Amazon.in (status ${resp.status}): ${parsed?.message ?? parsed?.error ?? "no message"}`);
  }
  return parsed;
}

export interface Session { id: string; content: any }

/** Opens the session on `url`, running `script` there; its answer is `content`. */
export async function open(url: string, script: string): Promise<Session> {
  const r = await browserFetch({ url, createPersistentSession: true, pageActions: [{ action: "evaluate", script }] });
  const id = r?.persistentSessionId || "";
  if (!id) fail("CRAWL_ERROR", "Flock's browser opened no session for Amazon.in.");
  opened = id;
  if (signedOut(r?.url)) fail("SESSION_OUTDATED", "Amazon.in asked to sign in again. The owner signs in via the dashboard browser session.");
  return { id, content: json(r?.content) };
}

/** Each ASIN's product page, read in the page (readProductPage), 5 tabs at a time. */
export async function readProducts(session: Session, asins: string[], failed: { asin: string; reason: string }[]): Promise<Map<string, PageRead>> {
  const reads = new Map<string, PageRead>();
  for (let i = 0; i < asins.length; i += 5) {
    const batch = asins.slice(i, i + 5);
    const r = await browserFetch({
      persistentSessionId: session.id,
      readPages: batch.map((a) => ({ url: dp(a), pageActions: [{ action: "evaluate", script: readProductPageSource }] })),
    });
    const pages = json(r?.content);
    if (!Array.isArray(pages)) { for (const a of batch) failed.push({ asin: a, reason: "no answer from the page" }); continue; }
    batch.forEach((a, k) => {
      const p = pages[k] ?? {};
      if (p.error) { failed.push({ asin: a, reason: String(p.error).slice(0, 120) }); return; }
      const read = json(Array.isArray(p.reads) ? p.reads[0] : p.content) as PageRead | null;
      if (!read) { failed.push({ asin: a, reason: "the page answered nothing" }); return; }
      if (read.captcha) { failed.push({ asin: a, reason: "CAPTCHA" }); return; }
      if (!read.asin) read.asin = a;
      reads.set(a, read);
    });
  }
  return reads;
}

let opened = "";

/** Runs `body`, closes the session it opened, then answers its result or its refusal. */
export async function main(body: () => Promise<Record<string, unknown>>): Promise<never> {
  if (!sessionName) errorJson("NO_AUTH", "No Amazon.in browser session. Connect Amazon.in via the dashboard browser session.");
  if (!agentId) errorJson("MISSING_AGENT", "FLOCK_AGENT_ID is not set; run this through _shared/skill-exec.sh");
  let result: Record<string, unknown> | null = null;
  let failure: Fail | null = null;
  try {
    result = await body();
  } catch (e: any) {
    failure = e instanceof Fail ? e : new Fail("SCRIPT_ERROR", String(e?.message ?? e));
  } finally {
    if (opened) {
      await fetch(`${FLOCK_API}/api/internal/browser-fetch`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${process.env.FLOCK_AUTH_TOKEN || ""}` },
        body: JSON.stringify({ sessionName, agentId, persistentSessionId: opened, closePersistentSession: true }),
      }).catch(() => {});
    }
  }
  if (failure) errorJson(failure.code, failure.message);
  emitResult(result);
  process.exit(0);
}
