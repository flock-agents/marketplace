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
  decayEngagement, upsertMessages, getCursor, setCursor, messagesSince, threadMessages,
  harvestRanToday, markHarvestRan, markPartialSpend, callsSpentToday,
  upsertThread, threadsToPoll, isThreadAttended,
  getLedger, writeLedger, bumpDeferred, deferredCount, oldestDeferredTs,
  bumpEngagement, rankedChannels,
  type SlackMessage,
} from "./store";
import { loadDirectory, permalinkFor, type Directory } from "./identity";

export interface HarvestConfig {
  /** Channel ids the owner chose. Empty means "work it out" — never "read everything". */
  channels: string[];
  ignoreBots: boolean;
  lookbackHours: number;
  /**
   * SHADOW BY DEFAULT, and that is the whole point of shipping it this way.
   *
   * In "shadow" the tier is computed and logged for every conversation and then ignored:
   * everything is extracted exactly as before. That produces the only evidence anyone should
   * enforce on — what fraction WOULD have been skipped, and whether a sample of those was worth
   * keeping — without risking a single memory. "enforce" acts on the verdict.
   */
  triageMode: "shadow" | "enforce";
  /** Blocks one pass may extract. A pass that stops here leaves the day resumable. */
  maxBlocks: number;
  /** First pass: treat discovered channels as picked, since a first run has no picked ones. */
  firstRun: boolean;
}

export function readConfig(filter: Record<string, unknown> | undefined): HarvestConfig {
  const raw = filter ?? {};
  const channels = Array.isArray(raw.channels) ? raw.channels.filter((c): c is string => typeof c === "string") : [];
  return {
    channels,
    ignoreBots: raw.ignoreBots !== false,
    lookbackHours: typeof raw.lookbackHours === "number" && raw.lookbackHours > 0 ? raw.lookbackHours : 24,
    // ENGAGED-ONLY IS THE DEFAULT. Shadow mode — compute the verdict and extract everything anyway
    // — survives as a diagnostic, because a skip is never revisited and a week of shadow says what
    // the rule would have dropped. But nobody should pay for it without asking: on a source this
    // noisy, reading everything is a guaranteed cost for a speculative benefit.
    // `enforceTriage` is the boolean the routine form renders (the config field types are
    // boolean/text/number/checkbox-group/multi-select — there is no select); `triageMode` is
    // accepted too so a test or a caller can say it directly.
    triageMode: raw.enforceTriage === false || raw.triageMode === "shadow" ? "shadow" : "enforce",
    maxBlocks: typeof raw.maxBlocks === "number" && raw.maxBlocks > 0 ? raw.maxBlocks : MAX_BLOCKS_PER_PASS,
    firstRun: false,
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

/**
 * Subtypes that are never memory whatever else is true of them.
 *
 * `channel_join` matters especially: the notice carries `user: <joiner>` and the text
 * "<@U…> has joined the channel", so the owner merely BEING ADDED to a channel used to read
 * as "the owner spoke here" and bought a full extraction with tasks — a false positive on the
 * most expensive tier. `file_share` and `thread_broadcast` are deliberately NOT here: the
 * shared document often IS the memory, and a broadcast is usually the summary someone wanted
 * the channel to see.
 */
const NOISE_SUBTYPES = new Set([
  "channel_join", "channel_leave", "channel_topic", "channel_purpose", "channel_name",
  "channel_archive", "channel_unarchive", "group_join", "group_leave", "pinned_item",
  "unpinned_item", "bot_add", "bot_remove", "reminder_add",
]);

/**
 * Is this message worth an extraction call?
 *
 * THE BOT RULE IS INVERTED FROM WHAT IT LOOKS LIKE IT SHOULD BE, and the old one was worse
 * than useless. It dropped authors whose id starts with `B` — but a bot post carries `bot_id`
 * and NO `user`, so `author` was empty and the message died at `if (!m.author)` before the
 * prefix test was ever reached. Bot content was already fully excluded, and search hits too
 * (the script emits `username`; the old normaliser looked for `user_name`). The set the prefix
 * test was written for is essentially empty.
 *
 * What that actually cost: GitHub "review requested from you", Jira "assigned to you",
 * PagerDuty pages, Drive comment mentions, calendar invitations — the highest-precision
 * actionable content in a workspace — were invisible. So a bot message is KEPT when it names
 * the owner or arrives in a DM, and dropped only as unaddressed chatter.
 */
export function isWorthRemembering(
  m: SlackMessage, cfg: HarvestConfig, dir?: { ownerId: string | null; ownerName: string | null; groupIds?: Set<string> },
): boolean {
  const text = (m.text ?? "").trim();
  if (text.length === 0) return false;
  if (m.subtype && NOISE_SUBTYPES.has(m.subtype)) return false;
  const fromBot = Boolean(m.botId) || m.subtype === "bot_message" || (m.author?.startsWith("B") ?? false);
  if (fromBot) {
    if (!cfg.ignoreBots) return true;
    // Addressed bot content is the point; unaddressed bot chatter is the noise.
    return namesOwner(m, dir) || isDirectMessage(m);
  }
  // Slack's own join/leave/topic notices carry a subtype and no real author.
  if (!m.author) return false;
  return true;
}

/** Is this message in a DM or group DM? Read from the connector's flags, not an id prefix. */
export function isDirectMessage(m: SlackMessage & { _dm?: boolean }): boolean {
  if (m._dm) return true;
  if (m.source === "dms") return true;
  // `mpim` ids start with G (or C on newer workspaces), so the D-prefix test alone missed every
  // group DM — and a four-person DM where a colleague asks for something is exactly the case
  // where nobody @-mentions anyone, because nobody needs to.
  return m.channelId === "im" || m.channelId === "mpim" || m.channelId.startsWith("D");
}

/**
 * Does this message name the owner in any way Slack actually renders as naming them?
 *
 * `<@UID>` alone misses most of it: user-group mentions, @here/@channel, and — by far the most
 * common in real asks — the owner's name typed as plain text without autocomplete.
 */
export function namesOwner(
  m: SlackMessage,
  dir?: { ownerId: string | null; ownerName: string | null; groupIds?: Set<string> },
): boolean {
  const text = m.text ?? "";
  if (!text) return false;
  if (dir?.ownerId && text.includes(`<@${dir.ownerId}>`)) return true;
  if (dir?.groupIds?.size) {
    for (const g of dir.groupIds) if (text.includes(`<!subteam^${g}`)) return true;
  }
  if (dir?.ownerName) {
    // Word-boundary, case-insensitive, on the handle and on the first name. A false positive
    // only costs money; a false negative loses the ask.
    const first = dir.ownerName.split(/[\s.]+/)[0];
    for (const needle of [dir.ownerName, first]) {
      if (!needle || needle.length < 3) continue;
      const re = new RegExp(`(^|[^\\w])${needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^\\w]|$)`, "i");
      if (re.test(text)) return true;
    }
  }
  return false;
}

/** `@here` / `@channel` — weak evidence: enough for facts, not enough for tasks. */
export function isBroadcast(m: SlackMessage): boolean {
  const t = m.text ?? "";
  return t.includes("<!here") || t.includes("<!channel") || t.includes("<!everyone");
}

/**
 * How long a channel can go quiet before the next message starts a new conversation.
 *
 * Only used for messages that are NOT in a thread. Slack's own reply threads already say where a
 * conversation begins and ends; a busy channel where nobody uses threads says nothing at all, and
 * has to be inferred from the clock.
 */
export const CONVERSATION_GAP_MS = 30 * 60_000;

/** Caps, so a day's spend is bounded rather than proportional to how much the workspace talks. */
export const MAX_MESSAGES_PER_BLOCK = 60;
export const MAX_CHARS_PER_BLOCK = 12_000;
export const MAX_BLOCKS_PER_PASS = 40;
/** The first pass has the only backlog there is, so it is capped harder — email-desk uses 10. */
export const FIRST_RUN_MAX_BLOCKS = 12;
/** How many blocks go in one extract request.
 *
 * TWO, not the route's 100. The platform budgets ~120s PER ITEM and serves with a 255s socket
 * limit, so about two items are all that can actually complete in one HTTP call — the SDK says so
 * out loud, and said so on the live run: "got 12 items; about 2 can be served in one call".
 * Small batches also make the HTTP status a near-per-item answer, which is the only attribution
 * available while the route reports counts without ids. */
export const EXTRACT_CHUNK = 2;

export type Tier = "full" | "facts" | "skip";

export interface Attention {
  /** Which signals fired, for the log and for the shadow-mode evidence. */
  signals: string[];
  /** Rank key when the budget binds. Higher wins. */
  score: number;
}

/**
 * Why this conversation might concern the owner — computed here, never inferred by the model.
 *
 * Scored over whatever messages the caller hands in, which MUST be the thread's full stored
 * history rather than the lookback slice: the owner asks at 17:00 Monday, the answers land at
 * 10:00 Tuesday, and Tuesday's window alone contains no owner message and no re-tag, so every
 * signal reads false and the answer to their own question scores zero.
 */
export function attentionOf(
  msgs: SlackMessage[],
  dir?: { ownerId: string | null; ownerName: string | null; groupIds?: Set<string> },
  opts: { attended?: boolean; activeChannel?: boolean; nowMs?: number } = {},
): Attention {
  const signals: string[] = [];
  let score = 0;
  const add = (name: string, weight: number) => { signals.push(name); score += weight; };
  const now = opts.nowMs ?? Date.now();
  const recentCut = (now - INTERACTION_RECENCY_DAYS * 86_400_000) / 1000;

  // Sticky: a thread that has ever carried a signal keeps it. A conversation the owner is part of
  // does not stop being theirs because they went quiet for a day.
  if (opts.attended) add("attended", 6);
  // RECENTLY interacted, not ever. Any-time participation keeps a channel the owner abandoned a
  // year ago in the read set forever; recency is what makes this "engaged" rather than "was once".
  if (dir?.ownerId && msgs.some((m) => m.author === dir.ownerId && Number(m.ts) >= recentCut)) {
    add("owner-spoke", 5);
  }
  if (msgs.some((m) => namesOwner(m, dir))) add("owner-named", 6);
  if (msgs.some((m) => isDirectMessage(m))) add("dm", 6);
  if (msgs.some((m) => m.source === "saved")) add("saved", 5);
  // CHANNEL-LEVEL ENGAGEMENT, which the app computed and then never read. A channel the owner is
  // historically very active in matters to them even in a conversation nobody named them in — so
  // it earns facts (below), not silence. Weaker than a direct signal, and deliberately so: no ask
  // was directed at anyone here.
  if (opts.activeChannel) add("active-channel", 2);
  // ADDRESSED TO EVERYONE IS STILL ADDRESSED TO THEM (owner, 2026-09-25). An earlier cut filed
  // this with active-channel as "worth remembering, not an ask" — but that reasoning is about a
  // conversation nobody aimed at anyone, and @channel is aimed at the reader. Slack itself decided
  // to interrupt them. "Please fill this in by Friday" is a real task, and these are rare enough
  // to be cheap: zero in 76 messages of real traffic. Bot-driven @channel spam does not reach here
  // — `namesOwner` does not match a broadcast, so an unaddressed bot post fails the bot filter.
  if (msgs.some((m) => isBroadcast(m))) add("broadcast", 4);
  return { signals, score };
}

/** How recently the owner must have spoken for it to count as interaction rather than history. */
export const INTERACTION_RECENCY_DAYS = 14;

/** Signals that mean an ask could be directed at the owner. Everything else is context.
 *  `broadcast` belongs here: @here/@channel is addressed AT the reader, unlike merely happening
 *  in a channel they are active in. */
const DIRECT_SIGNALS = new Set(["attended", "owner-spoke", "owner-named", "dm", "saved", "broadcast"]);

/**
 * What to spend on a conversation.
 *
 * THE TIERS ARE INVERTED FROM THE FIRST DRAFT, which put facts-only BELOW picked channels and
 * so stripped task detection from exactly the channels the owner had asked to be watched — to
 * save a prompt fragment. A picked channel is the owner saying "watch this", so it gets the
 * full tier. Facts-only is the PROMOTION PATH out of skip: a discovered channel with weak
 * evidence and no direct signal.
 *
 * THERE IS NO FIRST-RUN ESCALATION HERE. An earlier cut made a first pass treat every channel as
 * picked, so nothing could ever be skipped on it — widest window times widest tier, exactly once,
 * on the pass the owner is watching. The first run adapts its WINDOW instead (lifecycle.ts); the
 * rule is the same on every pass, which also means there is no second code path to keep in step.
 */
export function tierOf(
  att: Attention,
  opts: { channelWasPicked: boolean },
): Tier {
  // An ask could be directed at the owner ⇒ facts AND tasks.
  if (att.signals.some((sg) => DIRECT_SIGNALS.has(sg))) return "full";
  // A picked channel is the owner saying "watch this", so it keeps tasks too.
  if (opts.channelWasPicked) return "full";
  // Worth remembering, but no ask was aimed at anyone: a task minted here would belong to someone
  // else, and a board filling with other people's work is worse than a thinner one. This is the
  // channel-level signal ONLY — a broadcast is handled above, because it names the reader.
  if (att.signals.includes("active-channel")) return "facts";
  return "skip";
}

/** A stable fingerprint of exactly what we sent, so an unchanged conversation costs nothing. */
export function blockHash(text: string): string {
  // FNV-1a. Not cryptographic and does not need to be — it answers "did this text change".
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/** Split an over-long group rather than truncating it: the end of a conversation is where the
 *  decision usually is, so cutting it off loses the part most worth keeping. */
export function splitOversized(group: SlackMessage[]): SlackMessage[][] {
  if (group.length <= MAX_MESSAGES_PER_BLOCK) {
    let chars = 0;
    for (const m of group) chars += (m.text ?? "").length;
    if (chars <= MAX_CHARS_PER_BLOCK) return [group];
  }
  const out: SlackMessage[][] = [];
  let cur: SlackMessage[] = [];
  let chars = 0;
  for (const m of group) {
    const len = (m.text ?? "").length;
    if (cur.length > 0 && (cur.length >= MAX_MESSAGES_PER_BLOCK || chars + len > MAX_CHARS_PER_BLOCK)) {
      out.push(cur); cur = []; chars = 0;
    }
    cur.push(m); chars += len;
  }
  if (cur.length > 0) out.push(cur);
  return out;
}


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
  opts: { tier?: Tier } = {},
): {
  id: string;
  text: string;
  timestamp: string;
  reference?: string;
  participants?: string[];
  messages?: Array<{ index: number; from: string; text: string }>;
  hints?: { extractTasks?: boolean };
  context?: Record<string, unknown>;
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
  const reference = head.permalink || permalinkFor(dir?.url ?? null, head.channelId, anchorTs);

  // PER-MESSAGE STRUCTURE, which the platform's own task gate reads and which this app
  // never sent — so every Slack task passed ungated (`task-gates.ts` guards on
  // `block.source.messages`, and an absent array means the gate is skipped entirely).
  const messages = thread.map((m, index) => ({
    index,
    from: label(m.author),
    text: (m.text ?? "").trim(),
  }));

  // WHO THE OWNER IS, in the vocabulary the gate compares against. Slack has no To/Cc, so the
  // owner's own labels are what "self-authored" can be judged from.
  // Only when we actually know who the owner IS. With no identity there is nothing to name, and
  // emitting a bare "You" would hand the platform's gate a label matching nobody.
  const ownerAddresses = ownerId
    ? [ownerId, dir?.ownerName, "You"].filter((v): v is string => !!v)
    : [];

  return {
    id: `${head.channelId}:${anchorTs}`,
    text,
    timestamp: new Date(Number.isFinite(startedMs) ? startedMs : Date.now()).toISOString(),
    ...(participants.length > 0 ? { participants } : {}),
    ...(messages.length > 0 ? { messages } : {}),
    // A permalink the app already stored wins; otherwise build one from the workspace URL.
    ...(reference ? { reference } : {}),
    // FACTS-ONLY IS A CHEAPER CALL, NOT THE ABSENCE OF ONE: the flag drops TASK_RULES, the
    // importance policy and FINAL_TASK_GATE from the same prompt — about 2,676 tokens — and
    // skips the task pipeline. Set only for the facts tier; absent means "extract tasks".
    ...(opts.tier === "facts" ? { hints: { extractTasks: false } } : {}),
    ...mergeContext(addressingOf(thread, ownerId, dir), { ownerAddresses }),
  };
}

/** Fold the addressing verdict and the owner's labels into one `context`, or omit it entirely. */
function mergeContext(
  addressing: { context?: { addressing: "to" | "not-addressed" } },
  extra: { ownerAddresses: string[] },
): { context?: Record<string, unknown> } {
  const context: Record<string, unknown> = { ...(addressing.context ?? {}) };
  if (extra.ownerAddresses.length > 0) context.ownerAddresses = extra.ownerAddresses;
  return Object.keys(context).length > 0 ? { context } : {};
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
  dir?: { ownerId: string | null; ownerName: string | null; groupIds?: Set<string> },
): { context?: { addressing: "to" | "not-addressed" } } {
  if (!ownerId) return {};
  // Reuse the same naming test the attention signals use, so the verdict the model reads and
  // the verdict the triage acts on cannot disagree. `<@id>` alone missed plain-name asks,
  // user-group mentions and every group DM.
  const named = thread.some((m) => namesOwner(m, dir ?? { ownerId, ownerName: null }));
  const isDm = thread.some((m) => isDirectMessage(m));
  if (named || isDm) return { context: { addressing: "to" } };
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
  /** Why the pass stopped short, when it did. A pass with a reason has NOT claimed the day. */
  stopReason?: string;
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
  const day = dayKey(now);
  if (!deps.platform.configured) return { fetched: 0, newMessages: 0, blocks: 0, errors: 0, skipped: "not-configured" };
  if (harvestRanToday(accountId, day)) return { fetched: 0, newMessages: 0, blocks: 0, errors: 0, skipped: "already-ran-today" };

  const scope: "channels" | "activity" = cfg.channels.length > 0 ? "channels" : "activity";
  const picked = new Set(cfg.channels);
  let fetched = 0;
  let newMessages = 0;
  let errors = 0;
  // READS ARE THE CEILING THAT ACTUALLY BINDS: 60 per account per day, shared with email-desk,
  // ingest and the agent's own chat. A pass counts its own so it can stop cleanly rather than
  // discovering the limit as a wall of 429s — and every refused call still spends budget,
  // because the guard charges on acquire so a crashed run still counts.
  let reads = 0;
  let guardExhausted = false;

  const readBudget = Math.max(0, READS_PER_PASS - callsSpentToday(accountId, day));
  const exec = async (functionName: string, params: Record<string, unknown>, timeoutMs?: number) => {
    if (reads >= readBudget) { guardExhausted = true; return null; }
    reads++;
    const res = await deps.platform.connectors.exec({
      skillId: "slack", functionName, params, accountHint: accountId,
      ...(timeoutMs ? { timeoutMs } : {}),
    });
    if (!res.ok) {
      errors++;
      // A REFUSED LEASE IS NOT ONE REFUSED CHANNEL. Calls 61 through 600 each logging a warning
      // and moving on is a slow way of achieving nothing, so guard_busy aborts the pass and
      // leaves the day unclaimed for the next tick.
      if (/guard_busy|budget_exhausted|budget exhausted/i.test(String(res.reason ?? ""))) guardExhausted = true;
      console.warn(`[slack-desk] ${functionName}: ${res.reason}`);
      return null;
    }
    return res.data;
  };

  let channelsToRead: string[] = cfg.channels;

  if (scope === "activity") {
    const got = await readOwnActivity(accountId, deps, now, exec);
    fetched += got.fetched;
    newMessages += got.newMessages;
    channelsToRead = got.channels;
    if (channelsToRead.length > 0) {
      console.log(`[slack-desk] discovered ${channelsToRead.length} active channel(s) from own activity`);
    }
  }

  for (const channelId of channelsToRead) {
    if (guardExhausted) break;
    const oldest = getCursor(accountId, channelId)
      ?? String((now.getTime() - cfg.lookbackHours * 3600_000) / 1000);

    const data = await exec("conversations_history", { channel: channelId, oldest });
    if (data === null) continue;

    const msgs = normalizeHistory(channelId, data, "channel");
    fetched += msgs.length;
    if (msgs.length === 0) continue;
    newMessages += upsertMessages(accountId, msgs);
    setCursor(accountId, channelId, msgs[msgs.length - 1]!.ts);

    // `conversations.history` returns THREAD PARENTS ONLY, so a parent with replies is a thread
    // to fetch. Remembering it here is what makes the re-poll below possible at all.
    for (const parent of msgs) {
      if (!parent.replyCount) continue;
      upsertThread(accountId, channelId, parent.threadTs || parent.ts, { replyCount: parent.replyCount });
    }
  }

  // THE REPLIES NOBODY WOULD OTHERWISE FETCH AGAIN.
  //
  // A reply does not bump its parent's ts, so `history(oldest=cursor)` never returns a thread
  // again once its parent is behind the cursor — and a thread read on Monday that gains fifteen
  // replies on Tuesday had those replies never enter the store at all. This walks the thread set
  // instead of the cursor, which is the only way the ledger below ever has new content to notice.
  if (!guardExhausted) {
    const due = threadsToPoll(
      accountId,
      now.getTime() - THREAD_ACTIVE_DAYS * 86_400_000,
      THREAD_REPOLL_STALE_MS,
      Math.max(0, readBudget - reads),
    );
    for (const t of due) {
      if (guardExhausted) break;
      const rep = await exec("conversations_replies", { channel: t.channelId, ts: t.threadTs, limit: 200 });
      if (rep === null) continue;
      const replies = normalizeHistory(t.channelId, rep, "channel");
      fetched += replies.length;
      if (replies.length > 0) {
        newMessages += upsertMessages(accountId, replies);
        const newest = replies[replies.length - 1]!.ts;
        upsertThread(accountId, t.channelId, t.threadTs, { lastReplyTs: newest, replyCount: replies.length, polled: true });
      } else {
        upsertThread(accountId, t.channelId, t.threadTs, { polled: true });
      }
    }
  }

  // --- What to extract, and what to pay for it -------------------------------
  const outcome = await extractPass(accountId, cfg, deps, now, {
    picked, fetched, newMessages, errors, reads, guardExhausted, scope,
    channelsRead: channelsToRead.length,
  });
  return outcome;
}

/** Reads one pass may spend. Well under the guard's 60/day, which is shared with everything else. */
export const READS_PER_PASS = 40;
/** How recently a thread must have moved to be worth re-polling. */
export const THREAD_ACTIVE_DAYS = 14;
/** Do not re-poll the same thread more than once in this window. */
export const THREAD_REPOLL_STALE_MS = 20 * 3600_000;

/**
 * Decide, rank, spend, and record. Split out from the fetch so it is testable on a store alone.
 */
async function extractPass(
  accountId: string,
  cfg: HarvestConfig,
  deps: HarvestDeps,
  now: Date,
  st: {
    picked: Set<string>; fetched: number; newMessages: number; errors: number; reads: number;
    guardExhausted: boolean; scope: "channels" | "activity"; channelsRead: number;
  },
): Promise<HarvestOutcome> {
  const day = dayKey(now);
  let since = now.getTime() - cfg.lookbackHours * 3600_000;

  // REACH BACK FAR ENOUGH TO SEE WHAT WE OWE. The window alone makes a deferral a loss: a
  // conversation pushed out of a 14-day first run is not postponed by a 24-hour window, it is
  // unreachable, and `deferred_count` then counts debts that can never be paid. So the window is
  // widened to cover the oldest thing still owed. It costs nothing in model calls — the ledger's
  // hash check below drops everything already extracted before any of it reaches an extraction.
  const owed = oldestDeferredTs(accountId);
  if (owed !== null) {
    const owedMs = owed * 1000;
    if (owedMs < since) {
      console.log(`[slack-desk] widening the window to cover ${new Date(owedMs).toISOString()} — deferred work is owed`);
      since = owedMs;
    }
  }

  const dir = await loadDirectory(accountId, messagesSince(accountId, since).map((m) => m.author), deps);
  const eligible = messagesSince(accountId, since).filter((m) => isWorthRemembering(m, cfg, dir));

  // Group, then split anything oversized rather than truncating it: the end of a conversation
  // is usually where the decision is.
  const groups = groupByThread(eligible).flatMap(splitOversized);

  // WHERE THE OWNER IS HISTORICALLY VERY ACTIVE. A ranking, not a threshold: on a busy workspace a
  // threshold qualifies everywhere, so this is the top N by decayed score and nothing else. The
  // floor lives in `rankedChannels` — a channel with any lifetime mention outranks a bare score, so
  // the twice-a-year incident channel does not fall off by day 40.
  const activeChannels = new Set(rankedChannels(accountId, ACTIVE_CHANNEL_TOP_N).map((c) => c.channelId));

  type Candidate = { block: ReturnType<typeof toBlock>; tier: Tier; att: Attention; lastTs: string; hash: string };
  const candidates: Candidate[] = [];
  let skippedByTier = 0;
  let skippedByLedger = 0;

  for (const group of groups) {
    const head = group[0]!;
    const anchorTs = head.threadTs || head.ts;
    // ATTENTION OVER THE WHOLE STORED THREAD, not the window: the owner's Monday question and
    // Tuesday's answers are one conversation, and scoring only Tuesday finds no owner in it.
    const whole = threadMessages(accountId, head.channelId, anchorTs);
    const scored = whole.length > group.length ? whole : group;
    const att = attentionOf(scored, dir, {
      attended: isThreadAttended(accountId, head.channelId, anchorTs),
      activeChannel: activeChannels.has(head.channelId),
      nowMs: now.getTime(),
    });
    const tier = tierOf(att, { channelWasPicked: st.picked.has(head.channelId) });
    // Sticky from now on: a thread that showed a signal keeps it.
    if (att.signals.some((sg) => sg !== "broadcast")) {
      upsertThread(accountId, head.channelId, anchorTs, { attended: true });
    }

    if (tier === "skip") {
      skippedByTier++;
      // SHADOW MODE STILL EXTRACTS. The verdict is recorded and ignored, which is what makes the
      // week of evidence trustworthy: nothing is lost while we find out what would have been.
      if (cfg.triageMode === "enforce") continue;
    }

    // SHADOW IS A TRUE BASELINE: everything at full price, exactly as the app behaved before any
    // of this. A shadow pass that quietly priced some conversations down to facts would not be the
    // thing enforce is being compared against, and the diff between the two would mean nothing.
    const effectiveTier: Tier = cfg.triageMode === "enforce" ? tier : "full";
    const block = toBlock(group, dir, { tier: effectiveTier });
    const lastTs = group[group.length - 1]!.ts;
    const hash = blockHash(block.text);

    // UNCHANGED SINCE WE LAST EXTRACTED IT ⇒ FREE. This is the whole cost saving of the ledger,
    // and it is what the platform's watermark used to provide by accident (badly — it buried
    // threads forever). Same newest message, same rendered text: nothing to learn.
    const led = getLedger(accountId, block.id);
    if (led && led.textHash === hash && led.lastMessageTs === lastTs) { skippedByLedger++; continue; }
    // A conversation whose task already reached a terminal state must not mint it again: the
    // platform's task dedup index excludes done/dismissed, so a re-read resurrects it.
    if (led?.tasksTerminal && effectiveTier === "full") {
      candidates.push({ block: toBlock(group, dir, { tier: "facts" }), tier: "facts", att, lastTs, hash });
      continue;
    }
    candidates.push({ block, tier: effectiveTier, att, lastTs, hash });
  }

  // RANK, THEN SPEND. When the cap bites, what gets dropped decides whether it is a cost control
  // or a recall bug. Attention first; then how many times this block has already lost, so a
  // deferral ages into priority instead of starving forever behind an alphabetical channel id.
  candidates.sort((a, b) =>
    (b.att.score - a.att.score)
    || (deferredCount(accountId, b.block.id) - deferredCount(accountId, a.block.id))
    || (Number(b.lastTs) - Number(a.lastTs)));

  const budget = Math.max(0, cfg.maxBlocks);
  const chosen = candidates.slice(0, budget);
  const deferred = candidates.slice(budget);
  for (const d of deferred) bumpDeferred(accountId, d.block.id);

  let extracted = 0;
  let failedBatches = 0;
  for (let i = 0; i < chosen.length; i += EXTRACT_CHUNK) {
    const batch = chosen.slice(i, i + EXTRACT_CHUNK);
    const res = await deps.platform.memory.extract(batch.map((c) => c.block), {
      type: "slack", connectorSkill: "slack", account: accountId,
    });
    if (!res.ok) {
      // ONE BAD BATCH IS NOT THE PASS. This used to `break`, so a single slow or refused batch
      // abandoned every conversation after it — measured live: batch 3 of 5 timed out and 6 of 10
      // conversations went unextracted, with nothing deferred, because the loop stopped rather
      // than skipping. The batches are independent and the ledger only records successes, so the
      // honest response is to lose that batch and carry on.
      failedBatches++;
      console.warn(`[slack-desk] batch of ${batch.length} failed (${res.reason}) — skipping it, continuing`);
      continue;
    }
    // THE LEDGER IS WRITTEN ONLY FOR WHAT WE CAN PROVE LANDED. The route reports counts with no
    // per-item ids, so a partially-failed batch cannot be attributed — and marking it all done
    // would be permanent silent loss. A batch with any failure writes nothing and retries.
    const r = res.data as { failedItems?: number } | undefined;
    if (r && typeof r.failedItems === "number" && r.failedItems > 0) {
      failedBatches++;
      console.warn(`[slack-desk] ${r.failedItems} item(s) failed in a batch of ${batch.length} — not recording them`);
      continue;
    }
    for (const c of batch) writeLedger(accountId, c.block.id, c.lastTs, c.hash);
    extracted += batch.length;
  }

  // A pass is only "failed" if nothing survived. Some batches failing while others landed is a
  // partial pass: the day stays unclaimed so the rest is retried, but it is not a failure.
  const stopReason = st.guardExhausted ? "reads-exhausted"
    : (failedBatches > 0 && extracted === 0) ? "extract-failed"
    : failedBatches > 0 ? "batches-failed"
    : deferred.length > 0 ? "block-budget"
    : null;

  console.log(
    `[slack-desk] pass account=${accountId} scope=${st.scope} mode=${cfg.triageMode} `
    + `fetched=${st.fetched} new=${st.newMessages} groups=${groups.length} `
    + `candidates=${candidates.length} extracted=${extracted} deferred=${deferred.length} `
    + `skip_tier=${skippedByTier} skip_ledger=${skippedByLedger} reads=${st.reads} `
    + `errors=${st.errors} failed_batches=${failedBatches}${stopReason ? ` stop=${stopReason}` : ""}`,
  );

  // ONLY A PASS THAT FINISHED ITS WORK CLAIMS THE DAY. A pass that ran out of reads, failed to
  // extract, or left blocks unworked must stay claimable so the next tick resumes it — stamping
  // it was how a busy Wednesday came to be recorded as harvested while remembering nothing.
  if (st.fetched > 0 && !stopReason) {
    markHarvestRan(accountId, day, extracted, st.reads, null);
  } else if (st.reads > 0) {
    // Not the day, but the spend: a resumed pass must not start its read budget over.
    markPartialSpend(accountId, day, st.reads, stopReason);
  }

  return {
    fetched: st.fetched, newMessages: st.newMessages, blocks: extracted, scope: st.scope,
    errors: st.errors, channelsRead: st.channelsRead,
    ...(stopReason ? { stopReason } : {}),
  };
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
  exec: (fn: string, params: Record<string, unknown>, timeoutMs?: number) => Promise<unknown>,
): Promise<{ fetched: number; newMessages: number; channels: string[] }> {
  let fetched = 0;
  let newMessages = 0;
  const discovered = new Set<string>();
  // PER SOURCE, because the aggregate cannot answer the only question that matters about the two
  // sources this work repaired: did `dms` and `saved` return nothing, or parse nothing?
  const perSource: Record<string, number> = {};

  // conversations_unreads IS SLOW, AND SAYING SO IS NOT OPTIONAL. It fans out to one
  // conversations.history per unread channel and the connector paces every call by 3s, so its
  // cost scales with how many channels are unread. Slack connector 1.4.0 declares 300s for it;
  // this must be AT LEAST that or the app gives up before the platform's own budget expires —
  // and it must not be dropped, because `connectors.exec` defaults to only 60s.
  const SLOW_MS = 300_000;

  for (const src of ACTIVITY_SOURCES) {
    let raw: unknown = null;
    let fallbackChannel: string = src;

    if (src === "dms") {
      // "im,mpim", NOT "im". A group DM is a DM: it is the case where a colleague asks the owner
      // for something and nobody @-mentions anyone, because in a four-person conversation nobody
      // needs to. Scoping to "im" excluded all of them.
      raw = await exec("conversations_unreads", { channel_types: "im,mpim", include_messages: true }, SLOW_MS);
      fallbackChannel = "im";
    } else if (src === "mentions" || src === "engaged") {
      const { ownerId: myId } = await loadDirectory(accountId, [], deps);
      if (!myId) continue;
      const after = searchDateAfter(now, DISCOVERY_DAYS);
      raw = src === "mentions"
        ? await exec("conversations_search_messages", {
            query: `<@${myId}>`, count: 100, sort: "timestamp", filter_date_after: after,
          }, SLOW_MS)
        : await exec("conversations_search_messages", {
            query: `from:<@${myId}>`, count: 100, sort: "timestamp", filter_date_after: after,
          }, SLOW_MS);
      fallbackChannel = src === "mentions" ? "mention" : "engaged";
    } else {
      raw = await exec("saved_list", { filter: "saved", include_messages: true });
      fallbackChannel = "saved";
    }
    if (raw === null) continue;

    // `source` is stamped here, which is the only place that knows it. Without it the messages
    // table could not answer "was this a DM" or "did the owner save this" once the row was
    // written — and two of the four attention signals are exactly those questions.
    const msgs = normalizeHistory(fallbackChannel, raw, src)
      .map((m) => ({ ...m, channelId: m.channelId || fallbackChannel }));
    fetched += msgs.length;
    perSource[src] = (perSource[src] ?? 0) + msgs.length;
    if (msgs.length > 0) newMessages += upsertMessages(accountId, msgs);

    for (const m of msgs) {
      if (!m.channelId || m.channelId === fallbackChannel) continue;
      // A search match names a real conversation; reading the channel around it is what turns
      // "you were mentioned" into a conversation worth remembering.
      discovered.add(m.channelId);
      bumpEngagement(accountId, m.channelId, {
        hits: 1,
        mentions: src === "mentions" ? 1 : 0,
      });
      // A DM or a thread we have seen goes into the thread set so its replies are re-polled
      // later even though no channel cursor will ever return it again.
      if (m.threadTs) upsertThread(accountId, m.channelId, m.threadTs, {});
    }
  }

  // MEMBERSHIP IS A BETTER PRIOR THAN "HAS POSTED HERE". Both searches key on the owner having
  // spoken or been tagged, so a channel they read religiously and never post in — #incidents,
  // #leadership-updates — is never discovered at all, with or without decay. channels_list
  // ships with the connector and was never called.
  // ONLY WHAT THE SCRIPT READS. It takes limit/cursor/types/sort and hardcodes exclude_archived;
  // passing an unknown key made it exit 1 with no output at all on the live run. This is pure
  // enrichment — the ranking degrades without it — so a failure here must not read as a pass error.
  const chans = await exec("channels_list", { limit: 200 });
  if (chans !== null) {
    const rows: any[] = Array.isArray(chans) ? chans
      : Array.isArray((chans as any)?.channels) ? (chans as any).channels : [];
    for (const c of rows) {
      if (typeof c?.id !== "string") continue;
      bumpEngagement(accountId, c.id, {
        mentions: typeof c.mention_count === "number" ? c.mention_count : 0,
        numMembers: typeof c.num_members === "number" ? c.num_members : null,
        isMember: Boolean(c.is_member),
      });
    }
  }

  // DECAY, WITH A FLOOR. Nothing removed a channel before, so decay INTRODUCES eviction where
  // there was none — and the 30-day search window was the app's only long-tail coverage. The
  // floor is in `rankedChannels`: a channel with any lifetime mention outranks a bare score, so
  // #security-incidents does not fall off on day 40, which is when the incident happens.
  decayEngagement(accountId, ENGAGEMENT_DECAY);

  console.log(`[slack-desk] activity sources: ${ACTIVITY_SOURCES.map((k) => `${k}=${perSource[k] ?? 0}`).join(" ")}`);
  const ranked = rankedChannels(accountId, MAX_DISCOVERED_CHANNELS).map((c) => c.channelId);
  // Anything a search actually hit this pass is in; the rest of the slate comes from the ranking.
  const out = [...discovered];
  for (const c of ranked) if (!out.includes(c) && out.length < MAX_DISCOVERED_CHANNELS) out.push(c);
  return { fetched, newMessages, channels: out };
}

/** Per-pass decay factor for channel engagement — roughly a half-life of two weeks at one pass a day. */
export const ENGAGEMENT_DECAY = 0.95;
/** How many channels one pass will read, however many discovery turns up. */
export const MAX_DISCOVERED_CHANNELS = 12;
/** How many channels count as "historically very active" for the facts tier. */
export const ACTIVE_CHANNEL_TOP_N = 12;

/**
 * Shape whatever a connector returned into our own rows. Tolerant by design: a connector
 * version bump must degrade to fewer fields, never throw.
 *
 * FOUR ENVELOPES, NOT TWO, and getting this wrong cost the app two of its four sources
 * outright. It accepted a bare array, `messages` and `matches` — so:
 *   - `conversations_unreads` returns `{channel_types, unread_channels, channels:[{…, messages:[…]}]}`
 *     and parsed to NOTHING, every run. An unanswered DM, the most addressed-to-you object in
 *     Slack, was never read at all.
 *   - `saved_list` returns `{filter, counts, items:[…], total}` and parsed to nothing twice
 *     over: wrong envelope, and its items carry `message_ts`, never `ts`, so even reading
 *     `items` the `if (!ts) continue` below would have dropped every one.
 * Both are handled here, and `source` is stamped on every row so a signal can tell later which
 * read produced it — the messages table had no such column and the provenance was unrecoverable.
 */
export function normalizeHistory(channelId: string, raw: unknown, source?: string): SlackMessage[] {
  const rows: any[] = Array.isArray(raw) ? raw
    : Array.isArray((raw as any)?.messages) ? (raw as any).messages
    : Array.isArray((raw as any)?.matches) ? (raw as any).matches
    // conversations_unreads: messages hang one level down, per channel, and the channel
    // object carries the is_im/is_mpim flags a DM signal should be read from rather than
    // guessed at from an id prefix.
    : Array.isArray((raw as any)?.channels) ? (raw as any).channels.flatMap((c: any) => {
        const kind = c?.is_im ? "im" : c?.is_mpim ? "mpim" : undefined;
        return (Array.isArray(c?.messages) ? c.messages : []).map((m: any) => ({
          ...m,
          channel: m?.channel ?? c?.id ?? channelId,
          _dm: Boolean(c?.is_im || c?.is_mpim),
          _kind: kind,
        }));
      })
    // saved_list
    : Array.isArray((raw as any)?.items) ? (raw as any).items
    : [];

  const out: SlackMessage[] = [];
  for (const r of rows) {
    // `message_ts` is saved_list's spelling; everything else says `ts`.
    const ts = typeof r?.ts === "string" ? r.ts
      : typeof r?.message_ts === "string" ? r.message_ts
      : typeof r?.ts === "number" ? String(r.ts)
      : null;
    if (!ts) continue;
    out.push({
      // Prefer the row's OWN channel: a search or unreads reply spans conversations, so the
      // caller's label is a fallback, not the truth.
      channelId: typeof r?.channel === "string" ? r.channel
        : typeof r?.channel?.id === "string" ? r.channel.id
        : typeof r?.channel_id === "string" ? r.channel_id : channelId,
      ts,
      threadTs: typeof r?.thread_ts === "string" ? r.thread_ts : null,
      // `username` is what search.messages emits; `user_name` was a typo that matched nothing,
      // so every search hit normalised to no author at all.
      author: typeof r?.user === "string" ? r.user
        : typeof r?.username === "string" ? r.username
        : typeof r?.user_name === "string" ? r.user_name : undefined,
      text: typeof r?.text === "string" ? r.text : undefined,
      permalink: typeof r?.permalink === "string" ? r.permalink : undefined,
      replyCount: typeof r?.reply_count === "number" ? r.reply_count : 0,
      ...(source ? { source } : {}),
      ...(typeof r?.subtype === "string" ? { subtype: r.subtype } : {}),
      // A bot post carries bot_id INSTEAD of user. Keeping it is what lets the filter below
      // decide about bot content on purpose rather than dropping it by accident.
      ...(typeof r?.bot_id === "string" ? { botId: r.bot_id } : {}),
      ...(typeof r?.edited?.ts === "string" ? { editedTs: r.edited.ts } : {}),
      ...(r?._dm ? { _dm: true as const } : {}),
    } as SlackMessage & { _dm?: true });
  }
  return out.sort((a, b) => Number(a.ts) - Number(b.ts));
}
