/**
 * BLOCK-LEVEL addressing verdict for a thread. The per-message `addressingOf` and its types
 * were promoted to shared/ (B-6 inversion) because they are generic messaging logic consumed by
 * shared/task-gates.ts (used by wiki too). This block-level wrapper stays with email-desk, which
 * is its only consumer (harvest-runner), and composes the shared per-message verdict.
 *
 * WHAT IT IS NOT. It is not, on its own, the answer to "is this a broadcast?". Addressing is ONE
 * input the model reads alongside the profile and the importance policy; it does not gate here.
 */

import { addressingOf, type AddressedSegment, type Addressing } from "./addressing-core";

/**
 * The addressing verdict for a whole block (= a thread).
 *
 * THE RESOLUTION RULE, in one line: the strongest thing we can honestly say.
 *
 *   - any message with the user on To  → `to`   (one direct ask makes it direct)
 *   - else any message copying them    → `cc`
 *   - else, only if EVERY message was readable and named them nowhere
 *                                      → `not-addressed`
 *   - else                             → `unknown`
 *
 * The third clause is the careful one. A thread of five messages where four are
 * recovered from a parked body is mostly unreadable, and calling that
 * "not-addressed" would be a confident negative drawn from one message. A
 * negative has to be earned by reading all of them.
 */
export function blockAddressing(
  segments: readonly AddressedSegment[],
  ownerAddresses: readonly string[],
): Addressing {
  try {
    const list = Array.isArray(segments) ? segments : [];
    if (list.length === 0) return "unknown";

    let sawCc = false;
    let allKnown = true;

    for (const seg of list) {
      const verdict = addressingOf(seg, ownerAddresses);
      if (verdict === "to") return "to";
      if (verdict === "cc") sawCc = true;
      if (verdict === "unknown") allKnown = false;
    }

    if (sawCc) return "cc";
    return allKnown ? "not-addressed" : "unknown";
  } catch {
    // A malformed row must never cost the extraction. Say we do not know.
    return "unknown";
  }
}
