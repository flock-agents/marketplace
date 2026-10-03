import { describe, test, expect, beforeEach } from "bun:test";
import { mkdtempSync } from "fs"; import { tmpdir } from "os"; import { join } from "path";
import { ok, type PlatformContext } from "@flock/app-sdk";
process.env.APP_DATA_DIR = mkdtempSync(join(tmpdir(), "calendar-desk-ingest-"));
const S = await import("../store");
const { ingestFacts } = await import("../ingest");
const { readRemindersConfig } = await import("../rules");

const NOW = new Date(2026, 9, 5, 10, 17);
const F = (id: number, over: any = {}) => ({ id, content: `Deadline ${id} on 17 Oct.`, kind: "event", dateRole: "deadline", when: { date: "2026-10-17", time: null, tz: null, end: null, recurrence: null }, validFrom: null, validUntil: null, salience: 0.8, domain: "work", sourceLink: null, entityIds: [], recordedAt: `2026-10-05T0${id}:00:00.000Z`, ...over });
function platform(pages: any[][], seen: string[] = []): PlatformContext {
  let i = 0;
  return { configured: true, memory: { factsSince: async (o: any) => { seen.push(o.sinceIso); const facts = pages[i++] ?? []; return ok({ facts, nextSince: facts.length ? facts[facts.length - 1].recordedAt : o.sinceIso }); } } } as unknown as PlatformContext;
}
beforeEach(() => { for (const t of ["reminders", "cursors"]) S._db.exec(`DELETE FROM ${t}`); });

describe("ingestFacts", () => {
  test("creates reminders from dated facts, dedupes on fact id and on title+date, advances the cursor", async () => {
    const seen: string[] = [];
    const r = await ingestFacts(platform([[F(1), F(2, { content: "Deadline 1 on 17 Oct." })]], seen), readRemindersConfig(undefined), NOW);
    expect(r).toMatchObject({ read: 2, created: 1, updated: 1, cursorAdvanced: true });
    expect(S.listActiveReminders().length).toBe(1);
    expect(S.getCursor("facts_since")).toBe("2026-10-05T02:00:00.000Z");
    // first call started 30 days back
    expect(new Date(seen[0]!).getTime()).toBeLessThan(NOW.getTime() - 29 * 86_400_000);
    // a second pass with the same fact ids is a no-op and does not regress the cursor
    await ingestFacts(platform([[F(1)]]), readRemindersConfig(undefined), NOW);
    expect(S.listActiveReminders().length).toBe(1);
    expect(S.getCursor("facts_since")).toBe("2026-10-05T02:00:00.000Z");
  });
  test("a failed read leaves the cursor where it was; includeFound=false advances without creating", async () => {
    const failing = { configured: true, memory: { factsSince: async () => ({ ok: false, reason: "platform 503" }) } } as unknown as PlatformContext;
    const r = await ingestFacts(failing, readRemindersConfig(undefined), NOW);
    expect(r.cursorAdvanced).toBe(false);
    expect(S.getCursor("facts_since")).toBeNull();
    const r2 = await ingestFacts(platform([[F(7)]]), readRemindersConfig({ includeFound: false }), NOW);
    expect(r2.created).toBe(0); expect(r2.cursorAdvanced).toBe(true);
  });
  test("a cancelled reminder is not resurrected by its fact", async () => {
    await ingestFacts(platform([[F(3)]]), readRemindersConfig(undefined), NOW);
    const id = S.listActiveReminders()[0]!.id;
    S.updateReminder(id, { state: "cancelled" });
    S._db.exec("DELETE FROM cursors");
    await ingestFacts(platform([[F(3)]]), readRemindersConfig(undefined), NOW);
    expect(S.listActiveReminders().length).toBe(0);
  });
});
