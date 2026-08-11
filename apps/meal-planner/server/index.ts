import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import db from "./db";

const app = new Hono();

// --- Meals API ---

app.get("/api/meals", (c) => {
  const from = c.req.query("from");
  const to = c.req.query("to");
  if (!from || !to) return c.json({ error: "from and to query params required" }, 400);
  const rows = db.query("SELECT * FROM meals WHERE date >= ? AND date <= ? ORDER BY date, slot").all(from, to);
  return c.json(rows);
});

app.post("/api/meals", async (c) => {
  const body = await c.req.json();
  const { date, slot, name, notes } = body;
  if (!date || !slot || !name) return c.json({ error: "date, slot, and name are required" }, 400);
  const valid = ["breakfast", "lunch", "dinner", "snack"];
  if (!valid.includes(slot)) return c.json({ error: `slot must be one of: ${valid.join(", ")}` }, 400);
  const result = db.query("INSERT INTO meals (date, slot, name, notes) VALUES (?, ?, ?, ?) RETURNING *").get(date, slot, name, notes ?? null);
  return c.json(result, 201);
});

app.put("/api/meals/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const body = await c.req.json();
  const existing = db.query("SELECT * FROM meals WHERE id = ?").get(id);
  if (!existing) return c.json({ error: "Meal not found" }, 404);
  const { date, slot, name, notes } = body;
  const result = db.query(
    "UPDATE meals SET date = COALESCE(?, date), slot = COALESCE(?, slot), name = COALESCE(?, name), notes = COALESCE(?, notes), updated_at = datetime('now') WHERE id = ? RETURNING *"
  ).get(date ?? null, slot ?? null, name ?? null, notes ?? null, id);
  return c.json(result);
});

app.delete("/api/meals/:id", (c) => {
  const id = Number(c.req.param("id"));
  const existing = db.query("SELECT * FROM meals WHERE id = ?").get(id);
  if (!existing) return c.json({ error: "Meal not found" }, 404);
  db.query("DELETE FROM meals WHERE id = ?").run(id);
  return c.json({ ok: true });
});

// --- Shopping List API ---

app.get("/api/shopping", (c) => {
  const rows = db.query("SELECT * FROM shopping_items ORDER BY status ASC, created_at DESC").all();
  return c.json(rows);
});

app.post("/api/shopping", async (c) => {
  const body = await c.req.json();
  const { name, quantity } = body;
  if (!name) return c.json({ error: "name is required" }, 400);
  const result = db.query("INSERT INTO shopping_items (name, quantity) VALUES (?, ?) RETURNING *").get(name, quantity ?? null);
  return c.json(result, 201);
});

app.put("/api/shopping/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const body = await c.req.json();
  const existing = db.query("SELECT * FROM shopping_items WHERE id = ?").get(id);
  if (!existing) return c.json({ error: "Item not found" }, 404);
  const { name, quantity, status } = body;
  if (status && !["pending", "bought"].includes(status)) return c.json({ error: "status must be pending or bought" }, 400);
  const result = db.query(
    "UPDATE shopping_items SET name = COALESCE(?, name), quantity = COALESCE(?, quantity), status = COALESCE(?, status), updated_at = datetime('now') WHERE id = ? RETURNING *"
  ).get(name ?? null, quantity ?? null, status ?? null, id);
  return c.json(result);
});

app.delete("/api/shopping/:id", (c) => {
  const id = Number(c.req.param("id"));
  const existing = db.query("SELECT * FROM shopping_items WHERE id = ?").get(id);
  if (!existing) return c.json({ error: "Item not found" }, 404);
  db.query("DELETE FROM shopping_items WHERE id = ?").run(id);
  return c.json({ ok: true });
});

app.post("/api/shopping/clear-bought", (c) => {
  const result = db.query("DELETE FROM shopping_items WHERE status = 'bought'").run();
  return c.json({ ok: true, removed: result.changes });
});

// --- Static files ---

app.use("/*", serveStatic({ root: "./frontend/dist" }));

const port = Number(process.env.PORT) || 3456;
console.log(`listening on port ${port}`);
serve({ fetch: app.fetch, port });
