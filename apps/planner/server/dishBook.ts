// The dish book: what the family knows about a dish, kept by its name across weeks, on the dish's library rows (one per slot
// it is eaten at; slotStore.ts). A dish's video (a link the agent found or the family saved: YouTube, an Instagram reel, any
// page; never a file) and how it went (good, okay, didn't work, and what went well or didn't, the latest with a short
// history) belong to the dish, so every one of its rows carries them and they show wherever it is planned again. The agent
// writes them with set_dish_video and rate_dishes, and reads one dish with get_dish.
import type { Hono } from "hono";
import { desc, eq, sql } from "drizzle-orm";
import { slot_days, slot_dishes } from "./db/schema";
import { DISH_RATINGS, RATINGS_KEPT, type DishRating } from "./db/constants";
import { todayStr } from "./dates";
import { dishKey, type LastTime } from "./dishText";
import { youtubeThumb } from "./messages";
import { isObject, name, refuse, words, writeRoutes, type Db, type Emit } from "./family";
import { listLibrary, updateLibraryByName, upsertLibrary, type LibraryDish } from "./slotStore";

/** What the book reads of a dish: its video and ratings, the same on each of its library rows. */
export type BookRow = Pick<LibraryDish, "name" | "video_url" | "video_title" | "video_thumbnail" | "rating" | "rating_note" | "rated_on" | "rated_by" | "ratings">;
export type DishVideo = { url: string; title: string | null; thumbnail: string | null };
export type DishRatingEntry = { rating: DishRating; note: string | null; date: string; by: string | null };
/** One dish as get_dish answers it. */
export type BookView = { name: string; video: DishVideo | null; rating: DishRating | null; note: string | null; rated_on: string | null;
  said_by: string | null; history: DishRatingEntry[] };
type Change = Parameters<Emit>;

/** A link: http or https only. */
export const linkOf = (v: unknown, what: string): string => {
  const s = typeof v === "string" ? v.trim() : "";
  return /^https?:\/\/[^\s]+$/i.test(s) ? s : refuse(`${what} must be a link starting with https://`);
};

/** A rating however it is written ("didn't work", "OK", "bad"), as one of DISH_RATINGS. */
const RATING_WORDS: Record<string, DishRating> = { good: "good", great: "good", loved: "good", loved_it: "good", nice: "good",
  okay: "okay", ok: "okay", fine: "okay", average: "okay", so_so: "okay",
  didnt_work: "didnt_work", did_not_work: "didnt_work", bad: "didnt_work", not_good: "didnt_work", didnt_like: "didnt_work" };
export const ratingOf = (v: unknown, what = "rating"): DishRating => {
  const word = typeof v === "string" ? v.trim().toLowerCase().replace(/['’]/g, "").replace(/[\s-]+/g, "_") : "";
  return RATING_WORDS[word] ?? refuse(`${what} must be one of: ${DISH_RATINGS.join(", ")} (good, okay, or didn't work)`);
};

/** A dish's rows merged into one: the video of a row that has one, the newest rating of any. */
function merged(rows: LibraryDish[]): BookRow | null {
  if (!rows.length) return null;
  const video = rows.find((r) => r.video_url) ?? rows[0];
  const rated = [...rows].filter((r) => r.rated_on).sort((a, b) => b.rated_on!.localeCompare(a.rated_on!))[0] ?? rows[0];
  return { name: rows[0].name, video_url: video.video_url, video_title: video.video_title, video_thumbnail: video.video_thumbnail,
    rating: rated.rating, rating_note: rated.rating_note, rated_on: rated.rated_on, rated_by: rated.rated_by, ratings: rated.ratings };
}

export const bookFor = (db: Db, dish: string): BookRow | null => merged(listLibrary(db, { names: [dish] }));

/** The book's view of these dish names, by key. */
export function bookOf(db: Db, names: string[]): Map<string, BookRow> {
  const byKey = new Map<string, LibraryDish[]>();
  for (const r of listLibrary(db, { names })) byKey.set(r.key, [...(byKey.get(r.key) ?? []), r]);
  return new Map([...byKey].map(([k, rows]) => [k, merged(rows)!]));
}

export const videoOf = (r: BookRow | null | undefined): DishVideo | null =>
  r?.video_url ? { url: r.video_url, title: r.video_title, thumbnail: r.video_thumbnail } : null;
export const historyOf = (r: BookRow | null | undefined): DishRatingEntry[] => (r ? (r.ratings as DishRatingEntry[]) : []);
/** The latest rating of a dish, for a meal on `before` (a day): one given that same day or later is not "last time". */
export function lastTime(r: BookRow | null | undefined, before?: string): LastTime | null {
  if (!r?.rating || !r.rated_on || (before && r.rated_on >= before)) return null;
  return { rating: r.rating, note: r.rating_note, date: r.rated_on, by: r.rated_by };
}

export function bookView(r: BookRow | null, dish: string): BookView {
  return { name: r?.name ?? dish.trim(), video: videoOf(r), rating: (r?.rating as DishRating | null) ?? null, note: r?.rating_note ?? null,
    rated_on: r?.rated_on ?? null, said_by: r?.rated_by ?? null, history: historyOf(r) };
}

/** The dish's rows, one made when it has none: at the slot it was last planned at, named as it was planned. A dish never
 *  planned and not in the library is refused (add_dish puts a new one in the library). */
function bookRows(tx: Db, dish: string, by: string, changes: Change[]): BookRow {
  const had = bookFor(tx, dish);
  if (had) return had;
  const planned = tx.select({ dish: slot_dishes.dish, slot: slot_days.slot }).from(slot_dishes).innerJoin(slot_days, eq(slot_dishes.slot_day_id, slot_days.id))
    .where(sql`lower(trim(${slot_dishes.dish})) = ${dishKey(dish)}`).orderBy(desc(slot_dishes.created_at)).limit(1).get();
  if (!planned) return refuse(`${dish.trim()} is not one of the family's dishes and was never planned`);
  return upsertLibrary(tx, { name: planned.dish, slot: planned.slot, origin: "family_added" }, by, changes);
}

/** Give a dish its video, or take it away (null). The thumbnail, when none is given, is a YouTube link's own. A dish planned with
 *  a video_url gets it here too: the video is the dish's, so the next week it is planned in shows it. */
export function setVideo(tx: Db, dish: string, video: { url: string; title?: string | null; thumbnail?: string | null } | null, by: string, changes: Change[]): BookRow {
  const row = bookRows(tx, dish, by, changes);
  const same = !!video && row.video_url === video.url;
  const set = video
    ? { video_url: video.url,
        video_title: video.title !== undefined ? video.title : same ? row.video_title : null,
        video_thumbnail: video.thumbnail !== undefined ? video.thumbnail ?? youtubeThumb(video.url) : same ? row.video_thumbnail : youtubeThumb(video.url) }
    : { video_url: null, video_title: null, video_thumbnail: null };
  if (set.video_url === row.video_url && set.video_title === row.video_title && set.video_thumbnail === row.video_thumbnail) return row;
  return merged(updateLibraryByName(tx, dish, set, by, changes))!;
}

/** Keep how a dish went on a day. The same person rating the same dish on the same day again takes the place of the first;
 *  the newest day's rating is the dish's latest; at most RATINGS_KEPT are kept. */
export function rateDish(tx: Db, dish: string, r: DishRatingEntry, by: string, changes: Change[]): BookRow {
  const row = bookRows(tx, dish, by, changes);
  const who = (x: string | null) => (x ?? "").trim().toLowerCase();
  const history = [r, ...historyOf(row).filter((h) => !(h.date === r.date && who(h.by) === who(r.by)))]
    .map((h, n) => ({ h, n })).sort((a, b) => b.h.date.localeCompare(a.h.date) || a.n - b.n).map(({ h }) => h).slice(0, RATINGS_KEPT);
  const top = history[0];
  return merged(updateLibraryByName(tx, dish, { rating: top.rating, rating_note: top.note, rated_on: top.date, rated_by: top.by,
    ratings: JSON.stringify(history) }, by, changes))!;
}

/** The dish an op names: `dish` (its name, as planned) or `dish_id` (a planned dish, whose name it takes). */
function dishName(db: Db, b: Record<string, unknown>, what = ""): string {
  if (b.dish_id != null) {
    const row = db.select({ name: slot_dishes.dish }).from(slot_dishes).where(eq(slot_dishes.id, String(b.dish_id))).get();
    return row ? row.name : refuse(`${what}no planned dish has the id ${JSON.stringify(b.dish_id)}`);
  }
  return name(b.dish, `${what}dish (the dish's name, as planned)`);
}

export function mountDishBookRoutes(hono: Hono<any>, db: Db, emit: Emit, opts: { now?: () => Date } = {}) {
  const write = writeRoutes(hono);
  const today = () => todayStr((opts.now ?? (() => new Date()))());
  const commit = <T>(run: (tx: Db, changes: Change[]) => T): T => {
    const changes: Change[] = [];
    const out = db.transaction((tx) => run(tx as unknown as Db, changes));
    for (const c of changes) emit(...c);
    return out;
  };

  // get_dish { dish }: what the app knows of one dish (its video, how it went), by its name; a dish it knows nothing of
  // answers empty.
  hono.get("/api/dish-book", (c) => {
    const dish = (c.req.query("dish") ?? "").trim();
    if (!dish) return c.json({ ok: false, reason: "dish is required: the dish's name, as planned" }, 400);
    return c.json({ dish: bookView(bookFor(db, dish), dish) });
  });

  // set_dish_video { dish | dish_id, url, title?, thumbnail?, remove? }: the dish's one video, a link only.
  write("/api/dish-book/video", (b, by) => {
    const dish = dishName(db, b);
    if (b.remove === true) {
      if (!bookFor(db, dish)?.video_url) return { status: 404, body: { reason: `${dish} has no video` } };
      const row = commit((tx, ch) => setVideo(tx, dish, null, by, ch));
      return { body: { dish: bookView(row, dish) } };
    }
    const url = linkOf(b.url, "url");
    const title = b.title === undefined ? undefined : words(b.title, "title");
    const thumbnail = b.thumbnail === undefined || b.thumbnail === null ? b.thumbnail as undefined | null : linkOf(b.thumbnail, "thumbnail");
    const row = commit((tx, ch) => setVideo(tx, dish, { url, title, thumbnail }, by, ch));
    return { body: { dish: bookView(row, dish) } };
  });

  // rate_dishes { date?, ratings: [{ dish | dish_id, rating, note?, said_by? }] }: how each dish went on a day (today unless
  // given), all in one call.
  write("/api/dish-book/ratings", (b, by) => {
    const shape = "ratings must be a list of { dish, rating: good | okay | didnt_work, note?, said_by? }";
    if (!Array.isArray(b.ratings) || !b.ratings.length) refuse(shape);
    const date = b.date == null ? today() : typeof b.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(b.date) ? b.date : refuse("date must be a date as YYYY-MM-DD");
    if (date > today()) refuse(`date ${date} is after today: rate a dish once it is eaten`);
    const sent = (b.ratings as unknown[]).map((r, n) => {
      if (!isObject(r)) return refuse(shape);
      const dish = dishName(db, r, `ratings[${n}]: `);
      return { dish, entry: { rating: ratingOf(r.rating, `${dish}: rating`), note: r.note === undefined ? null : words(r.note, `${dish}: note`),
        date, by: r.said_by == null ? null : words(r.said_by, `${dish}: said_by`) } };
    });
    const rows = commit((tx, ch) => sent.map((s) => rateDish(tx, s.dish, s.entry, by, ch)));
    return { body: { dishes: rows.map((r) => bookView(r, r.name)) } };
  });
}
