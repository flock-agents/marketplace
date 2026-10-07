import type { StepState } from "./plan-report";
import { kindSpec } from "./kinds";

/** A step row from `tasks.list`. `skipped` and `closedAt` come from newer Flock; `updatedAt` is read only as a fallback. */
export type TallyRow = StepState & { skipped?: true; closedAt?: number; updatedAt?: number };
export type KindState = "on" | "off" | "none";

/**
 * The state the planner shows and the validator enforces: a card's answer is the owner's stated preference and beats the
 * tally (yes reads on, no reads off); a kind with no answer keeps its tallied state.
 */
export function withAnswers(tallied: ReadonlyMap<string, { state: KindState }>, said: ReadonlyMap<string, "yes" | "no">): Map<string, KindState> {
  const out = new Map<string, KindState>();
  for (const [kind, v] of tallied) out.set(kind, v.state);
  for (const [kind, a] of said) out.set(kind, a === "yes" ? "on" : "off");
  return out;
}

export const TALLY_WINDOW_MS = 90 * 86400_000, TALLY_PER_KIND = 10;

/**
 * How the owner closed past steps of each kind: done counts as done, "Not important" as a skip; withdrawn, covered,
 * other dismissals and open rows count nothing. Only closes inside the window count, the newest 10 per kind.
 * `off` when the two newest counted closes are skips, `on` when the newest is a done, else `none`.
 * Judgement kinds are recorded, never tallied. Pure: `covered` holds the sourceRefs of steps recorded as covered by an existing TODO.
 */
export function tally(rows: TallyRow[], kinds: Map<string, string>, now: number, covered: ReadonlySet<string> = new Set()): Map<string, { state: KindState; done: number; skips: number }> {
  const byKind = new Map<string, { at: number; skip: boolean }[]>();
  for (const r of rows) {
    const kind = kinds.get(r.sourceRef);
    if (!kind || kindSpec(kind)?.tier === "judgement" || r.withdrawn || covered.has(r.sourceRef)) continue;
    let skip: boolean;
    let at: number | undefined;
    if (r.status === "done") { skip = false; at = r.closedAt ?? r.updatedAt; }
    else if (r.status === "dismissed" && r.skipped) { skip = true; at = r.closedAt; }
    else continue;
    if (at == null || now - at > TALLY_WINDOW_MS) continue;
    (byKind.get(kind) ?? byKind.set(kind, []).get(kind)!).push({ at, skip });
  }
  const out = new Map<string, { state: KindState; done: number; skips: number }>();
  for (const [kind, list] of byKind) {
    const newest = list.sort((a, b) => b.at - a.at || Number(a.skip) - Number(b.skip)).slice(0, TALLY_PER_KIND);
    const skips = newest.filter((c) => c.skip).length;
    const state: KindState = newest.length >= 2 && newest[0].skip && newest[1].skip ? "off" : !newest[0].skip ? "on" : "none";
    out.set(kind, { state, done: newest.length - skips, skips });
  }
  return out;
}
