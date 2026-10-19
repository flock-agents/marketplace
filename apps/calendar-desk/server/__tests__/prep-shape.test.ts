import { describe, test, expect } from "bun:test";
import { prepShape, shapeChanged } from "../prep-shape";
import type { EventRow } from "../store";

const row = (over: Partial<EventRow> = {}): EventRow => ({
  accountId: "a", eventKey: "k", calendar: "primary", title: "Gym", allDay: false, localDate: "2026-10-05",
  startAt: new Date(2026, 9, 5, 7, 0).getTime(), endAt: new Date(2026, 9, 5, 8, 0).getTime(),
  attendeesText: "Yogesh Personal", location: null, rawTimeText: null, firstSeenAt: 1, lastSeenAt: 1, missingSince: null, missingConfirmed: false,
  source: "google", factId: null, sourceLink: null, googleEventId: null, guests: null, guestSummary: null, description: null, meetLink: null, detailsAt: null, ...over,
});
const read = (over: Partial<EventRow> = {}) => row({ detailsAt: 1, guests: [], ...over });

describe("shapeChanged", () => {
  test("another date at the same time is the same shape", () => {
    const next = row({ localDate: "2026-10-06", startAt: new Date(2026, 9, 6, 7, 0).getTime(), endAt: new Date(2026, 9, 6, 8, 0).getTime() });
    expect(shapeChanged(prepShape(row()), prepShape(next))).toBe(false);
  });
  test("a moved start, a new length, all-day or new attendee text is a change", () => {
    const was = prepShape(row());
    expect(shapeChanged(was, prepShape(row({ startAt: new Date(2026, 9, 5, 9, 0).getTime(), endAt: new Date(2026, 9, 5, 10, 0).getTime() })))).toBe(true);
    expect(shapeChanged(was, prepShape(row({ endAt: new Date(2026, 9, 5, 8, 30).getTime() })))).toBe(true);
    expect(shapeChanged(was, prepShape(row({ allDay: true, startAt: null, endAt: null })))).toBe(true);
    expect(shapeChanged(was, prepShape(row({ attendeesText: "Yogesh Personal, Coach" })))).toBe(true);
  });
  test("guests, location, description and Meet link are compared when both sides were read", () => {
    const was = prepShape(read());
    expect(shapeChanged(was, prepShape(read()))).toBe(false);
    expect(shapeChanged(was, prepShape(read({ guests: [{ email: "coach@gym.com" }] })))).toBe(true);
    expect(shapeChanged(was, prepShape(read({ location: "Cult, Indiranagar" })))).toBe(true);
    expect(shapeChanged(was, prepShape(read({ description: "Bring the fitness report" })))).toBe(true);
    expect(shapeChanged(was, prepShape(read({ meetLink: "https://meet.google.com/x" })))).toBe(true);
  });
  test("details not read now are unknown, not a change; details read now but not at judgement are new: a change", () => {
    expect(shapeChanged(prepShape(read({ description: "x" })), prepShape(row()))).toBe(false);
    expect(shapeChanged(prepShape(row()), prepShape(read()))).toBe(true);
  });
});
