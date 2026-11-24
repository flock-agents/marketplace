// The MEMORY eligibility filter — a denylist, and the deliberate opposite of the
// drafting gate.
//
// `shouldTrigger.ts` (drafting) is an ALLOWLIST: an engaged domain admits, and
// everything else drops. That is right for a reply — a draft to a vendor the
// owner has never written to is noise. It is exactly wrong for memory: receipts,
// renewals, flight confirmations and statements are the mail that carries durable
// facts, and none of them would ever pass an engagement test.
//
// So these tests pin the KEEP cases as hard as the drop cases. Every one of the
// three "KEPT" tests below is a case the drafting gate drops today, on purpose.

import { describe, test, expect, beforeAll, afterAll, spyOn } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";
import { isMemoryEligible, isColdOutreachThread } from "../lib/memory-eligibility";
import type { StoredJournalEntry } from "../lib/journal-entry";

// The module warns when it fails open (tested below); keep the run output clean.
const warn = { spy: undefined as ReturnType<typeof spyOn> | undefined };
beforeAll(() => { warn.spy = spyOn(console, "warn").mockImplementation(() => {}); });
afterAll(() => { warn.spy?.mockRestore(); });

const OWNER = "shiva@gostych.cc";

// A journaled Gmail entry, in the shape ingest-manifest-loader produces: `raw`
// is the scraped item (subject/snippet/from/date), `preview` is "subject — snippet".
const mail = (
  eventId: string,
  over: { from?: string; subject?: string; snippet?: string } = {},
): StoredJournalEntry => {
  const from = over.from ?? "Naresh <naresh@acme.com>";
  const subject = over.subject ?? "Q3 numbers";
  const snippet = over.snippet ?? "here they are";
  return {
    id: `row-${eventId}`,
    createdAt: 1_700_000_000_000,
    sourceId: "gmail",
    accountId: "acc-1",
    eventId,
    kind: "email",
    actor: { name: from, email: from.match(/<([^>]+)>/)?.[1] ?? from },
    threadKey: `t-${eventId}`,
    ts: 1_700_000_000_000,
    preview: `${subject} — ${snippet}`,
    permalink: null,
    raw: { id: eventId, from, subject, snippet, date: "Mon, 1 Sep 2026 09:00:00 +0000" },
  };
};

describe("drops confirmed noise", () => {
  test("bulk mail is dropped by its unsubscribe link", () => {
    const r = isMemoryEligible(mail("m1"), { unsubscribeLink: "https://x.co/u/abc" });
    expect(r.eligible).toBe(false);
    expect(r.reason).toBe("bulk_unsubscribe_link");
  });

  test("a manage-preferences link is the same signal", () => {
    const r = isMemoryEligible(mail("m1b"), {
      unsubscribeLink: "https://vendor.io/manage-preferences?id=9",
    });
    expect(r.eligible).toBe(false);
    expect(r.reason).toBe("bulk_unsubscribe_link");
  });

  test("an opt-out link is the same signal", () => {
    const r = isMemoryEligible(mail("m1c"), { unsubscribeLink: "https://vendor.io/opt-out" });
    expect(r.eligible).toBe(false);
    expect(r.reason).toBe("bulk_unsubscribe_link");
  });

  test("calendar auto-responses are dropped — the calendar connector carries them better", () => {
    for (const subject of [
      "Accepted: Sprint review @ Tue Sep 1",
      "Declined: Sprint review @ Tue Sep 1",
      "Invitation: Sprint review @ Tue Sep 1",
      "Updated invitation: Sprint review @ Tue Sep 1",
      "Canceled event: Sprint review @ Tue Sep 1",
    ]) {
      const r = isMemoryEligible(mail("c1", { subject }), {});
      expect(r.eligible).toBe(false);
      expect(r.reason).toBe("calendar_autoresponse");
    }
  });

  test("the calendar prefix is read off the subject even when only `preview` carries it", () => {
    const entry = mail("c2", { subject: "Accepted: Standup" });
    delete (entry.raw as Record<string, unknown>).subject;
    const r = isMemoryEligible(entry, {});
    expect(r.eligible).toBe(false);
    expect(r.reason).toBe("calendar_autoresponse");
  });
});

describe("keeps everything else — the cases the drafting gate drops", () => {
  test("a no-reply receipt is KEPT — the drafting gate drops these, memory does not", () => {
    expect(isMemoryEligible(mail("m2", { from: "no-reply@stripe.com" }), {}).eligible).toBe(true);
  });

  test("automated transactional senders are KEPT — that is where receipts and renewals live", () => {
    for (const from of [
      "noreply@united.com",
      "billing@aws.amazon.com",
      "statements@hdfcbank.net",
      "receipts@mail.notifications.vendor.io",
    ]) {
      expect(isMemoryEligible(mail("m2b", { from }), {}).eligible).toBe(true);
    }
  });

  test("a self-send is KEPT — the owner's own writing is a fact and voice source", () => {
    expect(isMemoryEligible(mail("m3", { from: OWNER }), {}).eligible).toBe(true);
  });

  test("an unengaged sender is KEPT — engagement is a drafting concern, not a memory one", () => {
    expect(isMemoryEligible(mail("m4", { from: "someone@newvendor.io" }), {}).eligible).toBe(true);
  });

  test("a subject that merely mentions a calendar word is KEPT — the prefix must lead", () => {
    for (const subject of [
      "Re: Invitation: Sprint review",     // a human replying on an invite thread
      "Your offer was Accepted: next steps",
      "Fwd: Accepted: Sprint review",
      "Invitations are open",              // no colon — not a calendar response
    ]) {
      expect(isMemoryEligible(mail("m5", { subject }), {}).eligible).toBe(true);
    }
  });

  test("no link means no bulk signal", () => {
    expect(isMemoryEligible(mail("m6"), {}).eligible).toBe(true);
    expect(isMemoryEligible(mail("m6"), { unsubscribeLink: null }).eligible).toBe(true);
    expect(isMemoryEligible(mail("m6"), { unsubscribeLink: "" }).eligible).toBe(true);
    expect(isMemoryEligible(mail("m6"), { unsubscribeLink: "   " }).eligible).toBe(true);
  });

  test("a non-email entry (Slack, a DM) is KEPT", () => {
    const entry = { ...mail("m7"), sourceId: "slack", kind: "message" as const };
    expect(isMemoryEligible(entry, {}).eligible).toBe(true);
  });
});

describe("fails open — never silently drop mail", () => {
  test("a malformed entry fails open", () => {
    expect(isMemoryEligible({} as never, {}).eligible).toBe(true);
  });

  test("a missing entry fails open", () => {
    expect(isMemoryEligible(null as never, {}).eligible).toBe(true);
    expect(isMemoryEligible(undefined as never, {}).eligible).toBe(true);
  });

  test("missing opts fails open rather than throwing", () => {
    expect(isMemoryEligible(mail("m8"), undefined as never).eligible).toBe(true);
  });

  test("a link of the wrong type is not a confirmed signal", () => {
    expect(isMemoryEligible(mail("m9"), { unsubscribeLink: 42 as never }).eligible).toBe(true);
  });

  test("a throw while reading the entry fails open with a reason", () => {
    const booby = mail("m10");
    Object.defineProperty(booby, "raw", {
      get() { throw new Error("boom"); },
    });
    const r = isMemoryEligible(booby, {});
    expect(r.eligible).toBe(true);
    expect(r.reason).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// THE BLOCK-LEVEL PREDICATE. isMemoryEligible is per-ENTRY and pure; "has the
// owner spoken in this thread?" is a property of the whole thread, so it needs
// its own predicate over the block's rows. Both signals are answerable from the
// journal rows already in hand: no fetch, no LLM.
//
// It lives here rather than in the runner because it is a policy question with
// edges worth pinning (who counts as the owner, what an engaged domain matches,
// what happens when identity is unresolvable) — and because it is pure, so it can
// be tested without a database, a browser or a guard.
//
// The engaged-domain LIST is an INPUT, never a read: this module must not import
// engaged-domains (the structural test at the bottom of this file forbids it, and
// the "two gates, never one" constraint is why).
// ---------------------------------------------------------------------------

describe("cold outreach — a block-level signal, not a per-message one", () => {
  const OWNER = "shiva@gostych.cc";
  const row = (from: string) => ({ actor: { name: from, email: from } });

  test("a stranger on an unengaged domain, with the owner silent, is cold outreach", () => {
    const r = isColdOutreachThread([row("priya@newvendor.io")], {
      engagedDomains: ["acme.com"],
      ownerAddresses: [OWNER],
    });
    expect(r.cold).toBe(true);
    expect(r.reason).toBe("cold_outreach");
  });

  // A tool the owner uses every day mails from `no-reply@`. Engagement is decided by
  // `in:sent to:@domain`, and nobody writes to a no-reply address — so that domain can
  // NEVER become engaged and every notification it sends deferred as cold outreach,
  // permanently. Live: a meeting recap listing five action items, three assigned to the
  // owner by name, never reached memory. The file header already called this out —
  // "no-reply and automated senders … that is where receipts and renewals live".
  test("an automated sender is not outreach, cold or otherwise", () => {
    const r = isColdOutreachThread([row("no-reply@fathom.video")], {
      engagedDomains: [],
      ownerAddresses: [OWNER],
    });
    expect(r.cold).toBe(false);
    expect(r.reason).toBe("automated_sender");
  });

  test.each([
    "noreply@x.io", "no-reply@x.io", "no_reply@x.io",
    "donotreply@x.io", "do-not-reply@x.io",
    "notifications@x.io", "mailer-daemon@x.io",
  ])("%s is treated as automated", (from) => {
    expect(isColdOutreachThread([row(from)], { engagedDomains: [], ownerAddresses: [OWNER] }).cold).toBe(false);
  });

  // Coverage for the 2026-09-22 (T3) ROLE_LOCAL widening at THIS call site —
  // the only two other tests that used to exercise `hello@` here were
  // renamed away to non-role addresses (fix round 1) since they needed a
  // definitely-human sentinel, which left the widening itself untested.
  test("a role-shaped address (hello@) is covered by the automated-sender exemption too", () => {
    const r = isColdOutreachThread([row("hello@newvendor.io")], {
      engagedDomains: [],
      ownerAddresses: [OWNER],
    });
    expect(r).toEqual({ cold: false, reason: "automated_sender" });
  });

  test("a HUMAN stranger is still cold — the rule is narrowed, not removed", () => {
    // The domain says nothing: fathom.video sends both no-reply recaps and human mail.
    expect(isColdOutreachThread([row("alyssa@fathom.video")], {
      engagedDomains: [], ownerAddresses: [OWNER],
    }).cold).toBe(true);
  });

  test("the owner having spoken in the thread KEEPS it, engagement or not", () => {
    const r = isColdOutreachThread([row("priya@newvendor.io"), row(OWNER)], {
      engagedDomains: [],
      ownerAddresses: [OWNER],
    });
    expect(r.cold).toBe(false);
  });

  // F8a made an inbox row's actor the LATEST participant, so a reply on a thread the owner
  // started no longer carries the owner as its actor. The row's participant list still does.
  test("an inbox row whose participants include the owner KEEPS it, even when the actor is a stranger", () => {
    const r = isColdOutreachThread([{ ...row("priya@newvendor.io"), raw: { participants: [OWNER.toUpperCase(), "priya@newvendor.io"] } }], {
      engagedDomains: [],
      ownerAddresses: [OWNER],
    });
    expect(r).toEqual({ cold: false });
  });

  test("the same row without participants (or with a non-array) is still cold", () => {
    for (const raw of [{}, { participants: OWNER }, { participants: null }]) {
      const r = isColdOutreachThread([{ ...row("priya@newvendor.io"), raw }], {
        engagedDomains: [],
        ownerAddresses: [OWNER],
      });
      expect(r).toEqual({ cold: true, reason: "cold_outreach" });
    }
  });

  test("an engaged sender domain KEEPS it, even when the owner never replied", () => {
    const r = isColdOutreachThread([row("anil@acme.com")], {
      engagedDomains: ["acme.com"],
      ownerAddresses: [OWNER],
    });
    expect(r.cold).toBe(false);
  });

  test("owner and engaged matching is case- and whitespace-insensitive", () => {
    expect(isColdOutreachThread([row("  ANIL@Acme.COM ")], {
      engagedDomains: ["  AcMe.com "],
      ownerAddresses: [OWNER],
    }).cold).toBe(false);
    expect(isColdOutreachThread([row(OWNER.toUpperCase())], {
      engagedDomains: [],
      ownerAddresses: [` ${OWNER} `],
    }).cold).toBe(false);
  });

  test("a subdomain is NOT the engaged domain — exact match, as the drafting gate does it", () => {
    expect(isColdOutreachThread([row("raj@mail.acme.com")], {
      engagedDomains: ["acme.com"],
      ownerAddresses: [OWNER],
    }).cold).toBe(true);
  });

  describe("fails open — a signal we do not have must never drop mail", () => {
    test("no owner address on record", () => {
      expect(isColdOutreachThread([row("priya@newvendor.io")], {
        engagedDomains: [],
        ownerAddresses: [],
      }).cold).toBe(false);
      expect(isColdOutreachThread([row("priya@newvendor.io")], {
        engagedDomains: [],
        ownerAddresses: null,
      }).cold).toBe(false);
      expect(isColdOutreachThread([row("priya@newvendor.io")], {} as never).cold).toBe(false);
    });

    test("an owner list of blanks is no owner list at all", () => {
      expect(isColdOutreachThread([row("priya@newvendor.io")], {
        engagedDomains: [],
        ownerAddresses: ["", "   ", null as never],
      }).cold).toBe(false);
    });

    test("a row whose sender cannot be identified", () => {
      expect(isColdOutreachThread([{ actor: {} }], {
        engagedDomains: [],
        ownerAddresses: [OWNER],
      }).cold).toBe(false);
      expect(isColdOutreachThread([{} as never], {
        engagedDomains: [],
        ownerAddresses: [OWNER],
      }).cold).toBe(false);
      expect(isColdOutreachThread([row("not-an-address")], {
        engagedDomains: [],
        ownerAddresses: [OWNER],
      }).cold).toBe(false);
    });

    test("an empty or missing block", () => {
      expect(isColdOutreachThread([], { engagedDomains: [], ownerAddresses: [OWNER] }).cold).toBe(false);
      expect(isColdOutreachThread(null as never, { engagedDomains: [], ownerAddresses: [OWNER] }).cold).toBe(false);
    });

    test("a throw while reading a row", () => {
      const booby = {} as { actor?: unknown };
      Object.defineProperty(booby, "actor", { get() { throw new Error("boom"); } });
      const r = isColdOutreachThread([booby], { engagedDomains: [], ownerAddresses: [OWNER] });
      expect(r.cold).toBe(false);
      expect(r.reason).toBeTruthy();
    });
  });

  test("one identifiable owner row is enough — the rest of the block may be unreadable", () => {
    expect(isColdOutreachThread([{ actor: {} }, row(OWNER)], {
      engagedDomains: [],
      ownerAddresses: [OWNER],
    }).cold).toBe(false);
  });
});

// "Two gates, never one." The drafting allowlist and this denylist answer
// opposite questions; sharing a rule list between them would silently import
// the allowlist's drops into memory. Pin the separation structurally so a
// later "let's deduplicate these" cannot pass unnoticed.
test("the memory filter shares no code with the drafting gate", () => {
  const src = readFileSync(join(import.meta.dir, "../lib/memory-eligibility.ts"), "utf8");
  const imports = [...src.matchAll(/^\s*import[^;]*?from\s+["']([^"']+)["']/gm)].map((m) => m[1]);
  expect(imports.filter((s) => /shouldTrigger|draft-eligibility|engaged-domains/.test(s))).toEqual([]);
});

describe("bulk mail from an automated sender still reaches memory", () => {
  // The unsubscribe link is a COMPLIANCE artifact: bulk senders attach one whether the
  // mail is promotional or transactional, so every example the header lists as wanted —
  // receipts, renewals, flight confirmations — carries one. The link alone was dropping
  // exactly the class this module exists to keep.
  const LINK = "https://fathom.video/unsubscribe?x=1";

  test("a no-reply recap with an unsubscribe link is KEPT", () => {
    const r = isMemoryEligible(
      mail("m1", { from: "Fathom <no-reply@fathom.video>", subject: 'Recap for "Impromptu Call"' }),
      { unsubscribeLink: LINK },
    );
    expect(r.eligible).toBe(true);
  });

  test("the same mail from a HUMAN sender is still bulk", () => {
    const r = isMemoryEligible(
      mail("m2", { from: "Alyssa <alyssa@fathom.video>", subject: "Our September newsletter" }),
      { unsubscribeLink: LINK },
    );
    expect(r.eligible).toBe(false);
    expect(r.reason).toBe("bulk_unsubscribe_link");
  });

  test("an automated sender does not bypass the calendar-autoresponse drop", () => {
    // Narrowing one rule must not silently disable the other.
    const r = isMemoryEligible(
      mail("m3", { from: "Google <no-reply@google.com>", subject: "Accepted: Sprint review" }),
      { unsubscribeLink: null },
    );
    expect(r.eligible).toBe(false);
    expect(r.reason).toBe("calendar_autoresponse");
  });
});

// ---------------------------------------------------------------------------
// BULK MAIL FROM AN AUTOMATED SENDER — kept only when it concerns the owner.
//
// The 2026-09-14 carve-out let every automated sender past the unsubscribe
// check, reasoning that "the extractor writes facts, not mail, so the failure
// mode is a few wasted tokens rather than a wrong memory". Measured on the
// owner's live wiki 2026-09-19, that assumption did not hold: a Digit Insurance
// announcement and a Microsoft internship blast became durable facts AND minted
// `IRDAI`, `NCLT` and `Digit Insurance` as organizations the owner has no
// relationship with, which then supplied descriptors for unrelated entities.
//
// The carve-out exists to protect a real class — receipts, renewals, and the
// meeting recap from a notetaker's no-reply address that an earlier rule was
// deferring, three action items and all. That class has a property the
// announcements lack: IT NAMES THE OWNER. So the refinement is not a revert.
// ---------------------------------------------------------------------------

describe("automated bulk mail", () => {
  const OWNER_NAMES = ["Shiva Shankar", "Shiva"];
  const LINK = "https://mail.example.com/unsubscribe/abc";

  const bulk = (text: string, names: string[] = OWNER_NAMES) =>
    isMemoryEligible(mail("e-bulk", { from: "Digit Insurance <no-reply@godigit.com>" }), {
      unsubscribeLink: LINK,
      text,
      personalNames: names,
    });

  test("an announcement that names nobody the owner knows is dropped", () => {
    const verdict = bulk(
      "The Digit Insurance scheme is subject to approval from IRDAI and the NCLT. "
      + "Read our latest product announcement and quarterly highlights.");
    expect(verdict.eligible).toBe(false);
    expect(verdict.reason).toBe("bulk_impersonal");
  });

  test("a meeting recap that names the owner is kept", () => {
    // The exact class the 2026-09-14 decision was made to protect.
    const verdict = bulk(
      "Fathom recap — 3 action items. Shiva Shankar to send the MSA by Friday.");
    expect(verdict.eligible).toBe(true);
  });

  test("an invoice that names the owner is kept", () => {
    const verdict = bulk("Hi Shiva, your invoice for September is attached. Amount due: 4,200.");
    expect(verdict.eligible).toBe(true);
  });

  test("a name is matched as a word, not as a fragment", () => {
    // "Shiva" must not be found inside "Shivam" or a file path, or every blast
    // that happens to contain the letters counts as personal.
    const verdict = bulk("Shivam Kapoor has joined Acme as VP of Engineering. Read the announcement.");
    expect(verdict.eligible).toBe(false);
  });

  test("with no names to check against, it keeps the mail", () => {
    // FAIL OPEN. An unresolved owner identity must never start dropping mail.
    expect(bulk("Some announcement with no names in it", []).eligible).toBe(true);
  });

  test("with no text to read, it keeps the mail", () => {
    const verdict = isMemoryEligible(
      mail("e-bulk-2", { from: "Digit Insurance <no-reply@godigit.com>" }),
      { unsubscribeLink: LINK, personalNames: OWNER_NAMES });
    expect(verdict.eligible).toBe(true);
  });

  test("bulk mail from a human sender is still dropped, named or not", () => {
    const verdict = isMemoryEligible(mail("e-human", { from: "Marketing <priya@acme.com>" }), {
      unsubscribeLink: LINK,
      text: "Hi Shiva Shankar, here is our latest newsletter.",
      personalNames: OWNER_NAMES,
    });
    expect(verdict.eligible).toBe(false);
    expect(verdict.reason).toBe("bulk_unsubscribe_link");
  });

  // Coverage for the 2026-09-22 (T3) ROLE_LOCAL widening at THIS call site —
  // a role mailbox now reads as automated here too, so an impersonal blast
  // from one takes the automated-only "does it name the owner" path instead
  // of the human-sender unsubscribe-link drop above.
  test("bulk mail from a role mailbox (support@) that never names the owner is dropped as impersonal", () => {
    const verdict = isMemoryEligible(mail("e-support-bulk", { from: "Acme Support <support@acme.com>" }), {
      unsubscribeLink: LINK,
      text: "Check out our latest product update and quarterly highlights.",
      personalNames: OWNER_NAMES,
    });
    expect(verdict.eligible).toBe(false);
    expect(verdict.reason).toBe("bulk_impersonal");
  });

  test("mail with no unsubscribe link is untouched by any of this", () => {
    // Receipts and transactional mail routinely carry no link at all.
    const verdict = isMemoryEligible(mail("e-plain", { from: "Airtel <no-reply@airtel.in>" }), {
      text: "Your CAF number for the new connection is 1234567.",
      personalNames: OWNER_NAMES,
    });
    expect(verdict.eligible).toBe(true);
  });
});


// ---------------------------------------------------------------------------
// SIGNAL STRENGTH, and the floor below which nothing can be judged.
//
// Both found by running these rules over the owner's real 272-message journal
// rather than by thinking about them:
//
//   - A footer that merely SAYS "unsubscribe" is weaker evidence than a real
//     opt-out URL. Treating the two alike dropped "Your NSDL CAS — August 2026",
//     a consolidated account statement, from a human-looking sender. It names
//     the owner; the weak signal alone should never have damned it.
//
//   - Four Fathom recaps had NO BODY stored, so the only text was a subject
//     line. Judging "does this name the owner?" on 40 characters called a
//     meeting recap impersonal. Too little text is "cannot judge", which means
//     keep — the same way every other unresolved signal in this module behaves.
// ---------------------------------------------------------------------------

describe("weak bulk signals and short text", () => {
  const NAMES = ["Shiva Shankar", "Shiva"];
  const STATEMENT = "Dear SHIVA SHANKAR G, your NSDL Consolidated Account Statement for August 2026 "
    + "is attached. It covers your demat holdings and mutual fund folios across participants. "
    + "This is a system-generated statement. To stop receiving these, unsubscribe.";

  test("a footer-only signal does not damn mail that names the owner", () => {
    const verdict = isMemoryEligible(mail("e-cas", { from: "NSDL <NSDL-CAS@nsdl.co.in>" }), {
      unsubscribeLink: "To stop receiving these, unsubscribe.",
      bulkSignal: "footer_text",
      text: STATEMENT,
      personalNames: NAMES,
    });
    expect(verdict.eligible).toBe(true);
  });

  test("a footer-only signal still drops a blast that names nobody", () => {
    const verdict = isMemoryEligible(mail("e-blast", { from: "Slite <femke@slite.com>" }), {
      unsubscribeLink: "click here to unsubscribe",
      bulkSignal: "footer_text",
      text: "So, should you just NOT buy a Company Brain? Here is our take, plus three customer stories. "
        + "You are receiving this because you signed up. click here to unsubscribe",
      personalNames: NAMES,
    });
    expect(verdict.eligible).toBe(false);
  });

  test("a real opt-out URL from a human sender is still a hard drop", () => {
    const verdict = isMemoryEligible(mail("e-url", { from: "Marie <marie@tally.so>" }), {
      unsubscribeLink: "https://tally.so/unsubscribe/abc",
      bulkSignal: "url",
      text: "Hi Shiva Shankar, new: verified Claude connector and ChatGPT plugin.",
      personalNames: NAMES,
    });
    expect(verdict.eligible).toBe(false);
  });
});

