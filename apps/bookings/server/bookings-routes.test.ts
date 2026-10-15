import { describe, it, expect } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { Hono } from "hono";
import { _settings, mountKit } from "@flock/app-kit";
import * as schema from "./db/schema";
import { services } from "./db/schema";
import { mountBookingRoutes } from "./bookings-routes";
import { bookings } from "./db/schema";
import { eq } from "drizzle-orm";
import { DEFAULT_SETTINGS, SETTINGS, overlaps, timesFor, weekdayOf, withinHours } from "./db/constants";
import { sampleBookings, sampleServices, planSampleBookings, addPlanSampleBookings } from "./db/seed";

const MON = "2026-10-12", SAT = "2026-10-17", SUN = "2026-10-18";   // Monday 9-18, Saturday 9-14, Sunday 10-13

async function boot() {
  const hono = new Hono();
  const dataDir = mkdtempSync(join(tmpdir(), "bookings-routes-"));
  const events: string[] = [];
  const kit = await mountKit({ hono, env: { appId: "t", dataDir, apiUrl: null, token: null, agent: null } }, { schema, dbFile: ":memory:", appName: "T", settings: SETTINGS, privateTables: { bookings: "GET/POST/PATCH/DELETE /api/bookings and GET /api/slots (see TEMPLATE.md)" } });
  mountBookingRoutes(hono, kit.db, (t, id, op) => events.push(`${t}:${op}:${id}`), kit.settings);
  const svc = (name: string, minutes: number) => kit.db.insert(services).values({ name, minutes }).returning().get()!.id;
  const half = svc("Consultation", 30), hour = svc("Check-up", 60);
  const call = async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
    const r = await hono.request(path, { method, headers: { "Content-Type": "application/json", ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, body: (await r.json()) as any };
  };
  const book = (start: string, service = half, extra: object = {}) => call("POST", "/api/bookings", { customer_name: "Asha", service_id: service, start, ...extra });
  const setSettings = (patch: object) => call("PATCH", "/api/_app/settings", patch, { "X-Flock-User": "owner" });
  return { hono, kit, half, hour, call, book, events, setSettings };
}

describe("POST /api/bookings", () => {
  it("books a free slot, stamps who did it and tells live pages", async () => {
    const { call, book, events, half } = await boot();
    const r = await call("POST", "/api/bookings", { customer_name: " Asha ", phone: "98450 11201", service_id: half, start: `${MON}T10:00` }, { "X-Flock-User": "tester" });
    expect(r.status).toBe(201);
    expect(r.body.row).toMatchObject({ customer_name: "Asha", start: `${MON}T10:00`, minutes: 30, status: "booked", service_name: "Consultation", updated_by: "user:tester" });
    expect(events).toEqual([`bookings:insert:${r.body.row.id}`]);
    expect((await book(`${MON}T11:00`)).status).toBe(201);
  });
  it("rejects a booking that overlaps another, with a message that names the clash", async () => {
    const { book, hour } = await boot();
    expect((await book(`${MON}T10:00`, hour)).status).toBe(201);          // 10:00 to 11:00
    for (const t of ["10:00", "10:30"]) {
      const r = await book(`${MON}T${t}`);
      expect(r.status, t).toBe(409);
      expect(r.body).toMatchObject({ error: "slot_taken", field: "start" });
      expect(r.body.message).toContain("10:00 to 11:00");
    }
    expect((await book(`${MON}T09:30`, hour)).status).toBe(409);          // 9:30 to 10:30 runs into it
    expect((await book(`${MON}T09:30`)).status).toBe(201);                // 9:30 to 10:00 only touches it
    expect((await book(`${MON}T11:00`)).status).toBe(201);                // starts exactly when it ends
  });
  it("lets two requests at the same moment take the slot only once", async () => {
    const { book } = await boot();
    const results = await Promise.all([book(`${MON}T15:00`), book(`${MON}T15:00`), book(`${MON}T15:00`)]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409, 409]);
  });
  it("frees the slot when a booking is cancelled and holds it again if un-cancelled into a clash", async () => {
    const { call, book } = await boot();
    const first = (await book(`${MON}T10:00`)).body.row;
    expect((await call("PATCH", `/api/bookings/${first.id}`, { status: "cancelled" })).status).toBe(200);
    const second = await book(`${MON}T10:00`);
    expect(second.status).toBe(201);
    const back = await call("PATCH", `/api/bookings/${first.id}`, { status: "booked" });
    expect(back.status).toBe(409);
  });
  it("answers sloppy input with a 400 that names the field, never a 500", async () => {
    const { call, book, half } = await boot();
    const cases: [object, string][] = [
      [{ service_id: half, start: `${MON}T10:00` }, "customer_name"],
      [{ customer_name: "A", service_id: half }, "start"],
      [{ customer_name: "A", service_id: half, start: "2026-10-12 10:00" }, "start"],
      [{ customer_name: "A", service_id: half, start: "2026-10-12T10:00Z" }, "start"],
      [{ customer_name: "A", service_id: half, start: "2026-02-30T10:00" }, "start"],
      [{ customer_name: "A", service_id: half, start: `${MON}T25:00` }, "start"],
      [{ customer_name: "A", service_id: "nope", start: `${MON}T10:00` }, "service_id"],
      [{ customer_name: "A", service_id: 12, start: `${MON}T10:00` }, "service_id"],
      [{ customer_name: 12, service_id: half, start: `${MON}T10:00` }, "customer_name"],
      [{ customer_name: "A", service_id: half, start: `${MON}T10:00`, status: "maybe" }, "status"],
      [{ customer_name: "A", service_id: half, start: `${MON}T10:00`, minutes: "30" }, "minutes"],
      [{ customer_name: "A", service_id: half, start: `${MON}T10:00`, id: "x" }, "id"],
    ];
    for (const [body, field] of cases) {
      const r = await call("POST", "/api/bookings", body);
      expect(r.status, JSON.stringify(body)).toBe(400);
      expect(r.body.field).toBe(field);
      expect(typeof r.body.message).toBe("string");
    }
    expect((await call("POST", "/api/bookings", [1])).status).toBe(400);
    expect((await book(`${MON}T10:00`, half, { phone: null })).status).toBe(201);
  });
  it("only books inside opening hours, and a long service must end by closing", async () => {
    const { book, hour } = await boot();
    expect((await book(`${MON}T08:30`)).status).toBe(400);
    expect((await book(`${MON}T17:30`)).status).toBe(201);
    expect((await book(`${MON}T18:00`)).status).toBe(400);
    expect((await book(`${MON}T17:30`, hour)).body.message).toContain("outside opening hours");
    expect((await book(`${SAT}T13:30`)).status).toBe(201);
    expect((await book(`${SAT}T14:00`)).status).toBe(400);
    expect((await book(`${SUN}T09:30`)).status).toBe(400);
    expect((await book(`${SUN}T10:00`)).status).toBe(201);
  });
});

describe("PATCH and DELETE /api/bookings/:id", () => {
  it("edits a booking without clashing with itself, and moving it onto another is refused", async () => {
    const { call, book } = await boot();
    const a = (await book(`${MON}T10:00`)).body.row, b = (await book(`${MON}T11:00`)).body.row;
    const same = await call("PATCH", `/api/bookings/${a.id}`, { notes: "Bring reports", status: "done" });
    expect(same.status).toBe(200);
    expect(same.body.row).toMatchObject({ notes: "Bring reports", status: "done", start: `${MON}T10:00` });
    expect((await call("PATCH", `/api/bookings/${b.id}`, { start: `${MON}T10:00` })).status).toBe(409);
    const moved = await call("PATCH", `/api/bookings/${b.id}`, { start: `${MON}T12:00` });
    expect(moved.body.row.start).toBe(`${MON}T12:00`);
  });
  it("re-measures the length when the service changes, and checks it fits", async () => {
    const { call, book, hour } = await boot();
    const a = (await book(`${MON}T10:00`)).body.row;
    await book(`${MON}T10:30`);
    expect((await call("PATCH", `/api/bookings/${a.id}`, { service_id: hour })).status).toBe(409);   // an hour would run into the 10:30
    const late = (await book(`${MON}T17:30`)).body.row;
    expect((await call("PATCH", `/api/bookings/${late.id}`, { service_id: hour })).status).toBe(400);
  });
  it("answers 404 for a booking that is not there and 400 for sloppy edits", async () => {
    const { call, book } = await boot();
    expect((await call("PATCH", "/api/bookings/nope", { notes: "x" })).status).toBe(404);
    expect((await call("DELETE", "/api/bookings/nope")).status).toBe(404);
    expect((await call("GET", "/api/bookings/nope")).status).toBe(404);
    const a = (await book(`${MON}T10:00`)).body.row;
    expect((await call("PATCH", `/api/bookings/${a.id}`, { status: 3 })).body.field).toBe("status");
    expect((await call("PATCH", `/api/bookings/${a.id}`, { customer_name: "" })).body.field).toBe("customer_name");
  });
  it("deletes, and booking the same details again is the undo", async () => {
    const { call, book, events } = await boot();
    const a = (await book(`${MON}T10:00`, undefined, { notes: "n" })).body.row;
    const del = await call("DELETE", `/api/bookings/${a.id}`);
    expect(del.status).toBe(200);
    expect(del.body.ok).toBe(true);
    expect((await call("GET", `/api/bookings/${a.id}`)).status).toBe(404);
    const { id, service_name, created_at, updated_at, updated_by, minutes, ...details } = del.body.row;
    expect((await call("POST", "/api/bookings", details)).status).toBe(201);
    expect(events.filter((e) => e.includes(":delete:")).length).toBe(1);
  });
});

describe("deleted services, status edits and one-minute clashes", () => {
  it("lets a booking whose service was deleted still be marked done, cancelled or edited", async () => {
    const { call, book, kit, half } = await boot();
    const a = (await book(`${MON}T10:00`)).body.row;
    kit.db.delete(services).where(eq(services.id, half)).run();
    const done = await call("PATCH", `/api/bookings/${a.id}`, { status: "done", start: a.start });
    expect(done.status).toBe(200);
    expect(done.body.row).toMatchObject({ status: "done", service_name: "Deleted service", minutes: 30 });
    expect((await call("PATCH", `/api/bookings/${a.id}`, { notes: "paid in cash" })).status).toBe(200);
    expect((await call("PATCH", `/api/bookings/${a.id}`, { service_id: "nope" })).body.field).toBe("service_id");   // setting a missing service is still refused
  });
  it("does not re-run opening hours when a booking is only marked done or no-show", async () => {
    const { call, kit, half } = await boot();
    const row = kit.db.insert(bookings).values({ customer_name: "Late", service_id: half, start: `${MON}T20:00`, minutes: 30 }).returning().get()!;   // outside hours, e.g. hours changed since
    expect((await call("PATCH", `/api/bookings/${row.id}`, { status: "no_show" })).status).toBe(200);
    expect((await call("PATCH", `/api/bookings/${row.id}`, { start: `${MON}T20:30` })).status).toBe(400);   // moving it is checked
  });
  it("treats a one-minute overlap as a clash and an exact touch as free", async () => {
    const { book } = await boot();
    expect((await book(`${MON}T10:00`)).status).toBe(201);            // 10:00 to 10:30
    expect((await book(`${MON}T10:29`)).status).toBe(409);            // one minute inside
    expect((await book(`${MON}T09:31`)).status).toBe(409);            // ends 10:01
    expect((await book(`${MON}T10:30`)).status).toBe(201);
    expect((await book(`${MON}T09:30`)).status).toBe(201);
  });
  it("offers reschedule times from the day's real hours and the booking's length, keeping an off-grid time", () => {
    const s = DEFAULT_SETTINGS;
    expect(timesFor(s, MON, 30)[0]).toBe("09:00");
    expect(timesFor(s, MON, 30).at(-1)).toBe("17:30");
    expect(timesFor(s, MON, 60).at(-1)).toBe("17:00");                // an hour must end by 18:00
    expect(timesFor(s, SAT, 30).at(-1)).toBe("13:30");
    expect(timesFor(s, SUN, 30)).toEqual(["10:00", "10:30", "11:00", "11:30", "12:00", "12:30"]);
    expect(timesFor(s, SUN, 30, "10:15")).toContain("10:15");
    expect(timesFor(s, SUN, 30, "10:15")).toEqual([...timesFor(s, SUN, 30), "10:15"].sort());
    expect(timesFor(s, "2026-10-12", 600)).toEqual([]);               // longer than any day: nothing impossible is offered
    const short = { hours: { ...s.hours, 1: ["12:00", "13:00"] as [string, string] }, slot_minutes: 20 };
    expect(timesFor(short, MON, 20)).toEqual(["12:00", "12:20", "12:40"]);
    expect(timesFor(short, MON, 20, "09:00")).toEqual(["09:00", "12:00", "12:20", "12:40"]);   // a booking from the old hours keeps its own time
  });
  it("tells agents where bookings live: the hint is in _schema, and bookings are still not in /api/_data", async () => {
    const { call } = await boot();
    const schema = (await call("GET", "/api/_data/_schema")).body;
    expect(schema.tables.bookings).toEqual({ routes: expect.stringContaining("/api/bookings") });
    expect(schema.tables.services.columns.length).toBeGreaterThan(0);
  });
});

describe("GET /api/bookings and /api/slots", () => {
  it("lists by day range in start order with the service name, and pages with an opaque cursor", async () => {
    const { call, book } = await boot();
    await book(`${MON}T11:00`); await book(`${MON}T09:00`); await book("2026-10-13T09:00"); await book("2026-10-14T09:00");
    const day = await call("GET", `/api/bookings?from=${MON}&to=${MON}`);
    expect(day.body.rows.map((r: any) => r.start)).toEqual([`${MON}T09:00`, `${MON}T11:00`]);
    expect(day.body.rows[0].service_name).toBe("Consultation");
    const p1 = await call("GET", `/api/bookings?from=${MON}&limit=3`);
    expect(p1.body.rows.length).toBe(3);
    expect(p1.body.nextCursor).toBeTruthy();
    const p2 = await call("GET", `/api/bookings?from=${MON}&limit=3&cursor=${p1.body.nextCursor}`);
    expect(p2.body.rows.length).toBe(1);
    expect(p2.body.nextCursor).toBeNull();
    for (const q of ["from=tomorrow", "to=2026-13-01", "status=maybe", "limit=0", "limit=501", "limit=abc", "cursor=!!"]) expect((await call("GET", `/api/bookings?${q}`)).status, q).toBe(400);
  });
  it("reports every grid slot a booking touches as taken, and a cancelled one as free", async () => {
    const { call, book, hour } = await boot();
    const long = (await book(`${MON}T10:00`, hour)).body.row;                // 10:00 to 11:00
    const slots = await call("GET", `/api/slots?date=${MON}`);
    expect(slots.body).toMatchObject({ closed: false, open: "09:00", close: "18:00", slotMinutes: 30, length: 30 });
    expect(slots.body.taken).toEqual(["10:00", "10:30"]);
    const forHour = await call("GET", `/api/slots?date=${MON}&service_id=${hour}`);
    expect(forHour.body.taken).toEqual(["09:30", "10:00", "10:30"]);         // a 9:30 hour would run into the 10:00
    expect(forHour.body.length).toBe(60);
    await call("PATCH", `/api/bookings/${long.id}`, { status: "cancelled" });
    expect((await call("GET", `/api/slots?date=${MON}`)).body.taken).toEqual([]);
    expect((await call("GET", `/api/slots?date=2030-01-01`)).body.taken).toEqual([]);
  });
  it("is honest about a closed day or a bad query", async () => {
    const { call } = await boot();
    expect((await call("GET", `/api/slots?date=${SUN}`)).body.open).toBe("10:00");
    expect((await call("GET", "/api/slots")).status).toBe(400);
    expect((await call("GET", "/api/slots?date=2026-10-12&service_id=zzz")).body.field).toBe("service_id");
  });
  it("keeps bookings out of the uniform /api/_data routes, so nothing can write around the overlap rule", async () => {
    const { call } = await boot();
    expect((await call("GET", "/api/_data/bookings")).status).toBe(404);
    expect((await call("POST", "/api/_data/bookings", { customer_name: "x", service_id: "y", start: `${MON}T10:00`, minutes: 30 })).status).toBe(404);
  });
});

describe("settings: opening hours and slot length (I7)", () => {
  it("declares hours and slot_minutes with today's values as defaults", async () => {
    const { call } = await boot();
    const app = (await call("GET", "/api/_app")).body;
    expect(app.settings.slot_minutes).toBe(30);
    expect(app.settings.hours).toEqual({ 0: ["10:00", "13:00"], 1: ["09:00", "18:00"], 2: ["09:00", "18:00"], 3: ["09:00", "18:00"], 4: ["09:00", "18:00"], 5: ["09:00", "18:00"], 6: ["09:00", "14:00"] });
  });
  it("makes /api/slots and new bookings follow new hours and slot minutes after a PATCH", async () => {
    const { call, book, hour, setSettings } = await boot();
    const r = await setSettings({ hours: { ...DEFAULT_SETTINGS.hours, 1: ["12:00", "16:00"], 0: null }, slot_minutes: 20 });
    expect(r.status).toBe(200);
    const slots = (await call("GET", `/api/slots?date=${MON}`)).body;
    expect(slots).toMatchObject({ closed: false, open: "12:00", close: "16:00", slotMinutes: 20, length: 20, taken: [] });
    expect((await call("GET", `/api/slots?date=${SUN}`)).body).toMatchObject({ closed: true, slotMinutes: 20 });
    expect((await book(`${MON}T10:00`)).status).toBe(400);                 // open under the old hours, closed under the new
    expect((await book(`${MON}T15:30`, hour)).body.message).toContain("12:00 to 16:00");
    expect((await book(`${SUN}T10:00`)).body.message).toContain("closed");
    expect((await book(`${MON}T12:20`)).status).toBe(201);
    expect((await call("GET", `/api/slots?date=${MON}`)).body.taken).toEqual(["12:20", "12:40"]);   // 12:20 to 12:50 touches both 20-minute slots
    await setSettings({ slot_minutes: 45 });
    expect((await call("GET", `/api/slots?date=${MON}`)).body).toMatchObject({ slotMinutes: 45, length: 45, taken: ["12:00", "12:45"] });
  });
  it("keeps existing bookings valid when the hours change: they are listed, can be marked done or edited, and still hold their time", async () => {
    const { call, book, hour, setSettings } = await boot();
    const early = (await book(`${MON}T10:00`)).body.row;                   // before the new opening
    const edge = (await book(`${MON}T15:30`, hour)).body.row;              // 15:30 to 16:30, runs past the new closing
    const sunday = (await book(`${SUN}T10:00`)).body.row;                  // Sunday becomes closed
    expect((await setSettings({ hours: { ...DEFAULT_SETTINGS.hours, 1: ["12:00", "16:00"], 0: null }, slot_minutes: 20 })).status).toBe(200);
    const listed = (await call("GET", `/api/bookings?from=${MON}&to=${SUN}`)).body.rows;
    expect(listed.map((r: any) => [r.id, r.status, r.start, r.minutes])).toEqual([
      [early.id, "booked", `${MON}T10:00`, 30], [edge.id, "booked", `${MON}T15:30`, 60], [sunday.id, "booked", `${SUN}T10:00`, 30],
    ]);
    expect((await call("GET", `/api/bookings/${early.id}`)).body.row.start).toBe(`${MON}T10:00`);
    expect((await call("PATCH", `/api/bookings/${early.id}`, { status: "done" })).status).toBe(200);
    expect((await call("PATCH", `/api/bookings/${sunday.id}`, { notes: "regular" })).status).toBe(200);
    expect((await call("PATCH", `/api/bookings/${edge.id}`, { customer_name: "Asha R", status: "no_show" })).status).toBe(200);
    expect((await call("PATCH", `/api/bookings/${edge.id}`, { status: "booked" })).status).toBe(200);   // never cancelled, so its time is not re-judged
    // It still holds its time: new slots that touch it are taken, and booking into it is a clash.
    expect((await call("GET", `/api/slots?date=${MON}`)).body.taken).toEqual(["15:20", "15:40"]);
    expect((await book(`${MON}T15:30`)).status).toBe(409);
    // Only moving it is judged by the new hours.
    expect((await call("PATCH", `/api/bookings/${early.id}`, { start: `${MON}T10:30` })).status).toBe(400);
    expect((await call("PATCH", `/api/bookings/${early.id}`, { start: `${MON}T12:00` })).status).toBe(200);
  });
  it("refuses hours and slot lengths the slot loop cannot use, naming the field, and changes nothing", async () => {
    const { call, setSettings } = await boot();
    const bad: [object, string][] = [
      [{ hours: "9 to 6" }, "hours"],
      [{ hours: [] }, "hours"],
      [{ hours: { 1: ["09:00", "18:00"] } }, "hours"],                                     // the other six days are missing
      [{ hours: { ...DEFAULT_SETTINGS.hours, 7: null } }, "hours"],
      [{ hours: { ...DEFAULT_SETTINGS.hours, 1: ["9:00", "18:00"] } }, "hours"],
      [{ hours: { ...DEFAULT_SETTINGS.hours, 1: ["18:00", "09:00"] } }, "hours"],
      [{ hours: { ...DEFAULT_SETTINGS.hours, 1: ["09:00", "24:30"] } }, "hours"],
      [{ hours: { ...DEFAULT_SETTINGS.hours, 1: ["09:00"] } }, "hours"],
      [{ slot_minutes: 0 }, "slot_minutes"],
      [{ slot_minutes: -30 }, "slot_minutes"],
      [{ slot_minutes: 2000 }, "slot_minutes"],
      [{ slot_minutes: 7.5 }, "slot_minutes"],
      [{ slot_minutes: 30, hours: null }, "hours"],
    ];
    for (const [patch, field] of bad) {
      const r = await setSettings(patch);
      expect(r.status, JSON.stringify(patch)).toBe(400);
      expect(r.body.field, JSON.stringify(patch)).toBe(field);
      expect(typeof r.body.message).toBe("string");
    }
    expect((await call("GET", "/api/_app")).body.settings).toEqual(DEFAULT_SETTINGS);
    expect((await setSettings({ hours: { ...DEFAULT_SETTINGS.hours, 1: ["00:00", "24:00"] } })).status).toBe(200);   // open all day is allowed
  });
  it("fails a boot import whose hours or slot length the slot loop cannot use, and writes nothing", async () => {
    for (const settings of [{ hours: { 1: ["18:00", "09:00"] } }, { slot_minutes: 0 }, { hours: { ...DEFAULT_SETTINGS.hours, 1: ["18:00", "09:00"] } }]) {
      const dataDir = mkdtempSync(join(tmpdir(), "bookings-import-"));
      mkdirSync(join(dataDir, ".flock"), { recursive: true });
      writeFileSync(join(dataDir, ".flock/import.json"), JSON.stringify({ importId: "imp-1", by: "pa", settings, rows: { services: [{ $key: "c", name: "Consultation", minutes: 30 }] } }));
      const kit = await mountKit({ hono: new Hono(), env: { appId: "t", dataDir, apiUrl: null, token: null, agent: null } }, { schema, dbFile: ":memory:", appName: "T", settings: SETTINGS, privateTables: ["bookings"] });
      expect(kit.importState.state, JSON.stringify(settings)).toBe("failed");
      expect((kit.importState as any).error).toContain(Object.keys(settings)[0]);
      expect((kit.sqlite.query(`SELECT count(*) AS n FROM services`).get() as any).n).toBe(0);
      expect((kit.sqlite.query(`SELECT count(*) AS n FROM _settings`).get() as any).n).toBe(0);
    }
  });
  it("falls back to the defaults when a stored value is unusable, so the slot loop always ends", async () => {
    const { call, kit } = await boot();
    // A hand edit of the database bypasses the checks; the kit then reads the default.
    kit.db.insert(_settings).values([{ key: "slot_minutes", value: "0" }, { key: "hours", value: '{"1":["18:00","09:00"]}' }]).run();
    const slots = (await call("GET", `/api/slots?date=${MON}`)).body;
    expect(slots).toMatchObject({ open: "09:00", close: "18:00", slotMinutes: 30 });
  });
});

describe("sample rows", () => {
  const ids = Object.fromEntries(sampleServices.map((s) => [s.name, `id-${s.name}`]));
  for (const day of [new Date(2026, 9, 9), new Date(2026, 9, 10), new Date(2026, 9, 11), new Date(2026, 9, 12)]) {
    it(`never overlap and always sit inside opening hours (${day.toDateString()})`, () => {
      const rows = sampleBookings(ids, day);
      expect(rows.length).toBeGreaterThan(8);
      for (const r of rows) expect(withinHours(DEFAULT_SETTINGS, r.start, r.minutes), r.start).toBe(true);
      const live = rows.filter((r) => r.status !== "cancelled");
      for (let i = 0; i < live.length; i++) for (let j = i + 1; j < live.length; j++) expect(overlaps(live[i].start, live[i].minutes, live[j].start, live[j].minutes), `${live[i].start} vs ${live[j].start}`).toBe(false);
    });
  }
  it("has bookings today, tomorrow and yesterday on a weekday", () => {
    const from = new Date(2026, 9, 12), starts = sampleBookings(ids, from).map((r) => r.start.slice(0, 10));
    for (const d of ["2026-10-11", "2026-10-12", "2026-10-13"]) expect(starts).toContain(d);
    expect(weekdayOf("2026-10-12")).toBe(1);
  });
});

describe("sample rows are marked, flagged by the app's routes, and cleared (T2b)", () => {
  it("marks sample bookings, keeps a sample service a real booking uses, and clears the rest", async () => {
    const { seed } = await import("./db/seed");
    const hono = new Hono();
    const dataDir = mkdtempSync(join(tmpdir(), "bookings-samples-"));
      const kit = await mountKit({ hono, env: { appId: "t", dataDir, apiUrl: null, token: null, agent: null } }, { schema, seed, appName: "T", settings: SETTINGS, privateTables: { bookings: "GET/POST/PATCH/DELETE /api/bookings and GET /api/slots (see TEMPLATE.md)" } });
    mountBookingRoutes(hono, kit.db, kit.emitChange, kit.settings, kit.flagSamples);
    const owner = { "Content-Type": "application/json", "X-Flock-User": "maya" };
    const n = (q: string) => (kit.sqlite.query(q).get() as { n: number }).n;
    const seeded = n(`SELECT count(*) AS n FROM bookings`);
    expect(seeded).toBeGreaterThan(0);
    expect(n(`SELECT count(*) AS n FROM _samples WHERE table_name = 'bookings'`)).toBe(seeded);
    const listed = (await (await hono.request("/api/bookings?limit=500")).json()) as any;
    expect(listed.rows.every((r: any) => r._sample === true)).toBe(true);

    const service = (await (await hono.request("/api/_data/services")).json() as any).rows[0];
    const made = await hono.request("/api/bookings", { method: "POST", headers: owner, body: JSON.stringify({ customer_name: "Real", service_id: service.id, start: "2027-01-04T10:00" }) });
    expect(made.status).toBe(201);
    const real = ((await made.json()) as any).row;
    expect(real._sample).toBeUndefined();

    const res = (await (await hono.request("/api/_data/_samples/clear", { method: "POST", headers: owner })).json()) as any;
    expect(res.kept).toEqual([{ table: "services", count: 1, reason: "used by bookings" }]);
    expect(kit.sqlite.query(`SELECT id FROM bookings`).all()).toEqual([{ id: real.id }]);
    expect(kit.sqlite.query(`SELECT id FROM services`).all()).toEqual([{ id: service.id }]);
    expect(n(`SELECT count(*) AS n FROM _samples`)).toBe(0);
    kit.sqlite.close();
  });
});

describe("sample bookings for a plan's own sample services", () => {
  const svc = [{ id: "a", name: "Physio session", minutes: 45 }, { id: "b", name: "Dry needling", minutes: 30 }, { id: "c", name: "Review", minutes: 30 }];
  for (const day of [new Date(2026, 9, 12), new Date(2026, 9, 13), new Date(2026, 9, 17), new Date(2026, 9, 18)]) {
    it(`gives 2 to 4 non-overlapping in-hours bookings today and tomorrow, or the next open days (${day.toDateString()})`, () => {
      const rows = planSampleBookings(svc, DEFAULT_SETTINGS, day);
      expect(rows.length).toBeGreaterThanOrEqual(2);
      expect(rows.length).toBeLessThanOrEqual(4);
      for (const r of rows) {
        expect(withinHours(DEFAULT_SETTINGS, r.start, r.minutes), r.start).toBe(true);
        expect(r.status).toBe("booked");
        expect(svc.map((s) => s.id)).toContain(r.service_id);
      }
      for (let i = 0; i < rows.length; i++) for (let j = i + 1; j < rows.length; j++) expect(overlaps(rows[i].start, rows[i].minutes, rows[j].start, rows[j].minutes)).toBe(false);
      expect(rows[0].start.slice(0, 10) >= `${day.getFullYear()}-10-${String(day.getDate()).padStart(2, "0")}`).toBe(true);
    });
  }
  it("on a weekday the bookings fall today and tomorrow", () => {
    const days = new Set(planSampleBookings(svc, DEFAULT_SETTINGS, new Date(2026, 9, 12)).map((r) => r.start.slice(0, 10)));
    expect([...days].sort()).toEqual(["2026-10-12", "2026-10-13"]);
  });
  it("makes none when there are no services, or the business is never open", () => {
    expect(planSampleBookings([], DEFAULT_SETTINGS, new Date(2026, 9, 12))).toEqual([]);
    expect(planSampleBookings(svc, { ...DEFAULT_SETTINGS, hours: Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((d) => [d, null])) }, new Date(2026, 9, 12))).toEqual([]);
  });

  it("a plan that brought sample services (no bookings) gets sample bookings, marked samples, once", async () => {
    const hono = new Hono();
    const dataDir = mkdtempSync(join(tmpdir(), "bookings-plan-"));
    mkdirSync(join(dataDir, ".flock"), { recursive: true });
    writeFileSync(join(dataDir, ".flock", "import.json"), JSON.stringify({ importId: "p1", by: "agent:pa", rows: {}, samples: { services: [{ $key: "s1", name: "Physio", minutes: 45 }, { $key: "s2", name: "Review", minutes: 30 }] } }));
    const kit = await mountKit({ hono, env: { appId: "t", dataDir, apiUrl: null, token: null, agent: null } }, { schema, dbFile: ":memory:", appName: "T", settings: SETTINGS, privateTables: { bookings: "x" } });
    const n = (q: string) => (kit.sqlite.query(q).get() as { n: number }).n;
    expect(n(`SELECT count(*) AS n FROM bookings`)).toBe(0);
    addPlanSampleBookings(kit);
    const made = n(`SELECT count(*) AS n FROM bookings`);
    expect(made).toBeGreaterThanOrEqual(2);
    expect(n(`SELECT count(*) AS n FROM _samples WHERE table_name = 'bookings'`)).toBe(made);
    addPlanSampleBookings(kit);   // a second boot adds nothing
    expect(n(`SELECT count(*) AS n FROM bookings`)).toBe(made);
    kit.sqlite.query(`DELETE FROM bookings`).run();
    addPlanSampleBookings(kit);   // the owner emptied it: it stays empty
    expect(n(`SELECT count(*) AS n FROM bookings`)).toBe(0);
    kit.sqlite.close();
  });
  it("is skipped, never fatal, unless the kit is writable and ok (blocked schema, failed import, check mode)", () => {
    const boom = new Proxy({}, { get() { throw new Error("must not be touched"); } });
    for (const [status, imp] of [["blocked", "none"], ["ok", "failed"]] as const)
      expect(addPlanSampleBookings({ db: boom, sqlite: boom, status: { state: status }, importState: { state: imp }, ctx: { dataDir: "/nonexistent" }, settings: boom, flagSamples: boom } as any)).toBe(0);
    process.env.FLOCK_KIT_SCHEMA = "check";
    try { expect(addPlanSampleBookings({ db: boom, sqlite: boom, status: { state: "ok" }, importState: { state: "done" }, ctx: { dataDir: "/nonexistent" }, settings: boom, flagSamples: boom } as any)).toBe(0); }
    finally { delete process.env.FLOCK_KIT_SCHEMA; }
    // a failure inside is logged, not thrown
    expect(addPlanSampleBookings({ db: boom, sqlite: boom, status: { state: "ok" }, importState: { state: "done" }, ctx: { dataDir: "/nonexistent" }, settings: boom, flagSamples: boom } as any)).toBe(0);
  });
  it("adds none when the services are the owner's, not samples", async () => {
    const hono = new Hono();
    const dataDir = mkdtempSync(join(tmpdir(), "bookings-plan-"));
    mkdirSync(join(dataDir, ".flock"), { recursive: true });
    writeFileSync(join(dataDir, ".flock", "import.json"), JSON.stringify({ importId: "p2", by: "agent:pa", rows: { services: [{ $key: "s1", name: "Physio", minutes: 45 }] } }));
    const kit = await mountKit({ hono, env: { appId: "t", dataDir, apiUrl: null, token: null, agent: null } }, { schema, dbFile: ":memory:", appName: "T", settings: SETTINGS, privateTables: { bookings: "x" } });
    addPlanSampleBookings(kit);
    expect((kit.sqlite.query(`SELECT count(*) AS n FROM bookings`).get() as { n: number }).n).toBe(0);
    kit.sqlite.close();
  });
});
