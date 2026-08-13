import { Database } from "bun:sqlite";
import { join } from "path";

const dataDir = process.env.APP_DATA_DIR || ".";
const db = new Database(join(dataDir, "app.db"));

db.exec("PRAGMA journal_mode=WAL");
db.exec("PRAGMA foreign_keys=ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS meals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL,
    slot TEXT NOT NULL,
    name TEXT NOT NULL,
    notes TEXT,
    label TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_meals_date ON meals(date);

  CREATE TABLE IF NOT EXISTS shopping_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    quantity TEXT,
    status TEXT DEFAULT 'pending',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS shopping_meal_links (
    shopping_item_id INTEGER NOT NULL,
    meal_id INTEGER NOT NULL,
    PRIMARY KEY (shopping_item_id, meal_id),
    FOREIGN KEY (shopping_item_id) REFERENCES shopping_items(id) ON DELETE CASCADE,
    FOREIGN KEY (meal_id) REFERENCES meals(id) ON DELETE CASCADE
  );
`);

// Migration: add label column if missing, convert snack → custom
const cols = db.query("PRAGMA table_info(meals)").all() as { name: string }[];
if (!cols.some((c) => c.name === "label")) {
  db.exec("ALTER TABLE meals ADD COLUMN label TEXT");
  db.exec("UPDATE meals SET label = 'Snacks', slot = 'custom' WHERE slot = 'snack'");
}

export default db;
