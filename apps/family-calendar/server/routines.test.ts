// The due-reminders routine: what came due since the last run is handed to the agent with the words to send, once. 3.0: no
// "evening before" (the 9 pm brief covers tomorrow), a deadline is spoken of a week before, a cancelled event never.
import { describe, it, expect } from "bun:test";
import { boot } from "./testkit";
import { DUE_PROMPT, dueBetween, dueReminders } from "./routines";

const at = (day: number, hour: number, min = 0) => new Date(2026, 10, day, hour, min);

/** The family's week as add_events put it there, a fee due by a day, and a routine run as Flock makes it. */
async function start() {
  const k = await boot({ now: () => at(20, 17, 30) });
  await k.op("add_events", { events: [
    { title: "Skating class", who: "Agastya", weekdays: ["Tue", "Thu"], start_time: "16:00", end_time: "17:30", notes: "Gowri Shankar drops and picks up" },
    { title: "Keyboard class", who: "Agastya", weekdays: ["Sat"], start_time: "16:00", location: "Music school", reminder: 60 },
    { title: "Art class", who: "Agastya", weekdays: ["Fri"], start_time: "17:00", reminder: null },
    { title: "Grandma's birthday", date: "1950-11-28", repeat: "yearly" },
    { title: "School fee due", date: "2026-12-03", kind: "deadline", who: "Shiva" }] });
  let state: unknown = null;
  const wakes: { message: string; data: any }[] = [];
  let ok = true;
  const ctx = { kit: k.kit, state: { get: <T,>() => state as T | null, set: (v: unknown) => { state = v; } },
    wakeAgent: async (message: string, data?: unknown) => { if (ok) wakes.push({ message, data }); return ok ? { ok: true } : { ok: false, reason: "busy" }; } };
  return Object.assign(k, { ctx, wakes, run: (now: Date) => dueReminders(ctx, now), fail: (v: boolean) => { ok = !v; }, state: () => state });
}

describe("due-reminders", () => {
  it("a timed event is nudged its minutes before (30 unless it says), once; nothing the evening before", async () => {
    const k = await start();
    await k.run(at(23, 18, 45));
    await k.run(at(23, 19, 0));                       // Monday 7 pm: once the evening before Tuesday's skating, now nothing
    expect(k.wakes).toEqual([]);
    await k.run(at(24, 15, 30));                      // Tuesday 3:30 pm: skating at 4
    expect(k.wakes).toEqual([{ message: DUE_PROMPT, data: { reminders: [
      { who: "Agastya", text: "Skating class: today, 4 pm to 5:30 pm. Gowri Shankar drops and picks up" }] } }]);
    await k.run(at(24, 15, 45));
    expect(k.wakes).toHaveLength(1);
    expect(k.state()).toEqual({ until: "2026-11-24T15:45" });
  });

  it("an hour before when it says so; none when it says none; a yearly all-day event has no nudge", async () => {
    const k = await start();
    await k.run(at(21, 15, 0));                       // Saturday 3 pm: keyboard at 4
    expect(k.wakes[0].data.reminders).toEqual([{ who: "Agastya", text: "Keyboard class: today, 4 pm, Music school" }]);
    await k.run(at(27, 16, 30));                      // Friday: art class at 5 has no nudge
    await k.run(at(27, 19, 0));
    expect(JSON.stringify(k.wakes)).not.toContain("Art class");
    expect(JSON.stringify(k.wakes)).not.toContain("birthday");
  });

  it("a deadline is spoken of a week before, at 9 in the morning, for the one it is for", async () => {
    const k = await start();
    await k.run(at(26, 8, 45));
    await k.run(at(26, 9, 0));                        // Thursday 26 Nov: the fee is due Thursday 3 Dec
    expect(k.wakes.map((w) => w.data.reminders)).toEqual([[{ who: "Shiva", text: "School fee due: due in a week, on Thu Dec 3" }]]);
  });

  it("a cancelled event is never spoken of", async () => {
    const k = await start();
    k.kit.sqlite.run("UPDATE events SET status = 'cancelled' WHERE title = 'Keyboard class'");
    await k.run(at(21, 15, 0));
    expect(k.wakes).toEqual([]);
  });

  it("a wake that did not go is a failed run and is tried again; a long stop sends no backlog", async () => {
    const k = await start();
    await k.run(at(24, 15, 15));
    k.fail(true);
    await expect(k.run(at(24, 15, 30))).rejects.toThrow("the agent was not woken: busy");
    expect(k.state()).toEqual({ until: "2026-11-24T15:15" });
    k.fail(false);
    await k.run(at(24, 15, 45));
    expect(k.wakes.map((w) => w.data.reminders.length)).toEqual([1]);
    // Stopped for two days: only the last hour is looked at.
    await k.run(at(26, 15, 30));
    expect(k.wakes[1].data.reminders).toEqual([{ who: "Agastya", text: "Skating class: today, 4 pm to 5:30 pm. Gowri Shankar drops and picks up" }]);
    expect(dueBetween(k.kit.db, "2026-11-26T15:30", "2026-11-26T15:45")).toEqual([]);
  });
});
