// The daily harvest: read the watched channels, remember what matters, surface missed tasks.
//
// SELF-FETCHING. The app calls the Slack connector itself through `platform.connectors.exec`
// (→ POST /apps/:id/skill-exec), so the platform never polls Slack on its behalf and no Slack
// content ever lands in a platform table. The platform still resolves the credential and applies
// the account guard server-side, so the app stays credential-free and rate-limited.
//
// PURE WHERE IT CAN BE. Everything that decides — which messages count, how threads group, what a
// task looks like — takes its inputs as arguments so it is testable without a Slack or a platform.

import type { PlatformContext, Result } from "@flock/app-sdk";
import {
  upsertMessages, getCursor, setCursor, messagesSince,
  harvestRanToday, markHarvestRan, type SlackMessage,
} from "./store";

export interface HarvestConfig {
  /** Channel ids the owner chose. Empty means "nothing to read" — never "read everything". */
  channels: string[];
  ignoreBots: boolean;
  lookbackHours: number;
}

export function readConfig(filter: Record<string, unknown> | undefined): HarvestConfig {
  const raw = filter ?? {};
  const channels = Array.isArray(raw.channels) ? raw.channels.filter((c): c is string => typeof c === "string") : [];
  return {
    channels,
    ignoreBots: raw.ignoreBots !== false,
    lookbackHours: typeof raw.lookbackHours === "number" && raw.lookbackHours > 0 ? raw.lookbackHours : 24,
  };
}

/**
 * The LOCAL day a harvest belongs to, so "once a day" survives a restart.
 *
 * Was `toISOString().slice(0,10)` — UTC. For anyone east of Greenwich that puts the daily
 * boundary in the middle of their evening: a run at 01:03 local on the 23rd recorded the 22nd,
 * and every further run that evening was refused as "already ran today". "Once a day" has to mean
 * the owner's day, not Greenwich's.
 */
export function dayKey(now: Date): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** A bot post is noise for memory; a human's is not. Bots announce, they do not remember. */
export function isWorthRemembering(m: SlackMessage, cfg: HarvestConfig): boolean {
  const text = (m.text ?? "").trim();
  if (text.length === 0) return false;
  // Slack's own join/leave/topic notices carry a subtype and no real author.
  if (!m.author) return false;
  if (cfg.ignoreBots && m.author.startsWith("B")) return false;   // Slack bot ids are B…
  return true;
}

/** Thread-first grouping: a thread is the unit of meaning, a lone message is a thread of one. */
export function groupByThread(msgs: SlackMessage[]): SlackMessage[][] {
  const groups = new Map<string, SlackMessage[]>();
  for (const m of msgs) {
    const key = `${m.channelId}:${m.threadTs || m.ts}`;
    const g = groups.get(key);
    if (g) g.push(m); else groups.set(key, [m]);
  }
  return [...groups.values()];
}

/**
 * One extraction ITEM per thread, in the shape `/api/memory/extract` actually validates:
 * `{ id, text, timestamp }` — all three required, timestamp a parseable ISO string.
 *
 * The first cut emitted `{text, permalink, sourceType}`, which the route rejects outright with
 * `items[0].id is required` — a 400 the app logged as "extraction failed" and carried on from, so
 * every harvest read Slack correctly and then dropped everything on the floor.
 *
 * `id` is the thread's own identity (channel:thread-ts) so re-extracting the same thread is
 * recognisably the same item rather than a new memory each day.
 */
export function toBlock(thread: SlackMessage[]): { id: string; text: string; timestamp: string; context?: Record<string, unknown> } {
  const head = thread[0]!;
  const text = thread
    .map((m) => `${m.author ?? "someone"}: ${(m.text ?? "").trim()}`)
    .join("\n");
  // Slack ts is epoch seconds with microseconds after the dot.
  const startedMs = Math.round(Number(head.threadTs || head.ts) * 1000);
  return {
    id: `${head.channelId}:${head.threadTs || head.ts}`,
    text,
    timestamp: new Date(Number.isFinite(startedMs) ? startedMs : Date.now()).toISOString(),
    ...(head.permalink ? { context: { permalink: head.permalink } } : {}),
  };
}

export interface HarvestDeps {
  platform: PlatformContext;
  now?: () => Date;
}

export interface HarvestOutcome {
  fetched: number;
  newMessages: number;
  blocks: number;
  /** Which reading this pass did: the chosen channels, or the owner's own activity. */
  scope?: "channels" | "activity";
  skipped?: "already-ran-today" | "not-configured";
}

/**
 * WITH NO CHANNELS CHOSEN, READ THE OWNER'S OWN ACTIVITY (owner, 2026-09-23).
 *
 * The first cut made "no channels" mean read NOTHING — defensible against "read everything", but
 * wrong in practice: it made a freshly installed app do nothing at all, silently, until someone
 * found the picker. The honest default is not a workspace-wide crawl and not silence; it is the
 * part of Slack that is already addressed to this person.
 *
 * Three sources, each the app's own call (never a platform poll):
 *   DMs        conversations_unreads {channel_types:"im"} — scoped to IM deliberately. The script
 *              warns it is "inherently slow… 1-5+ minutes for large workspaces" across all types.
 *   mentions   conversations_search_messages for the owner's own @id
 *   reminders  saved_list — Slack's saved/Later items and time-based reminders
 *
 * Each is independent: one failing costs that source, not the pass.
 */
const ACTIVITY_SOURCES = ["dms", "mentions", "saved"] as const;

/**
 * One workspace's daily pass. Idempotent per day by construction: the day record is checked
 * first and written last, so a crash mid-run re-runs rather than silently skipping.
 */
export async function harvestOnce(
  accountId: string,
  cfg: HarvestConfig,
  deps: HarvestDeps,
): Promise<HarvestOutcome> {
  const now = (deps.now ?? (() => new Date()))();
  if (!deps.platform.configured) return { fetched: 0, newMessages: 0, blocks: 0, skipped: "not-configured" };
  if (harvestRanToday(accountId, dayKey(now))) return { fetched: 0, newMessages: 0, blocks: 0, skipped: "already-ran-today" };

  const scope: "channels" | "activity" = cfg.channels.length > 0 ? "channels" : "activity";
  let fetched = 0;
  let newMessages = 0;

  if (scope === "activity") {
    const got = await readOwnActivity(accountId, deps);
    fetched += got.fetched;
    newMessages += got.newMessages;
  }

  for (const channelId of cfg.channels) {
    const oldest = getCursor(accountId, channelId)
      ?? String((now.getTime() - cfg.lookbackHours * 3600_000) / 1000);

    const res: Result<unknown> = await deps.platform.connectors.exec({
      skillId: "slack",
      functionName: "conversations_history",
      params: { channel: channelId, oldest },
      accountHint: accountId,
    });
    if (!res.ok) {
      // A channel that refuses is one channel, not the run. The next day tries again from the
      // same cursor, so nothing is lost by moving on.
      console.warn(`[slack-desk] ${channelId}: ${res.reason}`);
      continue;
    }

    const msgs = normalizeHistory(channelId, res.data);
    fetched += msgs.length;
    if (msgs.length === 0) continue;
    newMessages += upsertMessages(accountId, msgs);
    // Advance to the newest ts we actually stored.
    setCursor(accountId, channelId, msgs[msgs.length - 1]!.ts);

    // THE REPLIES ARE THE CONVERSATION (2026-09-23).
    //
    // `conversations.history` returns THREAD PARENTS ONLY. A channel whose whole day happened
    // inside one thread comes back with a single message and looks quiet — which is exactly what
    // this app reported: 1 parent carrying `reply_count: 15`, and fifteen messages it never saw.
    // Slack puts replies behind `conversations.replies`, one call per thread.
    for (const parent of msgs) {
      if (!parent.replyCount) continue;
      const rep = await deps.platform.connectors.exec({
        skillId: "slack",
        functionName: "conversations_replies",
        params: { channel: channelId, ts: parent.threadTs || parent.ts, limit: 100 },
        accountHint: accountId,
      });
      if (!rep.ok) {
        console.warn(`[slack-desk] ${channelId} thread ${parent.ts}: ${rep.reason}`);
        continue;
      }
      // The parent comes back again in the reply list; dedup by (channel, ts) drops it.
      const replies = normalizeHistory(channelId, rep.data);
      fetched += replies.length;
      if (replies.length > 0) newMessages += upsertMessages(accountId, replies);
    }
  }

  const since = now.getTime() - cfg.lookbackHours * 3600_000;
  const eligible = messagesSince(accountId, since).filter((m) => isWorthRemembering(m, cfg));
  const blocks = groupByThread(eligible).map(toBlock);

  if (blocks.length > 0) {
    const extracted = await deps.platform.memory.extract(blocks, {
      // The route requires a `source` envelope; "slack" is one of its valid source types and is
      // what the brain already models (harvest-runner's SOURCE_TYPE_BY_SOURCE maps slack→slack).
      type: "slack", connectorSkill: "slack", account: accountId,
    });
    if (!extracted.ok) console.warn(`[slack-desk] extraction failed: ${extracted.reason}`);
  }

  // ONLY A PASS THAT ACTUALLY READ SOMETHING CLAIMS THE DAY.
  //
  // Marking unconditionally burned the day on a pass that fetched nothing — so a run that failed
  // to read, for whatever reason, locked out every retry until tomorrow AND reported success. A
  // genuinely quiet workspace simply stays retryable; the trigger is a daily cron plus the manual
  // button, so retrying is cheap and being wedged is not.
  if (fetched > 0) markHarvestRan(accountId, dayKey(now), blocks.length);
  return { fetched, newMessages, blocks: blocks.length, scope };
}

/**
 * The no-channels default: whatever is already addressed to this person.
 *
 * Rows are stored under a SYNTHETIC channel id per source ("im", "mention", "saved") when the
 * reply does not name a real one, so dedup by (account, channel, ts) still holds and a message
 * that later arrives through a watched channel does not double-count.
 */
export async function readOwnActivity(
  accountId: string,
  deps: HarvestDeps,
): Promise<{ fetched: number; newMessages: number }> {
  let fetched = 0;
  let newMessages = 0;

  const call = async (functionName: string, params: Record<string, unknown>) => {
    const res = await deps.platform.connectors.exec({
      skillId: "slack", functionName, params, accountHint: accountId,
    });
    if (!res.ok) {
      console.warn(`[slack-desk] ${functionName}: ${res.reason}`);
      return null;
    }
    return res.data;
  };

  for (const src of ACTIVITY_SOURCES) {
    let raw: unknown = null;
    let fallbackChannel: string = src;

    if (src === "dms") {
      raw = await call("conversations_unreads", { channel_types: "im" });
      fallbackChannel = "im";
    } else if (src === "mentions") {
      const me = await call("getUserInfo", {});
      const myId = typeof (me as any)?.id === "string" ? (me as any).id
        : typeof (me as any)?.user?.id === "string" ? (me as any).user.id : null;
      // Without an id there is no "my mentions" to ask for — skip rather than search blindly.
      if (!myId) continue;
      raw = await call("conversations_search_messages", { query: `<@${myId}>`, count: 50 });
      fallbackChannel = "mention";
    } else {
      raw = await call("saved_list", { filter: "saved", include_messages: true });
      fallbackChannel = "saved";
    }
    if (raw === null) continue;

    const msgs = normalizeHistory(fallbackChannel, raw).map((m) => ({ ...m, channelId: m.channelId || fallbackChannel }));
    fetched += msgs.length;
    if (msgs.length > 0) newMessages += upsertMessages(accountId, msgs);
  }

  return { fetched, newMessages };
}

/** Shape whatever `conversations_history` returned into our own rows. Tolerant by design: a
 *  connector version bump must degrade to fewer fields, never throw. */
export function normalizeHistory(channelId: string, raw: unknown): SlackMessage[] {
  const rows = Array.isArray(raw) ? raw : Array.isArray((raw as any)?.messages) ? (raw as any).messages : [];
  const out: SlackMessage[] = [];
  for (const r of rows as any[]) {
    const ts = typeof r?.ts === "string" ? r.ts : null;
    if (!ts) continue;
    out.push({
      // Prefer the row's OWN channel: a search or unreads reply spans conversations, so the
      // caller's label is a fallback, not the truth.
      channelId: typeof r?.channel === "string" ? r.channel
        : typeof r?.channel?.id === "string" ? r.channel.id : channelId,
      ts,
      threadTs: typeof r?.thread_ts === "string" ? r.thread_ts : null,
      author: typeof r?.user === "string" ? r.user : (typeof r?.user_name === "string" ? r.user_name : undefined),
      text: typeof r?.text === "string" ? r.text : undefined,
      permalink: typeof r?.permalink === "string" ? r.permalink : undefined,
      replyCount: typeof r?.reply_count === "number" ? r.reply_count : 0,
    });
  }
  return out.sort((a, b) => Number(a.ts) - Number(b.ts));
}
