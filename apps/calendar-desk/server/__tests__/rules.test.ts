import { describe, test, expect } from "bun:test";
import { readRemindersConfig, reminderFromFact, leadDaysFor, nextOccurrenceDate, rowOccurrencesDue, timedFireDue, titleForLead } from "../rules";

const cfg = readRemindersConfig(undefined);
const fact = (over: Partial<Parameters<typeof reminderFromFact>[0]> = {}) => ({ id: 1, content: "Vendor security questionnaire due 17 Oct 17:00.", kind: "event", dateRole: "deadline", when: { date: "2026-10-17", time: "17:00", recurrence: null }, salience: 0.8, sourceLink: "https://mail.google.com/x", ...over });

describe("config", () => {
  test("defaults and parsing of the comma list", () => {
    expect(cfg).toEqual({ publishHour: 6, includeFound: true, leadDaysBirthday: 7, leadDaysTravel: 2, leadDaysDeadline: [14, 3] });
    expect(readRemindersConfig({ leadDaysDeadline: "7, 1,x", publishHour: 5 }).leadDaysDeadline).toEqual([7, 1]);
  });
});

describe("reminderFromFact", () => {
  test("a user-relevant dated fact with a role becomes a reminder keyed to the fact", () => {
    const r = reminderFromFact(fact(), cfg, "2026-10-05")!;
    expect(r).toMatchObject({ sourceKind: "fact", sourceRef: "fact:1", dueDate: "2026-10-17", dueTime: "17:00", recurrence: "none", leadDays: [14, 3, 0], state: "active" });
    expect(r.title.length).toBeLessThanOrEqual(80);
  });
  test("no when, no role, low salience, or a past date → nothing", () => {
    expect(reminderFromFact(fact({ when: null }), cfg, "2026-10-05")).toBeNull();
    expect(reminderFromFact(fact({ dateRole: null }), cfg, "2026-10-05")).toBeNull();
    expect(reminderFromFact(fact({ salience: 0.2 }), cfg, "2026-10-05")).toBeNull();
    expect(reminderFromFact(fact({ when: { date: "2026-09-30", time: null, recurrence: null } }), cfg, "2026-10-05")).toBeNull();
  });
  test("an unrated fact (salience null) is allowed; a yearly occasion stays yearly", () => {
    expect(reminderFromFact(fact({ salience: null }), cfg, "2026-10-05")).not.toBeNull();
    const b = reminderFromFact(fact({ dateRole: "occasion", when: { date: "2027-03-12", time: null, recurrence: "yearly" } }), cfg, "2026-10-05")!;
    expect(b.recurrence).toBe("yearly"); expect(b.leadDays).toEqual([7, 0]);
  });
  test("includeFound=false yields nothing", () => {
    expect(reminderFromFact(fact(), { ...cfg, includeFound: false }, "2026-10-05")).toBeNull();
  });
});

describe("lead days and occurrences", () => {
  test("defaults per role", () => {
    expect(leadDaysFor("deadline", cfg)).toEqual([14, 3, 0]);
    expect(leadDaysFor("milestone", cfg)).toEqual([14, 3, 0]);
    expect(leadDaysFor("travel", cfg)).toEqual([2, 0]);
    expect(leadDaysFor("occasion", cfg)).toEqual([7, 0]);
    expect(leadDaysFor("appointment", cfg)).toEqual([1, 0]);
    expect(leadDaysFor("renewal", cfg)).toEqual([7, 1, 0]);
    expect(leadDaysFor(null, cfg)).toEqual([0]);
  });
  test("yearly occurrence rolls forward, incl. 29 Feb → 28 Feb in a common year", () => {
    expect(nextOccurrenceDate({ dueDate: "2026-03-12", recurrence: "yearly" }, "2026-10-05")).toBe("2027-03-12");
    expect(nextOccurrenceDate({ dueDate: "2024-02-29", recurrence: "yearly" }, "2026-10-05")).toBe("2027-02-28");
    expect(nextOccurrenceDate({ dueDate: "2026-10-09", recurrence: "none" }, "2026-10-05")).toBe("2026-10-09");
    expect(nextOccurrenceDate({ dueDate: "2026-10-01", recurrence: "none" }, "2026-10-05")).toBe("2026-10-01");
  });
  const rem = (over: any = {}) => ({ id: "r", title: "Renew visa", body: null, dueDate: "2026-10-19", dueTime: null, recurrence: "none", leadDays: [14, 3, 0], sourceKind: "user", sourceRef: null, sourceLink: null, accountId: null, state: "active", createdAt: 0, updatedAt: 0, ...over });
  test("rowOccurrencesDue: lead day 14 before 19 Oct is 5 Oct; day-of; nothing on other days; an overdue untimed reminder is still due day-of (Review Focus 1)", () => {
    expect(rowOccurrencesDue(rem(), "2026-10-05")).toEqual(["2026-10-19"]);
    expect(rowOccurrencesDue(rem(), "2026-10-19")).toEqual(["2026-10-19"]);
    expect(rowOccurrencesDue(rem(), "2026-10-10")).toEqual([]);
    expect(rowOccurrencesDue(rem({ dueDate: "2026-10-05" }), "2026-10-05")).toEqual(["2026-10-05"]);
  });
  test("a TIMED reminder: lead days publish rows, the day itself fires a chat", () => {
    const t = rem({ dueTime: "17:00" });
    expect(rowOccurrencesDue(t, "2026-10-05")).toEqual(["2026-10-19"]);
    expect(rowOccurrencesDue(t, "2026-10-19")).toEqual([]);
    expect(timedFireDue(t, new Date(2026, 9, 19, 16, 59))).toBeNull();
    expect(timedFireDue(t, new Date(2026, 9, 19, 17, 0))).toEqual({ occurrence: "2026-10-19", dueAt: new Date(2026, 9, 19, 17, 0).getTime() });
    expect(timedFireDue(t, new Date(2026, 9, 20, 9, 0))).toBeNull();
  });
  test("titles", () => {
    expect(titleForLead(rem(), "2026-10-19", "2026-10-05")).toBe("Renew visa — in 14 days (19 Oct)");
    expect(titleForLead(rem(), "2026-10-19", "2026-10-19")).toBe("Renew visa");
    expect(titleForLead(rem(), "2026-10-19", "2026-10-22")).toBe("Renew visa — 3 days overdue (19 Oct)");
    expect(titleForLead(rem(), "2026-10-19", "2026-10-20")).toBe("Renew visa — 1 day overdue (19 Oct)");
  });
});
