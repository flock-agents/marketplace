// Significance predicate (P5) — the SKILL decides which new events are worth waking
// the agent for. The platform batches all new journal events into one call and obeys
// the returned selection. This is Gmail domain knowledge (what "noise" means), kept
// in the skill, not the platform.
//
// Pure: reads only the events + the routine's config it is handed; no browser session,
// no network, no DB. (The gmail skill declares a browser_session requirement, so the
// executor resolves one before running any gmail function, but this predicate ignores
// it.) Engagement is NOT looked up here — event-llm-dispatcher.ts's filterSignificant
// is the one component that knows the routine's bound account; it resolves the
// batch's distinct sender domains through engaged-domains.ts's read-through cache
// (`in:sent to:@domain` on a miss) and hands the answer in as `engagedDomains` +
// `resolvedDomains` before calling this. The spec's "deterministic, LLM-free, lives
// in shouldTrigger" is about the DECISION, not the data fetch: keeping the fetch out
// is what makes this gate unit-testable with no DB/network in the loop.
//
// Task-8 brief (spec §4.3) — evaluation order is NOT negotiable:
//
//   self-send                → drop
//   no-reply address         → drop        (nothing can be replied to)
//   calendar auto-response   → drop        (Accepted:/Declined:/Invitation: …)
//   engaged domain
//     └─ over velocity cap   → drop        (§4.5 — the allowlist's rate guard)
//     └─ otherwise           → KEEP        (denylist below does NOT apply)
//   role-name / subdomain / automated-domain / local-echoes-domain → drop
//   not engaged              → drop
//
// Engagement outranks the denylist below it. Measured live: the one false positive
// the combined gate produced was `supportmail@techsupport.microsoft.com` — dropped by
// the `support*` role rule even though the owner had emailed that desk four times on
// their own ticket. The ONLY rules permitted ABOVE the engagement check are self-send
// and a literal no-reply address; the ONLY rule permitted BELOW it is velocity.
//
// Keep Stych's restraint: `founder`, `product`, `crew` and similar are deliberately
// NOT role names — real humans at small startups use them. Do not "improve" this list.
//
// FAIL OPEN, always:
//   - a malformed/unparseable sender is never gated on (nothing to classify);
//   - a sender whose domain the platform could NOT classify this batch (its
//     `in:sent to:@domain` lookup failed, or was skipped past the per-pass cap) is
//     never dropped as "not engaged" — self-send/no-reply and the denylist still
//     apply, but a lookup that never ran may not suppress mail;
//   - a bad velocityCap (non-numeric, <= 0) is treated as "off";
//   - any throw in the script wrapper wakes for every input event.
// A predicate must never silently DROP mail; over-waking is recoverable, a missed
// reply is not.
//
// Input  (SKILL_PARAMS): { events: [{ eventId, actor: {name,email}, preview, kind }], config }
// Output (stdout JSON):  [{ eventId, wake: boolean, reason: string }]

export interface TriggerEvent {
  eventId: string;
  actor?: { name?: string; email?: string };
  preview?: string;
  kind?: string;
}

export interface TriggerConfig {
  // Legacy/still-supported opt-in for the §4.4 regex denylist below (role names,
  // marketing subdomains, always-automated domains, local-echoes-domain). Independent
  // of the engagement data — this is the pre-existing "ignore automated senders"
  // toggle, unrelated to whether an engaged-domain set is present at all.
  ignoreAutomated?: boolean;
  // The account owner's own address(es) — self-sends are always dropped, regardless
  // of ignoreAutomated.
  ownerAddresses?: string[];
  // The domains in THIS batch that are confirmed engaged. Resolved per batch by
  // event-llm-dispatcher.ts via engaged-domains.ts's read-through lookup -- NOT
  // the account's whole history, only the senders present here.
  engagedDomains?: string[];
  // The domains in this batch the platform actually managed to CLASSIFY -- the
  // engaged ones plus the confirmed not-engaged ones. A sender's domain missing
  // from this list was never successfully checked, and must fail open rather than
  // fall through to "not engaged". When the key is absent or empty, NOTHING is
  // resolved and the engagement layer does not gate at all: that is the correct
  // default for an old routine, a dispatcher that failed to resolve, or any
  // caller that does not know about this contract.
  resolvedDomains?: string[];
  // §4.5 — the allowlist's rate guard, keyed on the full sender address (never the
  // domain), so a flooding noreply@vendor.com can't suppress alice@vendor.com. This
  // predicate is stateless and events carry no timestamp, so "velocity" here means
  // "this address's share of the current batch" — the only signal a pure, DB-free
  // function has available. Defaults to 0 (off), as Stych ships it.
  velocityCap?: number;
}

export interface TriggerDecision {
  eventId: string;
  wake: boolean;
  reason: string;
}

// No-reply local parts. Nothing can be replied to here — this drops regardless
// of engagement, ownerAddresses, or ignoreAutomated. One of the rules permitted
// above the engagement check (with self-send and the calendar auto-responses).
//
// A SEGMENT match, not the whole local part (2026-09-10, live): the exact rule
// missed `workspace-noreply@google.com`, and it would miss `noreply-dmarc` and
// `donotreply` too. The word must stand alone between separators or at either
// end, so a person named "annoreplyson" is untouched.
const NO_REPLY_RE = /(^|[._-])(no[-_.]?reply|do[-_.]?not[-_.]?reply)([._-]|$)/i;

// Google Calendar's automatic responses (2026-09-10, live: "Accepted: 30 min
// meeting between …" from a real person's address reached the model). The
// subject is machine-written with a fixed prefix; the sender is a human, often
// engaged, and there is nothing to reply to. Matched on the preview, which is
// "subject — snippet", anchored at the very start with the colon so a human
// subject that merely begins with the word ("Accepted the offer, when …") stays.
const CALENDAR_RESPONSE_RE = /^(accepted|declined|tentatively accepted|tentative|invitation|updated invitation|cancell?ed event):/i;

// §4.4 role local-parts — exact match on the local part. Deliberately does NOT
// include founder/product/crew/etc: real humans at small startups use those.
//
// subscriptions/receipts/statements added 2026-09-09, after a live run let
// `subscriptions@razorpay.com` ("Subscription Charged Successfully") through to
// the draft gate. Nothing above engagement caught it and the engagement lookup
// had just died with the browser session, so the fail-open left no rule to drop
// it. These three are transactional billing words no human uses as a personal
// address, so they belong here rather than relying on engagement alone —
// engagement remains the primary rule, this is the floor under it when the
// lookup is unavailable. The restraint above still stands: do not add words a
// real person might send from.
const ROLE_LOCAL_RE =
  /^(no-reply|noreply|notifications?|communications?|welcome|marketing|mailers?|newsletter|alerts?|digest|updates?|invoice\w*|billing|subscriptions?|receipts?|statements?|payments?-noreply)$/i;

// §4.4 — these words are role-shaped only when paired with a common SaaS TLD:
// "support@bigco.io" reads as automated, "support@ourfamily.name" does not.
const ROLE_TLD_RE = /^(hello|hey|team|support|info|news|notify|onboarding)@[^@]+\.(app|io|com|dev|so|ai|co|net|tech|xyz)$/i;

// §4.4 marketing/notification subdomain prefixes, matched against the domain.
const MARKETING_SUBDOMAIN_RE =
  /^(marketing|mailers?|email|mail|news|newsletter|notify|notifications|noreply|no-reply|updates|campaigns?|promotions?|promo|em1)\./i;
const WEB_DASH_PREFIX_RE = /^web-/i;

// §4.4 domains that are always automated, regardless of local part. Matched on the
// domain itself or any subdomain of it.
const AUTOMATED_DOMAINS = [
  "github.com",
  "notify.cloudflare.com",
  "apple.com",
  "notion.so",
  "intercom.io",
  "lu.ma",
  "calendar.google.com",
];

function domainMatchesKnown(domain: string, known: string[]): boolean {
  return known.some((d) => domain === d || domain.endsWith(`.${d}`));
}

// §4.4 local-part-echoes-domain — catches `mongodb@team.mongodb.com` (a domain label
// equals the local part) and `spicejet@web-spicejet.com` (a domain label ends with
// `-<local part>`). Matched per dot-separated label, not as a raw substring, so a
// short local part can't match arbitrary unrelated domains; a 1-2 char local part is
// never enough on its own to call this an echo.
function localEchoesDomain(local: string, domain: string): boolean {
  if (local.length < 3) return false;
  return domain.split(".").some((label) => label === local || label.endsWith(`-${local}`));
}

// Any §4.4 regex-layer match. Independent of engagement data; gated entirely by the
// caller checking config.ignoreAutomated first.
// A role word as ANY dot/hyphen/underscore-separated segment of the local part
// (2026-09-10, live: `settlement.alerts@razorpay.com` reached the model because
// the role rule matched the whole local part only). A human's dotted name has no
// role word in it; "sara.smith" stays.
function roleSegment(local: string): boolean {
  if (ROLE_LOCAL_RE.test(local)) return true;
  return local.split(/[._-]+/).some((seg) => seg.length > 0 && ROLE_LOCAL_RE.test(seg));
}

function denylistReason(local: string, domain: string, email: string): string | null {
  if (roleSegment(local) || ROLE_TLD_RE.test(email)) return "role-name";
  if (MARKETING_SUBDOMAIN_RE.test(domain) || WEB_DASH_PREFIX_RE.test(domain)) return "marketing-subdomain";
  if (domainMatchesKnown(domain, AUTOMATED_DOMAINS)) return "automated-domain";
  if (localEchoesDomain(local, domain)) return "local-echo";
  return null;
}

function normalizeList(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

// Fails open (0 / "off") on anything that isn't a usable positive number, rather than
// throw or silently coerce NaN into a comparison that could behave unpredictably.
function safeVelocityCap(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

// The full §4 gate. Pure: no DB, no network — every input it needs (which of this
// batch's domains are engaged, which were resolved at all, the owner's own
// addresses) arrives via `config`. Always returns exactly one decision per input
// event, in input order.
export function decide(events: TriggerEvent[], config: TriggerConfig): TriggerDecision[] {
  const evts = Array.isArray(events) ? events : [];
  const cfg: TriggerConfig = config && typeof config === "object" ? config : {};

  const ownerSet = new Set(
    normalizeList(cfg.ownerAddresses).map((a) => a.trim().toLowerCase()).filter(Boolean),
  );
  const engagedSet = new Set(
    normalizeList(cfg.engagedDomains).map((d) => d.trim().toLowerCase()).filter(Boolean),
  );
  const resolvedSet = new Set(
    normalizeList(cfg.resolvedDomains).map((d) => d.trim().toLowerCase()).filter(Boolean),
  );
  const ignoreAutomated = cfg.ignoreAutomated === true;
  const velocityCap = safeVelocityCap(cfg.velocityCap);

  // §4.5 velocity, keyed on the FULL sender address (never the domain) — see the
  // TriggerConfig.velocityCap doc above for why this counts within the batch.
  const addressCounts = new Map<string, number>();
  if (velocityCap > 0) {
    for (const e of evts) {
      const email = String(e?.actor?.email || "").trim().toLowerCase();
      if (email) addressCounts.set(email, (addressCounts.get(email) || 0) + 1);
    }
  }

  return evts.map((e) => {
    const eventId = e?.eventId as string;
    const email = String(e?.actor?.email || "").trim().toLowerCase();
    const at = email.lastIndexOf("@");
    // Can't identify a sender at all — nothing to gate on; never drop mail we can't
    // classify.
    if (!email || at === -1) return { eventId, wake: true, reason: "" };

    if (ownerSet.has(email)) return { eventId, wake: false, reason: "self-send" };

    const local = email.slice(0, at);
    const domain = email.slice(at + 1);
    if (!domain) return { eventId, wake: true, reason: "" };

    if (NO_REPLY_RE.test(local)) return { eventId, wake: false, reason: "no-reply" };

    // A calendar auto-response: machine-written subject, nothing to answer. Above
    // engagement on purpose -- the sender is usually a colleague.
    const preview = typeof e?.preview === "string" ? e.preview.trimStart() : "";
    if (CALENDAR_RESPONSE_RE.test(preview)) return { eventId, wake: false, reason: "calendar-response" };

    // Unresolved: nobody successfully asked whether this domain is engaged, so
    // neither the KEEP path nor the "not engaged" drop below may act on it. The
    // denylist in between still applies -- it is independent of engagement data
    // and predates the concept, and bypassing it too would mean a fresh instance
    // drafts replies to every no-reply sender it sees.
    const unresolved = !resolvedSet.has(domain);

    if (!unresolved && engagedSet.has(domain)) {
      if (velocityCap > 0 && (addressCounts.get(email) || 0) > velocityCap) {
        return { eventId, wake: false, reason: "velocity" };
      }
      return { eventId, wake: true, reason: "" }; // engaged — the denylist does NOT apply
    }

    if (ignoreAutomated) {
      const reason = denylistReason(local, domain, email);
      if (reason) return { eventId, wake: false, reason };
    }

    // Never classified — fail open rather than drop on the "not engaged" fallback
    // below, which would suppress mail on the strength of a lookup that never ran.
    if (unresolved) return { eventId, wake: true, reason: "" };

    return { eventId, wake: false, reason: "not-engaged" };
  });
}

// --- Script entrypoint -----------------------------------------------------
// Gated on SKILL_PARAMS (set by skill-executor for every spawned invocation, even
// with `{}` params) so importing this module for `decide` in a unit test never runs
// runScript() — mirrors checkEngagedDomains.ts's pure/script split.
if (process.env.SKILL_PARAMS !== undefined) {
  runScript();
}

function runScript(): void {
  const params = JSON.parse(process.env.SKILL_PARAMS || "{}");
  const events: TriggerEvent[] = Array.isArray(params.events) ? params.events : [];
  const config: TriggerConfig = params.config && typeof params.config === "object" ? params.config : {};

  let decisions: TriggerDecision[];
  try {
    decisions = decide(events, config);
    // decide() always returns 1:1, but guard the invariant anyway — the dispatcher
    // treats a mismatched count as a reason to fail open too, and this belt-and-
    // suspenders check keeps that true even if decide() itself ever regresses.
    if (!Array.isArray(decisions) || decisions.length !== events.length) {
      throw new Error("decide() returned a mismatched decision count");
    }
  } catch (err: any) {
    // FAIL OPEN: any throw wakes for every input event rather than risk a missed
    // reply. Over-waking is recoverable; a missed reply is not.
    decisions = events.map((e) => ({ eventId: e?.eventId as string, wake: true, reason: "" }));
  }

  console.log(JSON.stringify(decisions));
}
