// Gather: read the person's new mail in code, under the mailbox lease, and keep what is worth a model's time.
//
// Ported from Flock's built-in desk, which split this across two engines: the ingest poll (ingest-runner.ts runReadCycle,
// with the gmail manifest's `ingest` block: listInbox, the F-SELF resolve read, normalize, journal) and the read half of
// the comprehension harvest (email-desk/harvest-runner.ts: claim → group by thread → horizon → cold outreach → fetch →
// filter). Both ran in-process against Flock's account guard. Here the whole gather runs inside ONE read turn
// (`connectors.readTurn(account, "email-desk:harvest")`, Flock's account-turn for a subprocess), every Gmail call is
// `connectors.exec("gmail", <the same function>, params, { turnId })`, and the turn is released on every path out.
//
// What it hands back is the thread-level mail that passed the read/skip rules, with the whole thread as its body. Nothing
// here extracts, wakes the agent or drafts (Task 2.4 does, with this result); nothing here can send.
//
// THE LEDGER IS THE BUILT-IN DESK'S. A journaled message is enrolled `pending` for the memory consumer; the gather marks
// what it skips `filtered` (with the rule's reason) and what it could not read `failed` (re-tried up to 3 times). What it
// keeps stays `pending` until the caller hands it over (seen.ts markHandedOver → `extracted`), so a run that dies between
// gathering and handing over offers the same mail again, and a mail handed over is never offered twice.
import type { Database } from "bun:sqlite";
import type { Result } from "@flock/app-sdk";
import type { RoutineCtx } from "../platform-ext";
import { getStore } from "../store";
import {
  GMAIL_SOURCE, MEMORY_CONSUMER, RESOLVE,
  appendEvents, applyResolve, claimPending, getCursor, isValidEvent, knownEventIds, markComprehension, needsResolve,
  normalizeInboxRow, setCursor, setEventBody,
  type ClaimedJournalEntry, type EventKey,
} from "../journal";
import { engagedFromSearch, listEngagedDomains, resolveEngagement, seedOwnerDomains } from "../engaged-domains";
import { isColdOutreachThread, isMemoryEligible } from "../lib/memory-eligibility";
import { isPersonalMailbox, personalVerdict, type FamilyContext } from "../lib/personal-mail-rules";
import { decideDraftEligibility, extractEmailAddress } from "../lib/draft-eligibility";
import { isAutomatedSender } from "../lib/automated-sender";
import { isSentRow } from "../lib/sent-row";
import { THREAD_BODY_SEPARATOR as SEPARATOR, MAX_BODY_CHARS } from "../lib/thread-format";
import { wasHandedOver } from "./seen";

/** The read turn's consumer name: Flock's lease and its logs say who holds the mailbox. */
export const HARVEST_CONSUMER = "email-desk:harvest";
/** The built-in desk's harvest turn (mailbox-turns.ts TTL_MS.harvest): the extract stage's budget plus detection latency. */
export const HARVEST_TURN_TTL_MS = 20 * 60_000;

/** The gmail manifest's poll: the inbox's newest 25 threads, no watermark (Gmail's list view has none); dedupe by event id. */
export const LIST_PARAMS = { maxResults: 25 } as const;
/** Flock's POLL_CALL_TIMEOUT_MS for the listing. */
export const LIST_TIMEOUT_MS = 2 * 60_000;
/** A resolve read's worst case (manifest ingest.resolve.maxCallMs). */
const RESOLVE_TIMEOUT_MS = 105_000;
/** checkEngagedDomains' own declared timeout. */
const ENGAGED_TIMEOUT_MS = 90_000;

/** Two windows (owner, 2026-09-15): a thread whose newest message is older than OPEN is left pending (not read this run);
 *  one older than HORIZON is dropped for good as `too_old`. */
export const OPEN_DAYS = 2;
export const HORIZON_DAYS = 5;
const DAY_MS = 24 * 60 * 60 * 1000;

const CLAIM_LIMIT = 100;
const MAX_CLAIM_PAGES = 5;
/** Threads read per run, in one getThreads call (harvest HARVEST_BATCH_LIMIT); the rest stay pending for the next run. */
export const MAX_THREADS_PER_RUN = 15;
const BATCH_MAX_BODY_CHARS = 20_000;
const THREAD_TIMEOUT_MS = 90_000;

export interface KeptMail {
  accountId: string;
  threadId: string;
  /** The journal event id of the newest kept message: pass it to markHandedOver once handed over. */
  messageId: string;
  /** The newest message's sender, as Gmail shows it ("Name <addr>"). */
  from: string;
  /** The newest message's To addresses, comma-separated; "" when the read did not say. */
  to: string;
  /** The newest kept message's time, ISO. */
  date: string;
  subject: string;
  /** The whole thread, oldest first: each message opened with `From: <who>`, messages separated by a `---` line. */
  body: string;
  mailboxKind: "personal" | "work";
  /** Today's draft gate, in code, on the thread as read now: the newest message is to the person (To, not cc), not their
   *  own, not bulk, not from an automated sender, and no draft is open. create_draft checks again before it writes. */
  draftEligible: boolean;
}

export interface GatherResult {
  kept: KeptMail[];
  /** Messages skipped for good this run (a read/skip rule, or past the horizon). */
  skipped: number;
  /** The journal's read-through watermark after this run (see readCursor). */
  cursor: string | null;
  /** Messages left pending for a later run (quiet thread, first contact from a stranger, over this run's thread cap). */
  deferred: number;
  /** True when the mailbox was held by someone else: nothing was read and the cursor is unchanged. */
  busy?: boolean;
  /** Why the run read nothing or stopped early, in a few plain words ("mailbox busy"). */
  note?: string;
  /** From a refused turn, when Flock said when to try again. */
  retryAfterMs?: number;
}

export interface GatherOptions {
  /** Who the family is, for a personal mailbox's rules. Until Flock gives the app this (a later seam field), the family is
   *  the mailbox itself; the rules that need names then fail open (keep). */
  family?: FamilyContext;
  now?: number;
}

type Gmail = <T = unknown>(fn: string, params: Record<string, unknown>, timeoutMs: number) => Promise<Result<T>>;

// ---- reading Gmail's answers ---------------------------------------------------------------------------------------------

const SESSION_UNAVAILABLE = /\bsession_(not_ready|outdated)\b/i;
const GUARD = /\b(busy|too_soon|budget_exhausted|quarantined|queue_full)\b/;
const PAUSED = /Flock paused using this \S+ account/;

/** A refusal that says "stop reading this mailbox for now" (the account guard, or a sign-in that needs redoing), or null. */
export function stopReason(r: Result<unknown>): string | null {
  if (r.ok) return null;
  if (r.skipped) return "not_configured";
  if (typeof r.code === "string" && r.code.startsWith("guard_")) return r.code.slice("guard_".length) || "refused";
  const text = `${r.code ?? ""} ${r.reason ?? ""} ${r.message ?? ""}`;
  if (SESSION_UNAVAILABLE.test(text)) return "session_not_ready";
  if (PAUSED.test(text)) return "quarantined";
  return text.match(GUARD)?.[1] ?? null;
}

const errorText = (r: Result<unknown>): string =>
  r.ok ? "" : r.skipped ? r.reason : [r.code, r.reason, r.message].filter(Boolean).join(": ") || "failed";

function parsed(data: unknown): any {
  if (typeof data !== "string") return data;
  try { return JSON.parse(data); } catch { return null; }
}

// ---- threads -------------------------------------------------------------------------------------------------------------

interface Segment { from: string; text: string; to?: string[] }

interface Block {
  key: string;
  rows: ClaimedJournalEntry[];
  segments: Segment[];
}

function actorEmail(row: ClaimedJournalEntry): string {
  const actor = row.actor as Record<string, unknown> | undefined;
  return actor && typeof actor.email === "string" ? actor.email : "";
}

/** A row's parked body split back into messages (the separator format the harvest writes), else its preview. */
function segmentsFromRow(row: ClaimedJournalEntry): Segment[] {
  const body = typeof row.body === "string" ? row.body.trim() : "";
  const text = body || (typeof row.preview === "string" ? row.preview.trim() : "");
  if (!text) return [];
  const from = actorEmail(row);
  if (!text.includes(SEPARATOR)) return [{ from, text }];
  return text.split(SEPARATOR).map((part) => {
    const named = part.match(/^From: ([^\n]*)\n([\s\S]*)$/);
    return named ? { from: named[1]!, text: named[2]! } : { from, text: part };
  });
}

/** Whole messages, oldest first, under MAX_BODY_CHARS; identical texts once (harvest renderSegments). */
export function renderSegments(segments: Segment[]): string {
  const seen = new Set<string>();
  const parts: string[] = [];
  let length = 0;
  for (const seg of segments) {
    const text = (seg.text ?? "").trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    const piece = seg.from && !/^from:/i.test(text) ? `From: ${seg.from}\n${text}` : text;
    if (parts.length === 0 && piece.length > MAX_BODY_CHARS) return piece.slice(0, MAX_BODY_CHARS);
    const sep = parts.length === 0 ? 0 : SEPARATOR.length;
    if (length + sep + piece.length > MAX_BODY_CHARS) break;
    parts.push(piece);
    length += sep + piece.length;
  }
  return parts.join(SEPARATOR);
}

/** Rows grouped by thread, oldest first within and across threads. The thread is the unit: read whole or skipped whole. */
function groupIntoBlocks(rows: ClaimedJournalEntry[]): Block[] {
  const sorted = [...rows].sort((a, b) => a.ts - b.ts || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const byKey = new Map<string, ClaimedJournalEntry[]>();
  for (const row of sorted) {
    const key = (typeof row.threadKey === "string" ? row.threadKey.trim() : "") || row.eventId;
    const members = byKey.get(key);
    if (members) members.push(row); else byKey.set(key, [row]);
  }
  return [...byKey.entries()].map(([key, members]) => ({ key, rows: members, segments: members.flatMap(segmentsFromRow) }));
}

const addressList = (v: unknown): string[] | undefined =>
  Array.isArray(v) ? v.filter((a): a is string => typeof a === "string" && a.trim().length > 0).map((a) => a.trim()) : undefined;

function segmentsFromThread(thread: any): Segment[] {
  const messages = thread && Array.isArray(thread.messages) ? thread.messages : [];
  return messages.map((m: any) => ({ from: typeof m?.from === "string" ? m.from : "", text: typeof m?.body === "string" ? m.body : "", to: addressList(m?.to) }));
}

// The bulk-mail signal (harvest findUnsubscribeLink / bulkSignalStrength). The browser read has no List-Unsubscribe header,
// so the link is found in the body; a footer that only SAYS unsubscribe is weaker evidence.
const UNSUBSCRIBE_URL = /https?:\/\/[^\s"'<>)\]]*(?:unsubscribe|opt[-_]?out|manage[-_]?(?:preferences|subscription)|email[-_]?preferences)[^\s"'<>)\]]*/i;
const UNSUBSCRIBE_LINE = /^.*\b(?:unsubscribe|opt[- ]?out|manage your preferences|email preferences)\b.*$/im;
const FOOTER_CHARS = 700;

export function findUnsubscribeLink(thread: any, text: string): string | null {
  const declared = thread && typeof thread === "object" ? thread.unsubscribeLink : null;
  if (typeof declared === "string" && declared.trim()) return declared.trim();
  const direct = text.match(UNSUBSCRIBE_URL);
  if (direct) return direct[0];
  const line = text.match(UNSUBSCRIBE_LINE);
  if (line) {
    const url = line[0].match(/https?:\/\/[^\s"'<>)\]]+/);
    if (url) return url[0];
  }
  const footer = text.length > FOOTER_CHARS ? text.slice(-FOOTER_CHARS) : text;
  const footerLine = footer.match(UNSUBSCRIBE_LINE);
  return footerLine ? footerLine[0].trim().slice(0, 200) : null;
}

function bulkSignalStrength(text: string): "url" | "footer_text" | null {
  if (UNSUBSCRIBE_URL.test(text)) return "url";
  const line = text.match(UNSUBSCRIBE_LINE);
  if (line && /https?:\/\/[^\s"'<>)\]]+/.test(line[0])) return "url";
  return findUnsubscribeLink(null, text) ? "footer_text" : null;
}

function subjectOf(row: ClaimedJournalEntry): string {
  const raw = row.raw ?? {};
  return typeof raw.subject === "string" && raw.subject.trim()
    ? raw.subject.trim()
    : String(row.preview ?? "").split(" — ")[0]!.trim();
}

/** The personal rules' verdict for one row (harvest personalEligibility). A sent row's actor is the recipient: the
 *  person is the sender, a family address. */
function personalEligibility(row: ClaimedJournalEntry, family: FamilyContext, text: string, bulk: boolean): { eligible: boolean; reason?: string } {
  const from = isSentRow(row) ? (family.addresses[0] ?? "") : actorEmail(row);
  const v = personalVerdict({ from, subject: subjectOf(row), text, bulk }, family);
  return v.keep ? { eligible: true } : { eligible: false, reason: v.reason };
}

function nameWords(full: string): string[] {
  return full.split(/\s+/).map((w) => w.replace(/[^\p{L}\p{M}'-]/gu, "")).filter((w) => w.length > 1);
}

/** The mailbox address's local part as a name ("asha.rao@" names "asha rao"); under three letters names nobody. */
function namesFromAddress(address: string | null): string[] {
  const local = (address ?? "").split("@")[0]?.replace(/[._-]+/g, " ").trim() ?? "";
  return local.length > 2 ? [local] : [];
}

const keyOf = (row: ClaimedJournalEntry): EventKey => ({ sourceId: row.sourceId, accountId: row.accountId, eventId: row.eventId });

// ---- the gather ----------------------------------------------------------------------------------------------------------

/** The cursor is the journal's read-through watermark for (gmail, account) in ingest_cursors: the newest message time
 *  (epoch ms, as text) read so far. Gmail's listing takes no watermark, so it bounds nothing in the read; it moves only
 *  forward, only after a read was journaled, and a refused turn leaves it as it was. */
function advancedCursor(prev: string | null, newestTs: number): string | null {
  const before = Number(prev);
  const was = Number.isFinite(before) && prev !== null ? before : -Infinity;
  if (!Number.isFinite(newestTs) || newestTs <= was) return prev;
  return String(newestTs);
}

async function mailboxAddress(ctx: RoutineCtx, accountId: string): Promise<string | null> {
  try {
    const r = await ctx.platform.connectors.accounts("gmail");
    if (!r.ok) return null;
    return r.data.accounts.find((a) => a.accountId === accountId)?.email?.trim() || null;
  } catch {
    return null;
  }
}

/**
 * Read the account's new mail inside the mailbox's read turn, journal it, and return what passed the read/skip rules.
 * A refused turn reads nothing, changes nothing and returns normally with `note` (busy: `busy: true`, "mailbox busy").
 * A Gmail call that throws, or a listing that fails for a reason other than the guard's, fails the run (it throws);
 * the turn is released either way.
 */
export async function gatherNewMail(ctx: RoutineCtx, accountId: string, opts: GatherOptions = {}): Promise<GatherResult> {
  const db = getStore(ctx.platform.dataDir);
  const cursor = getCursor(db, GMAIL_SOURCE, accountId);

  const turn = await ctx.platform.connectors.readTurn(accountId, HARVEST_CONSUMER, { skillId: "gmail", ttlMs: HARVEST_TURN_TTL_MS });
  if (!turn.ok) {
    const code = "code" in turn ? turn.code : undefined;
    const note = turn.skipped ? "not connected to Flock"
      : code === "busy" ? "mailbox busy"
      : code === "quarantined" ? "mailbox paused by Flock"
      : code === "not_yours" ? "not this person's mailbox"
      : `could not take the mailbox (${turn.reason})`;
    const retryAfterMs = "retryAfterMs" in turn && typeof turn.retryAfterMs === "number" ? turn.retryAfterMs : undefined;
    return { kept: [], skipped: 0, deferred: 0, cursor, note, ...(code === "busy" ? { busy: true } : {}), ...(retryAfterMs !== undefined ? { retryAfterMs } : {}) };
  }

  const { turnId } = turn.data;
  const gmail: Gmail = (fn, params, timeoutMs) => ctx.connectors.exec("gmail", fn, params, { account: accountId, turnId, timeoutMs });
  try {
    return await gatherUnderTurn(db, ctx, gmail, accountId, cursor, opts);
  } finally {
    try { await turn.data.release(); }
    catch (err: any) { console.warn(`[gather] ${accountId}: releasing the read turn failed: ${err?.message}`); }
  }
}

async function gatherUnderTurn(
  db: Database,
  ctx: RoutineCtx,
  gmail: Gmail,
  accountId: string,
  cursorBefore: string | null,
  opts: GatherOptions,
): Promise<GatherResult> {
  const now = opts.now ?? Date.now();
  const out: GatherResult = { kept: [], skipped: 0, deferred: 0, cursor: cursorBefore };

  // 1. LIST (ingest-runner runReadCycle with the gmail manifest's poll).
  const listedAt = Date.now();
  const listed = await gmail("listInbox", { ...LIST_PARAMS }, LIST_TIMEOUT_MS);
  if (!listed.ok) {
    const stop = stopReason(listed);
    if (stop) return { ...out, note: `mailbox not read (${stop})` };
    throw new Error(`could not list the inbox: ${errorText(listed)}`);
  }
  const page = parsed(listed.data);
  let items: Record<string, unknown>[] = Array.isArray(page) ? page.filter((i) => i && typeof i === "object") : [];

  // 2. RESOLVE (F-SELF): a row listInbox could not name a sender for is read from its thread first, at most 5 a run and
  // only rows not journaled yet. A row left unresolved is not journaled this run (never stored with a guessed sender).
  const flagged = items.filter(needsResolve);
  if (flagged.length > 0) {
    const idOf = (i: Record<string, unknown>) => normalizeInboxRow(i, accountId).eventId;
    const known = knownEventIds(db, GMAIL_SOURCE, accountId, flagged.map(idOf));
    const batch = flagged.filter((i) => !known.has(idOf(i))).slice(0, RESOLVE.maxPerPass);
    let resolved: Record<string, unknown>[] = [];
    if (batch.length > 0) {
      const r = await gmail(RESOLVE.functionName, {
        ...RESOLVE.params, threadIds: batch.map((i) => String(i.id ?? "").trim()).filter(Boolean), freshAfter: listedAt,
      }, RESOLVE_TIMEOUT_MS);
      if (r.ok) resolved = applyResolve(batch, parsed(r.data));
    }
    items = items.flatMap((i) => (needsResolve(i) ? resolved.filter((x) => x.id === i.id) : [i]));
  }

  // 3. JOURNAL, then move the watermark.
  const events = items.map((i) => normalizeInboxRow(i, accountId)).filter(isValidEvent);
  appendEvents(db, accountId, events);
  const cursor = advancedCursor(cursorBefore, events.reduce((m, e) => Math.max(m, e.ts), -Infinity));
  if (cursor !== cursorBefore) setCursor(db, GMAIL_SOURCE, accountId, cursor);
  out.cursor = cursor;

  // 4. WHO THE MAILBOX IS. Fails open: no address → work rules, and the cold check keeps everything.
  const mailbox = await mailboxAddress(ctx, accountId);
  const ownerAddresses = mailbox ? [mailbox] : [];
  if (mailbox) seedOwnerDomains(db, accountId, ownerAddresses);
  const personal = isPersonalMailbox(mailbox);
  const mailboxKind: KeptMail["mailboxKind"] = personal ? "personal" : "work";
  const family: FamilyContext | null = personal
    ? (opts.family ?? { names: nameWords(namesFromAddress(mailbox).join(" ")), addresses: ownerAddresses, schoolDomains: [] })
    : null;
  const ownerNames = namesFromAddress(mailbox);
  const identity = { engagedDomains: listEngagedDomains(db, accountId), ownerAddresses };

  // 5. CLAIM in pages → threads → horizon → cold outreach (harvest runHarvestOnceInner).
  const retentionCutoff = now - HORIZON_DAYS * DAY_MS;
  const openCutoff = now - OPEN_DAYS * DAY_MS;
  const blocks: Block[] = [];
  let offset = 0;
  for (let pages = 0; pages < MAX_CLAIM_PAGES; pages++) {
    const rows = claimPending(db, MEMORY_CONSUMER, GMAIL_SOURCE, accountId, CLAIM_LIMIT, offset);
    if (rows.length === 0) break;
    let stillPending = 0;
    const coldCandidates: Block[] = [];
    for (const block of groupIntoBlocks(rows)) {
      const newest = block.rows[block.rows.length - 1]?.ts ?? 0;
      if (newest < retentionCutoff) {
        for (const row of block.rows) { markComprehension(db, MEMORY_CONSUMER, keyOf(row), "filtered", "too_old"); out.skipped++; }
        continue;
      }
      if (newest < openCutoff) { out.deferred += block.rows.length; stillPending += block.rows.length; continue; }
      // A personal mailbox has no cold-outreach deferral: on a family's Gmail a stranger is the class teacher.
      if (personal || !isColdOutreachThread(block.rows, identity).cold) blocks.push(block);
      else coldCandidates.push(block);
    }
    if (coldCandidates.length > 0) {
      // One real lookup per page for the senders the cache calls cold; only a RESOLVED negative still defers.
      const domains = new Set<string>();
      for (const b of coldCandidates) for (const r of b.rows) {
        const email = actorEmail(r).trim().toLowerCase();
        const at = email.lastIndexOf("@");
        if (at > 0 && at < email.length - 1) domains.add(email.slice(at + 1));
      }
      const res = await resolveEngagement(db, accountId, [...domains], async (misses) =>
        engagedFromSearch(await gmail("checkEngagedDomains", { domains: misses }, ENGAGED_TIMEOUT_MS)));
      const settled = { ...identity, engagedDomains: [...identity.engagedDomains, ...res.engaged], resolvedDomains: res.resolved };
      for (const b of coldCandidates) {
        if (isColdOutreachThread(b.rows, settled).cold) { out.deferred += b.rows.length; stillPending += b.rows.length; }
        else blocks.push(b);
      }
    }
    if (blocks.length > 0 || rows.length < CLAIM_LIMIT) break;
    offset += stillPending;
  }

  // 6. READ the threads, newest conversations first, in one held session (getThreads); a thread the batch did not bring
  // back is read alone. Every worked thread is read, parked text or not: the draft gate needs the thread as it is now.
  blocks.sort((a, b) => (b.rows[b.rows.length - 1]?.ts ?? 0) - (a.rows[a.rows.length - 1]?.ts ?? 0));
  const work = blocks.slice(0, MAX_THREADS_PER_RUN);
  for (const b of blocks.slice(MAX_THREADS_PER_RUN)) out.deferred += b.rows.length;
  if (work.length === 0) return out;

  const freshAfter = work.flatMap((b) => b.rows).reduce((m, r) => Math.max(m, r.createdAt ?? 0), 0) || undefined;
  const threads = new Map<string, unknown>();
  const batch = await gmail("getThreads", {
    threadIds: work.map((b) => b.key), maxBodyChars: BATCH_MAX_BODY_CHARS, ...(freshAfter ? { freshAfter } : {}),
  }, THREAD_TIMEOUT_MS * 2);
  const batchStop = stopReason(batch);
  if (batchStop) {
    for (const b of work) out.deferred += b.rows.length;
    return { ...out, note: `mailbox not read (${batchStop})` };
  }
  if (batch.ok) {
    const list = parsed(batch.data)?.threads;
    if (Array.isArray(list)) for (const t of list) {
      const id = t && typeof t === "object" ? String(t.threadId ?? "").trim() : "";
      if (id) threads.set(id, t);
    }
  }

  const ownDraft = db.query("SELECT 1 FROM draft_records WHERE account_id = ? AND thread_id = ?");
  for (const [index, block] of work.entries()) {
    let thread = threads.get(block.key);
    if (thread === undefined) {
      const one = await gmail("getThread", { threadId: block.key, ...(freshAfter ? { freshAfter } : {}) }, THREAD_TIMEOUT_MS);
      const stop = stopReason(one);
      if (stop) {
        for (const b of work.slice(index)) out.deferred += b.rows.length;
        return { ...out, note: `mailbox not read (${stop})` };
      }
      if (!one.ok) {
        for (const row of block.rows) markComprehension(db, MEMORY_CONSUMER, keyOf(row), "failed", errorText(one));
        continue;
      }
      thread = parsed(one.data);
    }

    // Prefer the read, but a read that found headers and no text must not wipe a parked body.
    const fetched = segmentsFromThread(thread);
    const fetchedText = renderSegments(fetched);
    const segments = fetchedText ? fetched : block.segments;
    if (fetchedText) for (const row of block.rows) setEventBody(db, keyOf(row), fetchedText);

    // 7. FILTER, per row; the thread's text and opt-out link are every row's.
    const text = segments.map((s) => s.text).join("\n");
    const unsubscribeLink = findUnsubscribeLink(thread, text);
    const eligible: ClaimedJournalEntry[] = [];
    for (const row of block.rows) {
      if (wasHandedOver(row.eventId)) continue;
      const verdict = family
        ? personalEligibility(row, family, text, Boolean(unsubscribeLink))
        : isMemoryEligible(row, { unsubscribeLink, bulkSignal: bulkSignalStrength(text), text, personalNames: ownerNames });
      if (verdict.eligible) eligible.push(row);
      else { markComprehension(db, MEMORY_CONSUMER, keyOf(row), "filtered", verdict.reason); out.skipped++; }
    }
    const newestRow = eligible[eligible.length - 1];
    if (!newestRow) continue;

    const body = renderSegments(segments);
    const newestSeg = segments[segments.length - 1];
    const from = newestSeg?.from || String((newestRow.actor as { name?: unknown })?.name ?? "") || actorEmail(newestRow);
    out.kept.push({
      accountId,
      threadId: block.key,
      messageId: newestRow.eventId,
      from,
      to: (newestSeg?.to ?? []).join(", "),
      date: new Date(newestRow.ts).toISOString(),
      subject: subjectOf(newestRow),
      body,
      mailboxKind,
      draftEligible: draftEligible(thread, mailbox, Boolean(unsubscribeLink), !!ownDraft.get(accountId, block.key)),
    });
  }
  return out;
}

/** Today's draft gate on the thread as read (decideDraftEligibility), plus the sender check: no reply to a no-reply. */
function draftEligible(thread: any, mailbox: string | null, bulk: boolean, ownDraftOnThread: boolean): boolean {
  if (!mailbox || !thread || typeof thread !== "object") return false;
  const messages = Array.isArray(thread.messages) ? [...thread.messages] : [];
  const last = messages[messages.length - 1];
  if (last && bulk) messages[messages.length - 1] = { ...last, unsubscribeLink: true };
  const verdict = decideDraftEligibility(mailbox, { ...thread, messages }, { ownDraftOnThread });
  if (!verdict.ok) return false;
  const sender = extractEmailAddress(typeof last?.from === "string" ? last.from : "");
  return !isAutomatedSender(sender);
}
