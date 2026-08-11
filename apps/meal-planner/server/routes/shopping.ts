import { Hono } from "hono";
import db from "../db";
import type { CreateShoppingItemRequest, UpdateShoppingItemRequest } from "../../shared/types";

const shopping = new Hono();

shopping.get("/", (c) => {
  const rows = db.query("SELECT * FROM shopping_items ORDER BY status ASC, created_at DESC").all();
  return c.json(rows);
});

shopping.post("/", async (c) => {
  const body = await c.req.json<CreateShoppingItemRequest>();
  const { name, quantity } = body;
  if (!name) return c.json({ error: "name is required" }, 400);
  const result = db.query("INSERT INTO shopping_items (name, quantity) VALUES (?, ?) RETURNING *").get(name, quantity ?? null);
  return c.json(result, 201);
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
  ).get(name ?? null, quantity ?? null, status ?? null, id);
  return c.json(result);
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
