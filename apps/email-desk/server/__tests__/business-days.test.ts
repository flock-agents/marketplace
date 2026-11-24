import { test, expect } from "bun:test";
import { addBusinessDays, isBusinessDaysElapsed } from "../lib/business-days";
const IST = "Asia/Kolkata";
const ist = (iso: string) => Date.parse(`${iso}+05:30`);

test("Mon 10:00 + 3 = Thu 10:00", () => {
  expect(addBusinessDays(ist("2026-09-21T10:00:00"), 3, IST)).toBe(ist("2026-09-24T10:00:00"));
});
test("Fri 16:00 + 3 skips the weekend = Wed 16:00", () => {
  expect(addBusinessDays(ist("2026-09-25T16:00:00"), 3, IST)).toBe(ist("2026-09-30T16:00:00"));
});
test("Fri 23:30 IST is still Friday in IST (not UTC's Friday 18:00 vs Saturday confusion) = Wed 23:30", () => {
  expect(addBusinessDays(ist("2026-09-25T23:30:00"), 3, IST)).toBe(ist("2026-09-30T23:30:00"));
});
test("sent on Saturday counts from Monday: Sat + 3 = Wed same clock time", () => {
  expect(addBusinessDays(ist("2026-09-26T11:00:00"), 3, IST)).toBe(ist("2026-09-30T11:00:00"));
});
test("a weekday in another zone: Mon 01:00 IST is Sunday in New York, so +1 business day is Monday there", () => {
  const sent = ist("2026-09-21T01:00:00"); // Sun 15:30 America/New_York
  expect(addBusinessDays(sent, 1, "America/New_York")).toBe(Date.parse("2026-09-21T15:30:00-04:00"));
});
test("isBusinessDaysElapsed is inclusive at the due instant", () => {
  const sent = ist("2026-09-21T10:00:00");
  expect(isBusinessDaysElapsed(sent, ist("2026-09-24T09:59:00"), 3, IST)).toBe(false);
  expect(isBusinessDaysElapsed(sent, ist("2026-09-24T10:00:00"), 3, IST)).toBe(true);
});
