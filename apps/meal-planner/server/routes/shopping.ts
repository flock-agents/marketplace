import { Hono } from "hono";
import db from "../db";
import type { CreateShoppingItemRequest, UpdateShoppingItemRequest, LinkedMealRef } from "../../shared/types";

const shopping = new Hono();

interface RawShoppingRow {
  id: number;
  name: string;
  quantity: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

interface RawLinkRow {
  shopping_item_id: number;
  meal_id: number;
  meal_name: string;
  meal_date: string;
}

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function enrichWithLinks(items: RawShoppingRow[]) {
  if (items.length === 0) return [];
  const ids = items.map((i) => i.id);
  const today = todayStr();
  const links = db.query(
    `SELECT sml.shopping_item_id, sml.meal_id, m.name AS meal_name, m.date AS meal_date
     FROM shopping_meal_links sml
     JOIN meals m ON m.id = sml.meal_id
     WHERE sml.shopping_item_id IN (${ids.map(() => "?").join(",")})
       AND m.date >= ?
     ORDER BY m.date`
  ).all(...ids, today) as RawLinkRow[];

  const linkMap = new Map<number, LinkedMealRef[]>();
  for (const l of links) {
    const arr = linkMap.get(l.shopping_item_id) ?? [];
    arr.push({ meal_id: l.meal_id, meal_name: l.meal_name, meal_date: l.meal_date });
    linkMap.set(l.shopping_item_id, arr);
  }

  return items.map((item) => ({
    ...item,
    linked_meals: linkMap.get(item.id) ?? [],
  }));
}

shopping.get("/", (c) => {
  const rows = db.query("SELECT * FROM shopping_items ORDER BY status ASC, created_at DESC").all() as RawShoppingRow[];
  return c.json(enrichWithLinks(rows));
});

shopping.post("/", async (c) => {
  const body = await c.req.json<CreateShoppingItemRequest>();
  const { name, quantity, linkedMealIds } = body;
  if (!name) return c.json({ error: "name is required" }, 400);
  const item = db.query("INSERT INTO shopping_items (name, quantity) VALUES (?, ?) RETURNING *").get(name, quantity ?? null) as RawShoppingRow;
  if (linkedMealIds && linkedMealIds.length > 0) {
    const stmt = db.prepare("INSERT OR IGNORE INTO shopping_meal_links (shopping_item_id, meal_id) VALUES (?, ?)");
    for (const mealId of linkedMealIds) {
      stmt.run(item.id, mealId);
    }
  }
  return c.json(enrichWithLinks([item])[0], 201);
});

shopping.put("/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const existing = db.query("SELECT * FROM shopping_items WHERE id = ?").get(id);
  if (!existing) return c.json({ error: "Item not found" }, 404);
  const body = await c.req.json<UpdateShoppingItemRequest>();
  const { name, quantity, status } = body;
  if (status && !["pending", "bought"].includes(status)) return c.json({ error: "status must be pending or bought" }, 400);
  const result = db.query(
    "UPDATE shopping_items SET name = COALESCE(?, name), quantity = COALESCE(?, quantity), status = COALESCE(?, status), updated_at = datetime('now') WHERE id = ? RETURNING *"
  ).get(name ?? null, quantity ?? null, status ?? null, id) as RawShoppingRow;
  return c.json(enrichWithLinks([result])[0]);
});

shopping.delete("/:id", (c) => {
  const id = Number(c.req.param("id"));
  const existing = db.query("SELECT * FROM shopping_items WHERE id = ?").get(id);
  if (!existing) return c.json({ error: "Item not found" }, 404);
  db.query("DELETE FROM shopping_items WHERE id = ?").run(id);
  return c.json({ ok: true });
});

shopping.post("/clear-bought", (c) => {
  const result = db.query("DELETE FROM shopping_items WHERE status = 'bought'").run();
  return c.json({ ok: true, removed: result.changes });
});

export default shopping;
