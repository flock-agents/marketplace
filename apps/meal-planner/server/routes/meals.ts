import { Hono } from "hono";
import db from "../db";
import type { CreateMealRequest, UpdateMealRequest } from "../../shared/types";

const FIXED_SLOTS = ["breakfast", "lunch", "dinner"];
const VALID_SLOTS = [...FIXED_SLOTS, "custom"];

const meals = new Hono();

meals.get("/", (c) => {
  const today = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const defaultFrom = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
  const end = new Date(today);
  end.setDate(end.getDate() + 6);
  const defaultTo = `${end.getFullYear()}-${pad(end.getMonth() + 1)}-${pad(end.getDate())}`;

  const from = c.req.query("from") || defaultFrom;
  const to = c.req.query("to") || defaultTo;
  const rows = db.query("SELECT * FROM meals WHERE date >= ? AND date <= ? ORDER BY date, CASE slot WHEN 'breakfast' THEN 1 WHEN 'lunch' THEN 2 WHEN 'dinner' THEN 3 ELSE 4 END, created_at").all(from, to);
  return c.json(rows);
});

meals.get("/labels", (c) => {
  const rows = db.query("SELECT DISTINCT label FROM meals WHERE slot = 'custom' AND label IS NOT NULL AND label != '' ORDER BY label").all() as { label: string }[];
  return c.json(rows.map((r) => r.label));
});

meals.post("/", async (c) => {
  const body = await c.req.json<CreateMealRequest>();
  const { date, slot, name, notes, label } = body;
  if (!date || !slot || !name) return c.json({ error: "date, slot, and name are required" }, 400);
  if (!VALID_SLOTS.includes(slot)) return c.json({ error: `slot must be one of: ${VALID_SLOTS.join(", ")}` }, 400);
  if (slot === "custom" && (!label || !label.trim())) return c.json({ error: "label is required for custom entries" }, 400);
  const result = db.query("INSERT INTO meals (date, slot, name, notes, label) VALUES (?, ?, ?, ?, ?) RETURNING *").get(date, slot, name, notes ?? null, slot === "custom" ? label!.trim() : null);
  return c.json(result, 201);
});

meals.put("/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const existing = db.query("SELECT * FROM meals WHERE id = ?").get(id);
  if (!existing) return c.json({ error: "Meal not found" }, 404);
  const body = await c.req.json<UpdateMealRequest>();
  const { date, slot, name, notes, label } = body;
  const result = db.query(
    "UPDATE meals SET date = COALESCE(?, date), slot = COALESCE(?, slot), name = COALESCE(?, name), notes = COALESCE(?, notes), label = COALESCE(?, label), updated_at = datetime('now') WHERE id = ? RETURNING *"
  ).get(date ?? null, slot ?? null, name ?? null, notes ?? null, label ?? null, id);
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
