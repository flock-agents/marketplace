import { describe, test, expect } from "bun:test";
import { findPlaceholder, findDash, findBadRecipient } from "../lib/draft-body-check";

// See draft-body-check.ts: the owner ruled a draft carries no bracketed blanks.
describe("findPlaceholder", () => {
  test("catches the live Haiku output", () => {
    expect(findPlaceholder("Thanks for checking in. [AGGY STATUS UPDATE]\n\nAs for Instinct, [YES/NO ON INSTINCT INTEREST] - let me know.")).toBe("[AGGY STATUS UPDATE]");
  });
  test("catches the old GAP form and curly templates", () => {
    expect(findPlaceholder("Our GSTIN is [GSTIN].")).toBe("[GSTIN]");
    expect(findPlaceholder("Hi {name}, thanks")).toBe("{name}");
    expect(findPlaceholder("Sent on [insert date]")).toBe("[insert date]");
  });
  test("plain prose passes", () => {
    expect(findPlaceholder("Hey Pluto,\n\nYes, the autodraft is working. Happy to demo Thursday.\n\nCheers,\nShiva")).toBeNull();
    expect(findPlaceholder("")).toBeNull();
    expect(findPlaceholder(undefined)).toBeNull();
  });
  test("a bracket that never closes on its line is not a blank", () => {
    expect(findPlaceholder("see the note [1\n] later")).toBeNull();
  });
});

// See draft-body-check.ts: the owner's voice has no dashes, and a model asked
// for a draft in chat never saw that rule. The check is the backstop.
describe("findDash", () => {
  // Ported from Flock tests/gmail-body-html.test.ts (Task 3.4): a Markdown table's divider row is not a dash in the prose.
  test("|---| is not a dash; an empty header row is fine; a real em dash in a cell still is", () => {
    expect(findDash("Hi,\n\n| Field | Details |\n|---|---|\n| Designation | Co-Founder |\n\nThanks")).toBeNull();
    expect(findDash("| | |\n|---|---|\n| a | b |")).toBeNull();
    expect(findDash("| a | b |\n|:---|---:|\n| x | y |")).toBeNull();
    expect(findDash("| a |\n|---|\n| yes — confirmed |")).toBe("yes — confirmed");
  });
  test("catches an em dash, an en dash and a double hyphen, with the words around it", () => {
    expect(findDash("Yes — Friday works.")).toBe("Yes — Friday");
    expect(findDash("We ship 10–12 units.")).toBe("10–12");
    expect(findDash("Sure -- sending it now.")).toBe("Sure -- sending");
  });
  test("plain hyphens and prose pass", () => {
    expect(findDash("A well-known follow-up, sent on 2026-09-23.")).toBeNull();
    expect(findDash("")).toBeNull();
    expect(findDash(undefined)).toBeNull();
  });
  test("a signature delimiter on its own line is not a dash in the prose", () => {
    expect(findDash("Thanks,\n-- \nShiva")).toBeNull();
    expect(findDash("Thanks,\n--\nShiva")).toBeNull();
  });
});

// A RECIPIENT IS AN ADDRESS (owner, 2026-09-23). Live, an agent created a draft
// with to: "shubham" and it went through; the Personal Assistant had looked the
// address up, this agent did not.
describe("findBadRecipient", () => {
  test("a bare name is not a recipient", () => {
    expect(findBadRecipient("shubham")).toBe("shubham");
    expect(findBadRecipient("a@b.com, shubham")).toBe("shubham");
  });
  test("addresses, display-name forms and empty fields pass", () => {
    expect(findBadRecipient("shubham@bimacred.com")).toBeNull();
    expect(findBadRecipient("Shubham <shubham@bimacred.com>, a@b.co.in")).toBeNull();
    expect(findBadRecipient("")).toBeNull();
    expect(findBadRecipient(undefined)).toBeNull();
  });
});
