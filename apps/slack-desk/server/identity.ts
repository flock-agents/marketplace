// WHO SAID IT, AND WAS IT SAID TO THE OWNER.
//
// Extraction reads a block of text and decides what to remember about the owner. It was handed
// `U0C2S2W19EZ: Bug: notifications panel is too crowded` and nothing else — no statement of which
// opaque id belonged to the owner, no participant list, no addressing verdict. The extractor's own
// Slack preamble asks it to "distinguish messages the user sent from messages sent to the user",
// which it had no way to do, so it attributed everything to the owner: a colleague's bug report
// came back as "Yogesh identifies that important notifications are being lost".
//
// The two facts that fix it are cheap and stable, so they are fetched once and cached in the app's
// own store: the owner's Slack user id (`auth.test`, via the connector's checkTokenHealth) and a
// display name per author (`users.info`). Neither is per-message work.

import type { PlatformContext } from "@flock/app-sdk";
import { getWorkspace, setWorkspace, getUserNames, setUserName, type Workspace } from "./store";

/** Everything a block needs to name its speakers and say who it was addressed to. */
export interface Directory {
  /** The owner's own Slack user id, when known. Null means "cannot tell" — never "nobody". */
  ownerId: string | null;
  /** The owner's own display name, for the rare block that wants it spelled out. */
  ownerName: string | null;
  /** Workspace base URL ("https://acme.slack.com/"), for building permalinks. */
  url: string | null;
  /** userId → display name, for every author we could resolve. */
  names: Map<string, string>;
}

export interface DirectoryDeps {
  platform: PlatformContext;
}

/**
 * The workspace's own identity. Cached forever in practice — a workspace does not change its id
 * or its URL — but re-fetched whenever the cached row is missing the two fields that matter, so an
 * install that cached a row before the connector returned `url` heals on the next pass instead of
 * staying permanently link-less.
 */
async function resolveWorkspace(accountId: string, deps: DirectoryDeps): Promise<Workspace | null> {
  const cached = getWorkspace(accountId);
  if (cached?.userId && cached.url) return cached;

  const res = await deps.platform.connectors.exec({
    skillId: "slack", functionName: "checkTokenHealth", params: {}, accountHint: accountId,
  });
  if (!res.ok) {
    console.warn(`[slack-desk] checkTokenHealth: ${res.reason}`);
    return cached;   // a stale row beats no identity at all
  }
  const d = res.data as any;
  const fresh: Workspace = {
    userId: typeof d?.userId === "string" && d.userId ? d.userId : cached?.userId ?? null,
    userName: typeof d?.user === "string" && d.user ? d.user : cached?.userName ?? null,
    team: typeof d?.team === "string" ? d.team : cached?.team ?? null,
    teamId: typeof d?.teamId === "string" ? d.teamId : cached?.teamId ?? null,
    // `url` arrives only from Slack connector >= 1.3.0. An older connector leaves it null and the
    // blocks simply carry no permalink — degraded, not broken.
    url: typeof d?.url === "string" && d.url ? d.url : cached?.url ?? null,
  };
  setWorkspace(accountId, fresh);
  return fresh;
}

/**
 * Display names for the authors in this pass. Only ids we have never resolved cost a call, and a
 * failed lookup is remembered as "no name" for the pass rather than retried per message — a
 * workspace with a few dozen regulars settles to zero calls after the first day.
 */
async function resolveNames(
  accountId: string,
  userIds: string[],
  deps: DirectoryDeps,
): Promise<Map<string, string>> {
  const names = getUserNames(accountId, userIds);
  const missing = userIds.filter((id) => !names.has(id));
  if (missing.length === 0) return names;

  // ONE CALL FOR THE WHOLE ROSTER, NOT ONE PER PERSON.
  //
  // This was a serial loop of `getUserInfo`, one per unresolved author — and each one takes a
  // single-flight account lease and spends one of the account's 60 daily reads. On a first run
  // with a few hundred new authors that was the largest read cost in the app, and it ran BEFORE
  // any extraction, so the pass could exhaust its budget without remembering anything.
  //
  // `users.list` has no server-side id filter, so the connector pages and filters client-side —
  // which means this is cheap for a normal workspace and capped rather than unbounded for a huge
  // one. Whatever it cannot answer falls back to the per-user lookup below.
  if (missing.length > 1) {
    const res = await deps.platform.connectors.exec({
      skillId: "slack", functionName: "users_list",
      params: { users: missing.join(","), limit: 200 },
      accountHint: accountId,
      timeoutMs: 120_000,
    });
    if (res.ok) {
      const rows: any[] = Array.isArray((res.data as any)?.users) ? (res.data as any).users
        : Array.isArray(res.data) ? (res.data as any) : [];
      for (const u of rows) {
        if (typeof u?.id !== "string") continue;
        setUserName(accountId, u.id, pickName(u), Boolean(u.is_bot));
        const n = pickName(u);
        if (n) names.set(u.id, n);
      }
    } else {
      console.warn(`[slack-desk] users_list: ${res.reason}`);
    }
  }

  // Anyone the batch could not name — a deactivated account, a page the cap cut off — is worth
  // one direct lookup each. Bounded, because the batch has already done the bulk.
  for (const id of missing.filter((m) => !names.has(m))) {
    const res = await deps.platform.connectors.exec({
      skillId: "slack", functionName: "getUserInfo", params: { user: id }, accountHint: accountId,
    });
    if (!res.ok) {
      console.warn(`[slack-desk] getUserInfo(${id}): ${res.reason}`);
      continue;
    }
    const u = (res.data as any)?.user ?? res.data;
    const name = pickName(u);
    // CACHE THE NEGATIVE. The comment here used to claim a failed lookup was remembered as "no
    // name"; it was not — `setUserName` ran only on success, so an unresolvable id was retried
    // every pass, spending a lease each time. Worse, the block then read `U123: …` one day and
    // `Alice: …` the next, which changed the text hash and re-extracted the whole thread with
    // day one's facts attributed to an opaque id.
    setUserName(accountId, id, name, Boolean(u?.is_bot));
    if (name) names.set(id, name);
  }
  return names;
}

/** Slack's own order of preference: what a human chose to be called, then their real name, then
 *  the handle. An id is never a name — leaving it unresolved is better than pretending. */
function pickName(u: any): string | null {
  return (typeof u?.display_name === "string" && u.display_name)
    || (typeof u?.real_name === "string" && u.real_name)
    || (typeof u?.name === "string" && u.name)
    || null;
}

/** Resolve everything one harvest pass needs to attribute its messages. */
export async function loadDirectory(
  accountId: string,
  authorIds: readonly (string | undefined)[],
  deps: DirectoryDeps,
): Promise<Directory> {
  const ws = await resolveWorkspace(accountId, deps);
  const ids = [...new Set(authorIds.filter((a): a is string => typeof a === "string" && a.length > 0))];
  const names = await resolveNames(accountId, ids, deps);
  return {
    ownerId: ws?.userId ?? null,
    ownerName: ws?.userName ?? null,
    url: ws?.url ?? null,
    names,
  };
}

/**
 * A Slack message permalink: `<workspace url>archives/<channel>/p<ts with the dot removed>`.
 *
 * Built rather than fetched because `conversations.history` and `conversations.replies` do not
 * return one, and asking `chat.getPermalink` per message would be a call per message for a value
 * that is a pure function of (workspace, channel, ts).
 */
export function permalinkFor(url: string | null, channelId: string, ts: string): string | undefined {
  if (!url || !channelId || !ts) return undefined;
  const p = ts.replace(".", "");
  if (!/^\d+$/.test(p)) return undefined;
  return `${url}archives/${channelId}/p${p}`;
}
