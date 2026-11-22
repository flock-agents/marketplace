// The dish book: what the family knows about a dish, kept by its name across weeks. A dish's video (a link the agent found or
// the family saved: YouTube, an Instagram reel, any page; never a file) belongs to the dish, so it shows wherever the dish is
// planned again, in any week. How a dish went (good, okay, didn't work, and what went well or didn't) is kept the same way:
// the latest with a short history. The Week page and the messages show the note the next time the dish is planned, and the
// week's context lists every dish known, so a plan makes the ones that did not work rarely. The agent writes it with
// set_dish_video and rate_dishes, and reads one dish with get_dish.
import type { Hono } from "hono";
import { asc, desc, eq, inArray, sql } from "drizzle-orm";
import { dish_book, dishes, people } from "./db/schema";
import { DISH_RATINGS, RATINGS_KEPT, SLOTS, type DishRating } from "./db/constants";
import { todayStr } from "./dates";
import { dishKey, type LastTime } from "./dishText";
import { youtubeThumb } from "./messages";
import { getHouse, houseView, isObject, list, name, names, refuse, words, writeRoutes, type Db, type Emit } from "./family";
import { closest } from "./agentOps";

export type BookRow = typeof dish_book.$inferSelect;
export type DishVideo = { url: string; title: string | null; thumbnail: string | null };
export type DishRatingEntry = { rating: DishRating; note: string | null; date: string; by: string | null };
/** One dish as get_dish answers it. */
export type BookView = { name: string; video: DishVideo | null; rating: DishRating | null; note: string | null; rated_on: string | null;
  said_by: string | null; history: DishRatingEntry[] };
type Change = Parameters<Emit>;

const now = () => new Date().toISOString();

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

export const bookFor = (db: Db, dish: string): BookRow | null =>
  db.select().from(dish_book).where(eq(dish_book.key, dishKey(dish))).get() ?? null;

/** The book's rows of these dish names, by key. */
export function bookOf(db: Db, names: string[]): Map<string, BookRow> {
  const keys = [...new Set(names.map(dishKey))];
  if (!keys.length) return new Map();
  return new Map(db.select().from(dish_book).where(inArray(dish_book.key, keys)).all().map((r) => [r.key, r]));
}

export const videoOf = (r: BookRow | null | undefined): DishVideo | null =>
  r?.video_url ? { url: r.video_url, title: r.video_title, thumbnail: r.video_thumbnail } : null;
export const historyOf = (r: BookRow | null | undefined): DishRatingEntry[] => (r ? list<DishRatingEntry>(r.ratings) : []);
/** The latest rating of a dish, for a meal on `before` (a day): one given that same day or later is not "last time". */
export function lastTime(r: BookRow | null | undefined, before?: string): LastTime | null {
  if (!r?.rating || !r.rated_on || (before && r.rated_on >= before)) return null;
  return { rating: r.rating, note: r.rating_note, date: r.rated_on, by: r.rated_by };
}

export function bookView(r: BookRow | null, dish: string): BookView {
  return { name: r?.name ?? dish.trim(), video: videoOf(r), rating: (r?.rating as DishRating | null) ?? null, note: r?.rating_note ?? null,
    rated_on: r?.rated_on ?? null, said_by: r?.rated_by ?? null, history: historyOf(r) };
}

/** The dish's row, made when it is not there, named as the dish was last planned ("Rajma chawal" for "rajma chawal"). */
function bookRow(tx: Db, dish: string, by: string, changes: Change[]): BookRow {
  const had = bookFor(tx, dish);
  if (had) return had;
  const planned = tx.select({ name: dishes.name }).from(dishes).where(sql`lower(trim(${dishes.name})) = ${dishKey(dish)}`).orderBy(desc(dishes.created_at)).limit(1).get();
  const row = tx.insert(dish_book).values({ key: dishKey(dish), name: planned?.name.trim() ?? dish.trim(), updated_by: by }).returning().get();
  changes.push(["dish_book", row.id, "insert", by]);
  return row;
}

/** Give a dish its video, or take it away (null). The thumbnail, when none is given, is a YouTube link's own. A dish planned with
 *  a video_url gets it here too: the video is the dish's, so the next week it is planned in shows it. */
export function setVideo(tx: Db, dish: string, video: { url: string; title?: string | null; thumbnail?: string | null } | null, by: string, changes: Change[]): BookRow {
  const row = bookRow(tx, dish, by, changes);
  const same = !!video && row.video_url === video.url;
  const set = video
    ? { video_url: video.url,
        video_title: video.title !== undefined ? video.title : same ? row.video_title : null,
        video_thumbnail: video.thumbnail !== undefined ? video.thumbnail ?? youtubeThumb(video.url) : same ? row.video_thumbnail : youtubeThumb(video.url) }
    : { video_url: null, video_title: null, video_thumbnail: null };
  if (set.video_url === row.video_url && set.video_title === row.video_title && set.video_thumbnail === row.video_thumbnail) return row;
  const out = tx.update(dish_book).set({ ...set, updated_at: now(), updated_by: by }).where(eq(dish_book.id, row.id)).returning().get();
  changes.push(["dish_book", row.id, "update", by]);
  return out;
}

/** Keep how a dish went on a day. The same person rating the same dish on the same day again takes the place of the first;
 *  the newest day's rating is the dish's latest; at most RATINGS_KEPT are kept. */
export function rateDish(tx: Db, dish: string, r: DishRatingEntry, by: string, changes: Change[]): BookRow {
  const row = bookRow(tx, dish, by, changes);
  const who = (x: string | null) => (x ?? "").trim().toLowerCase();
  const history = [r, ...historyOf(row).filter((h) => !(h.date === r.date && who(h.by) === who(r.by)))]
    .map((h, n) => ({ h, n })).sort((a, b) => b.h.date.localeCompare(a.h.date) || a.n - b.n).map(({ h }) => h).slice(0, RATINGS_KEPT);
  const top = history[0];
  const out = tx.update(dish_book).set({ rating: top.rating, rating_note: top.note, rated_on: top.date, rated_by: top.by,
    ratings: JSON.stringify(history), updated_at: now(), updated_by: by }).where(eq(dish_book.id, row.id)).returning().get();
  changes.push(["dish_book", row.id, "update", by]);
  return out;
}

/** What a plan starts from about dishes: every dish with a rating or a video, the ones that did not work first. */
export function knownDishes(db: Db, max = 60): { dish: string; rating: DishRating | null; note: string | null; rated_on: string | null; video_url: string | null }[] {
  const rank = (r: BookRow) => (r.rating === "didnt_work" ? 0 : r.rating ? 1 : 2);
  return db.select().from(dish_book).orderBy(asc(dish_book.name)).all().filter((r) => r.rating || r.video_url)
    .sort((a, b) => rank(a) - rank(b)).slice(0, max)
    .map((r) => ({ dish: r.name, rating: (r.rating as DishRating | null) ?? null, note: r.rating_note, rated_on: r.rated_on, video_url: r.video_url }));
}

/** The family's own dishes (from the interview: what each person ate over the past week), by meal: what a week is planned from.
 *  `for` is left out when everyone eats it. */
export function familyDishes(db: Db): Record<string, { dish: string; for?: string[]; rating?: DishRating }[]> {
  const out: Record<string, { dish: string; for?: string[]; rating?: DishRating }[]> = {};
  for (const r of db.select().from(dish_book).orderBy(asc(dish_book.name)).all()) {
    const who = list<string>(r.eaten_by);
    for (const slot of list<string>(r.slots)) (out[slot] ??= []).push({ dish: r.name, ...(who.length ? { for: who } : {}), ...(r.rating ? { rating: r.rating as DishRating } : {}) });
  }
  return out;
}

/** The dish an op names: `dish` (its name, as planned) or `dish_id` (a planned dish, whose name it takes). */
function dishName(db: Db, b: Record<string, unknown>, what = ""): string {
  if (b.dish_id != null) {
    const row = db.select({ name: dishes.name }).from(dishes).where(eq(dishes.id, String(b.dish_id))).get();
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

  // set_family_dishes { dishes: [{ name, slots, for?, remove? }] }: the family's own dishes, from the interview's answers about
  // the past week ("idli, dosa, pongal for breakfast"; "Agastya's tiffin: paratha, poha"), each with the meals it is eaten at
  // and who eats it (left out: everyone). A week is planned from them. A dish sent again takes the meals and eaters sent.
  write("/api/dish-book/family", (b, by) => {
    const shape = "dishes must be a list of { name, slots: [the meals it is eaten at], for?: [names on the Family page], remove?: true }";
    if (!Array.isArray(b.dishes) || !b.dishes.length) refuse(shape);
    const h = houseView(getHouse(db));
    const slotNames = [...SLOTS, ...h.extra_slots.map((x) => x.name)];
    const family = db.select({ name: people.name }).from(people).where(eq(people.active, 1)).all().map((p) => p.name);
    const sent = (b.dishes as unknown[]).map((d) => {
      if (!isObject(d)) return refuse(shape);
      const dish = name(d.name, "a dish's name");
      if (d.remove === true) return { dish, remove: true as const };
      const slots = names(d.slots, `${dish}: slots`).map((s) => slotNames.find((x) => x.toLowerCase() === s.toLowerCase())
        ?? refuse(`${dish}: slots: ${JSON.stringify(s)} is not a meal (${slotNames.join(", ")})${closest(s, slotNames) ? `; did you mean ${closest(s, slotNames)}?` : ""}`));
      if (!slots.length) refuse(`${dish}: slots must name at least one meal (${slotNames.join(", ")})`);
      const who = d.for == null ? [] : names(d.for, `${dish}: for`).filter((w) => w.toLowerCase() !== "everyone").map((w) => family.find((p) => p.toLowerCase() === w.toLowerCase())
        ?? refuse(`${dish}: for: ${JSON.stringify(w)} is not on the Family page${closest(w, family) ? ` (did you mean ${closest(w, family)}?)` : ""}`));
      return { dish, slots: [...new Set(slots)], who };
    });
    commit((tx, ch) => {
      for (const s of sent) {
        if ("remove" in s) {
          const had = bookFor(tx, s.dish);
          if (had) { tx.update(dish_book).set({ slots: null, eaten_by: null, updated_at: now(), updated_by: by }).where(eq(dish_book.id, had.id)).run(); ch.push(["dish_book", had.id, "update", by]); }
          continue;
        }
        const row = bookRow(tx, s.dish, by, ch);
        tx.update(dish_book).set({ slots: JSON.stringify(s.slots), eaten_by: s.who.length ? JSON.stringify(s.who) : null, updated_at: now(), updated_by: by }).where(eq(dish_book.id, row.id)).run();
        ch.push(["dish_book", row.id, "update", by]);
      }
    });
    return { body: { family_dishes: familyDishes(db) } };
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
