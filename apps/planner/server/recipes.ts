// Saved recipes: a name, one or more video links (an Instagram reel, a YouTube short, any link), where the first is from, a
// thumbnail when a link gives one, notes, ingredients, tags and who it is for. The agent saves one with save_recipe when the
// family shares a link and says "save this".
import type { Hono } from "hono";
import { asc, eq } from "drizzle-orm";
import { saved_recipes } from "./db/schema";
import { isObject, list, name, names, refuse, words, writeRoutes, type Db, type Emit } from "./family";
import { hostOf, linkSource, youtubeId, youtubeThumb } from "./messages";

type RecipeRow = typeof saved_recipes.$inferSelect;
export type RecipeIngredient = { item: string; amount: number | null; unit: string | null };
/** A recipe with its lists read: what the route answers with. */
export type RecipeView = Omit<RecipeRow, "links" | "ingredients" | "tags" | "for_people"> &
  { links: string[]; ingredients: RecipeIngredient[]; tags: string[]; for_people: string[] };

export function recipeView(r: RecipeRow): RecipeView {
  return { ...r, links: list(r.links), ingredients: list(r.ingredients), tags: list(r.tags), for_people: list(r.for_people) };
}

/** What makes two links the same video or page: a YouTube video by its id, however it is addressed; anything else by its
 *  site and path, without the tracking a share adds after "?". */
export function linkKey(link: string): string {
  const id = youtubeId(link);
  if (id) return `youtube:${id}`;
  try { const u = new URL(link.trim()); return `${hostOf(u)}${u.pathname.replace(/\/+$/, "")}`; } catch { return link.trim().toLowerCase(); }
}

const thumbOf = (links: string[]): string | null => links.map(youtubeThumb).find((t) => t) ?? null;

function ingredientsOf(v: unknown): RecipeIngredient[] {
  const shape = "ingredients must be a list of { item, amount?, unit? }";
  if (!Array.isArray(v)) return refuse(shape);
  return v.map((i) => {
    if (!isObject(i)) return refuse(shape);
    const item = name(i.item, "an ingredient's item");
    const amount = i.amount == null ? null : typeof i.amount === "number" && Number.isFinite(i.amount) && i.amount > 0 ? i.amount
      : refuse(`the amount of ${item} must be a number above 0 (put the measure in unit)`);
    return { item, amount, unit: i.unit === undefined ? null : words(i.unit, `the unit of ${item}`) };
  });
}

export function mountRecipeRoutes(hono: Hono<any>, db: Db, emit: Emit) {
  const write = writeRoutes(hono);

  // save_recipe { recipe_id?, name?, links?, notes?, ingredients?, tags?, for?, thumbnail? }. By recipe_id it is that recipe,
  // and links sent replace its links. Without one, a recipe already holding one of the links is the one changed (the links
  // it did not have are added), so a reel shared twice is saved once; otherwise a new recipe is made, which needs a name.
  // Only what is sent changes. The source is where the first link is from; the thumbnail, unless given, is a YouTube link's.
  write("/api/recipes/save", (b, by) => {
    const sent = b.links === undefined ? undefined : names(b.links, "links");
    let had: RecipeRow | undefined;
    if (b.recipe_id != null) {
      had = db.select().from(saved_recipes).where(eq(saved_recipes.id, String(b.recipe_id))).get();
      if (!had) return { status: 404, body: { reason: `no saved recipe has the id ${JSON.stringify(b.recipe_id)}` } };
    } else if (sent?.length) {
      const keys = new Set(sent.map(linkKey));
      had = db.select().from(saved_recipes).orderBy(asc(saved_recipes.created_at)).all().find((r) => list<string>(r.links).some((l) => keys.has(linkKey(l))));
    }
    const set: Partial<typeof saved_recipes.$inferInsert> = {};
    if (b.name !== undefined || !had) {
      set.name = typeof b.name === "string" && b.name.trim() ? b.name.trim()
        : refuse("this recipe has no name yet: ask the family what to call it, then save it again with name", "NEEDS_NAME");
    }
    if (b.notes !== undefined) set.notes = words(b.notes, "notes");
    if (b.ingredients !== undefined) set.ingredients = JSON.stringify(ingredientsOf(b.ingredients));
    if (b.tags !== undefined) set.tags = JSON.stringify(names(b.tags, "tags"));
    if (b.for !== undefined) set.for_people = JSON.stringify(b.for === null ? [] : names(b.for, "for"));
    const old = had ? list<string>(had.links) : [];
    if (sent) {
      const held = new Set(old.map(linkKey));
      const links = had && b.recipe_id == null ? [...old, ...sent.filter((l) => !held.has(linkKey(l)))] : sent;
      set.links = JSON.stringify(links);
      set.source = links.length ? linkSource(links[0]) : null;
      // A thumbnail the family gave stays; one that came from a link follows the links.
      if (!had?.thumbnail || had.thumbnail === thumbOf(old)) set.thumbnail = thumbOf(links);
    }
    if (b.thumbnail !== undefined) set.thumbnail = words(b.thumbnail, "thumbnail") ?? thumbOf(sent ? list<string>(set.links!) : old);
    const row = had
      ? db.update(saved_recipes).set({ ...set, updated_at: new Date().toISOString(), updated_by: by }).where(eq(saved_recipes.id, had.id)).returning().get()
      : db.insert(saved_recipes).values({ ...set, name: set.name!, updated_by: by }).returning().get();
    emit("saved_recipes", row.id, had ? "update" : "insert", by);
    return { body: { recipe: recipeView(row) } };
  });
}
