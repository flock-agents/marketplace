import { useMemo, useState } from "react";
import { Button, Card, Empty, Form, InlinePanel, Page, RowList, Search, useTable, useToday, label } from "../flock/ui";
import { RECIPE_FIELDS, addDays, saidText, type Meal, type Recipe } from "./shared";
import { ingredientLines, suggestRecipes } from "./recipes";

/** Empty text fields come back from the form as null; the recipe keeps only what was written. */
export const recipeValues = (v: Record<string, any>): Partial<Recipe> =>
  ({ name: String(v.name ?? "").trim(), ingredients: v.ingredients ?? null, method: v.method ?? null, notes: v.notes ?? null });

export function RecipesPage({ onOpen }: { onOpen: (r: Recipe) => void }) {
  const [q, setQ] = useState("");
  const [adding, setAdding] = useState(false);
  const now = useToday();
  const list = useTable<Recipe>("recipes", { sort: "name", limit: 500 });
  const recent = useTable<Meal>("meals", { where: { "date[gte]": addDays(now, -56) }, sort: "-date", limit: 500 });
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
          const n = ingredientLines(r.ingredients).length, said = last.get(r.id) ?? null;
          return [n ? `${n} ingredient${n === 1 ? "" : "s"}` : "No ingredients yet", said ? saidText(said, now) : null].filter(Boolean).join(" · ");
        }}
        onRowClick={onOpen}
        empty={<Empty title={q ? "No matches" : "No recipes yet"} hint={q ? "Nothing matches that search." : "Add the dishes the family makes, with how you like them made."} object="grocery-bag"
          action={q ? undefined : <Button onClick={() => setAdding(true)}>Add a recipe</Button>} />}
      />
    </Page>
  );
}
