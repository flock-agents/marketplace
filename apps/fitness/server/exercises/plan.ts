// Plain code over the library: a day's plan rows as the page and the coach read them, and the message the coach shares.
import { EXERCISES, findExercise, imagePath, libraryPath, type Exercise } from "./library";

export interface PlanRow { id: string; name: string; dose: string | null; done: boolean | number | null; position: number | null }
export interface LinkedExercise { slug: string; name: string; link: string; image: string }
export interface PlanItem { id: string; name: string; dose: string | null; done: boolean; exercise: LinkedExercise | null }
export interface PlanInput { name: string; dose?: string | null }

/** An exercise as a shareable link and picture, both absolute when `base` is the app's own address. */
export const linked = (e: Pick<Exercise, "slug" | "name">, base: string): LinkedExercise =>
  ({ slug: e.slug, name: e.name, link: base + libraryPath(e.slug), image: base + imagePath(e.slug) });

/** The library, each exercise with its link and picture. */
export const library = (base: string) => EXERCISES.map(({ match: _m, ...e }) => ({ ...e, ...linked(e, base) }));

/** A day's rows in plan order, each linked to its library exercise when it names one. */
export function planItems(rows: PlanRow[], base: string): PlanItem[] {
  return [...rows]
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
    .map((r) => {
      const e = findExercise(r.name);
      return { id: r.id, name: r.name, dose: r.dose, done: !!r.done, exercise: e ? linked(e, base) : null };
    });
}

/** The plan as a chat message: one numbered line per exercise, its name linked to the exact library entry. */
export function shareText(day: string, items: PlanItem[]): string {
  if (items.length === 0) return `No workout plan set for ${day}.`;
  const lines = items.map((it, i) => {
    const name = it.exercise ? `[${it.name}](${it.exercise.link})` : it.name;
    return `${i + 1}. ${name}${it.dose ? ` — ${it.dose}` : ""}`;
  });
  return [`Workout plan for ${day}:`, ...lines].join("\n");
}

/** A PUT body's items, cleaned: a name is required, the dose is optional text. Null when the body is not a list of items. */
export function parseItems(body: unknown): PlanInput[] | null {
  const items = (body as { items?: unknown } | null)?.items;
  if (!Array.isArray(items)) return null;
  const clean = items.map((it) => ({ name: String(it?.name ?? "").trim(), dose: it?.dose == null ? null : String(it.dose).trim() || null }));
  return clean.every((it) => it.name) ? clean : null;
}
