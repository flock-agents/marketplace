import { describe, it, expect } from "bun:test";
import { inQuietHours, nextSlot, quietOver, windowTimes } from "./messages";

const S = { reminderTime: "20:00", headsUpMin: 15, yesWaitH: 3, quietStart: "22:30", quietEnd: "06:30" };
const times = windowTimes("2026-10-29T18:00", S);
const none = new Set<string>();

describe("windowTimes", () => {
  it("reminder the evening before, heads-up shortly before, price at the window, let-go after the yes wait", () => {
    expect(times).toEqual({ reminder: "2026-10-28T20:00", heads_up: "2026-10-29T17:45", price: "2026-10-29T18:00", let_go: "2026-10-29T21:00" });
    expect(windowTimes("2026-11-01T07:00", { ...S, yesWaitH: 0.5 }).let_go).toBe("2026-11-01T07:30");
  });
});

describe("quiet hours", () => {
  it("wraps midnight, and also works inside one day", () => {
    expect(inQuietHours("2026-10-28T23:00", "22:30", "06:30")).toBe(true);
    expect(inQuietHours("2026-10-28T06:29", "22:30", "06:30")).toBe(true);
    expect(inQuietHours("2026-10-28T06:30", "22:30", "06:30")).toBe(false);
    expect(inQuietHours("2026-10-28T14:00", "13:00", "15:00")).toBe(true);
    expect(inQuietHours("2026-10-28T15:00", "13:00", "15:00")).toBe(false);
  });
  it("quietOver is the first moment outside them", () => {
    expect(quietOver("2026-10-28T23:00", "22:30", "06:30")).toBe("2026-10-29T06:30");
    expect(quietOver("2026-10-29T05:00", "22:30", "06:30")).toBe("2026-10-29T06:30");
    expect(quietOver("2026-10-29T12:00", "22:30", "06:30")).toBe("2026-10-29T12:00");
  });
});

describe("nextSlot", () => {
  it("each slot in order, at its own moment", () => {
    expect(nextSlot(times, none, "2026-10-28T19:00", S)).toEqual({ slot: "reminder", due_at: "2026-10-28T20:00", due: false });
    expect(nextSlot(times, none, "2026-10-28T20:00", S)).toEqual({ slot: "reminder", due_at: "2026-10-28T20:00", due: true });
    expect(nextSlot(times, new Set(["reminder"]), "2026-10-28T20:15", S)).toEqual({ slot: "heads_up", due_at: "2026-10-29T17:45", due: false });
    expect(nextSlot(times, new Set(["reminder", "heads_up"]), "2026-10-29T18:00", S)).toEqual({ slot: "price", due_at: "2026-10-29T18:00", due: true });
    expect(nextSlot(times, new Set(["reminder", "heads_up", "price"]), "2026-10-29T18:00", S)).toBeNull();
  });
  it("a slot whose moment is over is skipped, never sent late; nothing after the let-go", () => {
    expect(nextSlot(times, none, "2026-10-29T17:50", S)).toEqual({ slot: "heads_up", due_at: "2026-10-29T17:50", due: true });
    expect(nextSlot(times, none, "2026-10-29T18:10", S)).toEqual({ slot: "price", due_at: "2026-10-29T18:10", due: true });
    expect(nextSlot(times, none, "2026-10-29T21:00", S)).toBeNull();
  });
  it("a reminder no earlier than an hour before the heads-up is dropped: the heads-up says it all", () => {
    expect(nextSlot(times, none, "2026-10-29T16:50", S)?.slot).toBe("heads_up");
    expect(nextSlot(times, none, "2026-10-29T16:40", S)).toEqual({ slot: "reminder", due_at: "2026-10-29T16:40", due: true });
  });
  it("quiet hours hold a message until they end, or drop it when its moment ends first", () => {
    const night = windowTimes("2026-10-29T06:45", S);   // heads-up 06:30, reminder the evening before at 20:00
    expect(nextSlot(night, new Set(["reminder"]), "2026-10-29T06:00", S)).toEqual({ slot: "heads_up", due_at: "2026-10-29T06:30", due: false });
    const early = windowTimes("2026-10-29T06:30", S);   // heads-up 06:15 is quiet and over by 06:30
    expect(nextSlot(early, new Set(["reminder"]), "2026-10-29T06:15", S)).toEqual({ slot: "price", due_at: "2026-10-29T06:30", due: false });
    expect(nextSlot(times, none, "2026-10-28T23:00", { ...S, quietStart: "22:30" })?.due).toBe(false);
  });
  it("a draft made after its reminder moment gets no reminder", () => {
    expect(nextSlot(times, none, "2026-10-28T21:00", S, "2026-10-28T21:00")).toEqual({ slot: "heads_up", due_at: "2026-10-29T17:45", due: false });
    expect(nextSlot(times, none, "2026-10-28T20:00", S, "2026-10-28T09:00")?.slot).toBe("reminder");
  });
});
