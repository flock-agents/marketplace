import { useState } from "react";
import { Bullets, Button, Detail, ErrorCard, Form, Markdown, Page, RowList, Section, Skeleton, useRecord, useTable } from "../flock/ui";
import { CATEGORIES, SERVICE_NAMES, serviceLabel, shortDate, type Grocery, type Recipe } from "./shared";
import {
  PRICE_CHOICES, SUBSTITUTION_CHOICES, aliasesOf, formatConversions, ingredientFormValues, ingredientPatch, parseJson, prefsSummary,
  type Ingredient, type ShoppingPrefs,
} from "./ingredients";
import type { IngredientRow } from "./recipes";

const EDIT_FIELDS = [
  { type: "text", name: "name", label: "Name", required: true },
  { type: "select", name: "category", label: "Category", options: CATEGORIES },
  { type: "text", name: "default_unit", label: "Usual unit", placeholder: "g, ml or pc" },
  { type: "text", name: "aliases", label: "Also called (comma separated)", placeholder: "palak, spinach" },
  { type: "text", name: "unit_conversions", label: "Unit conversions (grams or ml per unit)", placeholder: "pc=150, bunch=250" },
  { type: "number", name: "shelf_life_days", label: "Keeps for (days)" },
  { type: "number", name: "pack_min", label: "Smallest pack" },
  { type: "number", name: "pack_max", label: "Largest pack" },
  { type: "text", name: "pack_unit", label: "Pack unit", placeholder: "g" },
  { type: "number", name: "stock_days", label: "Days of stock to keep" },
  { type: "select", name: "price", label: "Price preference", options: PRICE_CHOICES },
  { type: "text", name: "brands_preferred", label: "Preferred brands (comma separated)" },
  { type: "text", name: "brands_avoid", label: "Brands to avoid (comma separated)" },
  { type: "select", name: "substitutions", label: "Substitutions", options: SUBSTITUTION_CHOICES },
  { type: "select", name: "service", label: "Order from", options: ["any", ...Object.keys(SERVICE_NAMES)] as string[] },
  { type: "checkbox", name: "never_auto_add", label: "Never add to the list on its own" },
  { type: "longtext", name: "notes", label: "Notes for the agent", placeholder: "Buy the small tender bunches; skip if wilted" },
] as const;

interface Props { id: string; onBack: () => void; onOpenRecipe: (id: string) => void }

/** One catalog ingredient: what it's called, how it converts and keeps, how the family likes it bought, what it's bought for and when. */
export function IngredientPage({ id, onBack, onOpenRecipe }: Props) {
  const { row, loading, error, update } = useRecord<Ingredient>("ingredients", id);
  const [editing, setEditing] = useState(false);
  const back = <Button variant="ghost" icon="arrow-left" onClick={onBack}>Ingredients</Button>;
  if (loading) return <Page title="Loading" width="narrow"><Skeleton variant="card" lines={5} /></Page>;
  if (error || !row) return <Page title="Not found" width="narrow" actions={back}><ErrorCard title="Couldn't open this ingredient" message={error ?? "It may have been deleted."} /></Page>;
  return (
    <Page title={row.name} width="narrow" actions={<>{back}{editing ? null : <Button variant="soft" icon="pencil" onClick={() => setEditing(true)}>Edit</Button>}</>}>
      {editing ? (
        <Form fields={[...EDIT_FIELDS]} initial={ingredientFormValues(row)} onCancel={() => setEditing(false)}
          onSubmit={async (v) => { await update(ingredientPatch(v)); setEditing(false); }} />
      ) : <IngredientFacts row={row} />}
      <UsedInRecipes ingredientId={row.id} onOpen={onOpenRecipe} />
      <PurchaseHistory ingredientId={row.id} />
    </Page>
  );
}

function IngredientFacts({ row }: { row: Ingredient }) {
  const prefs = parseJson<ShoppingPrefs>(row.prefs, {});
  const conversions = formatConversions(parseJson<Record<string, number>>(row.unit_conversions, {}));
  return (<>
    <Detail fields={[
      { label: "Also called", value: aliasesOf(row).join(", ") || null },
      { label: "Usual unit", value: row.default_unit },
      { label: "Conversions", value: conversions || null },
      { label: "Keeps for", value: row.shelf_life_days ? `${row.shelf_life_days} days` : null },
      { label: "Shopping", value: prefsSummary(prefs) || "Category defaults" },
      { label: "Avoid brands", value: prefs.brands_avoid?.join(", ") || null },
      { label: "Substitutions", value: prefs.substitutions ?? null },
      { label: "Order from", value: prefs.service && prefs.service !== "any" ? serviceLabel(prefs.service) : null },
    ]} />
    {row.notes ? <Section title="Notes" emphasis="subtle"><Markdown text={row.notes} /></Section> : null}
  </>);
}

function UsedInRecipes({ ingredientId, onOpen }: { ingredientId: string; onOpen: (id: string) => void }) {
  const lines = useTable<IngredientRow>("recipe_ingredients", { where: { ingredient_id: ingredientId }, limit: 500 });
  const recipes = useTable<Recipe>("recipes", { sort: "name", limit: 500 });
  const ids = new Set(lines.rows.map((l) => l.recipe_id));
  const used = recipes.rows.filter((r) => ids.has(r.id));
  return (
    <Section title="Used in recipes">
      <RowList rows={used} loading={lines.loading || recipes.loading} title={(r) => r.name} onRowClick={(r) => onOpen(r.id)}
        empty={<p>No recipe uses it yet.</p>} />
    </Section>
  );
}

function PurchaseHistory({ ingredientId }: { ingredientId: string }) {
  const bought = useTable<Grocery>("groceries", { where: { ingredient_id: ingredientId, status: "ordered" }, sort: "-buy_at", limit: 20 });
  const items = bought.rows.map((g) => [g.buy_at ? shortDate(g.buy_at.slice(0, 10)) : null, g.qty, g.service ? serviceLabel(g.service) : null, g.price ? `₹${g.price}` : null].filter(Boolean).join(" · "));
  return (
    <Section title="Bought before" emphasis="subtle">
      {bought.loading && !items.length ? <Skeleton lines={2} /> : items.length ? <Bullets items={items} /> : <p>No orders recorded yet.</p>}
    </Section>
  );
}
