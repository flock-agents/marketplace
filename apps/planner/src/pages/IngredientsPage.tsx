import { useState } from "react";
import { Button, Card, Empty, Form, InlinePanel, Page, RowList, Search, useTable } from "../flock/ui";
import { CATEGORIES, CATEGORY_LABELS } from "./shared";
import { aliasesOf, matchIngredients, parseJson, prefsSummary, type Ingredient, type ShoppingPrefs } from "./ingredients";

const NEW_FIELDS = [
  { type: "text", name: "name", label: "Name", required: true, placeholder: "Spinach" },
  { type: "select", name: "category", label: "Category", options: CATEGORIES },
  { type: "text", name: "default_unit", label: "Usual unit", placeholder: "g, ml or pc" },
] as const;

const rowMeta = (i: Ingredient): string => [
  i.category ? CATEGORY_LABELS[i.category] ?? i.category : null,
  aliasesOf(i).length ? `also ${aliasesOf(i).join(", ")}` : null,
  prefsSummary(parseJson<ShoppingPrefs>(i.prefs, {})) || null,
].filter(Boolean).join(" · ");

/** The ingredient catalog: search by name or alias (typos forgiven), open one to edit its aliases, conversions and shopping preferences. */
export function IngredientsPage({ onOpen }: { onOpen: (i: Ingredient) => void }) {
  const [q, setQ] = useState("");
  const [adding, setAdding] = useState(false);
  const list = useTable<Ingredient>("ingredients", { sort: "name", limit: 500 });
  const shown = q.trim() ? matchIngredients(list.rows, q, list.rows.length).map((m) => m.row) : list.rows;
  const add = async (v: Record<string, any>) => {
    const row = await list.create({ name: String(v.name ?? "").trim(), category: v.category ?? null, default_unit: v.default_unit ?? null });
    setAdding(false); onOpen(row);
  };
  return (
    <Page title="Ingredients" subtitle={`${list.rows.length} in the catalog`}
      actions={<Button variant="app" icon="plus" onClick={() => setAdding(true)}>Add</Button>}>
      {adding ? (
        <InlinePanel label="New ingredient" onClose={() => setAdding(false)}>
          <Card title="New ingredient"><Form fields={[...NEW_FIELDS]} submitLabel="Add" onSubmit={add} onCancel={() => setAdding(false)} /></Card>
        </InlinePanel>
      ) : null}
      <Search value={q} onChange={setQ} placeholder="Search ingredients or aliases" debounceMs={100} />
      <RowList rows={shown} loading={list.loading} error={list.error} title={(i) => i.name} meta={rowMeta} onRowClick={onOpen}
        empty={<Empty title={q ? "No matches" : "No ingredients yet"} hint={q ? "Nothing matches that name or alias." : "Ingredients appear here as recipes use them."} object="grocery-bag" />} />
    </Page>
  );
}
