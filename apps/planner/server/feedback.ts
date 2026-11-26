// What the family said about planned dishes (plan_feedback): every answer to record_feedback, every rating of rate_dishes and
// every dish swapped out with set_slot_day is kept, one row each. When one dish is turned down (disliked, swapped out or
// "never") PROPOSE_AFTER times, the operation's answer carries `proposed_rule`: a line for the agent to ask the family once,
// and the call that keeps it out of the plan for good when they say yes (rate_dishes with again: false: never planned again,
// as a disliked dish). Asked once: the rows it counted are marked.
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { plan_feedback } from "./db/schema";
import { AGAINST_ACTIONS, PROPOSE_AFTER, type FeedbackAction } from "./db/constants";
import { dishKey } from "./dishText";
import type { Db } from "./family";
import { listLibrary, type Change } from "./slotStore";

export type FeedbackEntry = { date: string | null; slot: string | null; dish: string; action: FeedbackAction; to?: string | null; who?: string | null; quote?: string | null };
/** A rule worth asking about: what to say, and the call to make on a yes. */
export type ProposedRule = { dish: string; times: number; who: string | null; say: string; op: "rate_dishes"; body: { ratings: { dish: string; rating: "didnt_work"; again: false; said_by?: string }[] } };

const WORD: Record<FeedbackAction, string> = { liked: "liked", disliked: "didn't like", swapped_to: "swapped out", skipped: "skipped", never: "said never to" };
const TIMES = ["", "once", "twice"];

/** Keep what was said, one row an entry. */
export function recordFeedback(tx: Db, entries: FeedbackEntry[], by: string, changes: Change[]): void {
  for (const e of entries) {
    const row = tx.insert(plan_feedback).values({ date: e.date, slot: e.slot, dish: e.dish.trim(), action: e.action, to: e.to ?? null, who: e.who ?? null,
      quote: e.quote ?? null, updated_by: by }).returning().get();
    changes.push(["plan_feedback", row.id, "insert", by]);
  }
}

/** The rows that turned a dish down and were not yet counted in a proposal. */
function againstRows(db: Db, dish: string) {
  return db.select().from(plan_feedback).where(and(sql`lower(trim(${plan_feedback.dish})) = ${dishKey(dish)}`, inArray(plan_feedback.action, [...AGAINST_ACTIONS]),
    eq(plan_feedback.proposed, 0))).orderBy(asc(plan_feedback.created_at), sql`rowid`).all();
}

/** The family's line for a dish turned down: "Riya swapped out Karela fry twice. Should I stop planning it?" */
function proposalSay(dish: string, rows: { action: string; who: string | null }[], who: string | null): string {
  const acts = [...new Set(rows.map((r) => WORD[r.action as FeedbackAction]))];
  const did = acts.length === 1 ? acts[0] : "turned down";
  const times = TIMES[rows.length] ?? `${rows.length} times`;
  return `${who ?? "You"} ${did} ${dish} ${times}. Should I stop planning it?`;
}

/** The rule to propose for the first of these dishes turned down PROPOSE_AFTER times or more (and not already kept out of the
 *  plan), as the answer's `proposed_rule`; the rows counted are marked so it is asked once. One question at a time. */
export function proposeRule(tx: Db, dishes: string[], by: string, changes: Change[]): { proposed_rule?: ProposedRule } {
  for (const dish of [...new Map(dishes.map((d) => [dishKey(d), d.trim()])).values()]) {
    if (listLibrary(tx, { names: [dish] }).some((r) => r.disliked)) continue;
    const rows = againstRows(tx, dish);
    if (rows.length < PROPOSE_AFTER) continue;
    const people = [...new Set(rows.map((r) => r.who?.trim()).filter((w): w is string => !!w))];
    const who = people.length === 1 && rows.every((r) => r.who) ? people[0] : null;
    for (const r of rows) {
      tx.update(plan_feedback).set({ proposed: 1, updated_at: new Date().toISOString(), updated_by: by }).where(eq(plan_feedback.id, r.id)).run();
      changes.push(["plan_feedback", r.id, "update", by]);
    }
    return { proposed_rule: { dish, times: rows.length, who, say: proposalSay(dish, rows, who), op: "rate_dishes",
      body: { ratings: [{ dish, rating: "didnt_work", again: false, ...(who ? { said_by: who } : {}) }] } } };
  }
  return {};
}
