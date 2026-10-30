import { useState } from "react";
import { Button, Card, Field, useTable } from "../flock/ui";
import { IngredientsPicker } from "./IngredientsPicker";
import type { Ingredient } from "./ingredients";
import { CATEGORIES } from "./shared";

export interface NewGroceryItem { item: string; qty: string | null; category: string | null; needed_by: string | null; ingredient_id?: string | null }

interface Props { onAdd: (values: NewGroceryItem) => Promise<unknown> }

/** The Groceries page's "Add item" box: a quick one-line add (just the item), with quantity, category and a
 *  need-by date behind "More options" for anyone who wants to be precise. */
export function AddGroceryItem({ onAdd }: Props) {
  const [item, setItem] = useState("");
  const [qty, setQty] = useState<string | null>(null);
  const [category, setCategory] = useState<string | null>(null);
  const [neededBy, setNeededBy] = useState<string | null>(null);
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [ingredientId, setIngredientId] = useState<string | null>(null);
  const catalog = useTable<Ingredient>("ingredients", { sort: "name", limit: 500 });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = item.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    try {
      await onAdd({ item: trimmed, qty, category, needed_by: neededBy, ...(ingredientId ? { ingredient_id: ingredientId } : {}) });
      setItem(""); setQty(null); setCategory(null); setNeededBy(null); setMore(false); setIngredientId(null);
    } finally { setBusy(false); }
  };

  return (
    <Card title="Add item">
      <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
          <div style={{ flex: "1 1 220px" }}>
            <IngredientsPicker name="item" label="Item" value={item} placeholder="2 lemons" ingredients={catalog.rows}
              onChange={(t) => { setItem(t); setIngredientId(null); }}
              onPick={(i) => { setItem(i.name); setIngredientId(i.id); if (!category && i.category) setCategory(i.category); }} />
          </div>
          <Button type="submit" loading={busy} disabled={!item.trim()}>Add</Button>
          <Button type="button" variant="ghost" onClick={() => setMore(!more)}>{more ? "Fewer options" : "More options"}</Button>
        </div>
        {more ? (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Field type="text" name="qty" label="Quantity" value={qty} onChange={(v) => setQty(v as string | null)} />
            <Field type="select" name="category" label="Category" options={CATEGORIES} value={category} onChange={(v) => setCategory(v as string | null)} />
            <Field type="date" name="needed_by" label="Needed by" value={neededBy} onChange={(v) => setNeededBy(v as string | null)} />
          </div>
        ) : null}
      </form>
    </Card>
  );
}
