import { Hono } from "hono";
import db from "../db";

const app = new Hono();

app.get("/", (c) => {
  const { from, to, status } = c.req.query();
  let sql = "SELECT * FROM reminders WHERE 1=1";
  const params: any[] = [];

  if (from) {
    sql += " AND due_time >= ?";
    params.push(from);
  }
  if (to) {
    sql += " AND due_time <= ?";
    params.push(to);
  }
  if (status) {
    sql += " AND status = ?";
    params.push(status);
  }
  sql += " ORDER BY due_time";

  const rows = db.query(sql).all(...params);
  return c.json(rows.map(toReminder));
});

app.post("/", async (c) => {
  const body = await c.req.json();
  if (!body.title || !body.dueTime) {
    return c.json({ error: "title and dueTime are required" }, 400);
  }

  const result = db
    .query(
      "INSERT INTO reminders (title, due_time, event_id, status) VALUES (?, ?, ?, ?) RETURNING *"
    )
    .get(body.title, body.dueTime, body.eventId || null, body.status || "pending");
  return c.json(toReminder(result), 201);
});

app.put("/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const body = await c.req.json();
  const existing: any = db.query("SELECT * FROM reminders WHERE id = ?").get(id);
  if (!existing) return c.json({ error: "not found" }, 404);

  db.query("UPDATE reminders SET title = ?, due_time = ?, event_id = ?, status = ? WHERE id = ?").run(
    body.title || existing.title,
    body.dueTime || existing.due_time,
    body.eventId !== undefined ? body.eventId : existing.event_id,
    body.status || existing.status,
    id
  );

  const row = db.query("SELECT * FROM reminders WHERE id = ?").get(id);
  return c.json(toReminder(row));
});

app.delete("/:id", (c) => {
  const id = Number(c.req.param("id"));
  db.query("DELETE FROM reminders WHERE id = ?").run(id);
  return c.json({ ok: true });
});

function toReminder(row: any) {
  return {
    id: row.id,
    title: row.title,
    dueTime: row.due_time,
    eventId: row.event_id,
    status: row.status,
    createdAt: row.created_at,
  };
}

export default app;
