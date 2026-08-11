import React, { useState, useEffect, useCallback } from "react";
import { meals, type Meal } from "./api";

const SLOTS = ["breakfast", "lunch", "dinner", "snack"] as const;
const SLOT_LABELS: Record<string, string> = { breakfast: "Breakfast", lunch: "Lunch", dinner: "Dinner", snack: "Snack" };

function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

function dayLabel(d: Date): string {
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

export default function MealPlan() {
  const [range, setRange] = useState<7 | 14>(7);
  const [startDate, setStartDate] = useState(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  });
  const [data, setData] = useState<Meal[]>([]);
  const [adding, setAdding] = useState<{ date: string; slot: string } | null>(null);
  const [editing, setEditing] = useState<number | null>(null);
  const [formName, setFormName] = useState("");
  const [formNotes, setFormNotes] = useState("");

  const from = formatDate(startDate);
  const to = formatDate(addDays(startDate, range - 1));
  const todayStr = formatDate(new Date());

  const load = useCallback(() => {
    meals.list(from, to).then(setData).catch(console.error);
  }, [from, to]);

  useEffect(() => { load(); }, [load]);

  const days = Array.from({ length: range }, (_, i) => {
    const d = addDays(startDate, i);
    return { date: formatDate(d), label: dayLabel(d), isToday: formatDate(d) === todayStr };
  });

  function mealsForSlot(date: string, slot: string) {
    return data.filter((m) => m.date === date && m.slot === slot);
  }

  function startAdd(date: string, slot: string) {
    setAdding({ date, slot });
    setEditing(null);
    setFormName("");
    setFormNotes("");
  }

  function startEdit(meal: Meal) {
    setEditing(meal.id);
    setAdding(null);
    setFormName(meal.name);
    setFormNotes(meal.notes ?? "");
  }

  function cancel() {
    setAdding(null);
    setEditing(null);
    setFormName("");
    setFormNotes("");
  }

  async function saveNew() {
    if (!adding || !formName.trim()) return;
    await meals.create({ date: adding.date, slot: adding.slot, name: formName.trim(), notes: formNotes.trim() || undefined });
    cancel();
    load();
  }

  async function saveEdit() {
    if (editing === null || !formName.trim()) return;
    await meals.update(editing, { name: formName.trim(), notes: formNotes.trim() || undefined });
    cancel();
    load();
  }

  async function deleteMeal(id: number) {
    await meals.delete(id);
    load();
  }

  function goToToday() {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    setStartDate(d);
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
        <div className="range-toggle">
          <button className={`range-btn ${range === 7 ? "active" : ""}`} onClick={() => setRange(7)}>7 days</button>
          <button className={`range-btn ${range === 14 ? "active" : ""}`} onClick={() => setRange(14)}>14 days</button>
        </div>
        <div className="nav-arrows">
          <button className="nav-btn" onClick={() => setStartDate(addDays(startDate, -range))}>←</button>
          <button className="today-nav-btn" onClick={goToToday}>Today</button>
          <button className="nav-btn" onClick={() => setStartDate(addDays(startDate, range))}>→</button>
        </div>
      </div>

      {days.map(({ date, label, isToday }) => (
        <div key={date} className={`day-card ${isToday ? "today" : ""}`}>
          <div className="day-header">
            <div>
              <span className="day-date">{label}</span>{" "}
              <span className="day-label">{date}</span>
            </div>
            {isToday && <span className="today-badge">Today</span>}
          </div>
          <div className="slots">
            {SLOTS.map((slot) => {
              const slotMeals = mealsForSlot(date, slot);
              const isAdding = adding?.date === date && adding.slot === slot;
              return (
                <div key={slot} className="slot">
                  <div className="slot-label">{SLOT_LABELS[slot]}</div>
                  {slotMeals.map((meal) =>
                    editing === meal.id ? (
                      <div key={meal.id} className="meal-form">
                        <input autoFocus placeholder="Meal name" value={formName} onChange={(e) => setFormName(e.target.value)}
                          onKeyDown={(e) => e.key === "Enter" && saveEdit()} />
                        <input placeholder="Notes (optional)" value={formNotes} onChange={(e) => setFormNotes(e.target.value)}
                          onKeyDown={(e) => e.key === "Enter" && saveEdit()} />
                        <div className="form-actions">
                          <button className="btn-save" onClick={saveEdit}>Save</button>
                          <button className="btn-cancel" onClick={cancel}>Cancel</button>
                        </div>
                      </div>
                    ) : (
                      <div key={meal.id} className="meal-item">
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div className="meal-name">{meal.name}</div>
                          {meal.notes && <div className="meal-notes">{meal.notes}</div>}
                        </div>
                        <div className="meal-actions">
                          <button className="icon-btn" onClick={() => startEdit(meal)} title="Edit">✎</button>
                          <button className="icon-btn delete" onClick={() => deleteMeal(meal.id)} title="Delete">✕</button>
                        </div>
                      </div>
                    )
                  )}
                  {isAdding ? (
                    <div className="meal-form">
                      <input autoFocus placeholder="Meal name" value={formName} onChange={(e) => setFormName(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && saveNew()} />
                      <input placeholder="Notes (optional)" value={formNotes} onChange={(e) => setFormNotes(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && saveNew()} />
                      <div className="form-actions">
                        <button className="btn-save" onClick={saveNew}>Add</button>
                        <button className="btn-cancel" onClick={cancel}>Cancel</button>
                      </div>
                    </div>
                  ) : (
                    <button className="add-meal-btn" onClick={() => startAdd(date, slot)}>+ Add</button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}

      {days.length === 0 && (
        <div className="empty-state">
          <span className="emoji">📅</span>
          No days to display
        </div>
      )}
    </div>
  );
}
