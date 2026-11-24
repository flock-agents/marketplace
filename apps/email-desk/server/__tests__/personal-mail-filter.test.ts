// server/tests/personal-mail-filter.test.ts
// The personal-mailbox filter (spec §1) against the dummy mail's expected verdicts: pure code, no model.
import { describe, test, expect } from "bun:test";
import { personalVerdict, isPersonalMailbox } from "../lib/personal-mail-rules";
import { CASES, FAMILY, PERSONAL_MAILBOX } from "./fixtures/personal-mail-cases";

const addressOf = (s: string) => (s.match(/<([^>]+)>/)?.[1] ?? s).trim().toLowerCase();
// The names test reads the message text only, as the harvest passes it (no headers).
const text = (c: (typeof CASES)[number]) => c.body;

describe("personal mailbox", () => {
  test("plain Gmail is personal; any other domain is work", () => {
    expect(isPersonalMailbox("shiva.test@gmail.com")).toBe(true);
    expect(isPersonalMailbox("Shiva.Test@GoogleMail.com")).toBe(true);
    expect(isPersonalMailbox("shiva@example.com")).toBe(false);
    expect(isPersonalMailbox("shiva@gmail.com.evil.io")).toBe(false);
    expect(isPersonalMailbox("")).toBe(false);
    expect(isPersonalMailbox(null)).toBe(false);
  });
});

describe("personal filter: every dummy mail's verdict and rule", () => {
  for (const c of CASES.filter((x) => x.mailbox !== "work")) {
    test(`${c.id} ${c.title}: ${c.filter.keep ? "keep" : "drop"} by rule ${c.filter.rule}`, () => {
      const v = personalVerdict({ from: addressOf(c.from), subject: c.subject, text: text(c), bulk: !!c.unsubscribe }, FAMILY);
      expect({ keep: v.keep, rule: v.rule }).toEqual({ keep: c.filter.keep, rule: c.filter.rule });
    });
  }
});

describe("personal filter: edges", () => {
  const v = (from: string, subject: string, opts: { bulk?: boolean; text?: string; family?: typeof FAMILY } = {}) =>
    personalVerdict({ from, subject, text: opts.text ?? subject, bulk: !!opts.bulk }, opts.family ?? FAMILY);

  test("whole words only: 'taxi' is not 'tax', 'credit card' is not 'credited', 'dueling' is not 'due'", () => {
    expect(v("rides@uber.com", "Your taxi receipt").rule).toBe(8);
    expect(v("cards@bank.com", "Your new credit card").rule).toBe(8);
    expect(v("club@fencing.in", "Dueling lessons").rule).toBe(8);
  });
  test("overdue is owed", () => {
    expect(v("ebill@power.in", "Overdue: pay by 18 Dec")).toMatchObject({ keep: true, rule: 2 });
  });
  test("a keep subject beats a role sender (owner's order)", () => {
    expect(v("alerts@axisbank.com", "Payment due reminder")).toMatchObject({ keep: true, rule: 2 });
  });
  test("a school's subdomain is the school", () => {
    expect(v("news@mail.greenwoodhigh.edu.in", "Sports day")).toMatchObject({ keep: true, rule: 1 });
  });
  test("role tokens split on separators and digits, not inside words", () => {
    expect(v("alerts2@bank.com", "Hi").rule).toBe(3);
    expect(v("hello.team@shop.in", "Hi").rule).toBe(3);
    expect(v("othello@theatre.in", "Hi").rule).toBe(8);
  });
  test("no-reply in any spelling", () => {
    for (const a of ["noreply@x.com", "no-reply@x.com", "no_reply@x.com", "donotreply@x.com", "do-not-reply@x.com", "do_not_reply@x.com"]) expect(v(a, "Hi").rule).toBe(4);
  });
  test("bulk mail naming a child is kept; with no names known, bulk is kept (fails open)", () => {
    expect(v("club@chess.in", "Weekend batch", { bulk: true, text: "Agastya's batch moves to 10 am" }).rule).toBe(8);
    expect(v("club@chess.in", "Weekend batch", { bulk: true, text: "Batch moves to 10 am", family: { ...FAMILY, names: [] } }).rule).toBe(8);
  });
  test("an unreadable sender skips the sender rules only", () => {
    expect(v("", "Your OTP is 1234").rule).toBe(5);
    expect(v("", "Hello").rule).toBe(8);
  });
  test("the mailbox owner writing to themself is a family address", () => {
    expect(v(PERSONAL_MAILBOX, "note to self").rule).toBe(1);
  });
});
