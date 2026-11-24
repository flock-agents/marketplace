// The owner's upgrade (Flock Task 3.2): two platform ops Flock's migration calls on the owner's copy once the built-in desk's
// email-desk.db is its store. Expectations from the brief and the spec (§5.2 "old owner cards are re-published as the
// copy's cards, with the same draft"; §5.4 voice rows copied, owner-edit provenance kept; Plan Review Focus 4: a card whose
// send already went out is closed, not republished), written before the code:
//   - republish_legacy_card { accountId, threadId, draftId, body } publishes the moved draft row's card (draft:<id>, the
//     draft's own body: Gmail's text, not a copy), twice is one card; a sent row is never republished; a thread with no row
//     gets one recorded from the payload; nothing to go on is NOT_FOUND;
//   - import_voice { rows } writes each row under its account, owner-edit kept as owner-edit and anything else as learned;
//     it never writes over a row the copy already has from the person, nor over anything with a learned row, so a second
//     import changes nothing;
//   - neither op is declared in the manifest (an agent calling one gets Flock's 404).
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import type { Database } from "bun:sqlite";
import { mkdtempSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { createOpsRouter } from "@flock/app-sdk";
import { openStore, _setStoreForTesting } from "../store";
import { _setLogForTesting } from "../drafts/card";
import { _setOpsLogForTesting } from "../ops";
import { allOps } from "../registry";
import { voiceRows, upsertVoiceRow, OWNER_SOURCE, CRAWL_SOURCE } from "../voice/store";

const TOKEN = "app-token";
const A1 = "acct-1";
const A2 = "acct-2";
const T1 = "thread-1";

let db: Database;
let published: any[];
let publishFails: boolean;

function platform(): any {
  return {
    appId: "email-desk", pairedAgent: { id: "ia-1", name: "Inbox Assistant" }, dataDir: "test", configured: true,
    connectors: { exec: async () => ({ ok: false, reason: "no gmail in this test" }) },
    tasks: {
      publish: async (t: any) => { if (publishFails) return { ok: false, reason: "down" }; published.push(t); return { ok: true, data: {} }; },
      withdraw: async () => ({ ok: true, data: undefined }),
    },
  };
}
const router = () => createOpsRouter({ handlers: allOps, token: TOKEN, platform: platform() });
async function call(name: string, payload: Record<string, unknown>): Promise<{ status: number; json: any }> {
  const res = await router().request(`/ops/${name}`, {
    method: "POST",
    headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  return { status: res.status, json: await res.json() };
}

/** A draft row as the built-in desk wrote it (no id: the copy's store gave it one on open). */
function builtInRow(account: string, thread: string, gmailDraftId: string, body: string, sentAt: number | null = null): string {
  db.run(
    "INSERT INTO draft_records (account_id, thread_id, draft_id, body_written, updated_at, sent_at, id) VALUES (?,?,?,?,?,?, lower(hex(randomblob(16))))",
    [account, thread, gmailDraftId, body, 1, sentAt],
  );
  return (db.query("SELECT id FROM draft_records WHERE account_id = ? AND thread_id = ?").get(account, thread) as { id: string }).id;
}

beforeEach(() => {
  db = openStore(mkdtempSync(join(tmpdir(), "email-desk-upgrade-")));
  _setStoreForTesting(db);
  _setLogForTesting(() => {});
  _setOpsLogForTesting(() => {});
  published = [];
  publishFails = false;
});
afterEach(() => {
  _setStoreForTesting(null);
  _setLogForTesting(null);
  _setOpsLogForTesting(null);
  db.close();
});

describe("republish_legacy_card", () => {
  test("the moved draft row gets the copy's card, with the draft's own body; twice is the same card", async () => {
    const id = builtInRow(A1, T1, "gm-1", "Hi Asha, Tuesday works.");
    const first = await call("republish_legacy_card", { accountId: A1, threadId: T1, draftId: "gm-1", body: "Hi Asha, Tuesday works." });
    expect(first.status).toBe(200);
    expect(first.json).toEqual({ id, published: true });
    expect(published).toHaveLength(1);
    const card = published[0];
    expect(card.sourceRef).toBe(`draft:${id}`);
    expect(card.context.threadId).toBe(T1);
    expect(card.context.accountId).toBe(A1);
    expect(card.context.agentId).toBe("ia-1");
    expect(card.context.card.blocks.find((b: any) => b.type === "draft").body).toBe("Hi Asha, Tuesday works.");
    expect(card.actions[0].executor).toEqual({ mode: "app", op: "send_draft", opArgs: { id }, passesEdit: true, byReply: true });
    const again = await call("republish_legacy_card", { accountId: A1, threadId: T1, draftId: "gm-1", body: "Hi Asha, Tuesday works." });
    expect(again.json).toEqual({ id, published: true });
    expect(published.map((p) => p.sourceRef)).toEqual([`draft:${id}`, `draft:${id}`]);
    expect((db.query("SELECT COUNT(*) AS n FROM draft_records").get() as { n: number }).n).toBe(1);
  });

  test("the republished card is marked so Flock does not notify about it as a new draft", async () => {
    builtInRow(A1, T1, "gm-1", "Hi Asha.");
    await call("republish_legacy_card", { accountId: A1, threadId: T1, draftId: "gm-1", body: "Hi Asha." });
    expect(published[0].republished).toBe(true);
  });

  test("the row's text is the card's, not the payload's (Gmail holds the row's)", async () => {
    builtInRow(A1, T1, "gm-1", "Text in Gmail.");
    await call("republish_legacy_card", { accountId: A1, threadId: T1, draftId: "gm-1", body: "An older card preview." });
    expect(published[0].context.card.blocks.find((b: any) => b.type === "draft").body).toBe("Text in Gmail.");
  });

  test("a sent row is never republished", async () => {
    const id = builtInRow(A1, T1, "gm-1", "Sent already.", Date.UTC(2026, 10, 20));
    const { status, json } = await call("republish_legacy_card", { accountId: A1, threadId: T1, draftId: "gm-1", body: "Sent already." });
    expect(status).toBe(200);
    expect(json).toEqual({ id, published: false, sent: true });
    expect(published).toEqual([]);
  });

  test("a sent ledger row for the Gmail draft is a sent row too", async () => {
    const id = builtInRow(A1, T1, "gm-1", "Went out.");
    db.run("INSERT INTO send_ledger (idempotency_key, account_id, thread_id, draft_id, state, created_at, updated_at) VALUES (?,?,?,?, 'sent', 1, 1)",
      [`${A1}|${T1}|gm-1`, A1, T1, "gm-1"]);
    const { json } = await call("republish_legacy_card", { accountId: A1, threadId: T1, draftId: "gm-1", body: "Went out." });
    expect(json).toEqual({ id, published: false, sent: true });
    expect(published).toEqual([]);
  });

  test("a thread with no row gets one recorded from the payload", async () => {
    const { json } = await call("republish_legacy_card", { accountId: A2, threadId: "t-9", draftId: "gm-9", body: "Recorded from the card." });
    expect(json.published).toBe(true);
    const row = db.query("SELECT * FROM draft_records WHERE id = ?").get(json.id) as any;
    expect(row).toMatchObject({ account_id: A2, thread_id: "t-9", draft_id: "gm-9", body_written: "Recorded from the card.", sent_at: null });
  });

  test("nothing to go on: NOT_FOUND; a refused publish is an error Flock retries", async () => {
    const none = await call("republish_legacy_card", { accountId: A1, threadId: "t-none" });
    expect(none.status).toBe(404);
    expect(none.json.code).toBe("NOT_FOUND");
    expect((await call("republish_legacy_card", { accountId: A1 })).status).toBe(400);
    builtInRow(A1, T1, "gm-1", "Hi.");
    publishFails = true;
    const down = await call("republish_legacy_card", { accountId: A1, threadId: T1, draftId: "gm-1", body: "Hi." });
    expect(down.status).toBe(502);
    expect(down.json.code).toBe("PUBLISH_FAILED");
  });
});

describe("import_voice", () => {
  const rows = [
    { accountId: A1, dimension: "greeting", value: "Hi <name>,", examples: ["Hi Asha,"], observationCount: 7, source: "owner-edit" },
    { accountId: A1, dimension: "sign_off", value: "Thanks, Shiva", examples: ["Thanks, Shiva"], observationCount: 7, source: "voice-crawl" },
    { accountId: A2, dimension: "greeting", value: "Hey", examples: [], observationCount: 3, source: "some-agent" },
  ];

  test("each row lands under its account; owner-edit kept, anything else as learned", async () => {
    const { status, json } = await call("import_voice", { rows });
    expect(status).toBe(200);
    expect(json).toEqual({ imported: 3, kept: 0 });
    const a1 = voiceRows(A1);
    expect(a1.map((r) => [r.dimension, r.value, r.source, r.observationCount])).toEqual([
      ["greeting", "Hi <name>,", OWNER_SOURCE, 7],
      ["sign_off", "Thanks, Shiva", CRAWL_SOURCE, 7],
    ]);
    expect(a1[0]!.examples).toEqual(["Hi Asha,"]);
    expect(voiceRows(A2).map((r) => [r.dimension, r.source])).toEqual([["greeting", CRAWL_SOURCE]]);
  });

  test("never writes over the copy's own rows; a second import changes nothing", async () => {
    upsertVoiceRow({ accountId: A1, dimension: "greeting", value: "Hello there,", source: OWNER_SOURCE });
    upsertVoiceRow({ accountId: A1, dimension: "sign_off", value: "Cheers", source: CRAWL_SOURCE, observationCount: 12 });
    const first = await call("import_voice", { rows });
    expect(first.json).toEqual({ imported: 1, kept: 2 });
    const before = JSON.stringify(voiceRows(A1).map(({ updatedAt: _u, ...r }) => r)) + JSON.stringify(voiceRows(A2).map(({ updatedAt: _u, ...r }) => r));
    expect(voiceRows(A1).map((r) => [r.dimension, r.value, r.source])).toEqual([["greeting", "Hello there,", OWNER_SOURCE], ["sign_off", "Cheers", CRAWL_SOURCE]]);
    const second = await call("import_voice", { rows });
    expect(second.json).toEqual({ imported: 0, kept: 3 });
    expect(JSON.stringify(voiceRows(A1).map(({ updatedAt: _u, ...r }) => r)) + JSON.stringify(voiceRows(A2).map(({ updatedAt: _u, ...r }) => r))).toBe(before);
  });

  test("an owner-edit row replaces a learned one; a bad row is refused, not half-written", async () => {
    upsertVoiceRow({ accountId: A1, dimension: "greeting", value: "Hey", source: CRAWL_SOURCE });
    expect((await call("import_voice", { rows: [rows[0]] })).json).toEqual({ imported: 1, kept: 0 });
    expect(voiceRows(A1)[0]).toMatchObject({ value: "Hi <name>,", source: OWNER_SOURCE });
    const bad = await call("import_voice", { rows: [{ accountId: A2, dimension: "tone", value: "warm", source: "owner-edit" }, { dimension: "x", value: "y" }] });
    expect(bad.status).toBe(400);
    expect(bad.json.code).toBe("INVALID");
    expect(voiceRows(A2)).toEqual([]);
  });
});

test("neither op is declared in the manifest", () => {
  const manifest = JSON.parse(readFileSync(join(import.meta.dir, "../../flock.app.json"), "utf-8"));
  const names = manifest.agentInterface.operations.map((o: any) => o.name);
  for (const op of ["republish_legacy_card", "import_voice"]) {
    expect(names).not.toContain(op);
    expect(typeof allOps[op]).toBe("function");
  }
});
