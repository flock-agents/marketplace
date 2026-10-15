import type { Context, Hono } from "hono";
import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import { and, asc, eq, gte, lt, ne, sql } from "drizzle-orm";
import { nowIso, type Settings } from "@flock/app-kit";
import { bookings, services } from "./db/schema";
import { STATUSES, fromMin, hoursFor, isRealDate, isRealStart, overlaps, toMin, usableSettings, withinHours, type BookingSettings } from "./db/constants";

type Db = BunSQLiteDatabase<any>;
type Row = typeof bookings.$inferSelect;
export type Failure = { status: 400 | 404 | 409; body: { error: string; message: string; field?: string } };
const bad = (field: string, message: string): Failure => ({ status: 400, body: { error: "invalid", field, message } });

const FIELDS = ["customer_name", "phone", "service_id", "start", "status", "notes"] as const;
const isFail = (v: unknown): v is Failure => typeof v === "object" && v !== null;
const clock = (start: string) => start.slice(11);

/** The day after `date`, for a half-open range on the text column. */
const nextDay = (date: string): string => {
  const [y, m, d] = date.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + 1));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}-${String(t.getUTCDate()).padStart(2, "0")}`;
};

/** The bookings that hold time on a day: everything except cancelled, optionally leaving one out (the booking being edited). */
function holding(db: Db, date: string, exceptId?: string): Row[] {
  const rows = db.select().from(bookings)
    .where(and(gte(bookings.start, date), lt(bookings.start, nextDay(date)), ne(bookings.status, "cancelled"))).all();
  return exceptId ? rows.filter((r) => r.id !== exceptId) : rows;
}

/** Validate a create (`current` null) or an edit, and return the row to write. One place for every rule, so the page and an agent get the same answers. */
export function checkBooking(db: Db, s: BookingSettings, input: unknown, current: Row | null): { ok: true; values: Omit<Row, "id" | "created_at" | "updated_at" | "updated_by"> } | { ok: false; failure: Failure } {
  const fail = (failure: Failure) => ({ ok: false as const, failure });
  if (!input || typeof input !== "object" || Array.isArray(input)) return fail({ status: 400, body: { error: "invalid", message: "body must be a JSON object" } });
  const body = input as Record<string, unknown>;
  for (const k of Object.keys(body)) if (!(FIELDS as readonly string[]).includes(k)) return fail(bad(k, `unknown field "${k}"; use ${FIELDS.join(", ")}`));
  const has = (k: string) => body[k] !== undefined;
  const text = (k: string, max: number, required: boolean, prior: string | null): string | null | Failure => {
    if (!has(k)) return prior;
    const v = body[k];
    if (v === null && !required) return null;
    if (typeof v !== "string") return bad(k, `${k} must be text`);
    const t = v.trim();
    if (!t) return required ? bad(k, `${k} is required`) : null;
    return t.length > max ? bad(k, `${k} is at most ${max} characters`) : t;
  };
  const name = text("customer_name", 120, true, current?.customer_name ?? null);
  const phone = text("phone", 30, false, current?.phone ?? null);
  const notes = text("notes", 500, false, current?.notes ?? null);
  if (isFail(name)) return fail(name);
  if (isFail(phone)) return fail(phone);
  if (isFail(notes)) return fail(notes);
  if (!name) return fail(bad("customer_name", "customer_name is required"));

  const serviceId = has("service_id") ? body.service_id : current?.service_id;
  if (typeof serviceId !== "string" || !serviceId) return fail(bad("service_id", "service_id is required"));
  // The service is looked up only when it is being set: a booking whose service was deleted can still be marked done or cancelled.
  const serviceChanged = !current || serviceId !== current.service_id;
  const service = serviceChanged ? db.select().from(services).where(eq(services.id, serviceId)).get() : undefined;
  if (serviceChanged && !service) return fail(bad("service_id", `no service with id "${serviceId}"; list them at /api/_data/services`));

  const start = has("start") ? body.start : current?.start;
  if (typeof start !== "string" || !isRealStart(start)) return fail(bad("start", 'start must be a local date-time like "2026-10-09T10:30" (no time zone)'));

  const status = has("status") ? body.status : current?.status ?? "booked";
  if (typeof status !== "string" || !(STATUSES as readonly string[]).includes(status)) return fail(bad("status", `status must be one of ${STATUSES.join(", ")}`));

  // The length is fixed when the booking is made; changing the service re-measures it, editing anything else does not.
  const minutes = serviceChanged ? service!.minutes : current!.minutes;
  // Opening hours and clashes are judged only when the booking's time or length changes, or it comes back from cancelled. Marking done or no-show never re-runs them,
  // so a booking made under older hours stays valid and keeps its time until it is moved (I7).
  const occupies = !current || (has("start") && start !== current.start) || serviceChanged || current.status === "cancelled";
  if (status !== "cancelled" && occupies) {
    const hours = hoursFor(s, start.slice(0, 10));
    if (!hours) return fail(bad("start", `closed on ${start.slice(0, 10)}`));
    if (!withinHours(s, start, minutes)) return fail(bad("start", `a ${minutes}-minute booking at ${clock(start)} falls outside opening hours (${hours[0]} to ${hours[1]})`));
    const clash = holding(db, start.slice(0, 10), current?.id).find((o) => overlaps(start, minutes, o.start, o.minutes));
    if (clash) return fail({ status: 409, body: { error: "slot_taken", field: "start", message: `${clock(clash.start)} to ${fromMin(toMin(clock(clash.start)) + clash.minutes)} is already booked (${clash.customer_name}); pick another time` } });
  }
  return { ok: true, values: { customer_name: name, phone, service_id: serviceId, start, minutes, status, notes } };
}

/** Which start times on a day are not free for a booking of `length` minutes, on the grid of the current hours and slot length.
 *  Every grid slot a booking touches is taken, including a booking made under older hours that now sits partly or wholly outside them. */
export function slotsFor(db: Db, s: BookingSettings, date: string, length: number) {
  const hours = hoursFor(s, date);
  if (!hours) return { date, closed: true as const, open: null, close: null, slotMinutes: s.slot_minutes, length, taken: [] as string[] };
  const day = holding(db, date);
  const taken: string[] = [];
  for (let m = toMin(hours[0]); m + length <= toMin(hours[1]); m += s.slot_minutes) {
    const at = `${date}T${fromMin(m)}`;
    if (day.some((o) => overlaps(at, length, o.start, o.minutes))) taken.push(fromMin(m));
  }
  return { date, closed: false as const, open: hours[0], close: hours[1], slotMinutes: s.slot_minutes, length, taken };
}

const withService = (db: Db, rows: Row[]) => {
  const names = new Map(db.select().from(services).all().map((v) => [v.id, v.name] as const));
  return rows.map((r) => ({ ...r, service_name: names.get(r.service_id) ?? "Deleted service" }));
};

const who = (c: Context): string => {
  const ok = (v: string | undefined) => { const t = v?.trim(); return t && /^[\x20-\x7E]{1,128}$/.test(t) ? t : null; };
  const agent = ok(c.req.header("x-flock-agent")); if (agent) return `agent:${agent}`;
  const user = ok(c.req.header("x-flock-user")); return user ? `user:${user}` : "app";
};
const json = async (c: Context): Promise<unknown> => { try { return await c.req.json(); } catch { return null; } };

type Emit = (table: string, id: string, op: "insert" | "update" | "delete", by: string) => void;

/** The current hours and slot length, read on every request so a PATCH to the settings takes effect at once. */
export const currentSettings = (settings: Settings): BookingSettings =>
  usableSettings({ hours: settings.get("hours"), slot_minutes: settings.get("slot_minutes") });

/** Bookings are written only here, so the overlap rule cannot be skipped. Times are local (IST) strings throughout. */
type Flag = <R extends Record<string, unknown>>(table: string, rows: R[]) => R[];
export function mountBookingRoutes(hono: Hono, db: Db, emit: Emit, settings: Settings, flag: Flag = (_t, rows) => rows) {
  hono.get("/api/slots", (c) => {
    const date = c.req.query("date") ?? "";
    if (!isRealDate(date)) return c.json({ error: "invalid", field: "date", message: "date must look like 2026-10-09" }, 400);
    const sid = c.req.query("service_id");
    const s = currentSettings(settings);
    let length = s.slot_minutes;
    if (sid) {
      const svc = db.select().from(services).where(eq(services.id, sid)).get();
      if (!svc) return c.json({ error: "invalid", field: "service_id", message: `no service with id "${sid}"` }, 400);
      length = svc.minutes;
    }
    return c.json(slotsFor(db, s, date, length));
  });

  hono.get("/api/bookings", (c) => {
    const q = (k: string) => c.req.query(k);
    for (const k of ["from", "to"]) if (q(k) !== undefined && !isRealDate(q(k)!)) return c.json({ error: "invalid", field: k, message: `${k} must look like 2026-10-09` }, 400);
    const status = q("status");
    if (status !== undefined && !(STATUSES as readonly string[]).includes(status)) return c.json({ error: "invalid", field: "status", message: `status must be one of ${STATUSES.join(", ")}` }, 400);
    const limitRaw = q("limit");
    const limit = limitRaw === undefined ? 100 : Number(limitRaw);
    if (!Number.isInteger(limit) || limit < 1 || limit > 500) return c.json({ error: "invalid", field: "limit", message: "limit must be a whole number from 1 to 500" }, 400);
    let offset = 0;
    if (q("cursor") !== undefined) {
      let n = NaN; try { n = Number(atob(q("cursor")!)); } catch { /* not base64 */ }
      if (!Number.isInteger(n) || n < 0) return c.json({ error: "invalid", field: "cursor", message: "cursor is not one this app gave out" }, 400);
      offset = n;
    }
    const where = and(
      q("from") ? gte(bookings.start, q("from")!) : undefined,
      q("to") ? lt(bookings.start, nextDay(q("to")!)) : undefined,
      status ? eq(bookings.status, status) : undefined,
    );
    const rows = db.select().from(bookings).where(where).orderBy(asc(bookings.start), asc(sql`rowid`)).limit(limit + 1).offset(offset).all();
    const more = rows.length > limit;
    return c.json({ rows: flag("bookings", withService(db, rows.slice(0, limit))), nextCursor: more ? btoa(String(offset + limit)) : null });
  });

  hono.get("/api/bookings/:id", (c) => {
    const row = db.select().from(bookings).where(eq(bookings.id, c.req.param("id"))).get();
    return row ? c.json({ row: flag("bookings", withService(db, [row]))[0] }) : c.json({ error: "not_found", message: "no such booking" }, 404);
  });

  hono.post("/api/bookings", async (c) => {
    const checked = checkBooking(db, currentSettings(settings), await json(c), null);
    if (!checked.ok) return c.json(checked.failure.body, checked.failure.status);
    const by = who(c);
    // Check and write happen with no await between them, so two requests can never both take the same slot.
    const row = db.insert(bookings).values({ ...checked.values, updated_by: by }).returning().get();
    emit("bookings", row.id, "insert", by);
    return c.json({ row: withService(db, [row])[0] }, 201);
  });

  hono.patch("/api/bookings/:id", async (c) => {
    const id = c.req.param("id");
    const current = db.select().from(bookings).where(eq(bookings.id, id)).get();
    if (!current) return c.json({ error: "not_found", message: "no such booking" }, 404);
    const checked = checkBooking(db, currentSettings(settings), await json(c), current);
    if (!checked.ok) return c.json(checked.failure.body, checked.failure.status);
    const by = who(c);
    const row = db.update(bookings).set({ ...checked.values, updated_at: nowIso(), updated_by: by }).where(eq(bookings.id, id)).returning().get()!;
    emit("bookings", id, "update", by);
    return c.json({ row: withService(db, [row])[0] });
  });

  hono.delete("/api/bookings/:id", (c) => {
    const id = c.req.param("id");
    const row = db.delete(bookings).where(eq(bookings.id, id)).returning().get();
    if (!row) return c.json({ error: "not_found", message: "no such booking" }, 404);
    emit("bookings", id, "delete", who(c));
    // Not in the kit's change log (the table is private), so there is no changeId: the page undoes by booking the same details again.
    return c.json({ ok: true, row });
  });
}

