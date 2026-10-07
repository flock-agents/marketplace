import { describe, test, expect, beforeEach } from "bun:test";
import { mkdtempSync } from "fs"; import { tmpdir } from "os"; import { join } from "path";
import { ok, failed, type PlatformContext } from "@flock/app-sdk";
process.env.APP_DATA_DIR = mkdtempSync(join(tmpdir(), "calendar-desk-asks-"));
const S = await import("../store");
const { askStates, publishAsk, settleAsks, ASK_TTL_MS } = await import("../asks");
const { kindSpec } = await import("../kinds");

beforeEach(() => { S._db.exec("DELETE FROM plan_asks"); });

const NOW = new Date(2026, 9, 7, 9, 0, 0).getTime(); // Wed 7 Oct 2026
const DAY = 86400_000;
type Row = { sourceRef: string; status: "open" | "done" | "dismissed"; withdrawn?: true; actionId?: string; title: string; due: number | null; dueTimed: boolean; showFrom: number | null; updatedAt: number };

/** A fake Flock: publish opens a row, withdraw dismisses it as the app's own close, list reads rows by prefix. */
function flock(o: { extract?: () => any; list?: () => any } = {}) {
  const rows: Row[] = [];
  const published: any[] = [];
  const withdrawn: { ref: string; reason?: string }[] = [];
  const extracted: { items: any[]; source: any }[] = [];
  const ctx = {
    tasks: {
      publish: async (t: any) => {
        published.push(t);
        const i = rows.findIndex((r) => r.sourceRef === t.sourceRef);
        const row: Row = { sourceRef: t.sourceRef, status: "open", title: t.title, due: t.due ?? null, dueTimed: false, showFrom: null, updatedAt: NOW };
        if (i >= 0) rows[i] = row; else rows.push(row);
        return ok({});
      },
      withdraw: async (ref: string, opts?: { reason?: string }) => {
        withdrawn.push({ ref, reason: opts?.reason });
        const r = rows.find((x) => x.sourceRef === ref && x.status === "open");
        if (!r) return failed("not found");
        r.status = "dismissed"; r.withdrawn = true;
        return ok({});
      },
      list: async (opts: { prefix?: string } = {}) => (o.list ? o.list() : ok({ tasks: rows.filter((t) => t.sourceRef.startsWith(opts.prefix ?? "")) })),
    },
    memory: {
      extract: async (items: any[], source: any) => { extracted.push({ items, source }); return o.extract ? o.extract() : ok({}); },
    },
  } as unknown as PlatformContext;
  const close = (ref: string, actionId?: string, status: "done" | "dismissed" = "done") => {
    const r = rows.find((x) => x.sourceRef === ref)!;
    r.status = status; if (actionId) r.actionId = actionId;
  };
  return { ctx, rows, published, withdrawn, extracted, close };
}
const asks = async (f: ReturnType<typeof flock>) => askStates((await f.ctx.tasks.list({ prefix: "ask:" }) as any).data.tasks);
const flush = () => new Promise((r) => setTimeout(r, 0));

describe("publishAsk", () => {
  test("the card asks with the kind's own two buttons, due now, kept 14 days", async () => {
    const f = flock();
    await publishAsk(f.ctx, "cab-local", NOW, ["Takes the metro to work."]);
    expect(f.published).toHaveLength(1);
    const t = f.published[0];
    const ask = kindSpec("cab-local")!.ask!;
    expect(t.sourceRef).toBe("ask:cab-local");
    expect(t.title).toBe("Remind you to book a cab before appointments?");
    expect(t.title).toBe(ask.title);
    expect(t.due).toBe(NOW);
    expect(t.maxDue).toBe(NOW + ASK_TTL_MS);
    expect(ASK_TTL_MS).toBe(14 * DAY);
    expect(t.maxDueReason).toBe("Asked on Wed 7 Oct");
    expect(t.context).toEqual({ kind: "cab-local", factsAtPublish: ["Takes the metro to work."] });
    expect(t.actions).toEqual([
      { id: "yes", label: "Book a cab reminder", kind: "primary", executor: { mode: "inline" } },
      { id: "no", label: "Don't remind me", kind: "secondary", executor: { mode: "inline" } },
    ]);
  });

  test("one card per kind ever: a second ask for a kind with any ask row is a no-op", async () => {
    const f = flock();
    await publishAsk(f.ctx, "gift", NOW, []);
    await publishAsk(f.ctx, "gift", NOW + DAY, []);
    expect(f.published).toHaveLength(1);
    f.close("ask:gift"); // closed without an answer: still never asked again
    S._db.exec("DELETE FROM plan_asks"); // even with the local record gone, the row decides
    await publishAsk(f.ctx, "gift", NOW + 2 * DAY, []);
    expect(f.published).toHaveLength(1);
  });

  test("a kind with no ask (not Tier 2) publishes nothing", async () => {
    const f = flock();
    await publishAsk(f.ctx, "checkin", NOW, []);
    await publishAsk(f.ctx, "no-such-kind", NOW, []);
    expect(f.published).toHaveLength(0);
  });

  test("when the board cannot be read, nothing is published", async () => {
    const f = flock({ list: () => failed("down") });
    await publishAsk(f.ctx, "gift", NOW, []);
    expect(f.published).toHaveLength(0);
  });

  test("two kinds publish two cards", async () => {
    const f = flock();
    await publishAsk(f.ctx, "gift", NOW, []);
    await publishAsk(f.ctx, "table-booking", NOW, []);
    expect(f.published.map((t) => [t.sourceRef, t.actions[0].label])).toEqual([["ask:gift", "Gift reminder"], ["ask:table-booking", "Table reminder"]]);
    const st = await asks(f);
    expect(st.get("gift")!.status).toBe("waiting");
    expect(st.get("table-booking")!.status).toBe("waiting");
  });
});

describe("askStates", () => {
  test("no row is none; an open card is waiting with when it was published and the facts it saw", async () => {
    const f = flock();
    expect((await asks(f)).get("cab-local")).toEqual({ kind: "cab-local", status: "none" });
    await publishAsk(f.ctx, "cab-local", NOW, ["a"]);
    expect((await asks(f)).get("cab-local")).toEqual({ kind: "cab-local", status: "waiting", publishedAt: NOW, factsAtPublish: ["a"] });
  });

  test("the button that closed the card is the answer; a close without one is unanswered", async () => {
    const f = flock();
    for (const k of ["cab-local", "gift", "table-booking"]) await publishAsk(f.ctx, k, NOW, []);
    f.close("ask:cab-local", "yes");
    f.close("ask:gift", "no");
    f.close("ask:table-booking"); // Mark done, no action id
    const st = await asks(f);
    expect(st.get("cab-local")!.status).toBe("yes");
    expect(st.get("gift")!.status).toBe("no");
    expect(st.get("table-booking")!.status).toBe("unanswered");
  });

  test("a dismissed or withdrawn card is unanswered", async () => {
    const f = flock();
    await publishAsk(f.ctx, "gift", NOW, []);
    await publishAsk(f.ctx, "table-booking", NOW, []);
    f.close("ask:gift", undefined, "dismissed");
    await f.ctx.tasks.withdraw("ask:table-booking");
    const st = await asks(f);
    expect(st.get("gift")!.status).toBe("unanswered");
    expect(st.get("table-booking")!.status).toBe("unanswered");
  });

  test("an unknown action id is not an answer", async () => {
    const f = flock();
    await publishAsk(f.ctx, "gift", NOW, []);
    f.close("ask:gift", "maybe");
    expect((await asks(f)).get("gift")!.status).toBe("unanswered");
  });
});

describe("settleAsks", () => {
  test("a yes is reported once and written to memory once as a preference", async () => {
    const f = flock();
    await publishAsk(f.ctx, "cab-local", NOW, []);
    f.close("ask:cab-local", "yes");
    const r = await settleAsks(f.ctx, await asks(f), new Map(), NOW + DAY);
    expect(r.answered).toEqual([{ kind: "cab-local", yes: true }]);
    await flush();
    expect(f.extracted).toHaveLength(1);
    expect(f.extracted[0]!.items).toHaveLength(1);
    const item = f.extracted[0]!.items[0];
    expect(item.text).toBe("Wants a reminder to book a cab before appointments.");
    expect(item.hints).toEqual({ extractTasks: false });
    expect(typeof item.id).toBe("string");
    expect(new Date(item.timestamp).getTime()).toBe(NOW + DAY);
    expect(f.extracted[0]!.source).toEqual({ type: "external", connectorSkill: "calendar-desk" });

    const again = await settleAsks(f.ctx, await asks(f), new Map(), NOW + 2 * DAY);
    expect(again.answered).toEqual([]);
    await flush();
    expect(f.extracted).toHaveLength(1);
  });

  test("a no is reported and written as not wanted", async () => {
    const f = flock();
    await publishAsk(f.ctx, "gift", NOW, []);
    f.close("ask:gift", "no");
    const r = await settleAsks(f.ctx, await asks(f), new Map(), NOW + DAY);
    expect(r.answered).toEqual([{ kind: "gift", yes: false }]);
    await flush();
    expect(f.extracted.map((e) => e.items[0].text)).toEqual(["Does not want a reminder to buy a gift before family birthdays."]);
  });

  test("a failed memory write logs, does not block the answer, and is retried next run without re-reporting", async () => {
    let down = true;
    const f = flock({ extract: () => (down ? failed("memory down") : ok({})) });
    const warn = console.warn; const logged: string[] = []; console.warn = (m: string) => { logged.push(m); };
    try {
      await publishAsk(f.ctx, "gift", NOW, []);
      f.close("ask:gift", "yes");
      const r = await settleAsks(f.ctx, await asks(f), new Map(), NOW + DAY);
      expect(r.answered).toEqual([{ kind: "gift", yes: true }]);
      await flush();
    } finally { console.warn = warn; }
    expect(logged.some((m) => m.includes("gift"))).toBe(true);
    expect(f.extracted).toHaveLength(1);

    down = false;
    const retry = await settleAsks(f.ctx, await asks(f), new Map(), NOW + 2 * DAY);
    expect(retry.answered).toEqual([]);
    await flush();
    expect(f.extracted).toHaveLength(2);

    await settleAsks(f.ctx, await asks(f), new Map(), NOW + 3 * DAY);
    await flush();
    expect(f.extracted).toHaveLength(2); // written: not sent again
  });

  test("a write still in flight is not sent again by an overlapping run", async () => {
    let release!: () => void;
    const f = flock({ extract: () => new Promise((r) => { release = () => r(ok({})); }) });
    await publishAsk(f.ctx, "gift", NOW, []);
    f.close("ask:gift", "no");
    await settleAsks(f.ctx, await asks(f), new Map(), NOW + DAY);
    await flush();
    await settleAsks(f.ctx, await asks(f), new Map(), NOW + DAY);
    await flush();
    expect(f.extracted).toHaveLength(1);
    release(); await flush();
  });

  test("a close without an action id writes nothing", async () => {
    const f = flock();
    await publishAsk(f.ctx, "gift", NOW, []);
    f.close("ask:gift");
    const r = await settleAsks(f.ctx, await asks(f), new Map(), NOW + DAY);
    expect(r.answered).toEqual([]);
    await flush();
    expect(f.extracted).toHaveLength(0);
  });

  test("an open card past 14 days is withdrawn as expired and then reads unanswered", async () => {
    const f = flock();
    await publishAsk(f.ctx, "table-booking", NOW, []);
    const early = await settleAsks(f.ctx, await asks(f), new Map(), NOW + 13 * DAY);
    expect(early.answered).toEqual([]);
    expect(f.withdrawn).toEqual([]);
    const st = await asks(f);
    await settleAsks(f.ctx, st, new Map(), NOW + ASK_TTL_MS);
    expect(f.withdrawn).toEqual([{ ref: "ask:table-booking", reason: "expired" }]);
    expect(st.get("table-booking")!.status).toBe("unanswered");
    expect((await asks(f)).get("table-booking")!.status).toBe("unanswered");
    await flush();
    expect(f.extracted).toHaveLength(0);
  });

  test("an open card with a fact it did not see is withdrawn as answered in chat", async () => {
    const f = flock();
    await publishAsk(f.ctx, "cab-local", NOW, ["Takes the metro to work."]);
    // The same facts as at publish: still waiting.
    await settleAsks(f.ctx, await asks(f), new Map([["cab-local", ["Takes the metro to work."]]]), NOW + DAY);
    expect(f.withdrawn).toEqual([]);
    const st = await asks(f);
    await settleAsks(f.ctx, st, new Map([["cab-local", ["Takes the metro to work.", "Takes an Uber to the dentist."]]]), NOW + 2 * DAY);
    expect(f.withdrawn).toEqual([{ ref: "ask:cab-local", reason: "answered in chat" }]);
    expect(st.get("cab-local")!.status).toBe("unanswered");
    expect((await asks(f)).get("cab-local")!.status).toBe("unanswered");
    await flush();
    expect(f.extracted).toHaveLength(0); // the chat answer is already in memory
  });

  test("a fact for another kind does not withdraw the card", async () => {
    const f = flock();
    await publishAsk(f.ctx, "cab-local", NOW, []);
    await settleAsks(f.ctx, await asks(f), new Map([["gift", ["Buys gifts on Amazon."]]]), NOW + DAY);
    expect(f.withdrawn).toEqual([]);
  });
});
