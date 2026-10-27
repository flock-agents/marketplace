import { describe, it, expect } from "bun:test";
import { mkdtempSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { exerciseRoutes } from "./routes";
import { downloadMedia, MAX_BYTES, type Fetch } from "./download";
import type { AddedRow, ExerciseStore } from "./added";
import type { PlanStore } from "./store";
import type { PlanInput, PlanRow } from "./plan";

const GIF = new Uint8Array([71, 73, 70, 56, 57, 97, 1, 0, 1, 0]);
const media = (bytes: Uint8Array, type = "image/gif", status = 200): Response => new Response(bytes as BodyInit, { status, headers: { "content-type": type } });

function memory(): ExerciseStore {
  const rows: AddedRow[] = [];
  return {
    all: () => rows,
    find: (slug) => rows.find((r) => r.slug === slug) ?? null,
    async add(e) { const r = { id: String(rows.length), slug: e.slug, name: e.name, notes: e.notes, file: e.file, gif_url: e.gifUrl, added_by: e.addedBy, added_at: "2026-10-27T07:00:00.000Z" }; rows.push(r); return r; },
    async remove(slug) { const i = rows.findIndex((r) => r.slug === slug); if (i < 0) return false; rows.splice(i, 1); return true; },
  };
}
function plans(): PlanStore {
  let saved: PlanRow[] = [];
  return { rows: () => saved, async replace(_d, items: PlanInput[]) { saved = items.map((it, i) => ({ id: `p${i}`, name: it.name, dose: it.dose ?? null, done: false, position: i, exercise: it.exercise ?? null })); } };
}
function setup(fetchImpl: Fetch = async () => media(GIF)) {
  const dataDir = mkdtempSync(join(tmpdir(), "fit-ex-"));
  const app = exerciseRoutes({ plans: plans(), added: memory(), dataDir, fetchImpl });
  const req = (method: string, path: string, body?: unknown) =>
    app.request(`http://h${path}`, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { dataDir, req };
}

describe("downloadMedia", () => {
  it("refuses non-http URLs, wrong types, failures and oversize pictures", async () => {
    expect(await downloadMedia("file:///etc/passwd")).toEqual({ ok: false, error: "gifUrl must be http(s)" });
    expect((await downloadMedia("https://x/a", async () => media(GIF, "text/html")) as { error: string }).error).toContain("GIF, WebP or MP4");
    expect((await downloadMedia("https://x/a", async () => media(GIF, "image/gif", 404)) as { error: string }).error).toContain("HTTP 404");
    expect((await downloadMedia("https://x/a", async () => { throw new Error("timed out"); }) as { error: string }).error).toContain("timed out");
    expect((await downloadMedia("https://x/a", async () => media(new Uint8Array(MAX_BYTES + 1))) as { error: string }).error).toContain("10 MB");
    expect(await downloadMedia("https://x/a.webp", async () => media(GIF, "image/webp; charset=binary"))).toMatchObject({ ok: true, ext: "webp" });
  });
});

describe("POST /exercises", () => {
  it("adds an exercise, downloads its picture into the data dir and serves it", async () => {
    const { dataDir, req } = setup();
    const res = await req("POST", "/exercises", { name: "Cable face pull", notes: "Rear delts", gifUrl: "https://example.com/fp.gif" });
    expect(res.status).toBe(201);
    const { exercise } = await res.json() as { exercise: { slug: string; file: string; image: string } };
    expect(exercise).toMatchObject({ slug: "cable-face-pull", file: "cable-face-pull.gif" });
    expect(exercise.image.endsWith("api/exercises/media/cable-face-pull.gif")).toBe(true);
    expect(existsSync(join(dataDir, "exercises", "cable-face-pull.gif"))).toBe(true);
    const pic = await req("GET", "/exercises/media/cable-face-pull.gif");
    expect(pic.headers.get("content-type")).toBe("image/gif");
    expect(new Uint8Array(await pic.arrayBuffer())).toEqual(GIF);
    expect((await req("GET", "/exercises/media/..%2F..%2Fapp.db")).status).toBe(404);
    const list = await (await req("GET", "/exercises")).json() as { exercises: { slug: string; source: string }[] };
    expect(list.exercises.find((e) => e.slug === "cable-face-pull")?.source).toBe("added");
    expect(list.exercises.some((e) => e.source === "preloaded")).toBe(true);
  });
  it("dedupes by slug, against preloaded and added exercises", async () => {
    const { req } = setup();
    expect((await req("POST", "/exercises", { name: "Goblet squat" })).status).toBe(200);
    await req("POST", "/exercises", { name: "Cable face pull" });
    const again = await req("POST", "/exercises", { name: "cable FACE-pull" });
    expect(again.status).toBe(200);
    expect(await again.json()).toMatchObject({ exists: true });
  });
  it("refuses a picture it cannot download, and adds the exercise without gifUrl", async () => {
    const { req } = setup(async () => media(GIF, "text/html"));
    const bad = await req("POST", "/exercises", { name: "Cable face pull", gifUrl: "https://example.com/page" });
    expect(bad.status).toBe(422);
    expect((await bad.json() as { error: string }).error).toContain("without gifUrl");
    const plain = await req("POST", "/exercises", { name: "Cable face pull" });
    expect(plain.status).toBe(201);
    expect((await plain.json() as { exercise: { image: string } }).exercise.image).toBe("");
    expect((await req("POST", "/exercises", { notes: "no name" })).status).toBe(400);
  });
  it("removes an added exercise but never a preloaded one", async () => {
    const { req } = setup();
    await req("POST", "/exercises", { name: "Cable face pull" });
    expect((await req("DELETE", "/exercises/goblet-squat")).status).toBe(400);
    expect((await req("DELETE", "/exercises/cable-face-pull")).status).toBe(200);
    expect((await req("DELETE", "/exercises/cable-face-pull")).status).toBe(404);
  });
});

describe("plan → exercise linking", () => {
  it("links plan items by slug to preloaded and added exercises, and by name as before", async () => {
    const { req } = setup();
    await req("POST", "/exercises", { name: "Cable face pull", gifUrl: "https://example.com/fp.gif" });
    const res = await req("PUT", "/plan", { date: "2026-10-27", items: [
      { name: "Face pulls", dose: "3x15", exercise: "cable-face-pull" },
      { name: "Goblet squat", dose: "3x12" },
      { name: "Cable face pull" },
      { name: "Something new" },
    ] });
    const { items } = await res.json() as { items: { exercise: { slug: string; image: string } | null }[] };
    expect(items.map((i) => i.exercise?.slug ?? null)).toEqual(["cable-face-pull", "goblet-squat", "cable-face-pull", null]);
    expect(items[0].exercise!.image.endsWith("api/exercises/media/cable-face-pull.gif")).toBe(true);
  });
});
