// The due-reminders routine: what came due since the last run is handed to the agent with the words to send, once.
import { describe, it, expect } from "bun:test";
import { boot } from "./testkit";
import { DUE_PROMPT, dueBetween, dueReminders } from "./routines";

const at = (day: number, hour: number, min = 0) => new Date(2026, 10, day, hour, min);

/** The family's week as add_events put it there, a reminder of its own, and a routine run as Flock makes it. */
async function start() {
  const k = await boot({ now: () => at(20, 17, 30) });
  await k.op("add_events", { events: [
    { title: "Skating class", who: "Agastya", weekdays: ["Tue", "Thu"], start_time: "16:00", end_time: "17:30", notes: "Gowri Shankar drops and picks up", reminder: "evening before" },
    { title: "Keyboard class", who: "Agastya", weekdays: ["Sat"], start_time: "16:00", location: "Music school", reminder: 60 },
    { title: "Art class", who: "Agastya", weekdays: ["Fri"], start_time: "17:00" },
    { title: "Grandma's birthday", date: "2026-11-28", reminder: "evening before" }] });
  await k.owner("POST", "/api/_data/reminders", { title: "Pack the PE kit", due: "2026-11-23T07:30", repeat: "weekly", who: "Agastya" });
  let state: unknown = null;
  const wakes: { message: string; data: any }[] = [];
  let ok = true;
  const ctx = { kit: k.kit, state: { get: <T,>() => state as T | null, set: (v: unknown) => { state = v; } },
    wakeAgent: async (message: string, data?: unknown) => { if (ok) wakes.push({ message, data }); return ok ? { ok: true } : { ok: false, reason: "busy" }; } };
  return Object.assign(k, { ctx, wakes, run: (now: Date) => dueReminders(ctx, now), fail: (v: boolean) => { ok = !v; }, state: () => state });
}

describe("due-reminders", () => {
  it("wakes the agent with what came due since the last run, in the words to send, and not again", async () => {
    const k = await start();
    await k.run(at(23, 18, 45));
    expect(k.wakes).toEqual([]);                      // nothing due: no wake
    await k.run(at(23, 19, 0));                       // Monday 7 pm: the evening before Tuesday's skating
    expect(k.wakes).toEqual([{ message: DUE_PROMPT, data: { reminders: [
      { who: "Agastya", text: "Skating class: tomorrow, 4 pm to 5:30 pm. Gowri Shankar drops and picks up" }] } }]);
    await k.run(at(23, 19, 15));
    expect(k.wakes).toHaveLength(1);
    expect(k.state()).toEqual({ until: "2026-11-23T19:15" });
  });

  it("an hour before, a reminder of its own, an all-day event, and the same class the week after", async () => {
    const k = await start();
    await k.run(at(21, 15, 0));                       // Saturday 3 pm: keyboard at 4
    expect(k.wakes[0].data.reminders).toEqual([{ who: "Agastya", text: "Keyboard class: today, 4 pm, Music school" }]);
    await k.run(at(23, 7, 30));                       // Monday 7:30: the PE kit, a reminder with no event
    expect(k.wakes[1].data.reminders).toEqual([{ who: "Agastya", text: "Pack the PE kit" }]);
    await k.run(at(27, 19, 0));                       // Friday 7 pm: tomorrow's birthday, for everyone
    expect(k.wakes[2].data.reminders).toEqual([{ who: null, text: "Grandma's birthday: tomorrow" }]);
    await k.run(at(30, 19, 0));                       // the Monday after: skating again, and the PE kit was due that morning only
    expect(k.wakes[3].data.reminders).toEqual([{ who: "Agastya", text: "Skating class: tomorrow, 4 pm to 5:30 pm. Gowri Shankar drops and picks up" }]);
    // An event without a reminder (Art class) is never spoken of.
    expect(JSON.stringify(k.wakes)).not.toContain("Art class");
  });

  it("a wake that did not go is a failed run and is tried again; a long stop sends no backlog", async () => {
    const k = await start();
    await k.run(at(23, 18, 45));
    k.fail(true);
    await expect(k.run(at(23, 19, 0))).rejects.toThrow("the agent was not woken: busy");
    expect(k.state()).toEqual({ until: "2026-11-23T18:45" });
    k.fail(false);
    await k.run(at(23, 19, 15));
    expect(k.wakes.map((w) => w.data.reminders.length)).toEqual([1]);
    // Stopped for two days: only the last hour is looked at.
    await k.run(at(25, 19, 30));
    expect(k.wakes[1].data.reminders).toEqual([{ who: "Agastya", text: "Skating class: tomorrow, 4 pm to 5:30 pm. Gowri Shankar drops and picks up" }]);   // Thursday's, due Wed 7 pm
    expect(dueBetween(k.kit.db, "2026-11-25T19:30", "2026-11-25T19:45")).toEqual([]);
  });
});
