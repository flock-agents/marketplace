// Ported from Flock's server/tests/task-gates.test.ts: the blockTaskGate and senderKindOf sections (the item-level gates
// stay in Flock's extraction and are tested there).
import { describe, test, expect } from "bun:test";
import { blockTaskGate, senderKindOf } from "../lib/task-gates";

const OWNER = ["shiva@bimacred.com"];
describe("blockTaskGate — who wrote this thread", () => {
  test("a thread the owner alone wrote is labelled self-authored, and tasks stay ON", () => {
    const segs = [
      { from: "me <shiva@bimacred.com>", text: "Daily brief: attach the audio file" },
      { from: "Shiva Shankar <shiva@bimacred.com>", text: "To-do: clarify the report" },
    ];
    expect(blockTaskGate(segs, OWNER)).toEqual({ tasks: true, selfAuthored: true });
  });
  test("one message from anyone else keeps tasks on", () => {
    const segs = [
      { from: "shiva@bimacred.com", text: "fwd" },
      { from: "Shubham <shubham@bimacred.com>", text: "please attach the audio" },
    ];
    expect(blockTaskGate(segs, OWNER)).toEqual({ tasks: true });
  });
  test("no owner identity on record fails open", () => {
    expect(blockTaskGate([{ from: "shiva@bimacred.com", text: "x" }], [])).toEqual({ tasks: true });
  });
  test("an empty thread fails open", () => {
    expect(blockTaskGate([], OWNER)).toEqual({ tasks: true });
  });
});

describe("senderKindOf — automated versus human, from the non-owner senders", () => {
  const seg = (from: string) => ({ from, text: "x" });

  test("a Google program mailbox is automated", () => {
    expect(senderKindOf([seg("Google for Startups <cloudstartupsupport@google.com>")], OWNER)).toBe("automated");
  });
  test("a no-reply address is automated", () => {
    expect(senderKindOf([seg("no-reply@fathom.video")], OWNER)).toBe("automated");
  });
  test.each(["info@acme.test", "team@acme.test", "hello@acme.test", "newsletter@acme.test"])("%s is a role mailbox, so it is automated", (from) => {
    expect(senderKindOf([seg(from)], OWNER)).toBe("automated");
  });
  test("a named colleague is human", () => {
    expect(senderKindOf([seg("shubham@bimacred.com")], OWNER)).toBe("human");
  });
  test("a mix of a human and an automated sender reads human", () => {
    expect(senderKindOf([seg("shubham@bimacred.com"), seg("no-reply@fathom.video")], OWNER)).toBe("human");
  });
  test("owner-only segments (no other party) read human", () => {
    expect(senderKindOf([seg("shiva@bimacred.com")], OWNER)).toBe("human");
  });
  test("a vendor support thread the owner opened is human, even though the address is role-shaped", () => {
    const segs = [seg("shiva@bimacred.com"), { from: "Vendor Support <support@vendor.com>", text: "Thanks, we'll look into it." }];
    expect(senderKindOf(segs, OWNER)).toBe("human");
  });
  test("the same thread without the owner's message is automated", () => {
    expect(senderKindOf([{ from: "Vendor Support <support@vendor.com>", text: "Thanks, we'll look into it." }], OWNER)).toBe("automated");
  });
});
