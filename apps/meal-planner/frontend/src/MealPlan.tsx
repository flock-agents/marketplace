import React, { useState, useEffect, useCallback, useRef } from "react";
import { meals, type Meal } from "./api";

const FIXED_SLOTS = ["breakfast", "lunch", "dinner"] as const;
const SLOT_CONFIG: Record<string, { label: string; icon: string; color: string }> = {
  breakfast: { label: "BREAKFAST", icon: "☀️", color: "#f59e0b" },
  lunch: { label: "LUNCH", icon: "🥗", color: "#16a34a" },
  dinner: { label: "DINNER", icon: "🌙", color: "#6366f1" },
};

function formatDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
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
  const [adding, setAdding] = useState<{ date: string; slot: string; label?: string } | null>(null);
  const [editing, setEditing] = useState<number | null>(null);
  const [formName, setFormName] = useState("");
  const [formNotes, setFormNotes] = useState("");

  const [addingCustom, setAddingCustom] = useState<string | null>(null);
  const [customLabel, setCustomLabel] = useState("");
  const [labelSuggestions, setLabelSuggestions] = useState<string[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const labelInputRef = useRef<HTMLInputElement>(null);

  const from = formatDate(startDate);
  const to = formatDate(addDays(startDate, range - 1));
  const todayStr = formatDate(new Date());

  const load = useCallback(() => {
    meals.list(from, to).then(setData).catch(console.error);
  }, [from, to]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    meals.labels().then(setLabelSuggestions).catch(console.error);
  }, []);

  const days = Array.from({ length: range }, (_, i) => {
    const d = addDays(startDate, i);
    return { date: formatDate(d), label: dayLabel(d), isToday: formatDate(d) === todayStr };
  });

  function mealsForSlot(date: string, slot: string) {
    return data.filter((m) => m.date === date && m.slot === slot);
  }

  function customMealsForDate(date: string) {
    const customs = data.filter((m) => m.date === date && m.slot === "custom");
    const grouped: { label: string; meals: Meal[] }[] = [];
    const seen = new Map<string, number>();
    for (const m of customs) {
      const lbl = m.label ?? "Other";
      if (seen.has(lbl)) {
        grouped[seen.get(lbl)!].meals.push(m);
      } else {
        seen.set(lbl, grouped.length);
        grouped.push({ label: lbl, meals: [m] });
      }
    }
    return grouped;
  }

  function startAdd(date: string, slot: string, label?: string) {
    setAdding({ date, slot, label });
    setEditing(null);
    setAddingCustom(null);
    setFormName("");
    setFormNotes("");
  }

  function startEdit(meal: Meal) {
    setEditing(meal.id);
    setAdding(null);
    setAddingCustom(null);
    setFormName(meal.name);
    setFormNotes(meal.notes ?? "");
  }

  function cancel() {
    setAdding(null);
    setEditing(null);
    setAddingCustom(null);
    setFormName("");
    setFormNotes("");
    setCustomLabel("");
  }

  async function saveNew() {
    if (!adding || !formName.trim()) return;
    await meals.create({
      date: adding.date,
      slot: adding.slot,
      name: formName.trim(),
      notes: formNotes.trim() || undefined,
      label: adding.label,
    });
    cancel();
    load();
    meals.labels().then(setLabelSuggestions).catch(console.error);
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

  async function deleteGroup(groupLabel: string, groupMeals: Meal[]) {
    if (!confirm(`Remove all "${groupLabel}" entries?`)) return;
    for (const m of groupMeals) {
      await meals.delete(m.id);
    }
    load();
  }

  function goToToday() {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    setStartDate(d);
  }

  function startAddCustom(date: string) {
    setAddingCustom(date);
    setAdding(null);
    setEditing(null);
    setCustomLabel("");
    setShowSuggestions(true);
    setTimeout(() => labelInputRef.current?.focus(), 50);
  }

  function confirmCustomLabel(date: string) {
    if (!customLabel.trim()) return;
    startAdd(date, "custom", customLabel.trim());
  }

  function selectSuggestion(date: string, label: string) {
    setCustomLabel(label);
    setShowSuggestions(false);
    startAdd(date, "custom", label);
  }

  const filteredSuggestions = customLabel.trim()
    ? labelSuggestions.filter((s) => s.toLowerCase().includes(customLabel.toLowerCase()) && s.toLowerCase() !== customLabel.toLowerCase())
    : labelSuggestions;

  function renderMealItem(meal: Meal) {
    if (editing === meal.id) {
      return (
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
      );
    }
    return (
      <div key={meal.id} className="meal-item">
        <div className="meal-text">
          <span className="meal-name">{meal.name}</span>
          {meal.notes && <span className="meal-notes"> {meal.notes}</span>}
        </div>
        <div className="meal-actions">
          <button className="icon-btn" onClick={() => startEdit(meal)} title="Edit">✎</button>
          <button className="icon-btn delete" onClick={() => deleteMeal(meal.id)} title="Delete">✕</button>
        </div>
      </div>
    );
  }

  function renderAddForm(date: string, slot: string, label?: string) {
    const isAdding = adding?.date === date && adding.slot === slot && adding.label === label;
    if (!isAdding) return null;
    return (
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
    );
  }

  return (
    <div>
      <div className="plan-toolbar">
        <div className="range-toggle">
          <button className={`range-btn ${range === 7 ? "active" : ""}`} onClick={() => { setRange(7); goToToday(); }}>7 days</button>
          <button className={`range-btn ${range === 14 ? "active" : ""}`} onClick={() => { setRange(14); goToToday(); }}>14 days</button>
        </div>
        <div className="nav-arrows">
          <button className="nav-btn" onClick={() => setStartDate(addDays(startDate, -range))}>←</button>
          <button className="today-nav-btn" onClick={goToToday}>Today</button>
          <button className="nav-btn" onClick={() => setStartDate(addDays(startDate, range))}>→</button>
        </div>
      </div>

      {days.map(({ date, label, isToday }) => {
        const customGroups = customMealsForDate(date);
        return (
          <div key={date} className={`day-card ${isToday ? "today" : ""}`}>
            <div className={`day-card-header ${isToday ? "today" : ""}`}>
              <span className="day-card-date">{label}</span>
              <div className="day-header-right">
                {isToday && <span className="day-badge today">TODAY</span>}
                <button className="header-add-btn" onClick={() => startAddCustom(date)} title="Add entry">+</button>
              </div>
            </div>

            <div className="day-card-body">
              {FIXED_SLOTS.map((slot) => {
                const cfg = SLOT_CONFIG[slot];
                const slotMeals = mealsForSlot(date, slot);
                const isAddingHere = adding?.date === date && adding.slot === slot && !adding.label;
                return (
                  <div key={slot} className="category-section">
                    <div className="category-header">
                      <span className="category-icon" style={{ background: cfg.color }}>{cfg.icon}</span>
                      <span className="category-label">{cfg.label}</span>
                      {!isAddingHere && (
                        <button className="add-inline-btn" onClick={() => startAdd(date, slot)} title="Edit meal">✎</button>
                      )}
                    </div>
                    {slotMeals.map(renderMealItem)}
                    {renderAddForm(date, slot, undefined)}
                  </div>
                );
              })}

              {customGroups.map(({ label: groupLabel, meals: groupMeals }) => {
                const isAddingToGroup = adding?.date === date && adding.slot === "custom" && adding.label === groupLabel;
                return (
                  <div key={groupLabel} className="category-section custom">
                    <div className="category-header">
                      <span className="category-icon custom">🍴</span>
                      <span className="category-label">{groupLabel.toUpperCase()}</span>
                      {!isAddingToGroup && (
                        <button className="add-inline-btn" onClick={() => startAdd(date, "custom", groupLabel)}>+</button>
                      )}
                      <button className="icon-btn delete section-delete" onClick={() => deleteGroup(groupLabel, groupMeals)} title={`Remove ${groupLabel}`}>✕</button>
                    </div>
                    {groupMeals.map(renderMealItem)}
                    {renderAddForm(date, "custom", groupLabel)}
                  </div>
                );
              })}

              {addingCustom === date ? (
                <div className="custom-label-form">
                  <div className="label-input-wrap">
                    <input
                      ref={labelInputRef}
                      placeholder="Label (e.g. Snacks, Pre-workout)"
                      value={customLabel}
                      onChange={(e) => { setCustomLabel(e.target.value); setShowSuggestions(true); }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") confirmCustomLabel(date);
                        if (e.key === "Escape") cancel();
                      }}
                      onFocus={() => setShowSuggestions(true)}
                      onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
                    />
                    {showSuggestions && filteredSuggestions.length > 0 && (
                      <div className="label-suggestions">
                        {filteredSuggestions.map((s) => (
                          <button key={s} className="label-suggestion" onClick={() => selectSuggestion(date, s)}>{s}</button>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="form-actions">
                    <button className="btn-save" onClick={() => confirmCustomLabel(date)} disabled={!customLabel.trim()}>Next</button>
                    <button className="btn-cancel" onClick={cancel}>Cancel</button>
                  </div>
                </div>
              ) : adding?.date === date && adding.slot === "custom" && adding.label && !customGroups.some((g) => g.label === adding.label) ? (
                <div className="category-section custom">
                  <div className="category-header">
                    <span className="category-icon custom">🍴</span>
                    <span className="category-label">{adding.label.toUpperCase()}</span>
                  </div>
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
                </div>
              ) : null}
            </div>
          </div>
        );
      })}

      {days.length === 0 && (
        <div className="empty-state">
          <span className="emoji">📅</span>
          No days to display
        </div>
      )}
    </div>
  );
}
