import { figure } from "../../format";

/** A share chart has 6 tones, so at most 6 slices: past that, the 5 largest stay and the rest are one "Other" slice.
 *  Pure, so the chat's block check (frame and server) folds the same way the chart does. */
export const MAX_SLICES = 6;
export function foldShare<T extends Record<string, unknown>>(data: T[], key: string): T[] {
  if (data.length <= MAX_SLICES) return data;
  const value = (d: T) => Math.max(0, figure(d[key]) ?? 0);
  const sorted = data.map((d, i) => ({ d, i })).sort((a, b) => value(b.d) - value(a.d) || a.i - b.i);
  const kept = sorted.slice(0, MAX_SLICES - 1).sort((a, b) => a.i - b.i).map((x) => x.d);
  const rest = sorted.slice(MAX_SLICES - 1).reduce((sum, x) => sum + value(x.d), 0);
  return [...kept, { label: "Other", [key]: Number(rest.toPrecision(12)) } as unknown as T];
}
