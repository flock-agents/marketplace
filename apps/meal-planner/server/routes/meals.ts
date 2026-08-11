import { Hono } from "hono";
import db from "../db";
import type { CreateMealRequest, UpdateMealRequest } from "../../shared/types";

const VALID_SLOTS = ["breakfast", "lunch", "dinner", "snack"];

const meals = new Hono();

meals.get("/", (c) => {
  const from = c.req.query("from");
  const to = c.req.query("to");
  if (!from || !to) return c.json({ error: "from and to query params required" }, 400);
  const rows = db.query("SELECT * FROM meals WHERE date >= ? AND date <= ? ORDER BY date, slot").all(from, to);
  return c.json(rows);
});

meals.post("/", async (c) => {
  const body = await c.req.json<CreateMealRequest>();
  const { date, slot, name, notes } = body;
  if (!date || !slot || !name) return c.json({ error: "date, slot, and name are required" }, 400);
  if (!VALID_SLOTS.includes(slot)) return c.json({ error: `slot must be one of: ${VALID_SLOTS.join(", ")}` }, 400);
  const result = db.query("INSERT INTO meals (date, slot, name, notes) VALUES (?, ?, ?, ?) RETURNING *").get(date, slot, name, notes ?? null);
  return c.json(result, 201);
});

meals.put("/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const existing = db.query("SELECT * FROM meals WHERE id = ?").get(id);
  if (!existing) return c.json({ error: "Meal not found" }, 404);
  const body = await c.req.json<UpdateMealRequest>();
  const { date, slot, name, notes } = body;
  const result = db.query(
    "UPDATE meals SET date = COALESCE(?, date), slot = COALESCE(?, slot), name = COALESCE(?, name), notes = COALESCE(?, notes), updated_at = datetime('now') WHERE id = ? RETURNING *"
  ).get(date ?? null, slot ?? null, name ?? null, notes ?? null, id);
  return c.json(result);
});

meals.delete("/:id", (c) => {
  const id = Number(c.req.param("id"));
  const existing = db.query("SELECT * FROM meals WHERE id = ?").get(id);
  if (!existing) return c.json({ error: "Meal not found" }, 404);
  db.query("DELETE FROM meals WHERE id = ?").run(id);
  return c.json({ ok: true });
});

export default meals;
