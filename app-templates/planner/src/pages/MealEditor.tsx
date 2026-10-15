import { useEffect, useRef, useState } from "react";
import { Button, Card, Field, RowList, Section, useTable, useToast } from "../flock/ui";
import { SLOTS, addDays, saidText, type Grocery, type Meal, type Recipe } from "./shared";
import { groceryChanges, ingredientLines, linkFor, mealGroceryChanges, suggestRecipes } from "./recipes";

interface Props {
  title: string;
  date: string;                 // the day being planned
  today: string;
  meal?: Meal;                  // editing this dish; adding one when absent
  others?: Meal[];              // the meal's other dishes (same date and slot), for "Add all for this meal"
  askSlot?: string;             // adding without a slot: ask for one, starting here
  onSave: (values: { dish: string; recipe_id: string | null; slot?: string }) => Promise<void>;
  onCancel: () => void;
  onRemove?: () => void;
}

const SHOWN = 4;

/** Add or change one dish of a meal. The dish offers the recipe book first (not planned lately first) and still takes any typed dish. */
export function MealEditor({ title, date, today, meal, others, askSlot, onSave, onCancel, onRemove }: Props) {
  const toast = useToast();
  const [dish, setDish] = useState(meal?.dish ?? "");
  const [slot, setSlot] = useState<string | null>(askSlot ?? null);
  const [keep, setKeep] = useState(false);             // "Save as a recipe" for a typed dish
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  // The week opens the editor in place, under the meal or "+ Add" tapped, and brings it into view; the dish is the field to type in
  // first, even when the Meal select comes before it.
  useEffect(() => { box.current?.querySelector<HTMLInputElement>('input[name="dish"]')?.focus({ preventScroll: true }); }, []);
  const recipes = useTable<Recipe>("recipes", { sort: "name", limit: 500 });
  const recent = useTable<Meal>("meals", { where: { "date[gte]": addDays(date < today ? date : today, -56) }, sort: "-date", limit: 500 });
  const groceries = useTable<Grocery>("groceries", { limit: 500 });

  const linkedId = linkFor(dish, recipes.rows, meal);
  const linked = recipes.rows.find((r) => r.id === linkedId) ?? null;
  const typed = dish.trim();
  // Every recipe the meal's dishes link to, this one first, each once.
  const mealRecipes = [linkedId, ...(others ?? []).map((o) => linkFor(o.dish, recipes.rows, o))]
    .filter((id, i, all): id is string => !!id && all.indexOf(id) === i)
    .map((id) => recipes.rows.find((r) => r.id === id)!).filter(Boolean);
  const ideas = suggestRecipes(recipes.rows, recent.rows, linked ? "" : typed, date, today, SHOWN + 1).filter((s) => s.recipe.id !== linkedId).slice(0, SHOWN);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!typed) { setError("Required"); return; }
    if (askSlot !== undefined && !slot) return;
    setBusy(true);
    try {
      let recipe_id = linkedId;
      if (!recipe_id && keep) recipe_id = (await recipes.create({ name: typed })).id;
      await onSave({ dish: typed, recipe_id, ...(askSlot !== undefined && slot ? { slot } : {}) });
    } catch { /* the data hook already said why */ } finally { setBusy(false); }
  };

  const addIngredients = async (r: Recipe) => {
    const lines = ingredientLines(r.ingredients);
    if (!lines.length) { toast.show({ message: `${r.name} has no ingredients yet. Add them on the Recipes page.` }); return; }
    const c = groceryChanges(lines, groceries.rows);
    setAdding(true);
    try {
      for (const item of c.add) await groceries.create({ item, aisle: "Other", done: false, for_dish: r.name });
      for (const id of c.reopen) await groceries.update(id, { done: false, for_dish: r.name });
      const put = c.add.length + c.reopen.length;
      toast.show({ tone: "success", message: put === 0 ? "Everything is already on the grocery list" : `Added ${put} to groceries under Other${c.skipped.length ? `, ${c.skipped.length} already on the list` : ""}` });
    } catch { /* the data hook already said why */ } finally { setAdding(false); }
  };

  const addAll = async () => {
    const c = mealGroceryChanges(mealRecipes, groceries.rows);
    setAdding(true);
    try {
      for (const a of c.add) await groceries.create({ item: a.item, aisle: "Other", done: false, for_dish: a.for_dish });
      for (const r of c.reopen) await groceries.update(r.id, { done: false, for_dish: r.for_dish });
      const put = c.add.length + c.reopen.length;
      const bare = c.bare.length ? `. ${c.bare.join(", ")} ${c.bare.length === 1 ? "has" : "have"} no ingredients yet` : "";
      toast.show({ tone: "success", message: (put === 0 ? "Everything is already on the grocery list" : `Added ${put} to groceries under Other${c.skipped ? `, ${c.skipped} already on the list` : ""}`) + bare });
    } catch { /* the data hook already said why */ } finally { setAdding(false); }
  };

  return (
    <div ref={box}><Card title={title}>
      <form onSubmit={save} noValidate style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {askSlot !== undefined ? <Field type="select" name="slot" label="Meal" options={SLOTS} required value={slot} onChange={(v) => setSlot(v as string | null)} /> : null}
        <Field type="text" name="dish" label="Dish" required placeholder="Pick a recipe below or type a dish" value={dish} error={error}
          onChange={(v) => { setDish((v as string | null) ?? ""); setError(null); }} />
        {linked ? (
          <div className="pl-tap" style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <Button variant="soft" icon="shopping-basket" loading={adding} disabled={groceries.loading && !groceries.rows.length} onClick={() => void addIngredients(linked)}>Add ingredients to groceries</Button>
            {mealRecipes.length > 1 ? <Button variant="ghost" icon="list-plus" disabled={adding || (groceries.loading && !groceries.rows.length)} onClick={() => void addAll()}>Add all for this meal</Button> : null}
          </div>
        ) : typed && !recipes.loading ? (
          <Field type="checkbox" name="keep" label="Save as a recipe" value={keep} onChange={(v) => setKeep(v === true)} />
        ) : null}
        {ideas.length ? (
          <Section title={typed && !linked ? "Matching recipes" : "From your recipes"} emphasis="subtle">
            <RowList rows={ideas.map((s) => ({ id: s.recipe.id, name: s.recipe.name, said: s.said }))}
              title={(s) => s.name}
              meta={(s) => saidText(s.said, today)}
              onRowClick={(s) => { setDish(s.name); setError(null); setKeep(false); }}
            />
          </Section>
        ) : null}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Button type="submit" loading={busy}>{meal ? "Save" : "Add"}</Button>
          <Button variant="ghost" onClick={onCancel} disabled={busy}>Cancel</Button>
          {onRemove ? <Button variant="ghost" icon="trash" onClick={onRemove} disabled={busy}>Remove from the plan</Button> : null}
        </div>
      </form>
    </Card></div>
  );
}
