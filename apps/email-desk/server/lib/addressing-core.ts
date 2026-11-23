/**
 * WAS THIS THREAD/BLOCK ADDRESSED TO THE USER? — a pure function over the segments a block
 * already holds. Ported from Stych's directedness work
 * (docs/research/2026-09-10-stych-todo-pipeline-comparison.md §3.2).
 *
 * Promoted to shared/ from email-desk/addressing.ts (B-6 inversion): the per-message verdict
 * `addressingOf` is consumed by shared/task-gates.ts (used by wiki, a non-email feature), so it
 * is generic messaging logic, not email-transport logic. PURE: segments plus the owner's
 * addresses, both handed in. No DB, no network, no config. The block-level `blockAddressing`
 * wrapper stays in email-desk/addressing.ts and composes this.
 */

/** Everything this module needs off a segment: who it went to. */
export interface AddressedSegment {
  to?: string[];
  cc?: string[];
}

export type Addressing =
  /** The user is on the To line of at least one message. */
  | "to"
  /** The user is copied somewhere and never on a To line. */
  | "cc"
  /** We could read the recipients and the user is on none of them. */
  | "not-addressed"
  /** We could not tell, and must not pretend otherwise. */
  | "unknown";

/**
 * Lower an address to the bare, comparable thing. `getThread` already lowers
 * "Name <addr>" to `addr`, but a donated or parked body can carry the display
 * form, so this handles both rather than trusting one.
 */
function normalise(raw: unknown): string {
  if (typeof raw !== "string") return "";
  const t = raw.trim().toLowerCase();
  const angled = t.match(/<([^>]+)>/);
  return (angled ? angled[1] : t).trim();
}

function normaliseAll(values: readonly string[] | undefined): Set<string> | null {
  // ABSENT IS UNKNOWN, `[]` IS KNOWN-AND-EMPTY. The distinction is the whole
  // honesty of this module and it is load-bearing downstream — see BlockSegment.
  if (!Array.isArray(values)) return null;
  const out = new Set<string>();
  for (const v of values) {
    const n = normalise(v);
    if (n) out.add(n);
  }
  return out;
}

function anyOf(haystack: Set<string> | null, owners: Set<string>): boolean {
  if (!haystack) return false;
  for (const o of owners) if (haystack.has(o)) return true;
  return false;
}

/**
 * The addressing verdict for one message.
 *
 * Exported for the item-level directedness gate, which asks this question of the
 * single message a task's `sourceExcerpt` resolves back to.
 */
export function addressingOf(seg: AddressedSegment, ownerAddresses: readonly string[]): Addressing {
  const owners = normaliseAll(ownerAddresses as string[]);
  // No identity on record means we cannot conclude anything about recipients.
  // Failing open to `unknown` is the same choice resolveOwnerIdentity makes.
  if (!owners || owners.size === 0) return "unknown";

  const to = normaliseAll(seg?.to);
  const cc = normaliseAll(seg?.cc);
  if (to === null && cc === null) return "unknown";

  if (anyOf(to, owners)) return "to";
  if (anyOf(cc, owners)) return "cc";
  // Both lines readable and the user is on neither: a real negative.
  if (to !== null && cc !== null) return "not-addressed";
  // One line readable, the user absent from it, the other unreadable. The user
  // could be on the line we cannot see, so this is not a negative.
  return "unknown";
}
