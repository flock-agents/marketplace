// The copy's mail journal: ingest_events (+ its ingest_content twin), ingest_cursors and the memory consumer's
// ingest_comprehension rows. Ported from the built-in desk's routes/journal.ts + routes/comprehension.ts (storage) and
// client.ts (the calls), now direct db calls because the journal is this process's own. The SQL, the row ids, the
// dual write and the dedupe are kept as they were, so the owner's moved email-desk.db reads unchanged (Task 3.2).
//
// Also here: how a Gmail `listInbox` row becomes a journal entry. In the built-in desk that was the gmail skill
// manifest's `ingest.map`, applied by Flock's ingest-manifest-loader; the app reads mail itself now, so the same
// transforms live with it, unchanged.
import type { Database } from "bun:sqlite";
import type { JournalEntry, StoredJournalEntry } from "./lib/journal-entry";
import { parseGmailDate, parseGmailDateTime } from "./lib/gmail-date";

/** The journal's source id for Gmail. Every built-in desk row and cursor carries it. */
export const GMAIL_SOURCE = "gmail";
/** The memory consumer's name in ingest_comprehension (Flock's ingest-db MEMORY_CONSUMER). */
export const MEMORY_CONSUMER = "memory";
/** A row whose thread read failed this many times is no longer claimed (ingest-db MAX_COMPREHENSION_ATTEMPTS). */
export const MAX_COMPREHENSION_ATTEMPTS = 3;

export type ComprehensionState = "pending" | "filtered" | "extracted" | "failed";

export interface EventKey {
  sourceId: string;
  accountId: string;
  eventId: string;
}

/** A journal row as the claim hands it over: the stored entry plus its body and the ledger's attempts. */
export interface ClaimedJournalEntry extends StoredJournalEntry {
  body: string | null;
  bodyStoredAt: number | null;
  attempts: number;
}

// ---- listInbox row → journal entry (gmail manifest ingest.map, Flock ingest-manifest-loader TRANSFORMS) -----------------

const asString = (v: unknown): string => (typeof v === "string" ? v : v == null ? "" : String(v));
const ADDRESS = /^[^@\s,<>]+@[^@\s,<>]+$/;

/** RFC5322 "Name <addr>" (or a bare addr) → { name, email }. Text with no address in it is a NAME: email stays "". */
export function rfc5322Actor(value: unknown): { name: string; email: string } {
  const s = asString(value);
  const m = s.match(/^\s*(.*?)\s*<([^>]+)>\s*$/);
  if (m) return ADDRESS.test(m[2].trim()) ? { name: m[1] || m[2], email: m[2] } : { name: m[1] || m[2], email: "" };
  const bare = s.trim();
  return ADDRESS.test(bare) ? { name: s, email: s } : { name: s, email: "" };
}

/** Thread id + a short hash of the row's visible content: a new reply on a known thread is a new event, an unchanged
 *  inbox re-listed is the same one. */
function threadMessageId(item: Record<string, unknown>): string {
  const thread = asString(item.id).trim();
  if (!thread) return "";
  const finger = ["subject", "snippet", "date"].map((f) => asString(item[f])).join("");
  let h = 5381;
  for (let i = 0; i < finger.length; i++) h = ((h << 5) + h + finger.charCodeAt(i)) >>> 0;
  return `${thread}:${h.toString(36)}`;
}

/** The message's own time: the row's full datetime title, else its visible date, else now. */
function messageTimestamp(item: Record<string, unknown>, now: Date): number {
  for (const field of ["dateFull", "date"]) {
    const v = item[field];
    if (typeof v !== "string") continue;
    const parsed = parseGmailDateTime(v) ?? parseGmailDate(v, now);
    if (parsed !== null) return parsed;
  }
  return now.getTime();
}

function emailPreview(item: Record<string, unknown>): string {
  const subject = asString(item.subject);
  const snippet = asString(item.snippet);
  return subject ? `${subject}${snippet ? ` — ${snippet}` : ""}` : snippet;
}

export function normalizeInboxRow(item: Record<string, unknown>, accountId: string, now = new Date()): JournalEntry {
  const id = asString(item.id).trim();
  return {
    sourceId: GMAIL_SOURCE,
    accountId,
    eventId: threadMessageId(item),
    kind: "email",
    actor: rfc5322Actor(item.from),
    threadKey: id || null,
    ts: messageTimestamp(item, now),
    preview: emailPreview(item),
    permalink: id ? `https://mail.google.com/mail/u/0/#inbox/${id}` : null,
    raw: item,
  };
}

/** ingest-runner isValidEvent: an entry with no id, no account or no usable time is not journaled. */
export function isValidEvent(e: JournalEntry): boolean {
  return !!e.eventId && !!e.accountId && !!e.sourceId && Number.isFinite(e.ts);
}

/** The manifest's `ingest.resolve` (F-SELF): rows listInbox could not name a sender for. */
export const RESOLVE = {
  flag: "senderUnresolved",
  functionName: "getThreads",
  params: { view: "print", maxBodyChars: 1, timeoutMs: 75_000 },
  maxPerPass: 5,
} as const;

export const needsResolve = (item: Record<string, unknown>): boolean => item?.[RESOLVE.flag] === true;

/** The `newestMessageFrom` resolver: the From of the item's thread's newest message, when it is a real address. The items
 *  the reply resolves come back with `from` rewritten and the flag removed; the rest are left out. */
export function applyResolve(items: Record<string, unknown>[], reply: unknown): Record<string, unknown>[] {
  const threads = reply && typeof reply === "object" && Array.isArray((reply as { threads?: unknown }).threads)
    ? (reply as { threads: Array<Record<string, unknown>> }).threads : [];
  const out: Record<string, unknown>[] = [];
  for (const item of items) {
    const id = asString(item.id).trim();
    const t = threads.find((x) => x && asString(x.threadId).trim() === id);
    if (!t || t.nav === "failed" || !Array.isArray(t.messages) || t.messages.length === 0) continue;
    const from = asString((t.messages[t.messages.length - 1] as Record<string, unknown>)?.from).trim();
    const m = from.match(/^\s*(.*?)\s*<([^>]+)>\s*$/);
    if (!ADDRESS.test((m ? m[2] : from).trim())) continue;
    const resolved: Record<string, unknown> = { ...item, from };
    delete resolved[RESOLVE.flag];
    out.push(resolved);
  }
  return out;
}

// ---- storage (routes/journal.ts, routes/comprehension.ts) -----------------------------------------------------------------

function genEventRowId(): string {
  return `evt_${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`;
}

function rowToClaimed(r: any): ClaimedJournalEntry {
  return {
    id: r.id,
    sourceId: r.source_id,
    accountId: r.account_id,
    eventId: r.event_id,
    kind: r.kind,
    actor: r.actor ? JSON.parse(r.actor) : {},
    threadKey: r.thread_key,
    ts: r.ts,
    preview: r.preview,
    permalink: r.permalink,
    raw: r.raw ? JSON.parse(r.raw) : {},
    createdAt: r.created_at,
    body: r.body ?? null,
    bodyStoredAt: r.body_stored_at ?? null,
    attempts: r.comp_attempts ?? 0,
  };
}

/**
 * Append entries for one account: new rows go to ingest_events and ingest_content and are enrolled `pending` for the
 * memory consumer; a known (source, account, event) is skipped, and so is a TWIN (same thread, time, kind, actor and
 * folder under another id: one message listed twice with a different snippet). Returns the rows inserted.
 */
export function appendEvents(db: Database, accountId: string, events: JournalEntry[]): StoredJournalEntry[] {
  const now = Date.now();
  const inserted: StoredJournalEntry[] = [];
  const insert = db.query(
    `INSERT INTO ingest_events
       (id, source_id, account_id, event_id, kind, actor, thread_key, ts, preview, permalink, raw, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(source_id, account_id, event_id) DO NOTHING
     RETURNING id, created_at`,
  );
  const insertContent = db.query(
    `INSERT INTO ingest_content (source_id, account_id, event_id, actor, preview, raw, body, body_stored_at)
     VALUES (?,?,?,?,?,?,NULL,NULL)
     ON CONFLICT(source_id, account_id, event_id) DO NOTHING`,
  );
  const enrol = db.query(
    `INSERT INTO ingest_comprehension (source_id, account_id, event_id, consumer, state, reason, attempts, updated_at)
     VALUES (?,?,?,?, 'pending', NULL, 0, ?)
     ON CONFLICT(source_id, account_id, event_id, consumer) DO NOTHING`,
  );
  const twin = db.query(
    `SELECT 1 FROM ingest_events
      WHERE source_id = ? AND account_id = ? AND thread_key = ? AND ts = ? AND kind = ? AND actor = ?
        AND COALESCE(json_extract(raw, '$.folder'), '') = ?
      LIMIT 1`,
  );
  db.transaction(() => {
    for (const e of events) {
      if (e.accountId !== accountId) continue; // partition guard
      const actor = JSON.stringify(e.actor ?? {});
      const folder = (e.raw as { folder?: unknown } | undefined)?.folder;
      if (e.threadKey && twin.get(e.sourceId, accountId, e.threadKey, e.ts, e.kind, actor, typeof folder === "string" ? folder : "")) continue;
      const raw = JSON.stringify(e.raw ?? {});
      const row = insert.get(genEventRowId(), e.sourceId, accountId, e.eventId, e.kind, actor, e.threadKey ?? null, e.ts,
        e.preview ?? "", e.permalink ?? null, raw, now) as { id: string; created_at: number } | null;
      if (!row) continue;
      insertContent.run(e.sourceId, accountId, e.eventId, actor, e.preview ?? "", raw);
      enrol.run(e.sourceId, accountId, e.eventId, MEMORY_CONSUMER, now);
      inserted.push({ ...e, id: row.id, createdAt: row.created_at });
    }
  })();
  return inserted;
}

export function knownEventIds(db: Database, sourceId: string, accountId: string, eventIds: string[]): Set<string> {
  const ids = eventIds.filter(Boolean).slice(0, 500);
  if (ids.length === 0) return new Set();
  const rows = db.query(
    `SELECT event_id FROM ingest_events WHERE source_id = ? AND account_id = ? AND event_id IN (${ids.map(() => "?").join(",")})`,
  ).all(sourceId, accountId, ...ids) as { event_id: string }[];
  return new Set(rows.map((r) => r.event_id));
}

export function getCursor(db: Database, sourceId: string, accountId: string): string | null {
  const row = db.query("SELECT cursor FROM ingest_cursors WHERE source_id = ? AND account_id = ?").get(sourceId, accountId) as { cursor: string | null } | null;
  return row?.cursor ?? null;
}

export function setCursor(db: Database, sourceId: string, accountId: string, cursor: string | null): void {
  db.run(
    `INSERT INTO ingest_cursors (source_id, account_id, cursor, updated_at) VALUES (?,?,?,?)
     ON CONFLICT(source_id, account_id) DO UPDATE SET cursor = excluded.cursor, updated_at = excluded.updated_at`,
    [sourceId, accountId, cursor, Date.now()],
  );
}

/** Park a fetched thread's text on a row (both halves), so nobody pays for the read twice. */
export function setEventBody(db: Database, key: EventKey, body: string): void {
  const at = Date.now();
  db.transaction(() => {
    db.run("UPDATE ingest_events SET body = ?, body_stored_at = ? WHERE source_id = ? AND account_id = ? AND event_id = ?",
      [body, at, key.sourceId, key.accountId, key.eventId]);
    db.run("UPDATE ingest_content SET body = ?, body_stored_at = ? WHERE source_id = ? AND account_id = ? AND event_id = ?",
      [body, at, key.sourceId, key.accountId, key.eventId]);
  })();
}

/** The consumer's claimable rows for one (source, account): pending, or failed under the retry cap; oldest first. */
export function claimPending(db: Database, consumer: string, sourceId: string, accountId: string, limit: number, offset = 0): ClaimedJournalEntry[] {
  const rows = db.query(
    `SELECT e.id, e.source_id, e.account_id, e.event_id, e.kind, e.thread_key, e.ts, e.permalink, e.created_at,
            COALESCE(ic.actor, e.actor)                   AS actor,
            COALESCE(ic.preview, e.preview)               AS preview,
            COALESCE(ic.raw, e.raw)                       AS raw,
            COALESCE(ic.body, e.body)                     AS body,
            COALESCE(ic.body_stored_at, e.body_stored_at) AS body_stored_at,
            comp.attempts AS comp_attempts
       FROM ingest_comprehension comp
       JOIN ingest_events e
         ON e.source_id = comp.source_id AND e.account_id = comp.account_id AND e.event_id = comp.event_id
       LEFT JOIN ingest_content ic
         ON ic.source_id = e.source_id AND ic.account_id = e.account_id AND ic.event_id = e.event_id
      WHERE comp.consumer = ? AND e.source_id = ? AND e.account_id = ?
        AND comp.state IN ('pending','failed') AND comp.attempts < ?
      ORDER BY e.ts ASC, e.id ASC
      LIMIT ? OFFSET ?`,
  ).all(consumer, sourceId, accountId, MAX_COMPREHENSION_ATTEMPTS, limit, offset) as any[];
  return rows.map(rowToClaimed);
}

/** Set a row's ledger state; `failed` counts an attempt. */
export function markComprehension(db: Database, consumer: string, key: EventKey, state: ComprehensionState, reason?: string): void {
  db.run(
    `INSERT INTO ingest_comprehension (source_id, account_id, event_id, consumer, state, reason, attempts, updated_at)
     VALUES (?,?,?,?,?,?,?,?)
     ON CONFLICT(source_id, account_id, event_id, consumer) DO UPDATE SET
       state = excluded.state, reason = excluded.reason,
       attempts = ingest_comprehension.attempts + ?, updated_at = excluded.updated_at`,
    [key.sourceId, key.accountId, key.eventId, consumer, state, reason ?? null, state === "failed" ? 1 : 0, Date.now(), state === "failed" ? 1 : 0],
  );
}
