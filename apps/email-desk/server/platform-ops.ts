// The platform ops (Op contract): reads and one write that only Flock's server calls (email-desk-ops.ts, with the app
// token). Served by the ops router, never declared in the manifest, so an agent calling one gets a 404 from Flock's
// routes/app-ops.ts. Each replaces a function of the built-in desk that Flock used to call on its own store:
//   newest_thread_message  <- store.newestStoredThreadMessage + storedThreadAccount
//   thread_body            <- the thread text the journal holds (what donateThread parked)
//   store_thread_body      <- client.donateThread (journal /donate)
//   last_harvest           <- harvest-runner.lastHarvestAt
//   follow_up_kind         <- follow-up-rules.followUpKindForTo
//   draft_send_recorded    <- send-email.draftSendRecorded
//   mailboxes              <- mailbox.resolveMailbox (routes/app-memory.ts)
//   bundle_rows            <- the sent-replies query pa-brief/bundle.ts ran on the built-in store
import type { OpHandler } from "@flock/app-sdk";
import { getStore } from "./store";
import { THREAD_BODY_SEPARATOR } from "./lib/thread-format";
import { followUpKindForTo } from "./lib/reply-context";
import { GMAIL_SOURCE } from "./journal";
import { sendLedgerKey } from "./drafts/send";

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const fail = (error: string, code: string, status = 400) => ({ error, code, status });

/** The donation cap (journal /donate): a buggy connector must not park an unbounded body. */
export const MAX_DONATION_BYTES = 500 * 1024;

/** app_meta key of an account's last finished memory run (memory-extraction.ts stamps it; last_harvest reads it). */
export const lastHarvestKey = (accountId: string): string => `last_harvest:${accountId}`;

export function recordHarvestRun(accountId: string, at = Date.now()): void {
  getStore().run(
    "INSERT INTO app_meta (key, value, updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
    [lastHarvestKey(accountId), String(at), at],
  );
}

/** Epoch ms of this mailbox's last finished memory run, or null (routines/harvest-schedule.ts reads it). */
export function lastHarvestRunAt(accountId: string): number | null {
  const row = getStore().query("SELECT value FROM app_meta WHERE key = ?").get(lastHarvestKey(accountId)) as { value: string } | null;
  const at = row ? Number(row.value) : NaN;
  return Number.isFinite(at) && at > 0 ? at : null;
}

const parseJson = (v: unknown): Record<string, unknown> => {
  if (typeof v !== "string" || !v) return {};
  try { const o = JSON.parse(v); return o && typeof o === "object" && !Array.isArray(o) ? o : {}; } catch { return {}; }
};

const CONTENT_JOIN = `LEFT JOIN ingest_content ic
  ON ic.source_id = e.source_id AND ic.account_id = e.account_id AND ic.event_id = e.event_id`;

/** The newest message of a thread as the journal stored it, with the account it is stored under. Null when no row of the
 *  thread holds a body. The body column is the whole thread rendered oldest first; its last segment is the newest message. */
function newestThreadMessage(p: Record<string, unknown>) {
  const threadId = str(p.threadId);
  if (!threadId) return { message: null };
  const row = getStore().query(
    `SELECT e.event_id AS event_id, e.account_id AS account_id, COALESCE(ic.actor, e.actor) AS actor, COALESCE(ic.raw, e.raw) AS raw,
            COALESCE(ic.body, e.body) AS body
       FROM ingest_events e ${CONTENT_JOIN}
      WHERE e.thread_key = ? AND COALESCE(ic.body, e.body) IS NOT NULL AND TRIM(COALESCE(ic.body, e.body)) != ''
      ORDER BY e.ts DESC, e.created_at DESC LIMIT 1`,
  ).get(threadId) as { event_id: string; account_id: string; actor: string | null; raw: string | null; body: string } | null;
  if (!row) return { message: null };
  const segments = row.body.split(THREAD_BODY_SEPARATOR).map((s) => s.trim()).filter(Boolean);
  const named = (segments[segments.length - 1] ?? "").match(/^From: ([^\n]*)\n/);
  const actor = parseJson(row.actor);
  const raw = parseJson(row.raw);
  const actorFrom = str(actor.name) && str(actor.email) ? `${str(actor.name)} <${str(actor.email)}>` : str(actor.email) || str(actor.name);
  return {
    message: { id: row.event_id, from: named ? named[1]!.trim() : actorFrom, date: str(raw.dateFull) || str(raw.date), accountId: row.account_id },
  };
}

function threadBody(p: Record<string, unknown>) {
  const accountId = str(p.accountId);
  const threadId = str(p.threadId);
  if (!accountId || !threadId) return { body: null };
  const row = getStore().query(
    `SELECT COALESCE(ic.body, e.body) AS body
       FROM ingest_events e ${CONTENT_JOIN}
      WHERE e.account_id = ? AND e.thread_key = ? AND COALESCE(ic.body, e.body) IS NOT NULL AND TRIM(COALESCE(ic.body, e.body)) != ''
      ORDER BY e.ts DESC, e.created_at DESC LIMIT 1`,
  ).get(accountId, threadId) as { body: string } | null;
  return { body: row?.body ?? null };
}

/** The donation: a fetched thread's text parked on EVERY journal row of the thread, so a read never pays for a second
 *  fetch. The door re-asserts the trust boundary (gmail only, size cap). Both stores in one transaction. */
function storeThreadBody(p: Record<string, unknown>) {
  const accountId = str(p.accountId);
  const threadId = str(p.threadId);
  const sourceId = str(p.sourceId);
  const rendered = p.rendered;
  if (!accountId || !threadId || typeof rendered !== "string") return fail("accountId, threadId and rendered are required", "INVALID");
  if (sourceId !== GMAIL_SOURCE) return fail("donation is only accepted from the gmail connector", "FORBIDDEN", 403);
  if (Buffer.byteLength(rendered, "utf8") > MAX_DONATION_BYTES) return fail("donation body exceeds the size cap", "TOO_LARGE", 413);
  const db = getStore();
  const storedAt = Date.now();
  db.transaction(() => {
    db.run("UPDATE ingest_events SET body = ?, body_stored_at = ? WHERE account_id = ? AND source_id = ? AND thread_key = ?",
      [rendered, storedAt, accountId, sourceId, threadId]);
    db.run(
      `UPDATE ingest_content SET body = ?, body_stored_at = ?
        WHERE (source_id, account_id, event_id) IN
          (SELECT source_id, account_id, event_id FROM ingest_events WHERE account_id = ? AND source_id = ? AND thread_key = ?)`,
      [rendered, storedAt, accountId, sourceId, threadId]);
  })();
  return { ok: true };
}

/** When this copy's memory run last finished (ISO), for one account, else the newest of all. Null: never. */
function lastHarvest(p: Record<string, unknown>) {
  const db = getStore();
  const accountId = str(p.accountId);
  const rows = (accountId
    ? db.query("SELECT value FROM app_meta WHERE key = ?").all(lastHarvestKey(accountId))
    : db.query("SELECT value FROM app_meta WHERE substr(key, 1, 13) = 'last_harvest:'").all()) as { value: string }[];
  const at = rows.map((r) => Number(r.value)).filter((n) => Number.isFinite(n) && n > 0).reduce((m, n) => Math.max(m, n), 0);
  return { at: at ? new Date(at).toISOString() : null };
}

/** Whether a card's draft was sent: the draft row's stamp, else the send ledger. `draft:<id>` is this app's sourceRef; a
 *  moved owner's older "<account>|<thread>" card is answered from the same tables. Never "in flight": that is not sent. */
function draftSendRecorded(p: Record<string, unknown>) {
  const ref = str(p.sourceRef);
  const db = getStore();
  const none = { sent: false };
  const sentFrom = (rec: { sent_at: number | null } | null, ledgerKey: string) => {
    if (rec?.sent_at) return { sent: true, sentAt: new Date(rec.sent_at).toISOString() };
    const led = db.query("SELECT state, result FROM send_ledger WHERE idempotency_key = ?").get(ledgerKey) as { state: string; result: string | null } | null;
    if (led?.state !== "sent") return none;
    const at = typeof parseJson(led.result).sentAt === "string" ? String(parseJson(led.result).sentAt) : "";
    return at ? { sent: true, sentAt: at } : { sent: true };
  };
  if (ref.startsWith("draft:")) {
    const id = ref.slice("draft:".length);
    if (!id) return none;
    const rec = db.query("SELECT sent_at FROM draft_records WHERE id = ?").get(id) as { sent_at: number | null } | null;
    return sentFrom(rec, sendLedgerKey(id));
  }
  const [account, threadId] = ref.split("|");
  if (!account || !threadId) return none;
  const rec = db.query("SELECT draft_id, sent_at FROM draft_records WHERE account_id = ? AND thread_id = ?").get(account, threadId) as { draft_id: string; sent_at: number | null } | null;
  return rec ? sentFrom(rec, `${account}|${threadId}|${rec.draft_id}`) : none;
}

/** The sent replies Flock's brief counts: the draft rows sent at or after `sinceIso`, in the named accounts. The columns are
 *  the ones pa-brief/bundle.ts read (account_id, thread_id, sent_at as epoch ms). */
function bundleRows(p: Record<string, unknown>) {
  const since = Date.parse(str(p.sinceIso));
  const accounts = Array.isArray(p.accountIds) ? p.accountIds.filter((a): a is string => typeof a === "string" && !!a) : [];
  if (!Number.isFinite(since)) return fail("sinceIso is not a date", "INVALID");
  if (accounts.length === 0) return { rows: [] };
  const rows = getStore().query(
    `SELECT account_id, thread_id, sent_at FROM draft_records
      WHERE sent_at IS NOT NULL AND sent_at >= ? AND account_id IN (${accounts.map(() => "?").join(",")})
      ORDER BY sent_at, thread_id`,
  ).all(since, ...accounts) as { account_id: string; thread_id: string; sent_at: number }[];
  return { rows };
}

export const platformOps: Record<string, OpHandler> = {
  newest_thread_message: async (p) => newestThreadMessage(p),
  thread_body: async (p) => threadBody(p),
  store_thread_body: async (p) => storeThreadBody(p),
  last_harvest: async (p) => lastHarvest(p),
  follow_up_kind: async (p) => ({ kindRef: followUpKindForTo(typeof p.to === "string" || Array.isArray(p.to) ? (p.to as string | string[]) : "") }),
  draft_send_recorded: async (p) => draftSendRecorded(p),
  mailboxes: async (_p, ctx) => {
    const list = ctx.platform.connectors.accounts;
    if (!list) return fail("this Flock cannot list mailboxes", "UNAVAILABLE", 502);
    const r = await list("gmail");
    if (!r.ok) return fail(r.skipped ? "Email Desk is not set up with an agent" : (r.message ?? r.reason), "UNAVAILABLE", 502);
    return { accounts: (r.data?.accounts ?? []).map((a) => ({ accountId: a.accountId, email: a.email ?? "" })) };
  },
  bundle_rows: async (p) => bundleRows(p),
};
