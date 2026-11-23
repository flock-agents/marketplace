// The day/count lint of slot-model spec §4.2: a library dish whose quote names a day or a number, saved with neither a
// frequency nor days, is read once more ("lemon rice on Friday", "rajma twice a week" said, nothing saved). Pure; no model.
//
// This is the planner's one allowlisted word file for day and count words (server/evalGuards.test.ts): setup and plan code
// import from here instead of writing their own word lists.

/** Day words: weekday names and their short forms, and the words for a set of days. */
export const DAY_WORDS = /\b(?:mon(?:day)?|tue(?:s(?:day)?)?|wed(?:nesday)?|thu(?:rs(?:day)?)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)s?\b|\b(?:week ?ends?|week ?days?|daily|every ?day|alternate days?)\b/i;
/** Count words: a number (not a clock time), a number word, once / twice / thrice. */
export const COUNT_WORDS = /(?<![\d:])\b\d+\b(?!:\d)|\b(?:one|two|three|four|five|six|seven|once|twice|thrice)\b/i;

export type LintDish = { name?: string; quote?: string | null; frequency?: string | null; days?: readonly string[] | null };

/** What in a quote says a day or a count: the words found (empty when none). */
export function dayOrCount(quote: string | null | undefined): { days: string[]; counts: string[] } {
  const q = quote ?? "";
  const all = (re: RegExp) => [...q.matchAll(new RegExp(re.source, "gi"))].map((m) => m[0]);
  return { days: all(DAY_WORDS), counts: all(COUNT_WORDS) };
}

/** spec §4.2: true when the dish's quote names a day or a number but nothing was saved for it (no frequency, no days). */
export function needsReread(d: LintDish): boolean {
  const saved = !!d.frequency || !!d.days?.length;
  if (saved) return false;
  const f = dayOrCount(d.quote);
  return f.days.length > 0 || f.counts.length > 0;
}

/** The dishes of a library read that need their one re-read. */
export const lintLibrary = <T extends LintDish>(dishes: readonly T[]): T[] => dishes.filter(needsReread);
