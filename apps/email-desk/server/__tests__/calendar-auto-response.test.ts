// P21.3: ONE calendar auto-response list for drafting and memory (owner, 2026-10-10).
import { describe, test, expect } from "bun:test";
import { CALENDAR_AUTO_RESPONSE_PREFIXES, isCalendarAutoResponse } from "../lib/calendar-auto-response";
import { isMemoryEligible } from "../lib/memory-eligibility";

describe("one calendar auto-response list", () => {
  test("is the union of both old lists", () => {
    for (const p of ["accepted", "declined", "tentatively accepted", "tentative", "invitation",
      "updated invitation", "cancelled event", "canceled event", "invitation from"]) {
      expect(CALENDAR_AUTO_RESPONSE_PREFIXES).toContain(p);
    }
  });
  test("matches only an anchored prefix with a colon", () => {
    expect(isCalendarAutoResponse("Tentatively accepted: 30 min sync")).toBe(true);
    expect(isCalendarAutoResponse("Invitation from: Priya Shah")).toBe(true);
    expect(isCalendarAutoResponse("  Declined : weekly")).toBe(true);
    expect(isCalendarAutoResponse("Accepted the offer, when do we start?")).toBe(false);
    expect(isCalendarAutoResponse("Re: Accepted: sync")).toBe(false);
    expect(isCalendarAutoResponse("")).toBe(false);
  });
  test("memory now drops 'Tentatively accepted:' (was drafting-only)", () => {
    const entry = { actor: { email: "priya@acme.com" }, preview: "Tentatively accepted: sync — ", raw: { subject: "Tentatively accepted: sync" } } as any;
    expect(isMemoryEligible(entry, {} as any)).toEqual({ eligible: false, reason: "calendar_autoresponse" });
  });
});
