// "Delete my mail data" (spec §5.4, ruling R6): the person's raw mail in this copy is deleted after a confirm in Settings.
// Only the app's own data goes: every table of the app's db is emptied in one transaction (the file and its schema stay, so
// the process stays healthy and the next run reads the mailbox again from nothing). Memory and TODOs made from the mail are
// Flock's and stay the person's: nothing here calls memory, tasks or the connectors.
import { Hono } from "hono";
import type { Database } from "bun:sqlite";
import { getStore } from "./store";
import { person } from "./routes/voice";

const NOT_YOURS = "Only you can delete your mail data.";
const NEEDS_CONFIRM = "Confirm to delete your mail data.";

/** Empty every table of the app's db, in one transaction. Returns how many rows went. */
export function deleteMailData(db: Database = getStore()): number {
  const tables = (db.query("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all() as { name: string }[])
    .map((t) => t.name);
  let rows = 0;
  db.transaction(() => {
    for (const t of tables) rows += db.run(`DELETE FROM "${t.replace(/"/g, '""')}"`).changes;
  })();
  try { db.exec("PRAGMA wal_checkpoint(TRUNCATE)"); } catch { /* the rows are gone either way */ }
  return rows;
}

export function removalRoutes(): Hono {
  const app = new Hono();
  app.post("/api/mail-data/delete", async (c) => {
    if (!person(c)) return c.json({ error: NOT_YOURS }, 403);
    let body: Record<string, unknown> = {};
    try { body = await c.req.json(); } catch { /* answered below */ }
    if (body.confirm !== true) return c.json({ error: NEEDS_CONFIRM }, 400);
    return c.json({ ok: true, deleted: deleteMailData() });
  });
  return app;
}
