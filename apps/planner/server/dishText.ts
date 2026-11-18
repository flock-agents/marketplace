// A dish in one line, as the messages and the pages write it. No imports: the pages read this file too.

/** "Boiled eggs (4 for me, 1 for wife)": the portions when they are noted, else who it is for ("Parathas (for Dad)"), else
 *  the name alone (a dish for everyone). */
export function dishText(d: { name: string; for_people?: string[] | null; portion_note?: string | null }): string {
  const note = d.portion_note?.trim();
  if (note) return `${d.name} (${note})`;
  return d.for_people?.length ? `${d.name} (for ${d.for_people.join(", ")})` : d.name;
}
