import { useEffect, useState } from "react";
import { Bullets, Button, Confirm, ErrorCard, Form, Markdown, Page, Section, Skeleton, kitFetch, useRecord, useTable, useToast } from "../flock/ui";
import { RECIPE_FIELDS, type Recipe } from "./shared";
import { ingredientLines } from "./recipes";
import { recipeValues } from "./RecipesPage";

interface Props { id: string; onBack: () => void; onSelect: (row: { table: string; id: string; label: string } | null) => void }

/** Remounts the page when Try again is pressed, so the recipe is fetched afresh. */
export function RecipePage(props: Props) {
  const [attempt, setAttempt] = useState(0);
  return <RecipeBody key={attempt} {...props} retry={() => setAttempt((n) => n + 1)} />;
}

function RecipeBody({ id, onBack, onSelect, retry }: Props & { retry: () => void }) {
  const { row, loading, error, update } = useRecord<Recipe>("recipes", id);
  const rows = useTable<Recipe>("recipes", { where: { id }, limit: 1 });   // its remove() does the delete
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
  const lines = ingredientLines(row.ingredients);
  return (
    <Page title={row.name} width="narrow"
      actions={<>
        {back}
        {editing ? null : <Button variant="soft" icon="pencil" onClick={() => setEditing(true)}>Edit</Button>}
        <Button variant="ghost" icon="trash" onClick={() => setAsking(true)}>Delete</Button>
      </>}
    >
      {editing ? (
        <Form fields={[...RECIPE_FIELDS]} initial={{ ...row }} onCancel={() => setEditing(false)} onSubmit={async (v) => { await update(recipeValues(v)); setEditing(false); }} />
      ) : (<>
        <Section title="Ingredients">{lines.length ? <Bullets items={lines} /> : <p>None written down yet. Edit to add them, one per line.</p>}</Section>
        <Section title="How we make it">{row.method ? <Markdown text={row.method} /> : <p>Not written down yet.</p>}</Section>
        {row.notes ? <Section title="Notes" emphasis="subtle"><Markdown text={row.notes} /></Section> : null}
      </>)}
      <Confirm open={asking} title="Delete this recipe?" body="Meals planned from it stay on the week. You can undo it for a few seconds." confirmLabel="Delete" tone="danger" onConfirm={remove} onCancel={() => setAsking(false)} />
    </Page>
  );
}
