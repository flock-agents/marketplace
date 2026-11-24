// How the family closed past steps, per kind and per place: Calendar Desk's tally (apps/calendar-desk/server/tally.ts) as it is,
// read from Flock's list of the app's own tasks (`tasks.list`), with each step's kind and place from the app's `todos`.
import { kindSpec } from "./kinds";

/** A step row from `tasks.list`. `skipped` (the owner's "Not important") and `closedAt` come from newer Flock. */
export type TallyRow = { sourceRef: string; status: "open" | "done" | "dismissed"; withdrawn?: true; skipped?: true; closedAt?: number; updatedAt?: number };
export type KindState = "on" | "off" | "none";

export const TALLY_WINDOW_MS = 90 * 86400_000, TALLY_PER_KIND = 10;

/** `off` when the two newest counted closes of a kind are skips, `on` when the newest is a done, else `none`. Judgement kinds,
 *  withdrawn and covered steps count nothing; only closes in the last 90 days, the newest 10 per kind. */
export function tally(rows: TallyRow[], kinds: Map<string, string>, now: number, covered: ReadonlySet<string> = new Set()): Map<string, { state: KindState; done: number; skips: number }> {
  const byKind = new Map<string, { at: number; skip: boolean }[]>();
  for (const r of rows) {
    const kind = kinds.get(r.sourceRef);
    if (!kind || kindSpec(kind)?.tier === "judgement" || r.withdrawn || covered.has(r.sourceRef)) continue;
    let skip: boolean, at: number | undefined;
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
export type PlaceStates = Map<string, Map<string, "on" | "off">>;

/** The same per kind and place (a venue, or the person for a gift): a done counts for 365 days, a skip for 90. */
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

export const placeState = (t: PlaceStates, kind: string, place: string | null): KindState => (place ? t.get(kind)?.get(place) : undefined) ?? "none";
