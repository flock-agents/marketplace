// A 15-minute heartbeat (docs/V3-FLOW-SPEC.md "Timeline for one shopping window"): keeps the plan current, lets go
// drafts nobody said yes to (silently, inside refreshShopping), and wakes the agent for exactly the message a window
// is due — reminder, heads-up or price — each once, inside the budget and quiet hours (server/messages.ts). The agent
// sends what the app asks, nothing more; nothing due → no model call.
import { appEmit } from "../appEmit";
import { eq } from "drizzle-orm";
import type { Database } from "bun:sqlite";
import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import { carts } from "../db/schema";
import { settingsReaderFrom } from "../settings";
import { orderAtOf, refreshShopping } from "../shopping";
import { draftView, type DraftView } from "../draft";
import { cancelMessage, requestMessage, type MessageSlot } from "../messages";
import { pantryCheckDue, type PantryDue } from "../stock";
import { rememberRoutineId } from "../routineRegistry";

interface Ctx {
  wakeAgent(message: string, data?: unknown): Promise<unknown>;
  routine: { id: string };
  platform: { dataDir: string };
  kit: { db: BunSQLiteDatabase<any>; sqlite: Database; emitChange(table: string, id: string, op: "insert" | "update" | "delete", by: string): void };
}
export interface Wake { message: string; data: Record<string, unknown> }

const RULES = "The list is the app's (call the get_draft operation again before quoting it later); every change the family asks for goes through "
  + "the edit_draft or move_window operation, and you reply with the app's updated draft. Silence means carry on: never "
  + "follow up, never answer your own question, never order without a family member's explicit yes.";
const when = (stampStr: string) => stampStr.replace("T", " ");
const spanText = (v: DraftView) => (v.span ? ` covering ${v.span.label}` : "");
const lineFacts = (v: DraftView) => v.lines.map((l) => ({ key: l.key, item: l.item, range: l.range }));
const ack = (id: string) => `When it's sent, call ack_message {message_id: "${id}"}. Send nothing else.`;
const base = (v: DraftView, slot: MessageSlot, messageId: string) =>
  ({ slot, message_id: messageId, cart_id: v.id, order_at: v.order_at, span: v.span, lines: lineFacts(v) });

/** The heads-up card: the draft as a Flock chat Checklist, every line ticked — unticking drops it. */
export function draftChecklistCard(v: DraftView) {
  return {
    type: "MiniApp", id: `draft-${v.id}`, props: { title: v.span ? `Next order · ${v.span.label}` : "Next order" },
    children: [{ type: "Checklist", id: "lines", props: { items: v.lines.map((l) => ({ id: l.key, label: l.item, done: true, ...(l.range ? { meta: l.range } : {}) })) } }],
  };
}

export function reminderWake(v: DraftView, messageId: string, pantry: PantryDue[]): Wake {
  const ask = pantry.length
    ? " data.pantry_check lists kitchen items due a check: ask ONE question (one question card) about the few that matter for these meals, and apply the answers through the app."
    : " Ask nothing unless something in it needs the family.";
  return {
    message: `Shopping reminder (message slot: reminder, message id ${messageId}). The next order is due ${when(v.order_at)} (cart ${v.id})${spanText(v)}. `
      + `Send the family ONE short message: what's due and when, and the meals it covers, from data.lines.${ask} ${RULES} ${ack(messageId)}`,
    data: { ...base(v, "reminder", messageId), pantry_check: pantry },
  };
}

export function headsUpWake(v: DraftView, messageId: string): Wake {
  return {
    message: `Shopping heads-up (message slot: heads_up, message id ${messageId}). The order${spanText(v)} goes out at ${when(v.order_at)} (cart ${v.id}). `
      + `Post data.card as it is (a flock-ui block: the app's draft, every line ticked) with "Anything to cancel or add?". Unticked lines → edit_draft `
      + `{cart_id, remove: [their ids]}; anything they name → edit_draft {cart_id, add: [{item, qty}]}. No reply = the list stands. ${RULES} ${ack(messageId)}`,
    data: { ...base(v, "heads_up", messageId), card: draftChecklistCard(v) },
  };
}

export function priceWake(v: DraftView, messageId: string, services: unknown): Wake {
  return {
    message: `Shopping price step (message slot: price, message id ${messageId}) for the order${spanText(v)} (cart ${v.id}). Call get_draft for the exact lines. `
      + `On each connected service in data.services, fill a cart with those lines (each range to a real pack) and call add_quote `
      + `{cart_id: "${v.id}", service, total, fees, lines, screenshot_url} — the reply names the best service. Then send ONE message: the best service, its rough total and its cart `
      + `screenshot, and ask once for a yes (one question card); if no service could be filled, say so instead. On a family member's yes: record_yes `
      + `{cart_id: "${v.id}", service, by}, place the order, then record_order {cart_id: "${v.id}", service, total, order_ref, delivery_eta} before saying it's done. `
      + `No yes → do nothing: the app lets the draft go at ${when(v.times.let_go)} and its still-useful items move to the next order. ${RULES} ${ack(messageId)}`,
    data: { ...base(v, "price", messageId), services, let_go_at: v.times.let_go },
  };
}

/** The owner's "Order with <service>" in the app: their explicit yes, already recorded (POST /api/carts/:id/order). */
export function orderYesWake(v: DraftView, service: string, by: string | null): Wake {
  return {
    message: `${by ?? "The owner"} said yes in the app: place the order${spanText(v)} (cart ${v.id}) with ${service} now. Call get_draft and place exactly `
      + `those lines (the ${service} quote, when there is one), then record_order {cart_id: "${v.id}", service, total, order_ref, delivery_eta} before telling the family `
      + `it's done. The yes is recorded; don't ask again. If it can't be placed, say so once.`,
    data: { cart_id: v.id, service, by, order_at: v.order_at, span: v.span, lines: lineFacts(v), quote: v.quotes.find((q) => q.service === service) ?? null },
  };
}

const delivered = (res: unknown) => !!res && (res as { ok?: boolean }).ok !== false;

/** The routine's real body, with `now` as a parameter so a test can pin it. */
export async function runShoppingTimeline(ctx: Ctx, now: Date): Promise<void> {
  rememberRoutineId(ctx.platform.dataDir, ctx.routine.id);   // so the app's "Order with …" can wake this same routine
  const db = ctx.kit.db;
  const settings = settingsReaderFrom(ctx.kit.sqlite);
  const emit = appEmit(ctx.kit);
  refreshShopping(db, settings, now, emit);

  const drafts = (db.select().from(carts).where(eq(carts.status, "draft")).all() as (typeof carts.$inferSelect)[])
    .sort((a, b) => orderAtOf(a).localeCompare(orderAtOf(b)));
  for (const cart of drafts) {
    const v = draftView(db, settings, cart.id, now);
    if (!v || v.yes || !v.lines.length || !v.next_message?.due) continue;
    const slot = v.next_message.slot;
    const messageId = requestMessage(db, cart.id, slot, now);
    if (!messageId) continue;
    const wake = slot === "reminder" ? reminderWake(v, messageId, pantryCheckDue(db, now))
      : slot === "heads_up" ? headsUpWake(v, messageId)
      : priceWake(v, messageId, settings.get("services"));
    const res = await ctx.wakeAgent(wake.message, wake.data).catch(() => null);
    if (!delivered(res)) cancelMessage(db, messageId);   // never reached the agent: asked again next tick
  }
}

export default function shoppingTimeline(ctx: Ctx): Promise<void> {
  return runShoppingTimeline(ctx, new Date());
}
