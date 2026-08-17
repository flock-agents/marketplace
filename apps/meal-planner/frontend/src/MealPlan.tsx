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

interface EditTarget {
  date: string;
  slot: string;
  label?: string;
  existingId?: number;
  existingName?: string;
}

export default function MealPlan() {
  const [range, setRange] = useState<7 | 14>(7);
  const [startDate, setStartDate] = useState(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  });
  const [data, setData] = useState<Meal[]>([]);
  const [editTarget, setEditTarget] = useState<EditTarget | null>(null);
  const [formName, setFormName] = useState("");
  const editInputRef = useRef<HTMLInputElement>(null);

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

  useEffect(() => {
    if (editTarget) {
      setTimeout(() => editInputRef.current?.focus(), 50);
    }
  }, [editTarget]);

  const days = Array.from({ length: range }, (_, i) => {
    const d = addDays(startDate, i);
    return { date: formatDate(d), label: dayLabel(d), isToday: formatDate(d) === todayStr };
  });

  function mealForSlot(date: string, slot: string, label?: string): Meal | undefined {
    return data.find((m) =>
      m.date === date && m.slot === slot && (label ? m.label === label : true)
    );
  }

  function customLabelsForDate(date: string): string[] {
    const labels = new Set<string>();
    for (const m of data) {
      if (m.date === date && m.slot === "custom" && m.label) {
        labels.add(m.label);
      }
    }
    return Array.from(labels);
  }

  function openEdit(date: string, slot: string, label?: string) {
    const existing = mealForSlot(date, slot, label);
    setEditTarget({
      date,
      slot,
      label,
      existingId: existing?.id,
      existingName: existing?.name,
    });
    setFormName(existing?.name ?? "");
    setAddingCustom(null);
  }

  function cancelEdit() {
    setEditTarget(null);
    setFormName("");
  }

  async function saveEdit() {
    if (!editTarget) return;
    const name = formName.trim();
    const target = editTarget;

    if (!name && target.existingId) {
      setData((prev) => prev.filter((m) => m.id !== target.existingId));
      cancelEdit();
      meals.delete(target.existingId).catch(() => load());
    } else if (name && target.existingId) {
      setData((prev) =>
        prev.map((m) => (m.id === target.existingId ? { ...m, name } : m))
      );
      cancelEdit();
      meals.update(target.existingId, { name }).catch(() => load());
    } else if (name) {
      const tempId = -Date.now();
      setData((prev) => [
        ...prev,
        {
          id: tempId,
          date: target.date,
          slot: target.slot as Meal["slot"],
          name,
          notes: null,
          label: target.label ?? null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      ]);
      cancelEdit();
      try {
        await meals.create({ date: target.date, slot: target.slot, name, label: target.label });
        load();
      } catch {
        load();
      }
    } else {
      cancelEdit();
    }

    meals.labels().then(setLabelSuggestions).catch(console.error);
  }

  async function removeCustomGroup(date: string, label: string) {
    const toDelete = data.filter((m) => m.date === date && m.slot === "custom" && m.label === label);
    for (const m of toDelete) {
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
    setEditTarget(null);
    setCustomLabel("");
    setShowSuggestions(true);
    setTimeout(() => labelInputRef.current?.focus(), 50);
  }

  function confirmCustomLabel(date: string) {
    if (!customLabel.trim()) return;
    setAddingCustom(null);
    openEdit(date, "custom", customLabel.trim());
  }

  function selectSuggestion(date: string, label: string) {
    setCustomLabel(label);
    setShowSuggestions(false);
    setAddingCustom(null);
    openEdit(date, "custom", label);
  }

  const filteredSuggestions = customLabel.trim()
    ? labelSuggestions.filter((s) => s.toLowerCase().includes(customLabel.toLowerCase()) && s.toLowerCase() !== customLabel.toLowerCase())
    : labelSuggestions;

  function renderSlotRow(date: string, slot: string, cfg: { label: string; icon: string; color: string }, label?: string) {
    const meal = mealForSlot(date, slot, label);
    const isEditing = editTarget?.date === date && editTarget.slot === slot && editTarget.label === label;

    if (isEditing) {
      return (
        <div className="slot-row editing">
          <div className="slot-header-line">
            <span className="slot-icon">{cfg.icon}</span>
            <span className="slot-label">{cfg.label}</span>
          </div>
          <div className="slot-edit-form">
            <input
              ref={editInputRef}
              className="slot-edit-input"
              placeholder="What are you having?"
              value={formName}
              onChange={(e) => setFormName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") saveEdit();
                if (e.key === "Escape") cancelEdit();
              }}
            />
            <div className="slot-edit-actions">
              <button className="btn-save" onClick={saveEdit}>
                {!formName.trim() && editTarget.existingId ? "Clear" : "Save"}
              </button>
              <button className="btn-cancel" onClick={cancelEdit}>Cancel</button>
            </div>
          </div>
        </div>
      );
    }

    return (
      <div className="slot-row" onClick={() => openEdit(date, slot, label)}>
        <div className="slot-header-line">
          <span className="slot-icon">{cfg.icon}</span>
          <span className="slot-label">{cfg.label}</span>
          <button
            className="slot-edit-btn"
            onClick={(e) => { e.stopPropagation(); openEdit(date, slot, label); }}
            aria-label={`Edit ${cfg.label}`}
          >
            ✎
          </button>
        </div>
        <div className={`slot-meal ${meal ? "" : "placeholder"}`}>
          {meal ? meal.name : "Add meal"}
          {meal?.notes && <div className="slot-notes">{meal.notes}</div>}
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
        const customLabels = customLabelsForDate(date);
        return (
          <div key={date} className={`day-card ${isToday ? "today" : ""}`}>
            <div className={`day-card-header ${isToday ? "today" : ""}`}>
              <span className="day-card-date">{label}</span>
              <div className="day-header-right">
                {isToday && <span className="day-badge today">TODAY</span>}
                <button className="header-add-btn" onClick={() => startAddCustom(date)} title="Add custom entry">+</button>
              </div>
            </div>

            <div className="day-card-body">
              {FIXED_SLOTS.map((slot) => (
                <React.Fragment key={slot}>
                  {renderSlotRow(date, slot, SLOT_CONFIG[slot])}
                </React.Fragment>
              ))}

              {customLabels.map((lbl) => (
                <div key={lbl} className="custom-slot-wrap">
                  {renderSlotRow(date, "custom", { label: lbl.toUpperCase(), icon: "🍴", color: "#9ca3af" }, lbl)}
                  <button
                    className="custom-remove-btn"
                    onClick={() => removeCustomGroup(date, lbl)}
                    title={`Remove ${lbl}`}
                  >
                    ✕
                  </button>
                </div>
              ))}

              {addingCustom === date && (
                <div className="custom-label-form">
                  <div className="label-input-wrap">
                    <input
                      ref={labelInputRef}
                      placeholder="Label (e.g. Snacks, Pre-workout)"
                      value={customLabel}
                      onChange={(e) => { setCustomLabel(e.target.value); setShowSuggestions(true); }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") confirmCustomLabel(date);
                        if (e.key === "Escape") { setAddingCustom(null); setCustomLabel(""); }
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
                    <button className="btn-cancel" onClick={() => { setAddingCustom(null); setCustomLabel(""); }}>Cancel</button>
                  </div>
                </div>
              )}

              {/* Show new custom slot being edited inline */}
              {editTarget?.date === date && editTarget.slot === "custom" && editTarget.label &&
                !customLabels.includes(editTarget.label) && (
                <div className="custom-slot-wrap">
                  {renderSlotRow(date, "custom", { label: editTarget.label.toUpperCase(), icon: "🍴", color: "#9ca3af" }, editTarget.label)}
                </div>
              )}
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
