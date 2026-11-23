// The block-level task gates, ported from Flock's shared/task-gates.ts (pure: no DB, no network). Only the two the extract
// item carries are here: `blockTaskGate` (a thread the person alone wrote is labelled `selfAuthored`, so the extraction
// mints only their own commitments from it, never their asks of others) and `senderKindOf` (a role or no-reply mailbox on
// the other end caps it to one item). The item-level gates (itemGate, replyGate, dueBorrowed) run inside Flock's extraction
// and stay there. memory-relay.ts: "three correct gates, all inert live" because the relay stopped sending their inputs.
import { isAutomatedSender } from "./automated-sender";

export interface GateSegment { from: string; text: string; to?: string[]; cc?: string[] }

export function authorOf(from: string): string {
  const t = (from ?? "").trim().toLowerCase();
  const angled = t.match(/<([^>]+)>/);
  return (angled ? angled[1]! : t).trim();
}

export function isOwnerAuthored(from: string, ownerAddresses: readonly string[]): boolean {
  const a = authorOf(from);
  if (!a) return false;
  return ownerAddresses.some((o) => o.trim().toLowerCase() === a);
}

export type BlockTaskGate = { tasks: true; selfAuthored?: true } | { tasks: false; reason: string };

/**
 * What kind of thread is this, for task purposes? A thread the owner alone wrote is LABELLED, not silenced (owner, 2026-09-22,
 * T11): `selfAuthored: true` rides the item to the prompt (only the user's own commitments) and to the item gate (first-person
 * words in the anchor message). Fails open on no owner identity and on an empty thread.
 */
export function blockTaskGate(segments: readonly GateSegment[], ownerAddresses: readonly string[]): BlockTaskGate {
  const owners = ownerAddresses.map((o) => o.trim().toLowerCase()).filter(Boolean);
  if (owners.length === 0 || segments.length === 0) return { tasks: true };
  const authored = segments.filter((s) => authorOf(s.from));
  if (authored.length === 0) return { tasks: true };
  return authored.every((s) => isOwnerAuthored(s.from, owners))
    ? { tasks: true, selfAuthored: true }
    : { tasks: true };
}

/**
 * Who is on the other end: a person, or a mailbox nobody staffs? The owner having spoken in the thread settles it (human).
 * Otherwise `automated` only when every other author is automated; `human` on any mix or with no other party (fails open).
 */
export function senderKindOf(segments: readonly GateSegment[], ownerAddresses: readonly string[]): "automated" | "human" {
  if (segments.some((s) => isOwnerAuthored(s.from, ownerAddresses))) return "human";
  const others = segments
    .map((s) => authorOf(s.from))
    .filter((a) => a && !isOwnerAuthored(a, ownerAddresses));
  if (others.length === 0) return "human";
  return others.every((a) => isAutomatedSender(a)) ? "automated" : "human";
}
