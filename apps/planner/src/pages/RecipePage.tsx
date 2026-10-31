import { useEffect, useState } from "react";
import { Bullets, Button, Card, Confirm, Detail, ErrorCard, Field, Form, Markdown, Page, RowList, Section, Skeleton, kitFetch, safeHref, useRecord, useTable, useToast, useToday } from "../flock/ui";
import { RECIPE_FIELDS, shortDate, type Meal, type PrepStep } from "./shared";
import { importMessage, ingredientLines, perAdult, scaledText, timesText, usedInMeals, type IngredientRow, type RecipeV2 } from "./recipes";
import { recipeValues } from "./RecipesPage";
import { stringList, type Ingredient } from "./ingredients";
import { IngredientsPicker } from "./IngredientsPicker";

/** "Soak dal + rice — 15h before cooking", from the recipe's prep_steps JSON. */
function prepLines(prepSteps: string | null): string[] {
  if (!prepSteps) return [];
  try {
    const steps = JSON.parse(prepSteps) as PrepStep[];
    return steps.map((s) => `${s.step} — ${s.hours_before_cook}h before cooking`);
  } catch { return []; }
}

const EXTRA_FIELDS = [
  { type: "number", name: "servings", label: "Serves (adults)" },
  { type: "number", name: "prep_min", label: "Prep (minutes)" },
  { type: "number", name: "cook_min", label: "Cook (minutes)" },
  { type: "number", name: "prep_lead_hours", label: "Start ahead (hours)" },
  { type: "text", name: "cuisine", label: "Cuisine", placeholder: "Punjabi" },
  { type: "text", name: "tags", label: "Tags (comma separated)", placeholder: "high protein, weekday" },
  { type: "url", name: "source_url", label: "Source link" },
] as const;

interface Props { id: string; onBack: () => void; onSelect: (row: { table: string; id: string; label: string } | null) => void }

/** Remounts the page when Try again is pressed, so the recipe is fetched afresh. */
export function RecipePage(props: Props) {
  const [attempt, setAttempt] = useState(0);
  return <RecipeBody key={attempt} {...props} retry={() => setAttempt((n) => n + 1)} />;
}

function RecipeBody({ id, onBack, onSelect, retry }: Props & { retry: () => void }) {
  const { row, loading, error, update } = useRecord<RecipeV2>("recipes", id);
  const rows = useTable<RecipeV2>("recipes", { where: { id }, limit: 1 });   // its remove() does the delete
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [asking, setAsking] = useState(false);
  useEffect(() => { if (row) onSelect({ table: "recipes", id: row.id, label: row.name }); }, [row?.id, row?.name]); // eslint-disable-line react-hooks/exhaustive-deps
  const back = <Button variant="ghost" icon="arrow-left" onClick={onBack}>Recipes</Button>;
  if (loading) return <Page title="Loading" width="narrow"><Skeleton variant="card" lines={5} /></Page>;
  if (error || !row) return <Page title="Not found" width="narrow" actions={back}><ErrorCard title="Couldn't open this recipe" message={error ?? "It may have been deleted."} onRetry={retry} /></Page>;
  const remove = async () => {
    setAsking(false);
    let changeId: string | undefined;
    try { changeId = await rows.remove(row.id); } catch { return; }   // the hook already said why
    onSelect(null);
    toast.show({ message: `Deleted ${row.name}`, tone: "success", action: changeId ? { label: "Undo", onClick: () => { void kitFetch(`_data/_changes/${changeId}/undo`, { method: "POST" }).catch(() => toast.show({ message: "Couldn't undo", tone: "danger" })); } } : undefined });
    onBack();
  };
  return (
    <Page title={row.name} width="narrow"
      actions={<>
        {back}
        {editing ? null : <Button variant="soft" icon="pencil" onClick={() => setEditing(true)}>Edit</Button>}
        <Button variant="ghost" icon="trash" onClick={() => setAsking(true)}>Delete</Button>
      </>}
    >
      {editing ? (
        <Form fields={[...RECIPE_FIELDS, ...EXTRA_FIELDS]} initial={{ ...row, tags: stringList(row.tags).join(", ") }} onCancel={() => setEditing(false)}
          onSubmit={async (v) => { await update(recipeValues(v)); setEditing(false); }} />
      ) : (<>
        <RecipeFacts row={row} />
        <StructuredIngredients recipe={row} />
        {prepLines(row.prep_steps).length ? <Section title="Prep ahead" emphasis="subtle"><Bullets items={prepLines(row.prep_steps)} /></Section> : null}
        <Section title="How we make it">{row.method ? <Markdown text={row.method} /> : <p>Not written down yet.</p>}</Section>
        {row.notes ? <Section title="Notes" emphasis="subtle"><Markdown text={row.notes} /></Section> : null}
        <UsedIn recipe={row} />
        <ImportBox recipe={row} />
      </>)}
      <Confirm open={asking} title="Delete this recipe?" body="Meals planned from it stay on the week. You can undo it for a few seconds." confirmLabel="Delete" tone="danger" onConfirm={remove} onCancel={() => setAsking(false)} />
    </Page>
  );
}

function RecipeFacts({ row }: { row: RecipeV2 }) {
  const times = timesText(row.prep_min, row.cook_min, row.prep_lead_hours);
  const tags = stringList(row.tags).join(", ");
  const href = safeHref(row.source_url ?? "");
  if (!times && !tags && !row.cuisine && !href && !row.servings) return null;
  return (<>
    <Detail fields={[
      { label: "Serves", value: row.servings ?? null }, { label: "Time", value: times || null },
      { label: "Cuisine", value: row.cuisine ?? null }, { label: "Tags", value: tags || null },
    ]} />
    {href ? <p><a href={href} target="_blank" rel="noreferrer">Source</a></p> : null}
  </>);
}

/** The recipe's ingredient rows: picker, quantity per adult, unit, optional, substitutes; a servings box previews the scaled amounts. */
function StructuredIngredients({ recipe }: { recipe: RecipeV2 }) {
  const lines = useTable<IngredientRow>("recipe_ingredients", { where: { recipe_id: recipe.id }, limit: 200 });
  const catalog = useTable<Ingredient>("ingredients", { sort: "name", limit: 500 });
  const [servings, setServings] = useState<number>(recipe.servings ?? 1);
  const [adding, setAdding] = useState(false);
  const legacy = ingredientLines(recipe.ingredients);
  const nameOf = (id: string) => catalog.rows.find((i) => i.id === id)?.name ?? id;
  return (
    <Section title="Ingredients" actions={<Button size="sm" variant="soft" icon="plus" onClick={() => setAdding(true)}>Add</Button>}>
      {lines.rows.length ? <div style={{ maxWidth: 160 }}><Field type="number" name="servings" label="Preview for (adults)" value={servings} onChange={(v) => setServings((v as number | null) ?? 1)} /></div> : null}
      <RowList rows={lines.rows} loading={lines.loading} rowKey={(r) => r.id}
        title={(r) => `${r.item}${r.optional ? " (optional)" : ""}`}
        meta={(r) => [scaledText(r, servings), perAdult(r) !== null && servings !== 1 ? `${scaledText(r, 1)} per adult` : null,
          stringList(r.substitutes).length ? `or ${stringList(r.substitutes).map(nameOf).join(", ")}` : null].filter(Boolean).join(" · ")}
        trailing={(r) => <Button size="sm" variant="ghost" icon="trash" onClick={() => void lines.remove(r.id).catch(() => undefined)}>Remove</Button>}
        empty={legacy.length ? <Bullets items={legacy} /> : <p>None written down yet. Add them one by one, or use Import below.</p>} />
      {adding ? <IngredientRowEditor catalog={catalog.rows} onCancel={() => setAdding(false)}
        onSave={async (v) => { await lines.create({ recipe_id: recipe.id, ...v }); setAdding(false); }} /> : null}
    </Section>
  );
}

type NewRow = Omit<IngredientRow, "id" | "recipe_id">;

function IngredientRowEditor({ catalog, onSave, onCancel }: { catalog: Ingredient[]; onSave: (v: NewRow) => Promise<void>; onCancel: () => void }) {
  const [text, setText] = useState("");
  const [picked, setPicked] = useState<Ingredient | null>(null);
  const [qty, setQty] = useState<number | null>(null);
  const [unit, setUnit] = useState<string | null>(null);
  const [optional, setOptional] = useState(false);
  const [subs, setSubs] = useState("");
  const [subIds, setSubIds] = useState<Ingredient[]>([]);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    const item = (picked?.name ?? text).trim();
    if (!item) return;
    setBusy(true);
    try {
      await onSave({ item, ingredient_id: picked?.id ?? null, qty, qty_per_adult: qty, unit: unit ?? picked?.default_unit ?? null, category: picked?.category ?? null,
        optional: optional ? 1 : 0, substitutes: subIds.length ? JSON.stringify(subIds.map((s) => s.id)) : null });
    } catch { /* the data hook already said why */ } finally { setBusy(false); }
  };
  return (
    <Card title="New ingredient row">
      <div className="pl-ri">
        <IngredientsPicker name="item" label="Ingredient" value={text} ingredients={catalog} placeholder="Spinach / palak"
          onChange={(t) => { setText(t); setPicked(null); }} onPick={(i) => { setText(i.name); setPicked(i); setUnit(i.default_unit); }} />
        <Field type="number" name="qty" label="Per adult" value={qty} onChange={(v) => setQty(v as number | null)} />
        <Field type="text" name="unit" label="Unit" value={unit} onChange={(v) => setUnit(v as string | null)} placeholder="g" />
        <span />
        <div className="pl-ri-extra">
          <Field type="checkbox" name="optional" label="Optional" value={optional} onChange={(v) => setOptional(v === true)} />
          <div style={{ flex: "1 1 220px" }}>
            <IngredientsPicker name="substitutes" label="Can swap with" value={subs} ingredients={catalog.filter((c) => !subIds.includes(c))}
              onChange={setSubs} onPick={(i) => { setSubIds((s) => [...s, i]); setSubs(""); }} />
          </div>
          {subIds.length ? <span>{subIds.map((s) => s.name).join(", ")} <Button size="sm" variant="ghost" onClick={() => setSubIds([])}>Clear</Button></span> : null}
        </div>
      </div>
      <div className="pl-form-row" style={{ marginTop: 8 }}>
        <Button loading={busy} disabled={!text.trim()} onClick={() => void save()}>Add</Button>
        <Button variant="ghost" onClick={onCancel}>Cancel</Button>
      </div>
    </Card>
  );
}

function UsedIn({ recipe }: { recipe: RecipeV2 }) {
  const today = useToday();
  const meals = useTable<Meal>("meals", { sort: "-date", limit: 500 });
  const { upcoming, past } = usedInMeals(recipe, meals.rows, today);
  const line = (m: Meal) => `${shortDate(m.date)} · ${m.slot}`;
  if (!upcoming.length && !past.length) return null;
  return (
    <Section title="Used in meals" emphasis="subtle">
      {upcoming.length ? <><strong>Coming up</strong><Bullets items={upcoming.slice(0, 5).map(line)} /></> : null}
      {past.length ? <><strong>Had</strong><Bullets items={past.slice(0, 5).map(line)} /></> : null}
    </Section>
  );
}

/** Paste a recipe or a link; the app's agent reads it and fills the structured fields. */
function ImportBox({ recipe }: { recipe: RecipeV2 }) {
  const toast = useToast();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const send = async () => {
    setBusy(true);
    try {
      await kitFetch("_agent/message", { method: "POST", body: JSON.stringify({ message: importMessage(recipe, text), context: { table: "recipes", id: recipe.id } }) });
      setText("");
      toast.show({ tone: "success", message: "Sent to the agent — open the chat to follow along" });
    } catch { toast.show({ tone: "danger", message: "Couldn't send that to the agent" }); } finally { setBusy(false); }
  };
  return (
    <Section title="Import" emphasis="subtle">
      <Field type="longtext" name="import" label="Paste a recipe or a link" value={text} onChange={(v) => setText((v as string | null) ?? "")} placeholder="https://… or the recipe text" />
      <div style={{ marginTop: 8 }}><Button variant="soft" icon="sparkles" loading={busy} disabled={!text.trim()} onClick={() => void send()}>Ask the agent to fill it in</Button></div>
    </Section>
  );
}
