import React, { useState, useEffect, useRef, useCallback } from "react";
import { shopping, type ShoppingItem } from "./api";

type Filter = "all" | "pending" | "bought";

export default function ShoppingList() {
  const [items, setItems] = useState<ShoppingItem[]>([]);
  const [newName, setNewName] = useState("");
  const [newQty, setNewQty] = useState("");
  const [editingField, setEditingField] = useState<{ id: number; field: "name" | "quantity" } | null>(null);
  const [editValue, setEditValue] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const editRef = useRef<HTMLInputElement>(null);

  const load = useCallback(() => {
    shopping.list().then(setItems).catch(console.error);
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (editingField && editRef.current) editRef.current.focus();
  }, [editingField]);

  async function addItem() {
    if (!newName.trim()) return;
    await shopping.create({ name: newName.trim(), quantity: newQty.trim() || undefined });
    setNewName("");
    setNewQty("");
    load();
  }

  async function toggleStatus(item: ShoppingItem) {
    await shopping.update(item.id, { status: item.status === "pending" ? "bought" : "pending" });
    load();
  }

  async function deleteItem(id: number) {
    await shopping.delete(id);
    load();
  }

  async function clearBought() {
    await shopping.clearBought();
    load();
  }

  function startEdit(id: number, field: "name" | "quantity", currentValue: string) {
    setEditingField({ id, field });
    setEditValue(currentValue);
  }

  async function commitEdit() {
    if (!editingField) return;
    const { id, field } = editingField;
    if (field === "name" && !editValue.trim()) {
      setEditingField(null);
      return;
    }
    await shopping.update(id, { [field]: editValue.trim() });
    setEditingField(null);
    load();
  }

  function onEditKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") commitEdit();
    if (e.key === "Escape") setEditingField(null);
  }

  const pendingCount = items.filter((i) => i.status === "pending").length;
  const boughtCount = items.filter((i) => i.status === "bought").length;

  const filtered = filter === "all" ? items : items.filter((i) => i.status === filter);

  function formatMealDay(dateStr: string): string {
    const d = new Date(dateStr + "T00:00:00");
    return d.toLocaleDateString("en-US", { weekday: "short" });
  }

  return (
    <div>
      <div className="shopping-header">
        <span className="shopping-count">{pendingCount} pending · {boughtCount} bought</span>
        {boughtCount > 0 && (
          <button className="clear-bought-btn" onClick={clearBought}>Clear bought</button>
        )}
      </div>

      <div className="filter-bar">
        <button className={`filter-chip ${filter === "all" ? "active" : ""}`} onClick={() => setFilter("all")}>
          All ({items.length})
        </button>
        <button className={`filter-chip ${filter === "pending" ? "active" : ""}`} onClick={() => setFilter("pending")}>
          Need to buy ({pendingCount})
        </button>
        <button className={`filter-chip ${filter === "bought" ? "active" : ""}`} onClick={() => setFilter("bought")}>
          In stock ({boughtCount})
        </button>
      </div>

      <div className="add-item-row">
        <input
          placeholder="Add item..."
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && addItem()}
        />
        <input
          className="qty-input"
          placeholder="Qty"
          value={newQty}
          onChange={(e) => setNewQty(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && addItem()}
        />
        <button className="add-item-btn" onClick={addItem}>Add</button>
      </div>

      <div className="shopping-list">
        {filtered.map((item) => (
          <div key={item.id} className={`shopping-item ${item.status === "bought" ? "bought" : ""}`}>
            <button
              className={`checkbox ${item.status === "bought" ? "checked" : ""}`}
              onPointerUp={(e) => {
                e.preventDefault();
                e.stopPropagation();
                toggleStatus(item);
              }}
              aria-label={item.status === "bought" ? "Mark as pending" : "Mark as bought"}
            >
              {item.status === "bought" ? "✓" : ""}
            </button>

            <div className="item-detail">
              <div className="item-content">
                {editingField?.id === item.id && editingField.field === "name" ? (
                  <input
                    ref={editRef}
                    className="inline-edit"
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    onBlur={commitEdit}
                    onKeyDown={onEditKeyDown}
                  />
                ) : (
                  <span
                    className={`item-name ${item.status === "bought" ? "bought-text" : ""}`}
                    onClick={() => startEdit(item.id, "name", item.name)}
                  >
                    {item.name}
                  </span>
                )}

                {editingField?.id === item.id && editingField.field === "quantity" ? (
                  <input
                    ref={editRef}
                    className="inline-edit"
                    style={{ width: 60 }}
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    onBlur={commitEdit}
                    onKeyDown={onEditKeyDown}
                  />
                ) : (
                  item.quantity && (
                    <span className="item-qty" onClick={() => startEdit(item.id, "quantity", item.quantity ?? "")}>
                      {item.quantity}
                    </span>
                  )
                )}
              </div>
              {item.linked_meals && item.linked_meals.length > 0 && (
                <div className="item-linked-meals">
                  For: {item.linked_meals.map((lm, i) => (
                    <span key={lm.meal_id}>
                      {i > 0 && ", "}
                      {lm.meal_name} ({formatMealDay(lm.meal_date)})
                    </span>
                  ))}
                </div>
              )}
            </div>

            <button className="delete-item-btn" onClick={() => deleteItem(item.id)} aria-label="Delete">✕</button>
          </div>
        ))}
      </div>

      {filtered.length === 0 && items.length > 0 && (
        <div className="empty-state">
          <span className="emoji">🔍</span>
          No items match this filter
        </div>
      )}

      {items.length === 0 && (
        <div className="empty-state">
          <span className="emoji">🛒</span>
          No items yet — add something above
        </div>
      )}
    </div>
  );
}
