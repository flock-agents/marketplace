import { describe, test, expect } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, mkdirSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { openStore } from "../store";
import { BUILTIN_DESK_DDL } from "./fixtures/builtin-desk-schema";

const TABLES = [
  "app_meta", "draft_records", "engaged_domains", "extracted_messages", "follow_up_runs", "follow_up_state",
  "ingest_comprehension", "ingest_content", "ingest_cursors", "ingest_events", "lifecycle_state", "reply_messages", "send_ledger",
];

const tmp = () => mkdtempSync(join(tmpdir(), "email-desk-store-"));
const tables = (db: Database) =>
  (db.query("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as { name: string }[]).map((r) => r.name);

describe("store", () => {
  test("creates all 13 tables on an empty dir", () => {
    const dir = join(tmp(), "fresh");
    const db = openStore(dir);
    expect(tables(db)).toEqual(TABLES);
    db.close();
  });

  test("is idempotent: a second open changes nothing", () => {
    const dir = tmp();
    const a = openStore(dir);
    a.run("INSERT INTO app_meta (key, value, updated_at) VALUES ('k','v',1)");
    a.close();
    const b = openStore(dir);
    expect(tables(b)).toEqual(TABLES);
    expect((b.query("SELECT COUNT(*) AS n FROM app_meta").get() as { n: number }).n).toBe(1);
    b.close();
  });

  test("opens a copy of a built-in desk db unchanged", () => {
    const dir = tmp();
    mkdirSync(dir, { recursive: true });
    const old = new Database(join(dir, "email-desk.db"));
    old.exec("PRAGMA journal_mode = WAL");
    old.exec(BUILTIN_DESK_DDL);
    old.run("INSERT INTO ingest_events (id, source_id, account_id, event_id, kind, ts, created_at, body) VALUES ('e1','gmail','a@x.com','m1','email',1,1,'hello')");
    old.run("INSERT INTO draft_records (account_id, thread_id, draft_id, body_written, updated_at) VALUES ('a@x.com','t1','d1','hi',1)");
    old.run("INSERT INTO send_ledger (idempotency_key, account_id, thread_id, state, created_at, updated_at) VALUES ('k','a@x.com','t1','sent',1,1)");
    old.run("INSERT INTO follow_up_state (account_id, thread_id, owner_msg_key, status, checked_at) VALUES ('a@x.com','t2','m','waiting',1)");
    const before = Object.fromEntries(tables(old).map((t) => [t, (old.query(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n]));
    expect((old.query("PRAGMA user_version").get() as { user_version: number }).user_version).toBe(0);
    old.close();

    const db = openStore(dir);
    expect(tables(db)).toEqual(TABLES);
    for (const t of TABLES) {
      expect((db.query(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n).toBe(before[t] ?? 0);
    }
    expect((db.query("SELECT body FROM ingest_events WHERE id='e1'").get() as { body: string }).body).toBe("hello");
    expect((db.query("PRAGMA user_version").get() as { user_version: number }).user_version).toBe(1);
    db.close();
  });

  test("a db from a newer app version is left alone (user_version never lowered)", () => {
    const dir = tmp();
    const db = new Database(join(dir, "email-desk.db"));
    db.exec("PRAGMA user_version = 7");
    db.close();
    const again = openStore(dir);
    expect((again.query("PRAGMA user_version").get() as { user_version: number }).user_version).toBe(7);
    again.close();
  });

  test("places the db at APP_DATA_DIR/email-desk.db", () => {
    const dir = tmp();
    openStore(dir).close();
    expect(Bun.file(join(dir, "email-desk.db")).size).toBeGreaterThan(0);
  });
});
