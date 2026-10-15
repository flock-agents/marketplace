import type { StepState } from "./plan-report";
import { kindSpec } from "./kinds";

/** A step row from `tasks.list`. `skipped` and `closedAt` come from newer Flock; `updatedAt` is read only as a fallback. */
export type TallyRow = StepState & { skipped?: true; closedAt?: number; updatedAt?: number };
export type KindState = "on" | "off" | "none";

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

export const PLACE_DONE_WINDOW_MS = 365 * 86400_000;
/** Per kind, per place: "on" or "off"; a place with nothing counted, or "none", is left out. */
export type PlaceStates = Map<string, Map<string, "on" | "off">>;

/**
 * How the owner closed past steps of a kind at one place (a venue, or the person for a gift): a done counts for 365 days
 * (yearly birthdays, a clinic visited every few months), a "Not important" skip for 90. Withdrawn and covered steps, other
 * dismissals and open rows count nothing. `on` when the newest counted close there is a done; `off` when the two newest are
 * skips. Pure: `places` holds the steps that recorded a place, by sourceRef.
 */
export function placeTally(rows: TallyRow[], places: ReadonlyMap<string, { kind: string; place: string }>, now: number, covered: ReadonlySet<string> = new Set()): PlaceStates {
  const by = new Map<string, { kind: string; place: string; list: { at: number; skip: boolean }[] }>();
  for (const r of rows) {
    const p = places.get(r.sourceRef);
    if (!p || r.withdrawn || covered.has(r.sourceRef)) continue;
    let skip: boolean, at: number | undefined;
    if (r.status === "done") { skip = false; at = r.closedAt ?? r.updatedAt; }
    else if (r.status === "dismissed" && r.skipped) { skip = true; at = r.closedAt; }
    else continue;
    if (at == null || now - at > (skip ? TALLY_WINDOW_MS : PLACE_DONE_WINDOW_MS)) continue;
    const key = `${p.kind}\u0000${p.place}`;
    (by.get(key) ?? by.set(key, { kind: p.kind, place: p.place, list: [] }).get(key)!).list.push({ at, skip });
  }
  const out: PlaceStates = new Map();
  for (const { kind, place, list } of by.values()) {
    const newest = list.sort((a, b) => b.at - a.at || Number(a.skip) - Number(b.skip));
    const state = newest.length >= 2 && newest[0]!.skip && newest[1]!.skip ? "off" : !newest[0]!.skip ? "on" : null;
    if (state) (out.get(kind) ?? out.set(kind, new Map()).get(kind)!).set(place, state);
  }
  return out;
}

/** The owner's pattern for a kind at a place; "none" when nothing counted there or the event has no place. */
export function placeState(t: PlaceStates, kind: string, place: string | null): KindState {
  return (place ? t.get(kind)?.get(place) : undefined) ?? "none";
}
