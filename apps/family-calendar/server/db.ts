import { Database } from "bun:sqlite";
import { join } from "path";

const dataDir = process.env.APP_DATA_DIR || ".";
const db = new Database(join(dataDir, "app.db"));

db.exec("PRAGMA journal_mode=WAL");
db.exec("PRAGMA foreign_keys=ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS members (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    color TEXT NOT NULL DEFAULT '#6366f1',
    emoji TEXT NOT NULL DEFAULT '👤',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    start_time TEXT NOT NULL,
    end_time TEXT NOT NULL,
    member_id INTEGER REFERENCES members(id) ON DELETE SET NULL,
    category TEXT NOT NULL DEFAULT 'other',
    status TEXT NOT NULL DEFAULT 'confirmed',
    notes TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS reminders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    due_time TEXT NOT NULL,
    event_id INTEGER REFERENCES events(id) ON DELETE SET NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

export default db;
