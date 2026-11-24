// A to-do ticked on the page is marked done on Flock's list as the person who ticked it (the SDK's tasks.complete), not taken
// back. Already settled by someone else (409): done here too, saying by whom. No open task there, or an older Flock (404, or no
// complete call at all): taken back as before. Flock away: sent on the next run.
import { describe, it, expect } from "bun:test";
import { boot } from "./testkit";
import { syncTodos } from "./calendar";

const NOW = () => new Date(2026, 10, 22, 10, 0);

async function start() {
  const k = await boot({ now: NOW });
  await k.op("import_events", { source: "email:shiva", label: "Shiva's email", items: [
    { ref: "trip", title: "School trip", date: "2026-12-04", todos: [{ title: "Sign the trip form", due: "2026-11-27" }] }] });
  const id = k.rows("events")[0].id;
  const ref = `event:${id}:sign-the-trip-form`;
  const tick = (user: string, role: string, done = true) => k.viewer(user, role, "POST", "/api/todos/done", { event_id: id, key: "sign-the-trip-form", done });
  const todo = () => k.rows("todos")[0];
  return Object.assign(k, { id, ref, tick, todo });
}

describe("a to-do ticked on the page", () => {
  it("is marked done on Flock's list as the owner, when the owner ticks it", async () => {
    const k = await start();
    const r = await k.tick("shiva", "owner");
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: true, todo: { key: "sign-the-trip-form", done: true } });
    expect(k.tasks.completed).toEqual([{ ref: k.ref, by: "owner" }]);
    expect(k.tasks.withdrawn).toEqual([]);
    expect(k.todo()).toMatchObject({ status: "done", synced: 1, done_by: "owner", done_note: null });
  });

  it("as the person the owner shared with, by their Flock user", async () => {
    const k = await start();
    await k.tick("user:ravi-123", "member");
    expect(k.tasks.completed).toEqual([{ ref: k.ref, by: "user:ravi-123" }]);
    expect(k.todo()).toMatchObject({ status: "done", done_by: "user:ravi-123" });
  });

  it("already settled by someone else (409): done here too, and the page is told by whom", async () => {
    const k = await start();
    k.tasks.completeAs("settled");
    const r = await k.tick("shiva", "owner");
    expect(r.body).toMatchObject({ ok: true, todo: { done: true }, message: "Already done by Ravi." });
    expect(k.todo()).toMatchObject({ status: "done", synced: 1, done_note: "Already done by Ravi." });
    expect(k.tasks.withdrawn).toEqual([]);
    // The page lists it as done, with the words.
    const extras = (await k.owner("GET", "/api/events/extras")).body.events[k.id];
    expect(extras.todos).toEqual([expect.objectContaining({ key: "sign-the-trip-form", done: true, note: "Already done by Ravi." })]);
  });

  it("no open task on Flock's list, or a Flock older than the call (404): taken back as before", async () => {
    const k = await start();
    k.tasks.completeAs("gone");
    await k.tick("shiva", "owner");
    expect(k.tasks.withdrawn).toEqual([k.ref]);
    expect(k.todo()).toMatchObject({ status: "done", synced: 1 });
  });

  it("an SDK with no complete at all: taken back as before", async () => {
    const k = await start();
    k.tasks.completeAs("absent");
    await k.tick("shiva", "owner");
    expect(k.tasks.completed).toEqual([]);
    expect(k.tasks.withdrawn).toEqual([k.ref]);
  });

  it("a ticker the task is not for (403): marked done as the app's", async () => {
    const k = await start();
    k.tasks.completeAs("forbidden");
    await k.tick("user:guest-9", "app_viewer");
    expect(k.tasks.completed).toEqual([{ ref: k.ref }]);
    expect(k.todo()).toMatchObject({ status: "done", synced: 1 });
  });

  it("Flock away: done here at once, and marked done there on the next run", async () => {
    const k = await start();
    k.tasks.down(true);
    await k.tick("shiva", "owner");
    expect(k.todo()).toMatchObject({ status: "done", synced: 0 });
    k.tasks.down(false);
    await syncTodos(k.cal);
    expect(k.tasks.completed).toEqual([{ ref: k.ref, by: "owner" }]);
    expect(k.todo().synced).toBe(1);
  });

  it("unticked: open again, and on Flock's list again", async () => {
    const k = await start();
    await k.tick("shiva", "owner");
    const before = k.tasks.published.length;
    await k.tick("shiva", "owner", false);
    expect(k.todo()).toMatchObject({ status: "open", synced: 1, done_by: null, done_note: null });
    expect(k.tasks.published).toHaveLength(before + 1);
  });
});
