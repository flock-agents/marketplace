import { useMemo, useState } from "react";
import { Button, Card, Empty, Form, InlinePanel, Page, RowList, Search, useTable, useToday, label } from "../flock/ui";
import { RECIPE_FIELDS, addDays, saidText, type Meal, type Recipe } from "./shared";
import { suggestRecipes, type RecipeV2 } from "./recipes";
import { splitList } from "./ingredients";

/** Empty text fields come back from the form as null; the recipe keeps only what was written. */
export const recipeValues = (v: Record<string, any>): Partial<RecipeV2> => {
  const out: Record<string, unknown> = { name: String(v.name ?? "").trim(), ingredients: v.ingredients ?? null, method: v.method ?? null, notes: v.notes ?? null };
  for (const k of ["servings", "prep_min", "cook_min", "prep_lead_hours", "cuisine", "source_url"] as const) if (k in v) out[k] = v[k] ?? null;
  if ("tags" in v) out.tags = JSON.stringify(splitList(v.tags));
  return out as Partial<RecipeV2>;
};

export function RecipesPage({ onOpen }: { onOpen: (r: Recipe) => void }) {
  const [q, setQ] = useState("");
  const [adding, setAdding] = useState(false);
  const now = useToday();
  const list = useTable<Recipe>("recipes", { sort: "name", limit: 500 });
  const recent = useTable<Meal>("meals", { where: { "date[gte]": addDays(now, -56) }, sort: "-date", limit: 500 });
  // The structured lines the shopping list is built from (not the free-text `ingredients` note), counted per recipe.
  const lines = useTable<{ id: string; recipe_id: string }>("recipe_ingredients", { limit: 5000 });
  const lineCount = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of lines.rows) m.set(l.recipe_id, (m.get(l.recipe_id) ?? 0) + 1);
    return m;
  }, [lines.rows]);
  const last = useMemo(() => new Map(suggestRecipes(list.rows, recent.rows, "", now, now, list.rows.length).map((s) => [s.recipe.id, s.said])), [list.rows, recent.rows, now]);
  // Search reads the name and the ingredients ("paneer" finds Palak paneer), so it filters here.
  const needle = q.trim().toLowerCase();
  const shown = list.rows.filter((r) => !needle || r.name.toLowerCase().includes(needle) || (r.ingredients ?? "").toLowerCase().includes(needle));
  const add = async (v: Record<string, any>) => { const row = await list.create(recipeValues(v)); setAdding(false); onOpen(row); };
  return (
    <Page title={label("title.recipes", "Recipes")} subtitle={list.rows.length === 1 ? "1 recipe in the family's book" : `${list.rows.length} recipes in the family's book`}
      actions={<Button variant="app" icon="plus" onClick={() => setAdding(true)}>Add</Button>}>
      {adding ? (
        <InlinePanel label="New recipe" onClose={() => setAdding(false)}>
          <Card title="New recipe">
            <Form fields={[...RECIPE_FIELDS]} submitLabel="Add" onSubmit={add} onCancel={() => setAdding(false)} />
          </Card>
        </InlinePanel>
      ) : null}
      <Search value={q} onChange={setQ} placeholder="Search recipes or ingredients" />
      <RowList
        rows={shown} loading={list.loading} error={list.error}
        title={(r) => r.name}
        meta={(r) => {
          const n = lineCount.get(r.id) ?? 0, said = last.get(r.id) ?? null;
          const count = lines.loading ? null : n ? `${n} ingredient${n === 1 ? "" : "s"}` : "No ingredients yet";
          return [count, said ? saidText(said, now) : null].filter(Boolean).join(" · ");
        }}
        onRowClick={onOpen}
        empty={<Empty title={q ? "No matches" : "No recipes yet"} hint={q ? "Nothing matches that search." : "Add the dishes the family makes, with how you like them made."} object="grocery-bag"
          action={q ? undefined : <Button onClick={() => setAdding(true)}>Add a recipe</Button>} />}
      />
    </Page>
  );
}
