// A dish in one line, as the messages and the pages write it. No imports: the pages read this file too.

/** "Boiled eggs (4 for me, 1 for wife)": the portions when they are noted, else who it is for ("Parathas (for Dad)"), else
 *  the name alone (a dish for everyone). */
export function dishText(d: { name: string; for_people?: string[] | null; portion_note?: string | null }): string {
  const note = d.portion_note?.trim();
  if (note) return `${d.name} (${note})`;
  return d.for_people?.length ? `${d.name} (for ${d.for_people.join(", ")})` : d.name;
}

/** A dish's name as it is matched across meals and weeks: lowercase, trimmed, single spaces. */
export const dishKey = (name: string): string => name.trim().toLowerCase().replace(/\s+/g, " ");

/** How a dish went the last time it was eaten, as a planned dish carries it. */
export type LastTime = { rating: string; note: string | null; date: string; by: string | null };

/** What is said about a dish planned again: its note from last time ("too oily"), or "didn't work" when it had none and did
 *  not work; null when there is nothing to say (no rating, or a good or okay one without a note). */
export function lastTimeText(r: LastTime | null | undefined): string | null {
  if (!r) return null;
  const note = r.note?.trim();
  if (note) return note;
  return r.rating === "didnt_work" ? "didn't work" : null;
}
