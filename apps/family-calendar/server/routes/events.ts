import { Hono } from "hono";
import db from "../db";

const app = new Hono();

app.get("/", (c) => {
  const { from, to, memberId } = c.req.query();
  let sql = `SELECT e.*, m.name as member_name, m.color as member_color, m.emoji as member_emoji
    FROM events e LEFT JOIN members m ON e.member_id = m.id WHERE 1=1`;
  const params: any[] = [];

  if (from) {
    sql += " AND e.start_time >= ?";
    params.push(from);
  }
  if (to) {
    sql += " AND e.start_time <= ?";
    params.push(to);
  }
  if (memberId) {
    sql += " AND e.member_id = ?";
    params.push(Number(memberId));
  }
  sql += " ORDER BY e.start_time";

  const rows = db.query(sql).all(...params);
  return c.json(rows.map(toEvent));
});

app.post("/", async (c) => {
  const body = await c.req.json();
  if (!body.title || !body.startTime || !body.endTime) {
    return c.json({ error: "title, startTime, endTime are required" }, 400);
  }

  const result = db
    .query(
      `INSERT INTO events (title, start_time, end_time, member_id, category, status, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING *`
    )
    .get(
      body.title,
      body.startTime,
      body.endTime,
      body.memberId || null,
      body.category || "other",
      body.status || "confirmed",
      body.notes || ""
    );

  const row = db
    .query(
      `SELECT e.*, m.name as member_name, m.color as member_color, m.emoji as member_emoji
       FROM events e LEFT JOIN members m ON e.member_id = m.id WHERE e.id = ?`
    )
    .get((result as any).id);
  return c.json(toEvent(row), 201);
});

app.put("/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const body = await c.req.json();
  const existing: any = db.query("SELECT * FROM events WHERE id = ?").get(id);
  if (!existing) return c.json({ error: "not found" }, 404);

  db.query(
    `UPDATE events SET title = ?, start_time = ?, end_time = ?, member_id = ?,
     category = ?, status = ?, notes = ? WHERE id = ?`
  ).run(
    body.title || existing.title,
    body.startTime || existing.start_time,
    body.endTime || existing.end_time,
    body.memberId !== undefined ? body.memberId : existing.member_id,
    body.category || existing.category,
    body.status || existing.status,
    body.notes !== undefined ? body.notes : existing.notes,
    id
  );

  const row = db
    .query(
      `SELECT e.*, m.name as member_name, m.color as member_color, m.emoji as member_emoji
       FROM events e LEFT JOIN members m ON e.member_id = m.id WHERE e.id = ?`
    )
    .get(id);
  return c.json(toEvent(row));
});

app.delete("/:id", (c) => {
  const id = Number(c.req.param("id"));
  db.query("DELETE FROM events WHERE id = ?").run(id);
  return c.json({ ok: true });
});

function toEvent(row: any) {
  return {
    id: row.id,
    title: row.title,
    startTime: row.start_time,
    endTime: row.end_time,
    memberId: row.member_id,
    memberName: row.member_name,
    memberColor: row.member_color,
    memberEmoji: row.member_emoji,
    category: row.category,
    status: row.status,
    notes: row.notes,
    createdAt: row.created_at,
  };
}

export default app;
