// Shared, PURE "open THIS draft, and prove it is the one on screen" helpers for
// the draft WRITERS (updateDraft, sendDraft). No browser, no side effects, no
// script entrypoint -- safe to import from another skill script (same rule as
// _gmailNav.ts / _draftBody.ts / _draftRows.ts).
//
// WHY THIS EXISTS (task-26a, live 2026-10-02 on 35626)
// ---------------------------------------------------
// A card chat called updateDraft and got "Draft compose area not found" after
// 4.6s, while the Inbox Assistant's draft run was using the same persistent
// Gmail page. updateDraft opened the draft by bare hash (`#drafts/<id>`), slept
// a fixed second in a SEPARATE call, then wrote in a third. A fragment-only goto
// on a reused page does not reload (_gmailNav.ts), so the sleep scraped whatever
// view was on screen, and the split calls left gaps another caller's navigation
// could land in. sendDraft was worse: bare hash, `wait 3000`, then click Send on
// WHATEVER compose was open -- on a busy page that can send a DIFFERENT draft.
//
// THE RULE: land the draft with gmailViewUrl (a real load), poll IN THE PAGE
// until the compose that belongs to `draftId` is open, and run the write/send in
// an expression that re-finds and re-verifies that compose itself, so there is
// no gap between "verified" and "acted" at all.

import { gmailViewUrl, pollInPageScript, parsePollResult } from "./_gmailNav";

/** Same budget as getDraft: a cold Gmail can take ~20s to render a thread. */
export const OPEN_DRAFT_TIMEOUT_MS = 25000;

export const DRAFT_NOT_OPEN_WRITTEN = "The draft did not open; nothing was written.";
export const DRAFT_NOT_OPEN_SENT = "The draft did not open; nothing was sent.";

export type DraftComposeReason = "ok" | "no-compose" | "ambiguous-compose" | "wrong-draft" | "wrong-view";

/**
 * Does a Gmail location hash name `draftId` (a legacy hex id)?
 *
 * Gmail REWRITES the hash once a thread opens (live, 35626, 2026-10-02): a load
 * of `#all/1a0d2e77f7627a81` settled on `#all/%23thread-f%3A1877207712469777025`
 * -- the same id in DECIMAL (BigInt('0x1a0d2e77f7627a81') = 1877207712469777025),
 * prefixed `#thread-f:` and URL-encoded. So a segment of the decoded hash counts
 * when it is the hex id (case-insensitive) or `thread-f:<that decimal>`. Any
 * other thread-f id is another thread. `msg-f:` is NOT accepted: nothing in this
 * repo shows Gmail using it for an opened draft (the row readers strip only
 * `#thread-f:` -- _unreadState.ts, getThreads.ts, searchEmails.ts).
 *
 * The hex-to-decimal conversion lives HERE only. Self-contained: it runs in the
 * page too (inlined via toString).
 */
export function hashNamesDraft(hash: string, draftId: string): boolean {
  let decoded = hash || "";
  try { decoded = decodeURIComponent(decoded); } catch (e) { decoded = hash || ""; }
  const hex = (draftId || "").toLowerCase();
  if (!hex) return false;
  let dec = "";
  try { dec = BigInt("0x" + hex).toString(); } catch (e) { dec = ""; }
  const parts = decoded.replace(/^#/, "").split(/[\/?&=]/);
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i].toLowerCase();
    if (part === hex) return true;
    const m = /^#?thread-f:(\d+)$/.exec(part);
    if (m && dec && m[1] === dec) return true;
  }
  return false;
}

/**
 * Does a Gmail location hash CLEARLY name a DIFFERENT draft/thread than `draftId`?
 * (Controller ruling R33, fix round 4.) This -- not hashNamesDraft -- is the
 * hash check findDraftCompose applies.
 *
 * Live 2026-10-02 23:00 (35626): Gmail rewrote an opened thread's hash not only
 * to `#thread-f:<decimal>` but also to OPAQUE tokens such as
 * `#all/FMfcgzQhWfNddFqzDHvBLrJWrmgZkjfq`, which cannot be mapped back to the
 * hex id. Requiring the hash to NAME draftId refused every update forever. So:
 *   - a segment that is a legacy hex id (10+ hex chars) other than draftId, or
 *     `thread-f:<decimal>` other than draftId's decimal -> true (refuse);
 *   - draftId itself, an opaque token, `msg-f:` forms, no id at all -> false;
 *     the decision then rests on the one-compose and heading/enclosing checks.
 * Self-contained: it runs in the page too (inlined via toString).
 */
export function hashNamesOtherId(hash: string, draftId: string): boolean {
  let decoded = hash || "";
  try { decoded = decodeURIComponent(decoded); } catch (e) { decoded = hash || ""; }
  const hex = (draftId || "").toLowerCase();
  let dec = "";
  try { dec = hex ? BigInt("0x" + hex).toString() : ""; } catch (e) { dec = ""; }
  const parts = decoded.replace(/^#/, "").split(/[\/?&=]/);
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i].toLowerCase();
    const m = /^#?thread-f:(\d+)$/.exec(part);
    if (m) { if (m[1] !== dec) return true; continue; }
    if (/^[0-9a-f]{10,}$/.test(part) && part !== hex) return true;
  }
  return false;
}

/**
 * The compose editor that belongs to `draftId`, or null with the reason.
 *
 * (a) Exactly ONE compose editor may be open (the same three selectors every
 *     writer uses -- COMPOSE_OPEN_EXPR / COMPOSE_BODY_SCRAPE). None: the draft
 *     did not open ("no-compose"). Two or more (a restored popup beside the
 *     inline reply): we cannot tell which is ours, and guessing is how the wrong
 *     draft gets sent ("ambiguous-compose").
 * (b) The draft's thread names `draftId`. For a reply draft the draft's legacy id
 *     IS its thread's legacy id (_draftRows.ts). Gmail's thread view carries it
 *     on the subject heading, `h2.hP[data-legacy-thread-id]`, which does NOT
 *     enclose the reply editor; getDraft reads the same attribute page-wide.
 *     The heading is preferred because a page-wide first match can be a row of
 *     the hidden list view Gmail keeps in the DOM. An ancestor of the editor
 *     that itself carries `data-legacy-thread-id` = draftId is accepted in place
 *     of the heading. A heading or ancestor naming a DIFFERENT id refuses
 *     ("wrong-draft"), whatever else matches.
 * (c) The location hash must not CLEARLY name a different id (hashNamesOtherId,
 *     R33). The caller has just loaded a fresh gmailViewUrl(`#drafts/<draftId>`);
 *     a hash naming another hex / thread-f id means another navigation landed
 *     ("wrong-view"). Gmail's opaque rewrites (`#all/FMfcgz…`) and id-less hashes
 *     pass this check and rest on (a) and (b).
 * Ids compare case-insensitively. The result also carries what was SEEN
 * (composes, heading-or-enclosing id, hash) for draftNotOpenMessage.
 *
 * Runs IN THE PAGE (inlined via Function.prototype.toString, like _replyAll.ts),
 * so it must stay self-contained: no imports, no outer variables. The hash rule
 * is a parameter for that reason -- the in-page wrappers pass hashNamesDraft's
 * source explicitly; the default serves direct (test) calls. One rule, both ways.
 */
export function findDraftCompose(
  doc: Document,
  draftId: string,
  hashNamesOther: (hash: string, draftId: string) => boolean = hashNamesOtherId,
): { compose: Element | null; reason: DraftComposeReason; threadId: string; composes: number; heading: string; hash: string } {
  const selector = 'div[aria-label="Message Body"][contenteditable="true"], .Am.Al.editable, [role="textbox"][aria-label*="Message"]';
  const want = (draftId || "").toLowerCase();
  const composes = Array.from(doc.querySelectorAll(selector));
  const headingEl = doc.querySelector("h2.hP[data-legacy-thread-id]") || doc.querySelector("[data-legacy-thread-id]");
  const heading = ((headingEl && headingEl.getAttribute("data-legacy-thread-id")) || "").toLowerCase();
  const hash = (doc.defaultView && doc.defaultView.location && doc.defaultView.location.hash) || "";
  const seen = { composes: composes.length, heading: heading, hash: hash };
  if (composes.length === 0) return { compose: null, reason: "no-compose", threadId: heading, ...seen };
  if (composes.length > 1) return { compose: null, reason: "ambiguous-compose", threadId: heading, ...seen };
  const compose = composes[0];
  const ancestorEl = compose.parentElement ? compose.parentElement.closest("[data-legacy-thread-id]") : null;
  const ancestor = ((ancestorEl && ancestorEl.getAttribute("data-legacy-thread-id")) || "").toLowerCase();
  if (!heading && ancestor) seen.heading = ancestor;
  if (heading && heading !== want) return { compose: null, reason: "wrong-draft", threadId: heading, ...seen };
  if (ancestor && ancestor !== want) return { compose: null, reason: "wrong-draft", threadId: ancestor, ...seen };
  if (heading !== want && ancestor !== want) return { compose: null, reason: "wrong-draft", threadId: heading || ancestor, ...seen };
  if (hashNamesOther(hash, draftId)) return { compose: null, reason: "wrong-view", threadId: draftId, ...seen };
  return { compose, reason: "ok", threadId: draftId, ...seen };
}

/** In-page expression: `{ ok, reason, threadId }` for `draftId`. */
export function draftComposeCheckExpr(draftId: string): string {
  return `(function(){
    var r = (${findDraftCompose.toString()})(document, ${JSON.stringify(draftId)}, ${hashNamesOtherId.toString()});
    return { ok: r.reason === 'ok', reason: r.reason, threadId: r.threadId, composes: r.composes, heading: r.heading, hash: r.hash };
  })()`;
}

/**
 * In-page expression that re-finds and re-verifies `draftId`'s compose and only
 * then runs `actionBody` -- a function body with `compose` in scope that returns
 * an object. Verify and act are one synchronous expression, so nothing can
 * navigate between them. Returns `{ opened: true, ...actionResult }`, or
 * `{ opened: false, ok: false, reason, threadId, composes, heading, hash }`
 * having done nothing -- the observation draftNotOpenMessage reports.
 */
export function onDraftComposeExpr(draftId: string, actionBody: string): string {
  return `(function(){
    var r = (${findDraftCompose.toString()})(document, ${JSON.stringify(draftId)}, ${hashNamesOtherId.toString()});
    if (r.reason !== 'ok' || !r.compose) return { opened: false, ok: false, reason: r.reason, threadId: r.threadId, composes: r.composes, heading: r.heading, hash: r.hash };
    var out = (function(compose){ ${actionBody} })(r.compose) || {};
    out.opened = true;
    return out;
  })()`;
}

/**
 * The persistentCreate request that opens `draftId` and runs `actionBody` on its
 * compose once it is verified: a gmailViewUrl load plus ONE in-page poll, the
 * getDraft way. The poll waits for the verified compose; its result expression
 * re-verifies before acting, so it acts only on a verified compose -- even when
 * that happens just after the poll's deadline (see parseOpenedDraft).
 */
export function openDraftRequest(
  draftId: string,
  actionBody: string,
  nonce: string | number = Date.now(),
  timeoutMs: number = OPEN_DRAFT_TIMEOUT_MS,
  stashKey?: string,
): { url: string; actions: Array<{ action: string; script?: string; delay?: number }> } {
  // stashKey (task 28): also keep the action's result on `window[stashKey]`, so a
  // LATER evaluate in the same request (sendDraft's confirmation poll) can read
  // what this one did. The result expression is otherwise unchanged.
  const act = onDraftComposeExpr(draftId, actionBody);
  const resultExpr = stashKey ? `(window[${JSON.stringify(stashKey)}] = ${act})` : act;
  return {
    url: gmailViewUrl(`#drafts/${draftId}`, nonce),
    actions: [
      { action: "evaluate", script: pollInPageScript(`${draftComposeCheckExpr(draftId)}.ok`, resultExpr, timeoutMs) },
    ],
  };
}

/**
 * Read an openDraftRequest reply. `opened` is the ACTION's own verdict, not the
 * poll's `ready`. pollInPageScript evaluates its result expression even after a
 * timeout, and the action re-verifies the compose itself before it acts -- so a
 * compose that verified in the last <=250ms after the final ready() check gets
 * acted on (Send clicked) under ready:false. Requiring `ready` here reported such
 * a send as "nothing was sent" while the mail went out (task-26a review, fix
 * round 3). The page decides; this only reports what the page did. Never throws.
 */
export function parseOpenedDraft<T = Record<string, unknown>>(
  content: unknown,
): { opened: boolean; result: (T & { opened?: boolean; ok?: boolean; reason?: string; threadId?: string; message?: string; composes?: number; heading?: string; hash?: string }) | null } {
  const { result } = parsePollResult<any>(content);
  return { opened: !!result && result.opened === true, result };
}

/**
 * The caller-facing "did not open" error, naming what the page showed (R33,
 * fix round 4). Live, every updateDraft on one reply draft failed after the full
 * 25s poll with no hint why. `observed` is the action's last result: the poll's
 * result expression runs even after its deadline, so a timed-out poll still
 * carries its LAST observation. No result at all -> reason=unknown.
 *   `<base> (reason=…, composes=…, heading=…, hash=…)`
 * The hash is decoded and cut to 120 chars.
 */
export function draftNotOpenMessage(base: string, observed: unknown): string {
  const o: any = observed && typeof observed === "object" ? observed : null;
  if (!o || typeof o.reason !== "string" || !o.reason || o.reason === "ok") {
    return `${base} (reason=unknown, composes=?, heading=none, hash=none; the page returned no observation)`;
  }
  let hash = typeof o.hash === "string" ? o.hash : "";
  try { hash = decodeURIComponent(hash); } catch { /* keep raw */ }
  hash = hash.slice(0, 120);
  const composes = typeof o.composes === "number" ? String(o.composes) : "?";
  const heading = typeof o.heading === "string" && o.heading ? o.heading : "none";
  return `${base} (reason=${o.reason}, composes=${composes}, heading=${heading}, hash=${hash || "none"})`;
}
