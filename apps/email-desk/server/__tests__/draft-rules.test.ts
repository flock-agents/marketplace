// The draft rules, pure (spec §2.4: one draft per thread, placeholder and quality checks, the person's own edits never
// overwritten). Expectations from the brief and the source gates (gmail-middleware.ts: draft_placeholder, draft_dash,
// draft_exists_use_update, draft_owner_edited; save-draft.ts checkDraftBody):
//   - an agent's body with a bracketed blank is refused PLACEHOLDER, naming the blank;
//   - an agent's body with a dash, or an empty or over-long body, is refused QUALITY with its reason;
//   - the person's own text is theirs: no placeholder or dash rule, only empty and too long;
//   - a thread with an open draft refuses a second, naming the first id;
//   - a sent draft is never changed; an agent never changes a draft the person edited.
import { describe, test, expect } from "bun:test";
import { bodyRefusal, draftExistsRefusal, updateRefusal, DRAFT_BODY_MAX } from "../drafts/rules";

describe("draft body rules", () => {
  test("placeholder like [Name] is refused", () => {
    const r = bodyRefusal("Hi [Name], see you then.", "agent");
    expect(r?.code).toBe("PLACEHOLDER");
    expect(r?.error).toContain("[Name]");
  });

  test("quality check refusal carries its reason", () => {
    const dash = bodyRefusal("Thanks — see you Tuesday.", "agent");
    expect(dash?.code).toBe("QUALITY");
    expect(dash?.error).toContain("dash");
    expect(dash?.error).toContain("—");
    const empty = bodyRefusal("   ", "agent");
    expect(empty?.code).toBe("QUALITY");
    expect(empty?.error).toContain("empty");
    const long = bodyRefusal("a".repeat(DRAFT_BODY_MAX + 1), "agent");
    expect(long?.code).toBe("QUALITY");
    expect(long?.error).toContain(String(DRAFT_BODY_MAX));
  });

  test("a clean body passes", () => {
    expect(bodyRefusal("Hi Asha, Tuesday works. See you then.", "agent")).toBeNull();
  });

  test("the person's own text skips the agent's placeholder and dash rules, not empty or too long", () => {
    expect(bodyRefusal("Hi [Name] — fine.", "person")).toBeNull();
    expect(bodyRefusal("", "person")?.code).toBe("QUALITY");
    expect(bodyRefusal("a".repeat(DRAFT_BODY_MAX + 1), "person")?.code).toBe("QUALITY");
  });

  test("refusal text is plain: no em or en dashes", () => {
    // The dash refusal quotes the dash it found; the rest of its text is plain.
    expect(bodyRefusal("a — b", "agent")!.error.replace('"a — b"', "")).not.toMatch(/[–—]/);
    for (const r of [bodyRefusal("Hi [x]", "agent"), bodyRefusal("", "agent"),
      draftExistsRefusal("d-1"), updateRefusal({ sentAt: 1, personEdited: false }, "agent"),
      updateRefusal({ sentAt: null, personEdited: true }, "agent")]) {
      expect(r?.error).not.toMatch(/[–—]/);
    }
  });
});

describe("one draft per thread", () => {
  test("second draft on a thread is refused naming the first id", () => {
    const r = draftExistsRefusal("draft-abc");
    expect(r.code).toBe("DRAFT_EXISTS");
    expect(r.error).toContain("draft-abc");
    expect(r.error).toContain("update_draft");
  });
});

describe("update rules", () => {
  test("agent update after a person's edit is refused", () => {
    expect(updateRefusal({ sentAt: null, personEdited: true }, "agent")?.code).toBe("PERSON_EDITED");
  });
  test("the person may change their own edited draft", () => {
    expect(updateRefusal({ sentAt: null, personEdited: true }, "person")).toBeNull();
  });
  test("a sent draft is never changed, by anyone", () => {
    expect(updateRefusal({ sentAt: 5, personEdited: false }, "agent")?.code).toBe("SENT");
    expect(updateRefusal({ sentAt: 5, personEdited: true }, "person")?.code).toBe("SENT");
  });
  test("an untouched open draft may be updated by the agent", () => {
    expect(updateRefusal({ sentAt: null, personEdited: false }, "agent")).toBeNull();
  });
});
