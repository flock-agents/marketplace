// MIRROR of server/src/shared/calendar-auto-response.ts — keep identical (pinned by server/tests/calendar-auto-response.test.ts).
// drafting hand-off's sender check (shouldTrigger, via config.calendarPrefixes) and by memory
// eligibility. The union of the two old lists: shouldTrigger had "tentatively accepted",
// memory-eligibility had "invitation from". skills/gmail/scripts/_calendarAutoResponse.ts is a
// byte-identical mirror (skills ship as installed packages server/ cannot import);
// calendar-auto-response.test.ts pins the two equal.
export const CALENDAR_AUTO_RESPONSE_PREFIXES: readonly string[] = [
  "accepted",
  "declined",
  "tentatively accepted",
  "tentative",
  "invitation",
  "invitation from",
  "updated invitation",
  "cancelled event",
  "canceled event",
];

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Anchored at the start, the prefix then a colon: "Accepted the offer" stays a human subject. */
export function calendarResponseRe(prefixes: readonly string[] = CALENDAR_AUTO_RESPONSE_PREFIXES): RegExp {
  const alts = [...prefixes]
    .map((p) => (typeof p === "string" ? p.trim().toLowerCase() : ""))
    .filter(Boolean)
    .sort((a, b) => b.length - a.length) // longest first: "tentatively accepted" before "tentative"
    .map((p) => escape(p).replace(/\s+/g, "\\s+"));
  return new RegExp(`^(?:${alts.join("|")})\\s*:`, "i");
}

export function isCalendarAutoResponse(subjectOrPreview: string, prefixes?: readonly string[]): boolean {
  if (typeof subjectOrPreview !== "string") return false;
  return calendarResponseRe(prefixes).test(subjectOrPreview.trimStart());
}
