import { describe, test, expect } from "bun:test";
import { KINDS, EVENT_TYPES, kindSpec, kindTable, speaksToKind } from "../kinds";

describe("kinds", () => {
  test("13 kinds, unique", () => {
    expect(KINDS.length).toBe(13);
    expect(new Set(KINDS.map((k) => k.kind)).size).toBe(13);
  });
  test("reminder, block and other are allowed by no kind", () => {
    for (const t of ["reminder", "block", "other"] as const) {
      expect(EVENT_TYPES).toContain(t);
      expect(KINDS.filter((k) => k.types.includes(t))).toEqual([]);
    }
  });
  test("every Tier 2 kind has a query and an ask", () => {
    const t2 = KINDS.filter((k) => k.tier === 2);
    expect(t2.map((k) => k.kind)).toEqual(["cab-local", "gift", "table-booking"]);
    for (const k of t2) {
      expect(k.query).toBeTruthy();
      expect(k.ask).toBeTruthy();
    }
  });
  test("ask copy is plain: no jargon, no em-dash", () => {
    for (const k of KINDS) {
      if (!k.ask) continue;
      for (const s of [k.ask.title, k.ask.yes, k.ask.no]) {
        expect(s).not.toMatch(/tier|kind|tally|type|—/i);
      }
    }
  });
  test("spec values", () => {
    expect(kindSpec("cab-airport")?.query).toBe("drive airport cab");
    expect(kindSpec("pack")?.types).toEqual(["stay", "journey"]);
    expect(kindSpec("book-opening")?.defaultKey).toBe("book-tickets");
    expect(kindSpec("documents")?.defaultKey).toBeNull();
    expect(kindSpec("prepare-ahead")?.tier).toBe("rule");
    expect(kindSpec("payment")?.tier).toBe("judgement");
    expect(kindSpec("nope")).toBeUndefined();
  });
  test("a personal kind's search never names the event itself, or every appointment, birthday or dinner fact would read as evidence", () => {
    expect(kindSpec("cab-local")?.query).toBe("cab Uber Ola drive");
    expect(kindSpec("gift")?.query).toBe("gift");
    expect(kindSpec("table-booking")?.query).toBe("table reservation");
  });
  test("speaksToKind: a whole action or query word, case-folded", () => {
    expect(speaksToKind("cab-local", "Prefers to take a CAB to appointments")).toBe(true);
    expect(speaksToKind("cab-local", "Takes an Uber to the dentist.")).toBe(true);
    expect(speaksToKind("cab-local", "Moved to Indiranagar")).toBe(false);
    expect(speaksToKind("cab-local", "Dentist appointment at Apollo Clinic")).toBe(false);
    expect(speaksToKind("cab-local", "Ordered a cabinet")).toBe(false); // whole words only
    expect(speaksToKind("gift", "Asha's birthday is 12 Oct")).toBe(false);
    expect(speaksToKind("gift", "No gift for office birthdays")).toBe(true);
    expect(speaksToKind("table-booking", "Likes a table by the window")).toBe(true);
    expect(speaksToKind("checkin", "anything")).toBe(false); // no personal kind: no words
  });
  test("kindTable lists every kind once", () => {
    const table = kindTable();
    for (const k of KINDS) {
      expect(table.split("`" + k.kind + "`").length - 1).toBe(1);
    }
  });
});
