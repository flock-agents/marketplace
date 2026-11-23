// Generic (messaging-shaped, not email-transport-shaped) sender classification. Promoted to
// shared/ from email-desk/memory-eligibility.ts (B-6 inversion): task-gates (used by wiki, a
// non-email extraction feature) needs it, so it must not live inside the email app. A pure
// local-part test over an address string — no DB, no domain state, no email-desk dependency.

// Role/program local-parts nobody personally staffs — an EXACT local-part match (fixed 2026-09-22).
const ROLE_LOCAL = new Set([
  "info", "sales", "hr", "support", "team", "hello", "newsletter", "marketing",
  "updates", "news", "offers", "program", "programs", "billing", "help",
  "contact", "admin", "office",
]);

/**
 * Is this an automated / role / no-reply sender (a tool talking, not a person)?
 *
 * The signal that separates "a stranger is pitching me" from "a tool I use is telling me
 * something" — and "a role nobody personally staffs". Nobody expects a reply to a no-reply
 * address or a program mailbox, so such mail is not outreach in any sense. Used by the
 * cold-outreach gate (email-desk/memory-eligibility.ts) and the task senderKindOf gate
 * (shared/task-gates.ts). Pure; never throws.
 */
export function isAutomatedSender(email: string): boolean {
  const local = email.slice(0, email.lastIndexOf("@")).toLowerCase();
  if (!local) return false;
  const squashed = local.replace(/[._-]/g, "");
  return (
    squashed.includes("noreply")
    || squashed.includes("donotreply")
    || squashed === "notifications"
    || squashed === "notification"
    || squashed === "mailerdaemon"
    || squashed === "bounce"
    || squashed === "bounces"
    || squashed.includes("support")
    || squashed.includes("newsletter")
    || squashed.includes("marketing")
    || ROLE_LOCAL.has(squashed)
  );
}
