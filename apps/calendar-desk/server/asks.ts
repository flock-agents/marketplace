// Ask once per personal step kind: a card on the owner's board with the kind's own two buttons. The button that closed the
// card is the answer (Flock returns it as the row's actionId); a close without one (Mark done, dismiss, withdraw, expiry) is
// asked-but-unanswered and is never asked again. Flock has no app-task expiry, so Calendar Desk withdraws its own open card
// after 14 days, and withdraws it early when a fact it did not see at publish, speaking to the kind, shows the owner answered in chat.
// A button answer binds (beats the tally, a no refuses the kind) only while the fact memory wrote for it stands and no newer fact
// for the kind came after it; then the kind is decided from evidence alone (and is still never asked again).
import type { PlatformContext } from "@flock/app-sdk";
import { KINDS, KIND_FACTS_LIMIT, kindSpec, kindsToAsk, speaksToKind, type EventType } from "./kinds";
import { recordAsk, askRecord, markAnswerReported, markMemoryWritten, setFactsAtAnswer, setAnswerBinds, stepKindsFor, holdEvent } from "./planning-store";
import type { EventRow } from "./store";
import type { KindState } from "./tally";

export const ASK_TTL_MS = 14 * 86400_000;
const PREFIX = "ask:";

/** `binds` (yes/no only): whether the button answer still binds; false once its memory fact is gone or a newer fact came. */
export type AskState = { kind: string; status: "none" | "waiting" | "yes" | "no" | "unanswered"; publishedAt?: number; factsAtPublish?: string[]; binds?: boolean };
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
    out.set(k.kind, { kind: k.kind, status, ...(publishedAt != null ? { publishedAt } : {}), factsAtPublish: rec?.factsAtPublish ?? [],
      ...(status === "yes" || status === "no" ? { binds: rec?.answerBinds ?? true } : {}) });
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

/** "Remind you to book a cab before appointments?" → the answer as one subject-less statement (memory drops "The owner wants …"). */
export function preference(title: string, yes: boolean): string {
  const what = title.replace(/^Remind you to /, "").replace(/\?$/, "");
  return `${yes ? "Wants" : "Does not want"} a reminder to ${what}.`;
}

const writing = new Set<string>(); // kinds whose memory write is in flight, so an overlapping run does not send it twice

/** Writes the answer to memory, not awaited. Only a successful write marks it written; a failure logs and the next run retries. */
function writeAnswer(platform: PlatformContext, kind: string, answer: "yes" | "no", now: number): void {
  const ask = kindSpec(kind)?.ask;
  if (!ask || writing.has(kind)) return;
  writing.add(kind);
  // A preference, not a to-do: task extraction is off so the answer cannot mint a TODO.
  const item = { id: `calendar-desk:${askRef(kind)}:${answer}`, text: preference(ask.title, answer === "yes"), timestamp: new Date(now).toISOString(), hints: { extractTasks: false } };
  const warn = (why: string) => console.warn(`[calendar-desk] ask ${kind}: answer not written to memory: ${why}`);
  Promise.resolve()
    .then(() => platform.memory.extract([item], { type: "external", connectorSkill: "calendar-desk" }, { timeoutMs: 130_000 }))
    .then((res) => {
      if (!res.ok) return warn((res as any).reason ?? "unknown");
      const wrote = (res as any).data?.facts?.writtenFacts;
      markMemoryWritten(kind, answer, Array.isArray(wrote) ? wrote.filter((f: unknown): f is string => typeof f === "string") : []);
    }, (e) => warn(e?.message ?? String(e)))
    .finally(() => writing.delete(kind));
}

const same = (a: string, b: string) => a.trim().replace(/\.$/, "").toLowerCase() === b.trim().replace(/\.$/, "").toLowerCase();

/**
 * Whether a button answer still binds, judged on this run's facts for the kind (null: memory could not be read) and stored so the
 * report's guard enforces the same verdict. It binds until memory has taken it; after that only while a fact memory wrote for it
 * (else the answer sentence itself) is found and no fact speaking to the kind has come since the answer was first read.
 */
function judgeAnswer(kind: string, answer: "yes" | "no", facts: readonly string[] | null | undefined): boolean {
  if (facts != null) setFactsAtAnswer(kind, facts);
  const rec = askRecord(kind);
  let binds: boolean;
  if (!rec || rec.memoryWritten !== answer) binds = true;
  else if (facts == null) binds = rec.answerBinds ?? true;
  else {
    const said = rec.writtenFacts?.length ? rec.writtenFacts : [preference(kindSpec(kind)!.ask!.title, answer === "yes")];
    const isSaid = (f: string) => said.some((s) => same(s, f));
    const before = new Set(rec.factsAtAnswer ?? facts);
    binds = facts.some(isSaid) && !facts.some((f) => !before.has(f) && !isSaid(f) && speaksToKind(kind, f));
  }
  setAnswerBinds(kind, binds);
  return binds;
}

/**
 * Each run: reports kinds newly answered by button (once each), judges whether each answer still binds, and writes each answer
 * to memory until a write succeeds; withdraws an open card past its 14 days ("expired") or one a new fact speaking to its kind
 * already answers ("answered in chat"). A withdrawn card's state becomes `unanswered` in `states`. A kind's facts are null when
 * memory could not be read.
 */
export async function settleAsks(platform: PlatformContext, states: Map<string, AskState>, factsByKind: ReadonlyMap<string, readonly string[] | null>, now: number): Promise<{ answered: { kind: string; yes: boolean }[] }> {
  const answered: { kind: string; yes: boolean }[] = [];
  for (const st of states.values()) {
    if (st.status === "yes" || st.status === "no") {
      if (markAnswerReported(st.kind, st.status, now)) answered.push({ kind: st.kind, yes: st.status === "yes" });
      st.binds = judgeAnswer(st.kind, st.status, factsByKind.get(st.kind));
      if (askRecord(st.kind)?.memoryWritten !== st.status) writeAnswer(platform, st.kind, st.status, now);
    } else if (st.status === "waiting") {
      const seen = new Set(st.factsAtPublish ?? []);
      const reason = (factsByKind.get(st.kind) ?? []).some((f) => !seen.has(f) && speaksToKind(st.kind, f)) ? "answered in chat"
        : st.publishedAt != null && now >= st.publishedAt + ASK_TTL_MS ? "expired" : null;
      if (!reason) continue;
      const res = await platform.tasks.withdraw(askRef(st.kind), { reason });
      if (res.ok) st.status = "unanswered";
      else console.warn(`[calendar-desk] ask ${st.kind} not withdrawn (${reason}): ${(res as any).reason ?? "unknown"}`);
    }
  }
  return { answered };
}

interface MemoryPlatform { memory: { search(query: string, opts?: { limit?: number; any?: boolean }): Promise<{ ok: true; data: { facts: string[] } } | { ok: false; reason: string }> } }

/** A card closed without a button whose kind's memory now holds a fact the card did not see, speaking to the kind: the owner answered in chat. */
export function answeredInChat(st: AskState | undefined, facts: readonly string[]): boolean {
  if (!st || st.status !== "unanswered") return false;
  const seen = new Set(st.factsAtPublish ?? []);
  return facts.some((f) => !seen.has(f) && speaksToKind(st.kind, f));
}

/** The answers given by button that still bind: the owner's stated preference per kind. */
export function statedAnswers(asks: ReadonlyMap<string, AskState> | null): Map<string, "yes" | "no"> {
  const out = new Map<string, "yes" | "no">();
  for (const st of asks?.values() ?? []) if ((st.status === "yes" || st.status === "no") && st.binds !== false) out.set(st.kind, st.status);
  return out;
}

/**
 * For one plan report: after an event is planned, each personal kind its type and title need (kindsToAsk) that it did not get,
 * with no evidence (effective state none, no memory fact from the kind's search, no answer on its card), holds the event; the kind's
 * card is published the first time. A card already open holds the event without a second card. A card answered, or closed
 * unanswered, never holds or asks again. When memory cannot be read, nothing is asked: asking a run later is better than
 * asking twice. Each kind's facts are read once per report.
 */
export function askHolder(platform: PlatformContext, now: number, asks: Map<string, AskState> | null): (ev: EventRow, type: EventType, effective: ReadonlyMap<string, KindState>) => Promise<void> {
  const p = platform as unknown as MemoryPlatform;
  const facts = new Map<string, string[] | null>();
  return async (ev, type, effective) => {
    const want = kindsToAsk(type, ev.title, ev.location);
    if (want.length === 0 || !asks) return;
    const prefix = `step:${ev.eventKey}:`;
    const made = new Set([...stepKindsFor(ev.accountId)].filter(([ref]) => ref.startsWith(prefix)).map(([, kind]) => kind));
    for (const kind of want) {
      if (made.has(kind) || (effective.get(kind) ?? "none") !== "none") continue;
      const st = asks.get(kind);
      if (!st || (st.status !== "none" && st.status !== "waiting")) continue;
      if (!facts.has(kind)) {
        const r = await p.memory.search(kindSpec(kind)!.query!, { limit: KIND_FACTS_LIMIT, any: true });
        facts.set(kind, r.ok ? r.data.facts : null);
      }
      const known = facts.get(kind);
      if (known == null || known.length > 0) continue;
      if (st.status === "none") {
        await publishAsk(platform, kind, now, []);
        if (askRecord(kind)) st.status = "waiting";
      }
      holdEvent(ev.accountId, ev.eventKey, kind, now);
    }
  };
}
