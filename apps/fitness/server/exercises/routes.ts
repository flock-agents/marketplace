// GET /api/exercises: the library, preloaded and added, with links and pictures.
// POST /api/exercises {name, notes?, gifUrl?}: add one; the app downloads the picture itself. DELETE /api/exercises/:slug removes an added one.
// GET /api/exercises/media/:file: an added exercise's downloaded picture.
// GET /api/plan?date=: the day's workout plan, linked to the library, with a message to share. PUT /api/plan sets the whole day.
import { Hono, type Context } from "hono";
import { existsSync, readFileSync } from "fs";
import { basename, join } from "path";
import { localDate } from "../time/dates";
import { appUrl } from "../profile/app-url";
import { EXERCISES } from "./library";
import { library, linkedAdded, parseItems, planItems, shareText, slugOf } from "./plan";
import { downloadMedia, MEDIA_TYPES, type Fetch } from "./download";
import { mediaDir, saveMedia, type ExerciseStore } from "./added";
import type { PlanStore } from "./store";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const PLAN_EXAMPLE = `{"date": "2026-10-22", "items": [{"name": "Elliptical", "dose": "20 min"}, {"name": "Goblet squat", "dose": "3x12", "exercise": "goblet-squat"}]}`;
const ADD_EXAMPLE = `{"name": "Cable face pull", "notes": "Rear delts and upper back; elbows high", "gifUrl": "https://…/face-pull.gif"}`;
const TYPE_OF_EXT = Object.fromEntries(Object.entries(MEDIA_TYPES).map(([t, e]) => [e, t]));

export interface ExerciseDeps { plans: PlanStore; added: ExerciseStore; dataDir: string; fetchImpl?: Fetch }

export function exerciseRoutes({ plans, added, dataDir, fetchImpl }: ExerciseDeps) {
  const routes = new Hono();
  const base = (c: Context) => appUrl({ get: (n) => c.req.header(n) }, c.req.url);
  const view = (day: string, b: string) => {
    const items = planItems(plans.rows(day), b, added.all());
    return { date: day, items, share: shareText(day, items) };
  };
  const addedView = (b: string) => added.all().map((e) => ({ notes: e.notes, source: "added" as const, gifUrl: e.gif_url, addedBy: e.added_by, addedAt: e.added_at, ...linkedAdded(e, b) }));

  routes.get("/exercises", (c) => c.json({ exercises: [...library(base(c)).map((e) => ({ ...e, source: "preloaded" as const })), ...addedView(base(c))] }));

  routes.post("/exercises", async (c) => {
    const body = await c.req.json().catch(() => null);
    const name = typeof body?.name === "string" ? body.name.trim() : "";
    const slug = slugOf(name);
    if (!slug) return c.json({ error: `Send the exercise, e.g. ${ADD_EXAMPLE} (gifUrl optional)` }, 400);
    const gifUrl = typeof body?.gifUrl === "string" && body.gifUrl.trim() ? body.gifUrl.trim() : null;
    const existing = EXERCISES.find((e) => e.slug === slug) ? { slug, name, source: "preloaded" } : added.find(slug);
    if (existing) return c.json({ exists: true, exercise: existing }, 200);   // dedupe by slug: reuse it in the plan
    let file: string | null = null;
    if (gifUrl) {
      const got = await downloadMedia(gifUrl, fetchImpl);
      if (!got.ok) return c.json({ error: `${got.error}. Find another picture, or add the exercise without gifUrl.` }, 422);
      file = `${slug}.${got.ext}`;
      saveMedia(dataDir, file, got.bytes);
    }
    const notes = typeof body?.notes === "string" && body.notes.trim() ? body.notes.trim() : null;
    const row = await added.add({ slug, name, notes, gifUrl, file, addedBy: "agent" });
    return c.json({ exercise: { ...row, ...linkedAdded(row, base(c)) } }, 201);
  });

  routes.delete("/exercises/:slug", async (c) => {
    const slug = c.req.param("slug");
    if (EXERCISES.some((e) => e.slug === slug)) return c.json({ error: "A preloaded exercise cannot be removed" }, 400);
    return (await added.remove(slug)) ? c.json({ removed: slug }) : c.json({ error: "No such added exercise" }, 404);
  });

  routes.get("/exercises/media/:file", (c) => {
    const file = basename(c.req.param("file"));
    const path = join(mediaDir(dataDir), file);
    const type = TYPE_OF_EXT[file.split(".").pop() ?? ""];
    if (!type || !existsSync(path)) return c.json({ error: "No such picture" }, 404);
    return c.body(readFileSync(path), 200, { "Content-Type": type, "Cache-Control": "public, max-age=86400" });
  });

  routes.get("/plan", (c) => {
    const day = c.req.query("date") ?? localDate(new Date());
    return DATE.test(day) ? c.json(view(day, base(c))) : c.json({ error: "date must be YYYY-MM-DD" }, 400);
  });
  routes.put("/plan", async (c) => {
    const body = await c.req.json().catch(() => null);
    const day = (body?.date as string | undefined) ?? localDate(new Date());
    const items = parseItems(body);
    if (!DATE.test(day) || !items) return c.json({ error: `Send the day's whole plan, e.g. ${PLAN_EXAMPLE}` }, 400);
    await plans.replace(day, items);
    return c.json(view(day, base(c)));
  });
  return routes;
}
