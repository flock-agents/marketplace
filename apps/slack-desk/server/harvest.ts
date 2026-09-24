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
import { loadDirectory, permalinkFor, type Directory } from "./identity";

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

/**
 * How long a channel can go quiet before the next message starts a new conversation.
 *
 * Only used for messages that are NOT in a thread. Slack's own reply threads already say where a
 * conversation begins and ends; a busy channel where nobody uses threads says nothing at all, and
 * has to be inferred from the clock.
 */
export const CONVERSATION_GAP_MS = 30 * 60_000;

/**
 * Group messages into the units a reader would call conversations.
 *
 * THREADS FIRST, because a Slack thread is an explicit statement that these messages belong
 * together. Then, for messages with no thread, CONSECUTIVE RUNS in the same channel: a gap longer
 * than CONVERSATION_GAP_MS starts a new group.
 *
 * The run-grouping is not a nicety. Keying every unthreaded message on its own ts made each one
 * its own extraction block, which is how a real exchange —
 *
 *     Yogesh:   @colleague - Are you fixing these bugs? Or do you want me to fix it?
 *     colleague: I am just noting down observed issues. Not picking these immediately.
 *
 * — reached the extractor as two unrelated fragments. Neither fragment alone says a thing has
 * landed on the owner's plate, so nothing was ever surfaced to act on. Together they say it
 * plainly. Channels where nobody threads are the common case, not the edge one.
 */
export function groupByThread(msgs: SlackMessage[]): SlackMessage[][] {
  const threads = new Map<string, SlackMessage[]>();
  const loose: SlackMessage[] = [];

  for (const m of msgs) {
    if (m.threadTs) {
      const key = `${m.channelId}:${m.threadTs}`;
      const g = threads.get(key);
      if (g) g.push(m); else threads.set(key, [m]);
      continue;
    }
    loose.push(m);
  }

  // A thread PARENT carries no thread_ts of its own, so it arrives in `loose`; fold it back in
  // rather than letting a thread's first message drift into a neighbouring run.
  const remaining: SlackMessage[] = [];
  for (const m of loose) {
    const own = threads.get(`${m.channelId}:${m.ts}`);
    if (own) own.unshift(m); else remaining.push(m);
  }

  const runs: SlackMessage[][] = [];
  let current: SlackMessage[] = [];
  const sorted = [...remaining].sort(
    (a, b) => a.channelId.localeCompare(b.channelId) || Number(a.ts) - Number(b.ts),
  );
  for (const m of sorted) {
    const prev = current[current.length - 1];
    const sameRun = prev
      && prev.channelId === m.channelId
      && (Number(m.ts) - Number(prev.ts)) * 1000 <= CONVERSATION_GAP_MS;
    if (sameRun) current.push(m);
    else { if (current.length > 0) runs.push(current); current = [m]; }
  }
  if (current.length > 0) runs.push(current);

  for (const t of threads.values()) t.sort((a, b) => Number(a.ts) - Number(b.ts));
  return [...threads.values(), ...runs];
}

/**
 * One extraction ITEM per conversation, in the shape `/api/memory/extract` actually reads.
 *
 * REQUIRED: `{ id, text, timestamp }` — all three, timestamp a parseable ISO string. The first cut
 * emitted `{text, permalink, sourceType}`, which the route rejects outright with
 * `items[0].id is required` — a 400 the app logged as "extraction failed" and carried on from, so
 * every harvest read Slack correctly and then dropped everything on the floor.
 *
 * ATTRIBUTION. Lines are labelled with who said them, and the owner's own lines are labelled
 * `You`. Labelling them `U0C2S2W19EZ` — which is what the first cut did — left the extractor no
 * way to tell the owner from anyone else, so it attributed the whole conversation to the owner and
 * a colleague's bug report came back as a thing the owner had reported. `participants` and
 * `context.addressing` carry the same judgement in the fields the prompt builder reads
 * (wiki-extraction-prompts.ts renders both into METADATA).
 *
 * THE LINK. `reference` — NOT `context.permalink`, which the route drops on the floor. It is
 * `reference` that becomes `wiki_entry_sources.external_link` and, for anything that turns into a
 * task, `tasks.deeplink`: the "open this in Slack" the task card otherwise has nothing to show.
 *
 * `id` is the conversation's own identity (channel:first-ts) so re-extracting the same
 * conversation is recognisably the same item rather than a new memory each day.
 */
export function toBlock(
  thread: SlackMessage[],
  dir?: Directory,
): {
  id: string;
  text: string;
  timestamp: string;
  reference?: string;
  participants?: string[];
} {
  const head = thread[0]!;
  const ownerId = dir?.ownerId ?? null;

  const label = (author?: string): string => {
    if (!author) return "someone";
    if (ownerId && author === ownerId) return "You";
    return dir?.names.get(author) ?? author;
  };

  const text = thread
    .map((m) => `${label(m.author)}: ${(m.text ?? "").trim()}`)
    .join("\n");

  // Everyone who spoke, named once, owner included and marked as such.
  const participants = [...new Set(thread.map((m) => label(m.author)))];

  // Slack ts is epoch seconds with microseconds after the dot.
  const startedMs = Math.round(Number(head.threadTs || head.ts) * 1000);
  const anchorTs = head.threadTs || head.ts;

  return {
    id: `${head.channelId}:${anchorTs}`,
    text,
    timestamp: new Date(Number.isFinite(startedMs) ? startedMs : Date.now()).toISOString(),
    ...(participants.length > 0 ? { participants } : {}),
    // A permalink the app already stored wins; otherwise build one from the workspace URL.
    ...((head.permalink || permalinkFor(dir?.url ?? null, head.channelId, anchorTs))
      ? { reference: head.permalink || permalinkFor(dir?.url ?? null, head.channelId, anchorTs) }
      : {}),
    ...addressingOf(thread, ownerId),
  };
}

/**
 * Was this conversation addressed to the owner?
 *
 * Deliberately conservative, and computed HERE rather than inferred by the model, for the same
 * reason email-desk computes it from To/Cc: the app can see the facts and the model can only
 * guess. `unknown` is expressed by saying nothing at all — the prompt builder prints no line for
 * it, because a line saying "unknown" is a line the model will reason about for no reason.
 *
 *   to             the owner is @-mentioned, or it is a DM (a synthetic "im" channel)
 *   not-addressed  the owner is neither a speaker nor mentioned — a conversation they overheard
 *   (omitted)      the owner spoke but was not mentioned: present, but not being asked anything
 */
function addressingOf(
  thread: SlackMessage[],
  ownerId: string | null,
): { context?: { addressing: "to" | "not-addressed" } } {
  if (!ownerId) return {};
  const mentioned = thread.some((m) => (m.text ?? "").includes(`<@${ownerId}>`));
  const isDm = thread[0]?.channelId === "im" || thread[0]?.channelId.startsWith("D");
  if (mentioned || isDm) return { context: { addressing: "to" } };
  const spoke = thread.some((m) => m.author === ownerId);
  return spoke ? {} : { context: { addressing: "not-addressed" } };
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
  /**
   * Connector calls that FAILED in this pass.
   *
   * A harvest degrades rather than throws — one refused channel must not cost the others — but a
   * pass where everything was refused is not the same as a quiet workspace, and initialize must
   * be able to tell them apart before it writes "Slack is set up" over a read that never happened.
   */
  errors: number;
  /** How many channels this pass actually read history from. */
  channelsRead?: number;
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
const ACTIVITY_SOURCES = ["dms", "mentions", "engaged", "saved"] as const;

/**
 * How far back the two discovery searches look. Deliberately longer than the daily window: the
 * question they answer is "which channels does this person actually live in", and that is not
 * answerable from yesterday alone. Slack's `after:` is a date, so this is in days.
 */
const DISCOVERY_DAYS = 30;

/** Slack search's `after:` wants YYYY-MM-DD. */
function searchDateAfter(now: Date, days: number): string {
  const d = new Date(now.getTime() - days * 86_400_000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

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
  if (!deps.platform.configured) return { fetched: 0, newMessages: 0, blocks: 0, errors: 0, skipped: "not-configured" };
  if (harvestRanToday(accountId, dayKey(now))) return { fetched: 0, newMessages: 0, blocks: 0, errors: 0, skipped: "already-ran-today" };

  const scope: "channels" | "activity" = cfg.channels.length > 0 ? "channels" : "activity";
  let fetched = 0;
  let newMessages = 0;
  let errors = 0;

  // The channels this pass will read in full. A picked list is an instruction and is obeyed
  // exactly; an empty one is a question, and the activity pass answers it by finding the
  // channels the owner actually speaks in or is tagged in.
  let channelsToRead: string[] = cfg.channels;

  if (scope === "activity") {
    const got = await readOwnActivity(accountId, deps, now);
    fetched += got.fetched;
    newMessages += got.newMessages;
    errors += got.errors;
    // A search match is one message out of its context. Reading the channel around it is what
    // turns "you were mentioned" into a conversation worth remembering.
    channelsToRead = got.channels;
    if (channelsToRead.length > 0) {
      console.log(`[slack-desk] discovered ${channelsToRead.length} active channel(s) from own activity`);
    }
  }

  for (const channelId of channelsToRead) {
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
      // same cursor, so nothing is lost by moving on — but it IS counted, so a pass in which
      // every channel refused cannot be mistaken for a pass over a quiet workspace.
      errors++;
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
        errors++;
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
  // WHO IS WHO, resolved once for the whole pass — before any block is built, because a block
  // built without it is a block that attributes everyone's words to the owner.
  const dir = await loadDirectory(accountId, eligible.map((m) => m.author), deps);
  const blocks = groupByThread(eligible).map((t) => toBlock(t, dir));

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
  return { fetched, newMessages, blocks: blocks.length, scope, errors, channelsRead: channelsToRead.length };
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
  now: Date,
): Promise<{ fetched: number; newMessages: number; errors: number; channels: string[] }> {
  let fetched = 0;
  let newMessages = 0;
  let errors = 0;
  /** Channels the two searches proved the owner is actually part of the conversation in. */
  const discovered = new Set<string>();

  // conversations_unreads IS SLOW, AND SAYING SO IS NOT OPTIONAL.
  //
  // The connector's own script documents it as "inherently slow… 1-5+ minutes for large
  // workspaces". Abandoning it does not cancel it: the platform holds a single-flight
  // account-guard lease for the real duration, so an app that gives up at the transport
  // default locks ITSELF out of its own account for everything it tries next. Measured live:
  // a 10s give-up followed by 8 consecutive `guard_busy` 429s and a harvest of nothing.
  const SLOW_MS = 240_000;
  const call = async (functionName: string, params: Record<string, unknown>) => {
    const res = await deps.platform.connectors.exec({
      skillId: "slack", functionName, params, accountHint: accountId,
      ...(functionName === "conversations_unreads" || functionName === "conversations_search_messages"
        ? { timeoutMs: SLOW_MS }
        : {}),
    });
    if (!res.ok) {
      errors++;
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
    } else if (src === "mentions" || src === "engaged") {
      // The owner's OWN id comes from auth.test (checkTokenHealth), not users.info: the
      // connector's getUserInfo requires a `user` param and refuses the call without one, so
      // asking it "who am I" failed validation every time and the mentions source silently
      // never ran. loadDirectory caches the answer, so this is free after the first pass.
      const { ownerId: myId } = await loadDirectory(accountId, [], deps);
      // Without an id there is no "me" to search for — skip rather than search blindly.
      if (!myId) continue;
      const after = searchDateAfter(now, DISCOVERY_DAYS);
      raw = src === "mentions"
        // WHERE THE OWNER WAS TAGGED.
        ? await call("conversations_search_messages", {
            query: `<@${myId}>`, count: 100, sort: "timestamp", filter_date_after: after,
          })
        // WHERE THE OWNER HAS BEEN ENGAGING. A person's own messages are the truest signal of
        // which channels matter to them, and it needs no picker: a workspace-wide search for
        // `from:` the owner names those channels directly. This is what makes "no channels
        // selected" mean "work it out" instead of "read only what was pushed at me".
        // `filter_users_from` is the connector's OWN way of saying from: — it appends
        // `from:<@UID>` to the query itself. Passing both produced
        // `from:<@U…> from:<@U…>`, which Slack reads as two conjunctive filters and
        // matches nothing. One or the other, never both.
        : await call("conversations_search_messages", {
            query: `from:<@${myId}>`, count: 100, sort: "timestamp",
            filter_date_after: after,
          });
      fallbackChannel = src === "mentions" ? "mention" : "engaged";
    } else {
      raw = await call("saved_list", { filter: "saved", include_messages: true });
      fallbackChannel = "saved";
    }
    if (raw === null) continue;

    const msgs = normalizeHistory(fallbackChannel, raw).map((m) => ({ ...m, channelId: m.channelId || fallbackChannel }));
    fetched += msgs.length;
    if (msgs.length > 0) newMessages += upsertMessages(accountId, msgs);

    // A search match names a real conversation; the placeholder labels do not. Collecting them
    // turns "the owner said something here once" into "read this channel properly this pass".
    if (src === "mentions" || src === "engaged") {
      for (const m of msgs) {
        if (m.channelId && m.channelId !== fallbackChannel) discovered.add(m.channelId);
      }
    }
  }

  return { fetched, newMessages, errors, channels: [...discovered] };
}

/** Shape whatever `conversations_history` returned into our own rows. Tolerant by design: a
 *  connector version bump must degrade to fewer fields, never throw. */
export function normalizeHistory(channelId: string, raw: unknown): SlackMessage[] {
  // `matches` is search.messages' own envelope. Missing it meant every mention the search found
  // was normalised to nothing: the source ran, the call succeeded, and zero rows came back.
  const rows = Array.isArray(raw) ? raw
    : Array.isArray((raw as any)?.messages) ? (raw as any).messages
    : Array.isArray((raw as any)?.matches) ? (raw as any).matches
    : [];
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
