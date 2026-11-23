// A dish in one line, as the messages and the pages write it. No imports: the pages read this file too.

/** "Boiled eggs (4 for me, 1 for wife)": the portions when they are noted, else who it is for ("Parathas (for Dad)"), else
 *  the name alone (a dish for everyone: no one named, or `["everyone"]`). `not_for`: the people a rule keeps it from, said
 *  after the note ("Fish curry (not for Gita)"). */
export function dishText(d: { name: string; for_people?: string[] | null; portion_note?: string | null; not_for?: string[] | null }): string {
  const note = d.portion_note?.trim();
  const not = d.not_for?.length ? `not for ${d.not_for.length <= 1 ? d.not_for.join("") : `${d.not_for.slice(0, -1).join(", ")} and ${d.not_for[d.not_for.length - 1]}`}` : "";
  if (note || not) return `${d.name} (${[note, not].filter(Boolean).join("; ")})`;
  return d.for_people?.length && !forAll(d.for_people) ? `${d.name} (for ${d.for_people.join(", ")})` : d.name;
}

/** Does a dish's `for` say "everyone" (everyone who eats that meal)? */
export const forAll = (who: readonly string[] | null | undefined): boolean => !!who?.some((w) => w.trim().toLowerCase() === "everyone");

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
