// Ported from Flock tests/voice-sampling.test.ts (Task 2.9). Which sent mail is worth reading, and how to get the user's own prose out
// of a thread. Pure text work: no browser, no DB, no model.
import { describe, test, expect } from "bun:test";
import {
  threadIdFromPermalink, prefilterSentRows, stripQuotedReply, stripSignature,
  stripSharedTrailer, ownMessageText, isUsableSample, capSample,
  MIN_SAMPLE_CHARS, SAMPLE_CHAR_CAP,
} from "../voice/sampling";

const NOW = new Date("2026-09-10T12:00:00+05:30");
const longSnippet = "x".repeat(120);

describe("threadIdFromPermalink", () => {
  test("takes the id after the last slash", () => {
    expect(threadIdFromPermalink("https://mail.google.com/mail/u/0/#sent/abc123")).toBe("abc123");
    expect(threadIdFromPermalink("https://mail.google.com/mail/u/0/#inbox/FMfcgz")).toBe("FMfcgz");
  });
  test("a link with no fragment yields nothing", () => {
    expect(threadIdFromPermalink("https://mail.google.com/mail/u/0/")).toBe("");
    expect(threadIdFromPermalink("")).toBe("");
  });
});

describe("prefilterSentRows", () => {
  const row = (over: Partial<Parameters<typeof prefilterSentRows>[0][number]> = {}) => ({
    subject: "Re: pricing", snippet: longSnippet, date: "9:14 AM",
    link: "https://mail.google.com/mail/u/0/#sent/t1", ...over,
  });

  test("keeps a substantive recent row", () => {
    expect(prefilterSentRows([row()], NOW)).toEqual([{ threadId: "t1", date: "9:14 AM" }]);
  });

  test("drops a forward — a forward is not the user's prose", () => {
    expect(prefilterSentRows([row({ subject: "Fwd: invoice" })], NOW)).toEqual([]);
    expect(prefilterSentRows([row({ subject: "Fw: invoice" })], NOW)).toEqual([]);
  });

  test("drops an auto-reply", () => {
    expect(prefilterSentRows([row({ subject: "Automatic reply: away" })], NOW)).toEqual([]);
    expect(prefilterSentRows([row({ subject: "Out of office" })], NOW)).toEqual([]);
  });

  test("drops a short snippet — Gmail truncates near 100, so short means short", () => {
    expect(prefilterSentRows([row({ snippet: "thanks!" })], NOW)).toEqual([]);
  });

  test("drops mail older than 180 days, anchored to now", () => {
    // "Jan 3" with no year: parseGmailDate anchors it to the most recent Jan 3,
    // which is more than 180 days before 10 Sept.
    expect(prefilterSentRows([row({ date: "Jan 3" })], NOW)).toEqual([]);
  });

  test("drops a row with no usable thread id", () => {
    expect(prefilterSentRows([row({ link: "https://mail.google.com/mail/u/0/" })], NOW)).toEqual([]);
  });

  test("de-duplicates threads, keeping the first (newest) row", () => {
    const out = prefilterSentRows([row(), row({ snippet: longSnippet + "!" })], NOW);
    expect(out).toEqual([{ threadId: "t1", date: "9:14 AM" }]);
  });

  // Regression (2026-09-10): searchEmails never returns `link` -- it returns
  // `id` -- so every row from the real crawl was shaped exactly like this: an
  // `id`, no `link` at all. Before the fix, threadIdFromPermalink("") was the
  // ONLY source of a thread id, so this row (and all 50 live sent rows) were
  // silently dropped -- listed=0 with no error. Live shape, first row of
  // `in:sent`: {"id": "1a08978fdad88798", "from": "me <me>", ...}.
  test("takes the thread id from `id` when there is no `link` — the live searchEmails shape", () => {
    const liveRow = {
      from: "me <me>", subject: "Aggy · Daily brief", snippet: longSnippet,
      date: "09:30", id: "1a08978fdad88798",
    };
    expect(prefilterSentRows([liveRow], NOW)).toEqual([{ threadId: "1a08978fdad88798", date: "09:30" }]);
  });

  test("prefers `link` over `id` when both are present (a getThread-style caller)", () => {
    expect(prefilterSentRows([row({ id: "should-not-win" })], NOW)).toEqual([{ threadId: "t1", date: "9:14 AM" }]);
  });

  test("falls back to `id` when `link` is present but carries no fragment", () => {
    expect(prefilterSentRows([row({ link: "https://mail.google.com/mail/u/0/", id: "t9" })], NOW))
      .toEqual([{ threadId: "t9", date: "9:14 AM" }]);
  });
});

describe("stripQuotedReply", () => {
  test("cuts at an On ... wrote: line", () => {
    const body = "Here are the numbers.\n\nOn Mon, 8 Sep 2026 at 10:02, Ann <ann@x.com> wrote:\n> what are they?";
    expect(stripQuotedReply(body)).toBe("Here are the numbers.");
  });
  test("cuts at Original Message", () => {
    expect(stripQuotedReply("Sure.\n-----Original Message-----\nFrom: Ann")).toBe("Sure.");
  });
  test("cuts at a forwarded block", () => {
    expect(stripQuotedReply("FYI.\n---------- Forwarded message ---------\nFrom: Ann")).toBe("FYI.");
  });
  test("cuts at the first run of quoted lines", () => {
    expect(stripQuotedReply("No.\n\n> did you send it?\n> please confirm")).toBe("No.");
  });
  test("leaves an unquoted body alone", () => {
    expect(stripQuotedReply("Just the one paragraph.")).toBe("Just the one paragraph.");
  });
});

describe("stripSignature", () => {
  test("cuts at a dash-dash-space line", () => {
    expect(stripSignature("Thanks,\nShiva\n-- \nShiva | Flock | +91 99999")).toBe("Thanks,\nShiva");
  });
  test("leaves a body with no signature marker alone", () => {
    expect(stripSignature("Thanks,\nShiva")).toBe("Thanks,\nShiva");
  });
});

describe("stripSharedTrailer", () => {
  test("removes a trailing block repeated across three or more samples", () => {
    const sig = "Shiva Shankar\nFounder, Flock";
    const out = stripSharedTrailer([`One.\n${sig}`, `Two.\n${sig}`, `Three.\n${sig}`]);
    expect(out).toEqual(["One.", "Two.", "Three."]);
  });
  test("leaves a trailer that only two samples share", () => {
    const sig = "Shiva Shankar\nFounder, Flock";
    const out = stripSharedTrailer([`One.\n${sig}`, `Two.\n${sig}`, "Three."]);
    expect(out).toEqual([`One.\n${sig}`, `Two.\n${sig}`, "Three."]);
  });
});

describe("ownMessageText", () => {
  const msgs = [
    { from: "Ann <ann@x.com>", body: "can you send the numbers?" },
    { from: "Shiva <shiva@bimacred.com>", body: "Sending them now.\n\nOn Mon, Ann wrote:\n> ping" },
    { from: "Ann <ann@x.com>", body: "got it" },
  ];
  test("takes the LAST message the owner wrote, stripped", () => {
    expect(ownMessageText(msgs, "shiva@bimacred.com")).toBe("Sending them now.");
  });
  test("matches the owner case-insensitively", () => {
    expect(ownMessageText(msgs, "Shiva@BimaCred.com")).toBe("Sending them now.");
  });
  test("a thread with nothing from the owner yields nothing", () => {
    expect(ownMessageText(msgs, "someone@else.com")).toBe("");
  });
});

describe("isUsableSample / capSample", () => {
  test("300 characters is the floor", () => {
    expect(isUsableSample("x".repeat(MIN_SAMPLE_CHARS - 1))).toBe(false);
    expect(isUsableSample("x".repeat(MIN_SAMPLE_CHARS))).toBe(true);
  });
  test("a sample is capped at 1200 characters", () => {
    expect(capSample("x".repeat(5000)).length).toBe(SAMPLE_CHAR_CAP);
  });
});
