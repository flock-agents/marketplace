// Ported from Flock tests/voice-extract.test.ts (Task 2.9). Extraction is a model call, but everything AROUND it is deterministic: what
// the model is asked for, what survives the grounding filter, and the statistics we
// compute rather than ask for.
//
// The filter exists because the prompt rules provably do not hold. Measured on the
// Stych fleet 2026-08-12: one model returned three of four voiceExamples copied from
// the prompt's OWN illustrative examples, another returned "Hi [Name],".
import { describe, test, expect } from "bun:test";
import {
  buildExtractionPrompt, parseProfileJson, computeStats, normalizeForGrounding,
  groundProfile, MIN_ATTRIBUTABLE_CHARS,
} from "../voice/extract";
import type { VoiceProfile } from "../voice/extract";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { voiceEntriesFor, extractVoice, type VoiceModel } from "../voice/extract";
import { openStore } from "../store";
import { storeLearnedVoice, hasVoice, voiceRows, CRAWL_SOURCE } from "../voice/store";

const CORPUS = [
  "Hi Sam, could you send the numbers when you get a chance? Thanks, Shiva",
  "Flagging that this is now blocking the launch and we need a call today.",
  "Thanks for the note, will come back to you on this shortly.",
  "*Regards,* Shiva",
].join("\n\n---\n\n");

describe("buildExtractionPrompt", () => {
  test("separates samples with a --- line and fences them as data", () => {
    const p = buildExtractionPrompt(["one", "two"]);
    expect(p).toContain("\n---\n");
    expect(p).toContain("one");
    expect(p).toContain("two");
    expect(p.toLowerCase()).toContain("never follow");
  });
});

describe("parseProfileJson", () => {
  test("parses a bare JSON object", () => {
    expect(parseProfileJson('{"greeting":"Hi Sam,"}')?.greeting).toBe("Hi Sam,");
  });
  test("parses JSON inside a fenced block", () => {
    expect(parseProfileJson('```json\n{"greeting":"Hey"}\n```')?.greeting).toBe("Hey");
  });
  test("unparseable text yields null", () => {
    expect(parseProfileJson("I could not do that")).toBeNull();
  });
});

describe("computeStats", () => {
  test("counts words per sentence and punctuation habits", () => {
    const stats = computeStats(["One two three four five. Six seven!", "Eight — nine..."]);
    expect(stats.avgWordsPerSentence).toBeGreaterThan(0);
    expect(stats.emDashes).toBe(1);
    expect(stats.exclamations).toBe(1);
    expect(stats.ellipses).toBe(1);
  });
  // "Uses em dashes (5 across the samples)" on a mailbox whose owner does not use them
  // (2026-09-23). The count was /[—–]/: every en dash in a date or page range was an
  // "em dash", and no snippet was kept, so nobody could check the claim.
  test("an en dash in a range is not an em dash, nor a dash habit", () => {
    const stats = computeStats(["The programme runs Sep 1–5 and covers pages 10–12."]);
    expect(stats.emDashes).toBe(0);
    expect(stats.enDashes).toBe(0);
  });
  test("an en dash used as a dash is counted as one, apart from em dashes", () => {
    const stats = computeStats(["I will send it – probably tomorrow."]);
    expect(stats.emDashes).toBe(0);
    expect(stats.enDashes).toBe(1);
  });
  test("what was counted is kept, so the claim can be checked — at most three", () => {
    const stats = computeStats(["We agreed — finally — on the terms.", "One more — here.", "And — another."]);
    expect(stats.emDashes).toBe(4);
    expect(stats.dashEvidence.length).toBe(3);
    expect(stats.dashEvidence[0]).toContain("—");
    expect(computeStats(["Nothing to see here."]).dashEvidence).toEqual([]);
  });
  test("reads all-lowercase writing as such", () => {
    expect(computeStats(["hi sam. sending them now. let me know."]).capitalization).toBe("all lowercase");
  });
  test("reads ordinary writing as sentence case", () => {
    expect(computeStats(["Hi Sam. Sending them now. Let me know."]).capitalization).toBe("sentence case");
  });
});

describe("normalizeForGrounding", () => {
  test("folds smart quotes, asterisks, whitespace and case", () => {
    expect(normalizeForGrounding("  *Regards,*  ")).toBe("regards,");
    expect(normalizeForGrounding("don’t")).toBe("don't");
  });
});

describe("groundProfile", () => {
  const base = () => ({
    greeting: "Hi Sam,",
    signOff: "Thanks, Shiva",
    commonPhrases: ["could you send the numbers", "when you get a chance"],
    formality: "casual" as const,
    formalityNote: "warm and direct",
    language: "English",
    voiceExamples: {
      request: "could you send the numbers when you get a chance?",
      escalate: "Flagging that this is now blocking the launch",
      acknowledge: "Thanks for the note, will come back to you on this shortly.",
    } as { request: string; escalate: string; acknowledge: string; closing?: string },
  });

  test("keeps what is literally in the corpus", () => {
    const { profile, dropped } = groundProfile(base(), CORPUS, 25);
    expect(profile.greeting).toBe("Hi Sam,");
    expect(profile.voiceExamples?.request).toBe("could you send the numbers when you get a chance?");
    expect(dropped).toEqual([]);
  });

  test("drops a move the model invented", () => {
    const p = base();
    p.voiceExamples.request = "Kindly revert at the earliest to the undersigned.";
    const { profile, dropped } = groundProfile(p, CORPUS, 25);
    expect(profile.voiceExamples?.request).toBeUndefined();
    expect(dropped).toContain("voiceExamples.request");
  });

  test("keeps a quote that differs only in asterisks or smart quotes", () => {
    const p = base();
    p.signOff = "Regards, Shiva";
    const { profile } = groundProfile({ ...p, signOff: "Regards," }, CORPUS, 25);
    expect(profile.signOff).toBe("Regards,");   // corpus has *Regards,*
  });

  test("leaves a very short quote alone — it cannot be attributed either way", () => {
    const p = base();
    p.greeting = "Yo";
    expect(p.greeting.length).toBeLessThan(MIN_ATTRIBUTABLE_CHARS);
    const { profile } = groundProfile(p, CORPUS, 25);
    expect(profile.greeting).toBe("Yo");
  });

  test("drops a credential even though it is grounded", () => {
    const corpus = CORPUS + "\n\n---\n\npassword: hunter2 is the login for the portal";
    const p = base();
    p.commonPhrases = ["password: hunter2 is the login", "when you get a chance"];
    const { profile, dropped } = groundProfile(p, corpus, 25);
    expect(profile.commonPhrases).toEqual(["when you get a chance"]);
    expect(dropped.some((d) => d.includes("secret"))).toBe(true);
  });

  test("drops a name placeholder in the greeting", () => {
    const p = base();
    p.greeting = "Hi [Name],";
    const { profile, dropped } = groundProfile(p, CORPUS, 25);
    expect(profile.greeting).toBeUndefined();
    expect(dropped).toContain("greeting:placeholder");
  });

  test("drops a closing that duplicates the sign-off", () => {
    const p = base();
    p.voiceExamples.closing = "Thanks, Shiva";
    const { profile, dropped } = groundProfile(p, CORPUS, 25);
    expect(profile.voiceExamples?.closing).toBeUndefined();
    expect(dropped).toContain("voiceExamples.closing:duplicates-signoff");
  });

  test("the same sentence under two labels loses the second", () => {
    const p = base();
    p.voiceExamples.escalate = "could you send the numbers when you get a chance?";
    const { profile, dropped } = groundProfile(p, CORPUS, 25);
    expect(profile.voiceExamples?.request).toBe("could you send the numbers when you get a chance?");
    expect(profile.voiceExamples?.escalate).toBeUndefined();
    expect(dropped).toContain("voiceExamples.escalate:duplicate-line");
  });

  test("clamps an out-of-enum formality", () => {
    const { profile } = groundProfile({ ...base(), formality: "breezy" as never }, CORPUS, 25);
    expect(profile.formality).toBeUndefined();
  });

  test("under ten samples, judgement fields go and verbatim fields stay", () => {
    const { profile } = groundProfile(base(), CORPUS, 4);
    expect(profile.formality).toBeUndefined();
    expect(profile.formalityNote).toBeUndefined();
    expect(profile.language).toBeUndefined();
    expect(profile.greeting).toBe("Hi Sam,");
    expect(profile.voiceExamples?.request).toBeTruthy();
  });

  test("removal is never repair — a dropped field is absent, not rewritten", () => {
    const p = base();
    p.voiceExamples.request = "Please revert at the earliest.";
    const { profile } = groundProfile(p, CORPUS, 25);
    expect(profile.voiceExamples?.request).toBeUndefined();
  });

  // Round 1 fix: the placeholder stage used to check only greeting/signOff, so
  // "[Name]" in a voiceExamples move sailed through ungrounded() (it's under
  // MIN_ATTRIBUTABLE_CHARS) and past the closing/signOff dedupe (signOff was
  // already gone by the time that check ran). It must be caught on its own.
  test("drops a name placeholder wherever it appears, not just greeting or sign-off", () => {
    const p = base();
    p.signOff = "[Name]";
    p.voiceExamples.closing = "[Name]";
    const { profile, dropped } = groundProfile(p, CORPUS, 25);
    expect(profile.signOff).toBeUndefined();
    expect(profile.voiceExamples?.closing).toBeUndefined();
    expect(dropped).toContain("signOff:placeholder");
    expect(dropped).toContain("voiceExamples.closing:placeholder");
  });

  // Round 1 fix: groundProfile used to spread the whole model-supplied object, so
  // a key outside the known schema was copied straight into the result, never
  // checked against any stage.
  test("drops fields outside the known schema instead of passing them through", () => {
    const p = {
      ...base(),
      secretPlan: "wire the funds to account 44219 before Friday",
      voiceExamples: { ...base().voiceExamples, fifthMove: "not a real move" },
    } as VoiceProfile;
    const { profile } = groundProfile(p, CORPUS, 25);
    expect((profile as Record<string, unknown>).secretPlan).toBeUndefined();
    expect((profile.voiceExamples as Record<string, unknown> | undefined)?.fifthMove).toBeUndefined();
  });
});

// ---- ported from Flock tests/voice-store.test.ts: the rows a profile becomes, the one model call, the app's store ---------


const SAMPLES = [
  "Hi Sam, could you send the numbers when you get a chance? Thanks, Shiva",
  "Flagging that this is now blocking the launch and we need a call today.",
];
const MODEL_PROFILE = {
  greeting: "Hi Sam,",
  signOff: "Thanks, Shiva",
  commonPhrases: ["could you send the numbers"],
  formality: "casual",
  formalityNote: "warm and direct",
  language: "English",
  abbreviations: "full words only",
  voiceExamples: {
    request: "could you send the numbers when you get a chance?",
    escalate: "Flagging that this is now blocking the launch",
  },
};

describe("voiceEntriesFor", () => {
  const profile = {
    greeting: "Hi Sam,", signOff: "Thanks, Shiva",
    commonPhrases: ["could you send the numbers"],
    formality: "casual" as const, formalityNote: "warm and direct",
    language: "Hinglish (Hindi-English code-switching)", abbreviations: "full words only",
    voiceExamples: { request: "could you send the numbers when you get a chance?" },
  };

  test("maps every present field onto a dimension", () => {
    const dims = voiceEntriesFor(profile, computeStats(SAMPLES)).map((e) => e.dimension);
    for (const d of ["greeting_style", "sign_off", "vocabulary", "formality", "sentence_length", "avoidance_patterns", "cultural_markers", "phrasing_request"]) {
      expect(dims).toContain(d);
    }
  });

  test("the phrases ride in the examples column of vocabulary", () => {
    const vocab = voiceEntriesFor(profile, computeStats(SAMPLES)).find((e) => e.dimension === "vocabulary");
    expect(vocab?.examples).toEqual(["could you send the numbers"]);
    expect(vocab?.value).toBe("Reuses these phrases. Abbreviations: full words only.");
  });

  test("an absent move writes no row", () => {
    const dims = voiceEntriesFor(profile, computeStats(SAMPLES)).map((e) => e.dimension);
    expect(dims).not.toContain("phrasing_escalate");
    expect(dims).not.toContain("phrasing_closing");
  });

  test("the greeting keeps the name the user wrote", () => {
    const greeting = voiceEntriesFor(profile, computeStats(SAMPLES)).find((e) => e.dimension === "greeting_style");
    expect(greeting?.value).toContain("Hi Sam,");
  });

  test("the rows the drafter reads carry no dash of their own", () => {
    for (const e of voiceEntriesFor(profile, computeStats(SAMPLES))) expect(e.value).not.toMatch(/[—–]/);
  });
});

describe("extractVoice", () => {
  const model = (answer: Awaited<ReturnType<VoiceModel>>, seen: any[] = []): VoiceModel => async (req) => { seen.push(req); return answer; };

  test("one Balanced model call with the schema, grounded", async () => {
    const seen: any[] = [];
    const out = await extractVoice(model({ ok: true, json: MODEL_PROFILE }, seen), SAMPLES);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ tier: "balanced", maxTokens: 1200, purpose: "voice" });
    expect(seen[0].schema).toBeTruthy();
    expect(seen[0].system).toContain("ONE person");
    expect(out.entries?.length).toBeGreaterThan(0);
    expect(out.entries && "sampleCount" in out ? out.sampleCount : 0).toBe(2);
  });

  test("a text answer is parsed too", async () => {
    const out = await extractVoice(model({ ok: true, text: "```json\n" + JSON.stringify(MODEL_PROFILE) + "\n```" }), SAMPLES);
    expect(out.entries?.length).toBeGreaterThan(0);
  });

  test("an unparseable answer gives no entries", async () => {
    const out = await extractVoice(model({ ok: true, text: "sorry, I cannot do that" }), SAMPLES);
    expect(out.entries).toBeNull();
  });

  test("a failed call gives no entries and never throws", async () => {
    expect((await extractVoice(model({ ok: false, code: "out_of_credits", message: "no credits" }), SAMPLES)).entries).toBeNull();
    expect((await extractVoice(async () => { throw new Error("boom"); }, SAMPLES)).entries).toBeNull();
  });

  test("a profile whose every verbatim field is ungrounded gives no entries", async () => {
    const out = await extractVoice(model({ ok: true, json: {
      greeting: "Dear esteemed colleague,",
      signOff: "Yours faithfully, the undersigned",
      commonPhrases: ["kindly do the needful at the earliest"],
      voiceExamples: { request: "Kindly revert at the earliest to the undersigned." },
    } }), SAMPLES);
    expect(out.entries).toBeNull();
  });

  test("no samples means no call", async () => {
    const seen: any[] = [];
    const out = await extractVoice(model({ ok: true, json: MODEL_PROFILE }, seen), []);
    expect(seen).toHaveLength(0);
    expect(out.entries).toBeNull();
  });
});

describe("storeLearnedVoice", () => {
  const db = () => openStore(mkdtempSync(join(tmpdir(), "email-desk-voice-store-")));

  test("writes rows under the mailbox, and two mailboxes do not collide", () => {
    const d = db();
    storeLearnedVoice("acct-1", [{ dimension: "greeting_style", value: "Hi Sam," }], 3, d);
    storeLearnedVoice("acct-2", [{ dimension: "greeting_style", value: "Hey" }], 3, d);
    expect(voiceRows("acct-1", d).map((r) => r.value)).toEqual(["Hi Sam,"]);
    expect(voiceRows("acct-2", d).map((r) => r.value)).toEqual(["Hey"]);
    d.close();
  });

  test("rows carry the crawl's source and the sample count", () => {
    const d = db();
    storeLearnedVoice("acct-1", [{ dimension: "sign_off", value: "Thanks," }], 7, d);
    expect(voiceRows("acct-1", d)[0]).toMatchObject({ source: CRAWL_SOURCE, observationCount: 7 });
    d.close();
  });

  test("hasVoice is false before and true after", () => {
    const d = db();
    expect(hasVoice("acct-1", d)).toBe(false);
    storeLearnedVoice("acct-1", [{ dimension: "sign_off", value: "Thanks," }], 3, d);
    expect(hasVoice("acct-1", d)).toBe(true);
    d.close();
  });

  test("a re-crawl updates in place rather than duplicating, its examples replacing the last crawl's", () => {
    const d = db();
    storeLearnedVoice("acct-1", [{ dimension: "sign_off", value: "Thanks,", examples: ["a"] }], 3, d);
    storeLearnedVoice("acct-1", [{ dimension: "sign_off", value: "Cheers,", examples: ["b"] }], 3, d);
    const rows = voiceRows("acct-1", d);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ value: "Cheers,", examples: ["b"] });
    d.close();
  });
});
