// The message budget for one shopping window (docs/V3-FLOW-SPEC.md "Message budget"): at most three agent messages
// per draft — reminder, heads-up, price — each once, only outside quiet hours, and none the app didn't ask for. The
// timing rules are pure (unit-tested); the DB helpers keep `message_log` (server-only) as the record of what was asked.
import { eq } from "drizzle-orm";
import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import { message_log } from "./db/schema";
import { MESSAGE_SLOTS } from "./db/constants";
import { addDaysStr, addMinutes, dateOf, dateTime, type SettingsReader } from "./timeline";
import { bestMessageTime } from "./patterns";

type Db = BunSQLiteDatabase<any>;
export type MessageSlot = (typeof MESSAGE_SLOTS)[number];
export const MAX_MESSAGES_PER_WINDOW = MESSAGE_SLOTS.length;
/** A reminder that could only go out this close to the heads-up is skipped: the heads-up says it all. */
export const REMINDER_MIN_LEAD_MIN = 60;

export interface WindowTimes { reminder: string; heads_up: string; price: string; let_go: string }
export interface WindowSettings { reminderTime: string; headsUpMin: number; yesWaitH: number; quietStart: string; quietEnd: string }

/** The window's moments, local "YYYY-MM-DDTHH:MM": the reminder the evening before, the heads-up shortly before,
 *  the price step at the window itself, and the silent let-go once the yes wait is over. */
export function windowTimes(orderAt: string, s: Pick<WindowSettings, "reminderTime" | "headsUpMin" | "yesWaitH">): WindowTimes {
  return {
    reminder: dateTime(addDaysStr(dateOf(orderAt), -1), s.reminderTime),
    heads_up: addMinutes(orderAt, -s.headsUpMin),
    price: orderAt,
    let_go: addMinutes(orderAt, Math.round(s.yesWaitH * 60)),
  };
}

/** Quiet from `start` to `end` ("22:30" → "06:30" wraps midnight). */
export function inQuietHours(stamp: string, start: string, end: string): boolean {
  const t = stamp.slice(11, 16);
  return start > end ? t >= start || t < end : t >= start && t < end;
}

/** The first moment at or after `stamp` outside quiet hours. */
export function quietOver(stamp: string, start: string, end: string): string {
  if (!inQuietHours(stamp, start, end)) return stamp;
  const today = dateTime(dateOf(stamp), end);
  return today > stamp ? today : dateTime(addDaysStr(dateOf(stamp), 1), end);
}

export interface SlotPlan { slot: MessageSlot; due_at: string; due: boolean }

/** Which message this window sends next: each slot once, in order, inside its own stretch (a slot whose stretch is over
 *  before it could go out — quiet hours covered it — is skipped, never sent late). A draft that only appeared after its
 *  reminder moment (`createdAt`: it came late, or rolled over from a let-go draft) gets no reminder: the heads-up and
 *  price still come. Null once nothing is left to send. `due` says whether it goes out now. */
export function nextSlot(times: WindowTimes, logged: ReadonlySet<string>, nowStamp: string, s: Pick<WindowSettings, "quietStart" | "quietEnd">, createdAt?: string): SlotPlan | null {
  if (logged.size >= MAX_MESSAGES_PER_WINDOW) return null;
  const ends: Record<MessageSlot, string> = { reminder: addMinutes(times.heads_up, -REMINDER_MIN_LEAD_MIN), heads_up: times.price, price: times.let_go };
  for (const slot of MESSAGE_SLOTS) {
    if (logged.has(slot)) continue;
    if (slot === "reminder" && createdAt && createdAt > times.reminder) continue;
    const start = quietOver(times[slot] > nowStamp ? times[slot] : nowStamp, s.quietStart, s.quietEnd);
    if (start >= ends[slot]) continue;
    return { slot, due_at: start, due: start <= nowStamp };
  }
  return null;
}

export function windowSettings(db: Db, settings: SettingsReader): WindowSettings {
  return {
    reminderTime: bestMessageTime(db) ?? settings.get<string>("shop.reminder_time") ?? "20:00",
    headsUpMin: settings.get<number>("shop.heads_up_min") ?? 15,
    yesWaitH: settings.get<number>("shop.yes_wait_h") ?? 3,
    quietStart: settings.get<string>("quiet.start") ?? "22:00",
    quietEnd: settings.get<string>("quiet.end") ?? "07:00",
  };
}

// --- Database ------------------------------------------------------------------------------------------------------------
export interface LoggedMessage { id: string; slot: string; requested_at: string; sent_at: string | null }

export const messagesFor = (db: Db, cartId: string): LoggedMessage[] =>
  db.select({ id: message_log.id, slot: message_log.slot, requested_at: message_log.requested_at, sent_at: message_log.sent_at })
    .from(message_log).where(eq(message_log.cart_id, cartId)).all() as LoggedMessage[];

/** Logs that the app asks for this slot's message, returning its id — or null when the slot was already asked for
 *  or the window's budget is spent. The one gate every agent message of a window goes through. */
export function requestMessage(db: Db, cartId: string, slot: MessageSlot, now: Date): string | null {
  const logged = messagesFor(db, cartId);
  if (logged.length >= MAX_MESSAGES_PER_WINDOW || logged.some((m) => m.slot === slot)) return null;
  const row = db.insert(message_log).values({ cart_id: cartId, slot, requested_at: now.toISOString(), updated_by: "app" }).returning().get() as { id: string };
  return row.id;
}

/** The wake carrying it never reached the agent: forget the request so the next tick asks again. */
export function cancelMessage(db: Db, id: string): void {
  db.delete(message_log).where(eq(message_log.id, id)).run();
}

/** The agent's ack that it sent the message it was asked for. Idempotent. */
export function markMessageSent(db: Db, id: string, now: Date): LoggedMessage | null {
  const row = db.select().from(message_log).where(eq(message_log.id, id)).get() as LoggedMessage | undefined;
  if (!row) return null;
  if (row.sent_at) return row;
  const sentAt = now.toISOString();
  db.update(message_log).set({ sent_at: sentAt, updated_by: "app" }).where(eq(message_log.id, id)).run();
  return { ...row, sent_at: sentAt };
}
