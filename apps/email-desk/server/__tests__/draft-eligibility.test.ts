// The draft/no-draft decision, as a pure function (owner decision, 2026-09-09:
// "the decision to draft or not should be deterministic without any LLM call").
//
// This is the SINGLE definition both callers use — event-llm-dispatcher at gate
// time, so a thread that cannot produce a draft never wakes the agent, and
// skill-executor at draft time as the backstop. Testing it here tests both.

import { describe, test, expect } from "bun:test";
import { decideDraftEligibility, extractEmailAddress, gateReadView, PRINT_VIEW_SHOWS_DRAFTS } from "../lib/draft-eligibility";
// Flock's gmail skill constant this mirrors is not in this app, so the pin is a literal here.
const SKILLS_PRINT_VIEW_SHOWS_DRAFTS = false;

const OWNER = "shiva@gostych.cc";
// recipientsVerified defaults TRUE here: these cases are about the rules, and
// getThread sets it when it could read Gmail's labelled "to:" / "cc:" header
// rows. The unverified case has its own tests at the bottom.
const msg = (from: string, to: string[], recipientsVerified = true) =>
  ({ from, to, cc: [], date: "d", body: "b", recipientsVerified });
const thread = (messages: unknown[], incomplete = false) => ({ messages, incomplete });

describe("decideDraftEligibility", () => {
  test("an unanswered question addressed to the owner is eligible", () => {
    const v = decideDraftEligibility(OWNER, thread([
      msg("Naresh <naresh@acme.com>", [OWNER]),
    ]));
    expect(v.ok).toBe(true);
  });

  test("the owner having spoken last is already answered", () => {
    const v = decideDraftEligibility(OWNER, thread([
      msg("Naresh <naresh@acme.com>", [OWNER]),
      msg(`Shiva <${OWNER}>`, ["naresh@acme.com"]),
    ]));
    expect(v.ok).toBe(false);
    expect((v as { code: string }).code).toBe("draft_already_answered");
  });

  test("a NEW message after the owner's reply is eligible again", () => {
    const v = decideDraftEligibility(OWNER, thread([
      msg("Naresh <naresh@acme.com>", [OWNER]),
      msg(`Shiva <${OWNER}>`, ["naresh@acme.com"]),
      msg("Naresh <naresh@acme.com>", [OWNER]),
    ]));
    expect(v.ok).toBe(true);
  });

  // The live failure, reproduced: every message came from a DIFFERENT address
  // under a display name identical to the owner's, and a model concluded the
  // owner had "already replied". Matching on the address cannot do that.
  test("a look-alike display name is not the owner", () => {
    const v = decideDraftEligibility(OWNER, thread([
      msg("Shiva Shankar <shiva@bimacred.com>", [OWNER]),
      msg("Shiva Shankar <shiva@bimacred.com>", [OWNER]),
    ]));
    expect(v.ok).toBe(true);
  });

  test("cc/bcc only draws no reply", () => {
    const v = decideDraftEligibility(OWNER, thread([
      msg("Naresh <naresh@acme.com>", ["someone@else.com"]),
    ]));
    expect(v.ok).toBe(false);
    expect((v as { code: string }).code).toBe("draft_not_direct_recipient");
  });

  test("only the TRIGGERING (last) message's recipients decide it", () => {
    // Owner was a direct recipient earlier but not on the newest message.
    const v = decideDraftEligibility(OWNER, thread([
      msg("Naresh <naresh@acme.com>", [OWNER]),
      msg("Naresh <naresh@acme.com>", ["someone@else.com"]),
    ]));
    expect(v.ok).toBe(false);
    expect((v as { code: string }).code).toBe("draft_not_direct_recipient");
  });

  describe("fails closed on anything it cannot establish", () => {
    test("no owner address", () => {
      const v = decideDraftEligibility("", thread([msg("a@b.com", ["x@y.com"])]));
      expect(v.ok).toBe(false);
      expect((v as { code: string }).code).toBe("draft_recipient_unverifiable");
    });

    test("an incomplete scrape — its recipient list cannot be trusted", () => {
      const v = decideDraftEligibility(OWNER, thread([msg("a@b.com", [OWNER])], true));
      expect(v.ok).toBe(false);
      expect((v as { code: string }).code).toBe("draft_recipient_unverifiable");
    });

    test("no messages, or no thread at all", () => {
      expect(decideDraftEligibility(OWNER, thread([])).ok).toBe(false);
      expect(decideDraftEligibility(OWNER, null).ok).toBe(false);
      expect(decideDraftEligibility(OWNER, undefined).ok).toBe(false);
    });
  });

  test("address matching is case- and format-insensitive", () => {
    const v = decideDraftEligibility(OWNER, thread([
      msg("Naresh <NARESH@acme.com>", ["  Shiva@GoStych.CC  "]),
    ]));
    expect(v.ok).toBe(true);
  });
});

// R3: server/ mirrors skills/gmail/scripts/_printView's PRINT_VIEW_SHOWS_DRAFTS rather than
// importing it (server/ code must never import skills/). This pins the mirror to the constant it
// mirrors, and gateReadView() to the read view that follows from it.
describe("gateReadView (R3)", () => {
  test("the server mirror equals the skills constant it mirrors", () => {
    expect(PRINT_VIEW_SHOWS_DRAFTS).toBe(SKILLS_PRINT_VIEW_SHOWS_DRAFTS);
  });

  test("the gate reads print view only when print view can see an open draft", () => {
    expect(gateReadView()).toBe(SKILLS_PRINT_VIEW_SHOWS_DRAFTS ? "print" : "thread");
  });
});

describe("extractEmailAddress", () => {
  test("pulls the address out of a display-name form", () => {
    expect(extractEmailAddress("Shiva Shankar <shiva@gostych.cc>")).toBe("shiva@gostych.cc");
  });
  test("passes a bare address through, lowercased", () => {
    expect(extractEmailAddress("  Shiva@GoStych.CC ")).toBe("shiva@gostych.cc");
  });
  test("never throws on junk", () => {
    expect(extractEmailAddress("")).toBe("");
    expect(extractEmailAddress("not an address")).toBe("not an address");
  });
});

// THE CC REGRESSION (live, 2026-09-09). A real message with Gmail headers
// "to: shiva@bimacred.com / cc: shiva@gostych.cc" came back from getThread as
// to: [both], cc: [] — its collapsed header renders To and Cc as one merged
// summary with no marker, so every cc'd address was classified "to". The
// To-only rule then saw the owner as a direct recipient of mail they were only
// cc'd on. These two tests pin both halves of the fix.
describe("cc must never read as a direct recipient", () => {
  test("cc-only is refused once recipients are verified", () => {
    const v = decideDraftEligibility(OWNER, thread([
      { from: "Naresh <naresh@acme.com>", to: ["someone.else@acme.com"], cc: [OWNER], date: "d", body: "b", recipientsVerified: true },
    ]));
    expect(v.ok).toBe(false);
    expect((v as { code: string }).code).toBe("draft_not_direct_recipient");
  });

  test("an UNVERIFIED recipient list refuses rather than assuming To", () => {
    // Exactly the shape the old scrape produced for that cc-only message: the
    // owner appears in `to`, but the scrape could not tell To from Cc. Passing
    // this would draft a reply to a thread the owner was only cc'd on.
    const v = decideDraftEligibility(OWNER, thread([
      msg("Naresh <naresh@acme.com>", ["shiva@bimacred.com", OWNER], false),
    ]));
    expect(v.ok).toBe(false);
    expect((v as { code: string }).code).toBe("draft_recipient_unverifiable");
  });

  test("a missing recipientsVerified field is treated as unverified", () => {
    const v = decideDraftEligibility(OWNER, thread([
      { from: "Naresh <naresh@acme.com>", to: [OWNER], cc: [], date: "d", body: "b" },
    ]));
    expect(v.ok).toBe(false);
    expect((v as { code: string }).code).toBe("draft_recipient_unverifiable");
  });
});

// BULK MAIL (owner decision, 2026-09-10). The browser scrape has no
// List-Unsubscribe / Precedence headers to gate on (IMAP was rejected), so the
// signal is the footer link getThread finds in the message body: unsubscribe,
// opt out, manage preferences. A live wake on 2026-09-10 listed six items and
// only one deserved it -- the rest were newsletters from ENGAGED domains,
// addressed To the owner, which no rule above this one can tell apart from a
// person. The owner also ruled that a HUMAN sender with such a link (a founder
// mailing from their own address through a campaign tool) is impersonating bulk
// mail and draws no draft either.
describe("bulk mail draws no draft", () => {
  test("an unsubscribe link in the triggering message refuses, even when addressed To the owner", () => {
    const v = decideDraftEligibility(OWNER, thread([
      { ...msg("Lou <lou@weekahead.io>", [OWNER]), unsubscribeLink: true },
    ]));
    expect(v.ok).toBe(false);
    expect((v as { code: string }).code).toBe("draft_bulk_mail");
  });

  test("a human reply on a thread that STARTED as bulk mail is still eligible", () => {
    // Only the triggering (last) message decides: the newsletter's footer must not
    // taint the person who later replied on the same thread.
    const v = decideDraftEligibility(OWNER, thread([
      { ...msg("Digio <hello@digio.in>", [OWNER]), unsubscribeLink: true },
      msg("Priya <priya@digio.in>", [OWNER]),
    ]));
    expect(v.ok).toBe(true);
  });

  test("bulk is decided before the recipient rules, so the log gives the real reason", () => {
    // Recipients could not be verified AND the message is bulk: the useful
    // refusal is "bulk", not "could not tell To from Cc".
    const v = decideDraftEligibility(OWNER, thread([
      { ...msg("SpringVerify <team@springverify.com>", [OWNER], false), unsubscribeLink: true },
    ]));
    expect(v.ok).toBe(false);
    expect((v as { code: string }).code).toBe("draft_bulk_mail");
  });

  test("a missing or non-boolean flag never reads as bulk", () => {
    const v = decideDraftEligibility(OWNER, thread([
      { ...msg("Naresh <naresh@acme.com>", [OWNER]), unsubscribeLink: "yes" },
    ]));
    expect(v.ok).toBe(true);
  });
});

// A DRAFT ALREADY ON THE THREAD (2026-09-10, live). After a reset the platform's
// own draft records were empty, so the first sweep woke for a thread that
// already carried a draft from the earlier run and wrote on it again. Whoever
// wrote a draft, someone is already replying: no draft. The one exception is a
// draft of OUR OWN answering an OLDER message -- the executor's replace path
// discards it and drafts for the new message, so the caller says so.
describe("a draft already on the thread draws no draft", () => {
  test("hasDraft refuses, even for an unanswered question addressed To the owner", () => {
    const v = decideDraftEligibility(OWNER, { messages: [msg("Naresh <naresh@acme.com>", [OWNER])], incomplete: false, hasDraft: true });
    expect(v.ok).toBe(false);
    expect((v as { code: string }).code).toBe("draft_exists");
  });
  test("but our own recorded draft on the thread does not block a replace", () => {
    const v = decideDraftEligibility(OWNER, { messages: [msg("Naresh <naresh@acme.com>", [OWNER])], incomplete: false, hasDraft: true }, { ownDraftOnThread: true });
    expect(v.ok).toBe(true);
  });
  test("a missing or non-boolean flag never reads as a draft", () => {
    expect(decideDraftEligibility(OWNER, { messages: [msg("Naresh <naresh@acme.com>", [OWNER])], incomplete: false }).ok).toBe(true);
    expect(decideDraftEligibility(OWNER, { messages: [msg("Naresh <naresh@acme.com>", [OWNER])], incomplete: false, hasDraft: "yes" }).ok).toBe(true);
  });
  test("already-answered still wins: the owner's own last message with a draft is 'answered'", () => {
    const v = decideDraftEligibility(OWNER, { messages: [msg("Naresh <naresh@acme.com>", [OWNER]), msg(`Shiva <${OWNER}>`, ["naresh@acme.com"])], incomplete: false, hasDraft: true });
    expect((v as { code: string }).code).toBe("draft_already_answered");
  });
});

// REPLY ALL (owner, 2026-09-23): who a reply to the newest message must reach.
describe("replyAllRecipients", () => {
  const { replyAllRecipients } = require("../lib/draft-eligibility") as typeof import("../lib/draft-eligibility");
  test("the sender plus To and Cc of the newest message, minus the owner, once each", () => {
    const thread = { messages: [
      { from: "Old <old@x.com>", to: ["me@b.com"], cc: [] },
      { from: "radhika.ch <radhika.ch@matrixbsindia.com>", to: ["me@b.com"], cc: ["vinodkumar@matrixbsindia.com", "Vinay <VinayKumar.A@matrixbsindia.com>", "me@b.com"] },
    ] };
    expect(replyAllRecipients("ME@b.com", thread)).toEqual(["radhika.ch@matrixbsindia.com", "vinodkumar@matrixbsindia.com", "vinaykumar.a@matrixbsindia.com"]);
  });
  test("a one-to-one thread has only the sender", () => {
    expect(replyAllRecipients("me@b.com", { messages: [{ from: "a@x.com", to: ["me@b.com"], cc: [] }] })).toEqual(["a@x.com"]);
  });
  test("nothing readable is an empty list", () => {
    expect(replyAllRecipients("me@b.com", undefined)).toEqual([]);
  });
});

// Task 34 (R73): the owner's own ask, in a card chat in their turn, lifts "already answered" only.
describe("decideDraftEligibility: ownerAskedInCardChat (R73)", () => {
  const ownerLast = (extra: Partial<ReturnType<typeof msg>> = {}) => thread([
    { ...msg("Naresh <naresh@acme.com>", [OWNER]), ...extra },
    msg(`Shiva <${OWNER}>`, ["naresh@acme.com"]),
  ]);
  test("an owner-last thread is drafted when the owner asked in the card chat", () => {
    expect(decideDraftEligibility(OWNER, ownerLast(), { ownerAskedInCardChat: true }).ok).toBe(true);
  });
  test("without the flag it is still already answered", () => {
    const v = decideDraftEligibility(OWNER, ownerLast(), {});
    expect((v as { code: string }).code).toBe("draft_already_answered");
  });
  test("the other rules stand: an open draft, bulk mail, cc-only and an incomplete scrape still refuse", () => {
    const flag = { ownerAskedInCardChat: true };
    expect((decideDraftEligibility(OWNER, { ...ownerLast(), hasDraft: true }, flag) as { code: string }).code).toBe("draft_exists");
    expect((decideDraftEligibility(OWNER, ownerLast({ unsubscribeLink: true } as never), flag) as { code: string }).code).toBe("draft_bulk_mail");
    expect((decideDraftEligibility(OWNER, ownerLast({ to: ["someone@acme.com"] } as never), flag) as { code: string }).code).toBe("draft_not_direct_recipient");
    expect((decideDraftEligibility(OWNER, { ...ownerLast(), incomplete: true }, flag) as { code: string }).code).toBe("draft_recipient_unverifiable");
  });
  test("a thread only the owner has written to has no correspondent: draft_no_correspondent", () => {
    const v = decideDraftEligibility(OWNER, thread([msg(`Shiva <${OWNER}>`, ["naresh@acme.com"]), msg(`Shiva <${OWNER}>`, ["naresh@acme.com"])]), { ownerAskedInCardChat: true });
    expect((v as { code: string }).code).toBe("draft_no_correspondent");
  });
  test("the live case: the correspondent wrote, the owner replied last, the older message's recipients are unverified → allowed", () => {
    const v = decideDraftEligibility(OWNER, thread([
      msg("Pluto <pluto@meridian.com>", [OWNER], false),
      msg(`Shiva <${OWNER}>`, ["pluto@meridian.com"]),
    ]), { ownerAskedInCardChat: true });
    expect(v.ok).toBe(true);
  });
  test("recipientsVerified is still required without the owner's ask", () => {
    const v = decideDraftEligibility(OWNER, thread([msg("Pluto <pluto@meridian.com>", [OWNER], false)]), {});
    expect((v as { code: string }).code).toBe("draft_recipient_unverifiable");
  });
  test("a bulk sender is still refused for an owner-asked draft", () => {
    const v = decideDraftEligibility(OWNER, thread([
      { ...msg("News <news@vendor.com>", [OWNER], false), unsubscribeLink: true },
      msg(`Shiva <${OWNER}>`, ["news@vendor.com"]),
    ]), { ownerAskedInCardChat: true });
    expect((v as { code: string }).code).toBe("draft_bulk_mail");
  });
});
