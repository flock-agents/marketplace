import { Hono } from "hono";
import db from "../db";

const app = new Hono();

app.get("/", (c) => {
  const rows = db.query("SELECT * FROM members ORDER BY name").all();
  return c.json(rows.map(toMember));
});

app.post("/", async (c) => {
  const body = await c.req.json();
  if (!body.name) return c.json({ error: "name is required" }, 400);

  const result = db
    .query("INSERT INTO members (name, color, emoji) VALUES (?, ?, ?) RETURNING *")
    .get(body.name, body.color || "#6366f1", body.emoji || "👤");
  return c.json(toMember(result), 201);
});

app.put("/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const body = await c.req.json();
  const existing: any = db.query("SELECT * FROM members WHERE id = ?").get(id);
  if (!existing) return c.json({ error: "not found" }, 404);

  const result = db
    .query("UPDATE members SET name = ?, color = ?, emoji = ? WHERE id = ? RETURNING *")
    .get(
      body.name || existing.name,
      body.color || existing.color,
      body.emoji || existing.emoji,
      id
    );
  return c.json(toMember(result));
});

app.delete("/:id", (c) => {
  const id = Number(c.req.param("id"));
  db.query("DELETE FROM members WHERE id = ?").run(id);
  return c.json({ ok: true });
});

function toMember(row: any) {
  return {
    id: row.id,
    name: row.name,
    color: row.color,
    emoji: row.emoji,
    createdAt: row.created_at,
  };
}

export default app;
