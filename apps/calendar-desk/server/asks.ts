// Ask once per personal step kind: a card on the owner's board with the kind's own two buttons. The button that closed the
// card is the answer (Flock returns it as the row's actionId); a close without one (Mark done, dismiss, withdraw, expiry) is
// asked-but-unanswered and is never asked again. Flock has no app-task expiry, so Calendar Desk withdraws its own open card
// after 14 days, and withdraws it early when a fact it did not see at publish shows the owner answered in chat.
import type { PlatformContext } from "@flock/app-sdk";
import { KINDS, kindSpec } from "./kinds";
import { recordAsk, askRecord, markAnswerWritten } from "./planning-store";

export const ASK_TTL_MS = 14 * 86400_000;
const PREFIX = "ask:";

export type AskState = { kind: string; status: "none" | "waiting" | "yes" | "no" | "unanswered"; publishedAt?: number; factsAtPublish?: string[] };
// `actionId` and `withdrawn` are newer Flock fields: on an older Flock no close carries an actionId, so nothing reads as an answer.
export type AskRow = { sourceRef: string; status: "open" | "done" | "dismissed"; withdrawn?: true; actionId?: string; due: number | null };

const askRef = (kind: string) => `${PREFIX}${kind}`;
const askedOn = (at: number) =>
  `Asked on ${new Date(at).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" }).replace(",", "")}`;

/** Each askable kind's state from the `ask:` rows (tasks.list({ prefix: "ask:" })). */
export function askStates(rows: AskRow[]): Map<string, AskState> {
  const out = new Map<string, AskState>();
  for (const k of KINDS) {
    if (!k.ask) continue;
    const row = rows.find((r) => r.sourceRef === askRef(k.kind));
    if (!row) { out.set(k.kind, { kind: k.kind, status: "none" }); continue; }
    const rec = askRecord(k.kind);
    const status: AskState["status"] = row.status === "open" ? "waiting"
      : !row.withdrawn && (row.actionId === "yes" || row.actionId === "no") ? row.actionId
      : "unanswered";
    const publishedAt = rec?.publishedAt ?? row.due ?? undefined;
    out.set(k.kind, { kind: k.kind, status, ...(publishedAt != null ? { publishedAt } : {}), factsAtPublish: rec?.factsAtPublish ?? [] });
  }
  return out;
}

/** Publishes the kind's one card, unless it has no ask or any `ask:<kind>` row already exists (open or closed). */
export async function publishAsk(platform: PlatformContext, kind: string, now: number, facts: string[]): Promise<void> {
  const ask = kindSpec(kind)?.ask;
  if (!ask || askRecord(kind)) return;
  const listed = await platform.tasks.list({ prefix: askRef(kind) });
  if (!listed.ok) return; // cannot see the board: asking twice is worse than asking a run later
  if ((listed.data as { tasks: AskRow[] }).tasks.some((r) => r.sourceRef === askRef(kind))) return;
  const res = await platform.tasks.publish({
    sourceRef: askRef(kind), title: ask.title, due: now, status: "backlog",
    maxDue: now + ASK_TTL_MS, maxDueReason: askedOn(now),
    context: { kind, factsAtPublish: facts },
    actions: [
      { id: "yes", label: ask.yes, kind: "primary", executor: { mode: "inline" } },
      { id: "no", label: ask.no, kind: "secondary", executor: { mode: "inline" } },
    ],
  });
  if (res.ok) recordAsk(kind, now, facts);
  else console.warn(`[calendar-desk] ask ${kind} not published: ${(res as any).reason ?? "unknown"}`);
}

/** "Remind you to book a cab before appointments?" → the owner's answer as one plain statement. */
function preference(title: string, yes: boolean): string {
  const what = title.replace(/^Remind you to /, "").replace(/\?$/, "");
  return `The owner ${yes ? "wants" : "does not want"} a reminder to ${what}.`;
}

/** Writes the answer to memory once. Fire-and-forget: a failure logs and is not retried; the card's actionId stays the truth. */
function writeAnswer(platform: PlatformContext, kind: string, yes: boolean, now: number): void {
  const ask = kindSpec(kind)?.ask;
  if (!ask) return;
  const text = preference(ask.title, yes);
  const item = { id: `calendar-desk:${askRef(kind)}:${yes ? "yes" : "no"}`, text, timestamp: new Date(now).toISOString() };
  const warn = (why: string) => console.warn(`[calendar-desk] ask ${kind}: answer not written to memory: ${why}`);
  Promise.resolve()
    .then(() => platform.memory.extract([item], { type: "external", connectorSkill: "calendar-desk" }, { timeoutMs: 130_000 }))
    .then((res) => { if (!res.ok) warn((res as any).reason ?? "unknown"); }, (e) => warn(e?.message ?? String(e)));
}

/**
 * Each run: reports kinds newly answered by button (and writes each answer to memory once), withdraws an open card past its
 * 14 days ("expired") or one a new fact for its kind already answers ("answered in chat"). A withdrawn card's state becomes
 * `unanswered` in `states`.
 */
export async function settleAsks(platform: PlatformContext, states: Map<string, AskState>, factsByKind: Map<string, string[]>, now: number): Promise<{ answered: { kind: string; yes: boolean }[] }> {
  const answered: { kind: string; yes: boolean }[] = [];
  for (const st of states.values()) {
    if (st.status === "yes" || st.status === "no") {
      if (!markAnswerWritten(st.kind, st.status, now)) continue;
      answered.push({ kind: st.kind, yes: st.status === "yes" });
      writeAnswer(platform, st.kind, st.status === "yes", now);
    } else if (st.status === "waiting") {
      const seen = new Set(st.factsAtPublish ?? []);
      const reason = (factsByKind.get(st.kind) ?? []).some((f) => !seen.has(f)) ? "answered in chat"
        : st.publishedAt != null && now >= st.publishedAt + ASK_TTL_MS ? "expired" : null;
      if (!reason) continue;
      const res = await platform.tasks.withdraw(askRef(st.kind), { reason });
      if (res.ok) st.status = "unanswered";
      else console.warn(`[calendar-desk] ask ${st.kind} not withdrawn (${reason}): ${(res as any).reason ?? "unknown"}`);
    }
  }
  return { answered };
}
