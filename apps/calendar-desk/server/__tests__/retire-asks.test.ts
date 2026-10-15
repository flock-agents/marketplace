import { describe, test, expect, beforeEach } from "bun:test";
import { mkdtempSync } from "fs"; import { tmpdir } from "os"; import { join } from "path";
import { ok, failed, type PlatformContext } from "@flock/app-sdk";
process.env.APP_DATA_DIR = mkdtempSync(join(tmpdir(), "calendar-desk-retire-asks-"));
const S = await import("../store");
const { retireAskCards } = await import("../retire-asks");

beforeEach(() => S._db.exec("DELETE FROM cursors"));
type Row = { sourceRef: string; status: "open" | "done" | "dismissed" };
function flock(rows: Row[], o: { listFails?: boolean; failWithdraw?: Set<string> } = {}) {
  const lists: any[] = [], withdrawals: { ref: string; reason?: string }[] = [];
  const ctx = { tasks: {
    list: async (opts: { prefix?: string }) => { lists.push(opts); return o.listFails ? failed("board offline") : ok({ tasks: rows.filter((r) => r.sourceRef.startsWith(opts.prefix ?? "")) }); },
    withdraw: async (ref: string, opts?: { reason?: string }) => { withdrawals.push({ ref, reason: opts?.reason }); return o.failWithdraw?.has(ref) ? failed("busy") : ok(undefined); },
  } } as unknown as PlatformContext;
  return { ctx, lists, withdrawals };
}

describe("retireAskCards", () => {
  test("withdraws only the open ask cards, with the plain reason, once", async () => {
    const f = flock([{ sourceRef: "ask:cab-local", status: "open" }, { sourceRef: "ask:gift", status: "done" }, { sourceRef: "ask:table-booking", status: "dismissed" }]);
    expect(await retireAskCards(f.ctx)).toBe(1);
    expect(f.withdrawals).toEqual([{ ref: "ask:cab-local", reason: "no longer used" }]);
    expect(f.lists).toEqual([{ prefix: "ask:" }]);
    expect(await retireAskCards(f.ctx)).toBe(0);
    expect(f.lists).toHaveLength(1); // done: never listed again
  });
  test("a board that cannot be read is tried again next run", async () => {
    expect(await retireAskCards(flock([], { listFails: true }).ctx)).toBe(0);
    expect(S.getCursor("asks_retired")).toBeNull();
    const f = flock([{ sourceRef: "ask:gift", status: "open" }]);
    expect(await retireAskCards(f.ctx)).toBe(1);
    expect(S.getCursor("asks_retired")).not.toBeNull();
  });
  test("a failed withdrawal is retried next run, and only the card still open is withdrawn then", async () => {
    const rows: Row[] = [{ sourceRef: "ask:cab-local", status: "open" }, { sourceRef: "ask:gift", status: "open" }];
    const first = flock(rows, { failWithdraw: new Set(["ask:gift"]) });
    expect(await retireAskCards(first.ctx)).toBe(1);
    expect(S.getCursor("asks_retired")).toBeNull();
    rows[0]!.status = "dismissed";
    const second = flock(rows);
    expect(await retireAskCards(second.ctx)).toBe(1);
    expect(second.withdrawals).toEqual([{ ref: "ask:gift", reason: "no longer used" }]);
    expect(S.getCursor("asks_retired")).not.toBeNull();
  });
  test("no cards at all: done after one read", async () => {
    const f = flock([]);
    expect(await retireAskCards(f.ctx)).toBe(0);
    expect(S.getCursor("asks_retired")).not.toBeNull();
  });
});
