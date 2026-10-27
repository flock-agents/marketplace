// Plain code over the library: a day's plan rows as the page and the coach read them, and the message the coach shares.
import { EXERCISES, findExercise, imagePath, libraryPath, type Exercise } from "./library";

export interface PlanRow { id: string; name: string; dose: string | null; done: boolean | number | null; position: number | null; exercise?: string | null }
/** An exercise the coach added (the `exercises` table); `file` is its downloaded picture, null when none was found. */
export interface AddedExercise { slug: string; name: string; notes: string | null; file: string | null; credit?: string | null }
export interface LinkedExercise { slug: string; name: string; link: string; image: string }
export interface PlanItem { id: string; name: string; dose: string | null; done: boolean; exercise: LinkedExercise | null }
export interface PlanInput { name: string; dose?: string | null; exercise?: string | null }

/** An exercise as a shareable link and picture, both absolute when `base` is the app's own address. */
export const linked = (e: Pick<Exercise, "slug" | "name">, base: string): LinkedExercise =>
  ({ slug: e.slug, name: e.name, link: base + libraryPath(e.slug), image: base + imagePath(e.slug) });
/** Where an added exercise's downloaded picture is served, relative to the app. */
export const mediaPath = (file: string) => `api/exercises/media/${encodeURIComponent(file)}`;
/** An added exercise as a link and picture (no picture when none was found). */
export const linkedAdded = (e: AddedExercise, base: string): LinkedExercise =>
  ({ slug: e.slug, name: e.name, link: base + libraryPath(e.slug), image: e.file ? base + mediaPath(e.file) : "" });
/** A name as a slug: "Cable face-pull (rope)" → "cable-face-pull-rope". */
export const slugOf = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/** The exercise a plan row means: its `exercise` slug, else the preloaded pattern its name matches, else an added one of the same name. */
function exerciseFor(r: Pick<PlanRow, "name" | "exercise">, base: string, added: readonly AddedExercise[]): LinkedExercise | null {
  const bySlug = (slug: string) => {
    const pre = EXERCISES.find((e) => e.slug === slug);
    if (pre) return linked(pre, base);
    const own = added.find((e) => e.slug === slug);
    return own ? linkedAdded(own, base) : null;
  };
  if (r.exercise) { const hit = bySlug(r.exercise); if (hit) return hit; }
  const pre = findExercise(r.name);
  if (pre) return linked(pre, base);
  const own = added.find((e) => e.slug === slugOf(r.name));
  return own ? linkedAdded(own, base) : null;
}

/** The library, each exercise with its link and picture. */
export const library = (base: string) => EXERCISES.map(({ match: _m, ...e }) => ({ ...e, ...linked(e, base) }));

/** A day's rows in plan order, each linked to its library exercise when it names one. */
export function planItems(rows: PlanRow[], base: string, added: readonly AddedExercise[] = []): PlanItem[] {
  return [...rows]
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
    .map((r) => {
      return { id: r.id, name: r.name, dose: r.dose, done: !!r.done, exercise: exerciseFor(r, base, added) };
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
  const clean = items.map((it) => ({
    name: String(it?.name ?? "").trim(), dose: it?.dose == null ? null : String(it.dose).trim() || null,
    exercise: it?.exercise == null ? null : slugOf(String(it.exercise)) || null,
  }));
  return clean.every((it) => it.name) ? clean : null;
}
