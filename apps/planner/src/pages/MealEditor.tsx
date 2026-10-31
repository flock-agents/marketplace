import { useEffect, useRef, useState } from "react";
import { Button, Card, Field, RowList, Section, useApp, useTable, useToast } from "../flock/ui";
import { SLOTS, addDays, saidText, type Diner, type DinerPortionRow, type Grocery, type Meal, type Recipe, type RecipeIngredient } from "./shared";
import { ingredientLines, linkFor, normalizeTime, slotDefaultTime, suggestRecipes } from "./recipes";
import { buildGroceryChanges, familyMultiplier } from "./portions";

interface Props {
  title: string;
  date: string;                 // the day being planned
  today: string;
  meal?: Meal;                  // editing this dish; adding one when absent
  others?: Meal[];              // the meal's other dishes (same date and slot), for "Add all for this meal"
  askSlot?: string;             // adding without a slot: ask for one, starting here
  /** `time` is "HH:MM", or null to follow the slot's default (settings cook.morning / cook.evening, lunch 13:00). */
  onSave: (values: { dish: string; recipe_id: string | null; slot?: string; time: string | null; note: string | null }) => Promise<void>;
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
  const [time, setTime] = useState<string | null>((meal as (Meal & { time?: string | null }) | undefined)?.time ?? null);
  const [timeError, setTimeError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(meal?.note ?? null);
  const { settings } = useApp();
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  // The week opens the editor in place, under the meal or "+ Add" tapped, and brings it into view; the dish is the field to type in
  // first, even when the Meal select comes before it.
  useEffect(() => { box.current?.querySelector<HTMLInputElement>('input[name="dish"]')?.focus({ preventScroll: true }); }, []);
  const recipes = useTable<Recipe>("recipes", { sort: "name", limit: 500 });
  const recent = useTable<Meal>("meals", { where: { "date[gte]": addDays(date < today ? date : today, -56) }, sort: "-date", limit: 500 });
  const groceries = useTable<Grocery>("groceries", { limit: 500 });
  const recipeIngredients = useTable<RecipeIngredient>("recipe_ingredients", { limit: 1000 });
  const diners = useTable<Diner>("diners", { limit: 50 });
  const dinerPortions = useTable<DinerPortionRow>("diner_portions", { limit: 500 });

  const linkedId = linkFor(dish, recipes.rows, meal);
  const linked = recipes.rows.find((r) => r.id === linkedId) ?? null;
  const typed = dish.trim();
  // Every recipe the meal's dishes link to, this one first, each once.
  const mealRecipes = [linkedId, ...(others ?? []).map((o) => linkFor(o.dish, recipes.rows, o))]
    .filter((id, i, all): id is string => !!id && all.indexOf(id) === i)
    .map((id) => recipes.rows.find((r) => r.id === id)!).filter(Boolean);
  const ideas = suggestRecipes(recipes.rows, recent.rows, linked ? "" : typed, date, today, SHOWN + 1).filter((s) => s.recipe.id !== linkedId).slice(0, SHOWN);

  // The suggested quantity (point 5): a recipe's per-adult ingredients, scaled to whichever diners actually eat
  // this slot. Unknown slot (still asking) → 0, which leaves every quantity to the history fallback instead.
  const mealSlot = meal?.slot ?? slot;
  const familyTotal = mealSlot ? familyMultiplier(diners.rows.map((d) => d.id), mealSlot, dinerPortions.rows) : 0;
  const structuredByRecipe = new Map<string, RecipeIngredient[]>();
  for (const ri of recipeIngredients.rows) structuredByRecipe.set(ri.recipe_id, [...(structuredByRecipe.get(ri.recipe_id) ?? []), ri]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!typed) { setError("Required"); return; }
    if (askSlot !== undefined && !slot) return;
    const hhmm = time ? normalizeTime(time) : null;
    if (time && !hhmm) { setTimeError("Use HH:MM, e.g. 19:30"); return; }
    setBusy(true);
    try {
      let recipe_id = linkedId;
      if (!recipe_id && keep) recipe_id = (await recipes.create({ name: typed })).id;
      await onSave({ dish: typed, recipe_id, ...(askSlot !== undefined && slot ? { slot } : {}), time: hhmm, note: note?.trim() || null });
    } catch { /* the data hook already said why */ } finally { setBusy(false); }
  };

  /** Shared by "Add ingredients" (one recipe) and "Add all for this meal" (several): builds the list's add/reopen
   *  from whichever ingredient source each recipe has, writes them, then reports what happened. */
  const addFrom = async (recipesToAdd: Recipe[]) => {
    const bare = recipesToAdd.filter((r) => !structuredByRecipe.has(r.id) && !ingredientLines(r.ingredients).length);
    if (bare.length === recipesToAdd.length) { toast.show({ message: `${recipesToAdd.map((r) => r.name).join(", ")} ${recipesToAdd.length === 1 ? "has" : "have"} no ingredients yet. Add them on the Recipes page.` }); return; }
    const c = buildGroceryChanges(recipesToAdd, structuredByRecipe, familyTotal, groceries.rows);
    setAdding(true);
    try {
      for (const a of c.add) await groceries.create({ item: a.item, aisle: "Other", category: a.category, qty: a.qty, status: "pending", for_dish: a.for_dish });
      for (const r of c.reopen) await groceries.update(r.id, { status: "pending", for_dish: r.for_dish });
      const put = c.add.length + c.reopen.length;
      const bareNote = c.bare.length ? `. ${c.bare.join(", ")} ${c.bare.length === 1 ? "has" : "have"} no ingredients yet` : "";
      toast.show({ tone: "success", message: (put === 0 ? "Everything is already on the grocery list" : `Added ${put} to groceries under Other${c.skipped ? `, ${c.skipped} already on the list` : ""}`) + bareNote });
    } catch { /* the data hook already said why */ } finally { setAdding(false); }
  };
  const addIngredients = (r: Recipe) => addFrom([r]);
  const addAll = () => addFrom(mealRecipes);

  return (
    <div ref={box} className="pl-meal-editor"><Card title={title}>
      <form onSubmit={save} noValidate style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {askSlot !== undefined ? <Field type="select" name="slot" label="Meal" options={SLOTS} required value={slot} onChange={(v) => setSlot(v as string | null)} /> : null}
        <Field type="text" name="dish" label="Dish" required placeholder="Pick a recipe below or type a dish" value={dish} error={error}
          onChange={(v) => { setDish((v as string | null) ?? ""); setError(null); }} />
        <div style={{ maxWidth: 180 }}>
          <Field type="text" name="time" label="Time" value={time} error={timeError} placeholder={slotDefaultTime(mealSlot, settings) ?? "HH:MM"}
            onChange={(v) => { setTime(v as string | null); setTimeError(null); }} />
        </div>
        <Field type="text" name="note" label="Note" placeholder="leftovers from tonight, only for kids…" value={note} onChange={(v) => setNote(v as string | null)} />
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
