#!/usr/bin/env bun
/**
 * Amazon.in — search, read every product page, and answer one ProductCards block.
 *
 * Params: query (what to search) or asins (product ids to read, up to 10); max? (results to show,
 * default 5, at most 10); size? (the owner's size, pre-picked on the cards); title? (the block's title).
 *
 * One persistent session: the search page, then the product pages through readPages (5 tabs at a
 * time), each read in the page itself by readProductPage (no clicks). The answer:
 *   { block, shown, skipped, health, note? } — `block` is the ```flock-ui fence to send as it is;
 *   `health` is what each product's read found and missed; `skipped` the products left off, and why.
 * A read that finds no product at all is an error (PAGE_CHANGED): Amazon's pages have changed
 * beyond the reader's fallbacks, and the skill's manual steps are the way on.
 */
import { FLOCK_API, emitResult } from "../../_shared/_helpers";
import { errorJson } from "../../_shared/_grocery_helpers";
import { readProductPageSource, readSearchPageSource } from "./_product-read";
import { toItem, toBlock, healthOf, type PageRead, type Health } from "./_cards";

const PARAMS = JSON.parse(process.env.SKILL_PARAMS || "{}");
const query: string = String(PARAMS.query ?? "").trim();
const asinsIn: string[] = Array.isArray(PARAMS.asins) ? PARAMS.asins.map((a: unknown) => String(a).trim().toUpperCase()) : [];
const max = Math.min(10, Math.max(1, parseInt(PARAMS.max, 10) || 5));
const size: string | undefined = PARAMS.size ? String(PARAMS.size) : undefined;
const title: string | undefined = PARAMS.title ? String(PARAMS.title).slice(0, 80) : undefined;

const sessionName = process.env.BROWSER_SESSION || "";
const agentId = process.env.FLOCK_AGENT_ID || "";
/** A refusal to report: thrown inside the run so the session closes before the script exits. */
class Fail extends Error { constructor(public code: string, msg: string) { super(msg); } }
const fail = (code: string, msg: string): never => { throw new Fail(code, msg); };

if (!sessionName) errorJson("NO_AUTH", "No Amazon.in browser session. Connect Amazon.in via the dashboard browser session.");
if (!agentId) errorJson("MISSING_AGENT", "FLOCK_AGENT_ID is not set; run this through amazon-exec.sh");
if (!query && asinsIn.length === 0) errorJson("MISSING_PARAM", "Give a query (what to search) or asins (the products to read).");
if (asinsIn.some((a) => !/^[A-Z0-9]{10}$/.test(a))) errorJson("BAD_PARAM", "Each of asins is a 10-character Amazon product id, such as B0C2YCBW9Y.");

async function browserFetch(body: Record<string, unknown>): Promise<any> {
  const resp = await fetch(`${FLOCK_API}/api/internal/browser-fetch`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${process.env.FLOCK_AUTH_TOKEN || ""}` },
    body: JSON.stringify({ sessionName, agentId, ...body }),
  });
  const text = await resp.text();
  let parsed: any;
  try { parsed = JSON.parse(text); } catch { parsed = { content: text }; }
  if (resp.status === 429) fail("RATE_LIMITED", "Amazon is limiting requests. Try again in a few minutes.");
  if (resp.status >= 400) {
    const code = [String(parsed?.error ?? ""), String(parsed?.code ?? ""), String(parsed?.error_code ?? "")];
    if (code.includes("prep_stop")) fail("PREP_STOP", String(parsed?.error ?? "Flock stopped this read while the card is prepared."));
    if (code.includes("session_not_ready")) fail("SESSION_NOT_READY", "The Amazon.in browser session is not ready. Log in via the dashboard.");
    fail("CRAWL_ERROR", `Flock's browser could not read Amazon.in (status ${resp.status}): ${parsed?.message ?? parsed?.error ?? "no message"}`);
  }
  return parsed;
}

const json = (s: unknown): any => { try { return typeof s === "string" ? JSON.parse(s) : s; } catch { return null; } };
const signedOut = (url: unknown) => /amazon\.in\/ap\/(signin|register)/.test(String(url ?? "").split(/[?#]/)[0]);

let persistentSessionId = "";

async function run(): Promise<Record<string, unknown>> {
  // 1. The search (or the first product, when asins are given): opens the session.
  const firstUrl = query ? `https://www.amazon.in/s?k=${encodeURIComponent(query)}` : `https://www.amazon.in/dp/${asinsIn[0]}`;
  const opened = await browserFetch({
    url: firstUrl, createPersistentSession: true,
    pageActions: [{ action: "evaluate", script: query ? readSearchPageSource : "JSON.stringify({ok:true})" }],
  });
  persistentSessionId = opened?.persistentSessionId || "";
  if (!persistentSessionId) fail("CRAWL_ERROR", "Flock's browser opened no session for Amazon.in.");
  if (signedOut(opened?.url)) fail("SESSION_OUTDATED", "Amazon.in asked to sign in again. The owner signs in via the dashboard browser session.");

  let asins = asinsIn.slice(0, 10);
  let searched: { asin: string; title: string }[] = [];
  if (query) {
    const s = json(opened?.content);
    if (s?.captcha) fail("CAPTCHA_DETECTED", "Amazon.in is showing a CAPTCHA. Solve it in the dashboard browser session, then try again.");
    searched = Array.isArray(s?.results) ? s.results : [];
    if (searched.length === 0) {
      return { block: null, shown: 0, skipped: [], health: [], note: `Amazon.in found nothing for "${query}", or its results page has changed.` };
    }
    // A spare or two beyond `max`: a product page that fails its read leaves room for the next one.
    asins = searched.slice(0, Math.min(10, max + 2)).map((r) => r.asin);
  }

  // 2. Every product page, 5 tabs at a time, each read in the page.
  const reads = new Map<string, PageRead>();
  const failed: { asin: string; reason: string }[] = [];
  for (let i = 0; i < asins.length; i += 5) {
    const batch = asins.slice(i, i + 5);
    const r = await browserFetch({
      persistentSessionId,
      readPages: batch.map((a) => ({ url: `https://www.amazon.in/dp/${a}`, pageActions: [{ action: "evaluate", script: readProductPageSource }] })),
    });
    const pages = json(r?.content);
    if (!Array.isArray(pages)) { for (const a of batch) failed.push({ asin: a, reason: "no answer from the page" }); continue; }
    batch.forEach((a, k) => {
      const p = pages[k] ?? {};
      if (p.error) { failed.push({ asin: a, reason: String(p.error).slice(0, 120) }); return; }
      const read = json(Array.isArray(p.reads) ? p.reads[0] : p.content) as PageRead | null;
      if (!read) { failed.push({ asin: a, reason: "the page answered nothing" }); return; }
      if (read.captcha) { failed.push({ asin: a, reason: "CAPTCHA" }); return; }
      reads.set(a, read);
    });
  }

  // 3. The cards.
  const items: any[] = [];
  const skipped = [...failed];
  const health: Health[] = [];
  for (const a of asins) {
    const r = reads.get(a);
    if (!r) continue;
    health.push(healthOf(a, r));
    if (items.length >= max) continue;
    const { item, reason } = toItem(r, a);
    if (item) items.push(item); else skipped.push({ asin: a, reason: reason ?? "unreadable" });
  }
  if (skipped.some((s) => s.reason === "CAPTCHA") && items.length === 0) {
    fail("CAPTCHA_DETECTED", "Amazon.in is showing a CAPTCHA. Solve it in the dashboard browser session, then try again.");
  }
  if (items.length === 0) {
    fail("PAGE_CHANGED", `No product page gave a title and a price (${skipped.map((s) => `${s.asin}: ${s.reason}`).join("; ") || "nothing read"}). Amazon.in's pages may have changed: read them with the skill's manual steps instead.`);
  }
  const thin = health.filter((h) => ["price", "photos"].some((f) => h.missing.includes(f)));
  return {
    block: toBlock(items, { title, size }),
    shown: items.length,
    skipped,
    health,
    ...(thin.length ? { note: `Some reads came back thin (${thin.map((h) => `${h.asin} missing ${h.missing.join(", ")}`).join("; ")}): Amazon.in's page may have changed.` } : {}),
  };
}

let result: Record<string, unknown> | null = null;
let failure: Fail | null = null;
try {
  result = await run();
} catch (e: any) {
  failure = e instanceof Fail ? e : new Fail("SCRIPT_ERROR", String(e?.message ?? e));
} finally {
  if (persistentSessionId) {
    await fetch(`${FLOCK_API}/api/internal/browser-fetch`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${process.env.FLOCK_AUTH_TOKEN || ""}` },
      body: JSON.stringify({ sessionName, agentId, persistentSessionId, closePersistentSession: true }),
    }).catch(() => {});
  }
}
if (failure) errorJson(failure.code, failure.message);
emitResult(result);
