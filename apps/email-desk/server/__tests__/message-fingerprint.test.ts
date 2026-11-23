import { describe, test, expect } from "bun:test";
import { messageFingerprint } from "../lib/message-fingerprint";

const base = {
  from: "Priya Raman <priya@northwind.test>",
  date: "Oct 27, 2026, 2:12 PM",
  body: "Can you send the signed order form?\n\nOn Mon, Asha wrote:\n> earlier text",
  bodyMain: "Can you send the signed order form?",
};

describe("messageFingerprint", () => {
  test("is stable for the same message read twice", () => {
    expect(messageFingerprint(base)).toBe(messageFingerprint({ ...base }));
  });

  test("reads the sender's address, not how the name was shown", () => {
    expect(messageFingerprint({ ...base, from: "PRIYA@northwind.test" })).toBe(messageFingerprint(base));
  });

  test("two replies in the same minute from one sender differ by their text", () => {
    expect(messageFingerprint({ ...base, body: "Thursday works.", bodyMain: undefined }))
      .not.toBe(messageFingerprint({ ...base, body: "Friday works.", bodyMain: undefined }));
  });

  test("covers the message's own text: the quoted history does not change it", () => {
    expect(messageFingerprint({ ...base, body: `${base.bodyMain}\n\n> other history` })).toBe(messageFingerprint(base));
  });

  test("collapses whitespace and reads only the start of the text", () => {
    const long = "word ".repeat(100);
    expect(messageFingerprint({ ...base, bodyMain: undefined, body: `${long}\nending one` }))
      .toBe(messageFingerprint({ ...base, bodyMain: undefined, body: `  ${long.replace(/ /g, "\n ")} ending two` }));
  });

  test("one minute written two ways is one message; another minute is another", () => {
    expect(messageFingerprint({ ...base, date: "Tue, 27 Oct 2026, 14:12" })).toBe(messageFingerprint(base));
    expect(messageFingerprint({ ...base, date: "Oct 27, 2026, 2:13 PM" })).not.toBe(messageFingerprint(base));
  });

  test("no date or no text gives no fingerprint", () => {
    expect(messageFingerprint({ ...base, date: "" })).toBeUndefined();
    expect(messageFingerprint({ ...base, body: "  ", bodyMain: undefined })).toBeUndefined();
    expect(messageFingerprint({ from: 1, date: null, body: {} })).toBeUndefined();
  });
});
