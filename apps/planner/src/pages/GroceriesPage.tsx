import { useState } from "react";
import { Button, Checklist, Empty, ErrorCard, Page, Skeleton, useTable, label, isSample } from "../flock/ui";
import { ManageGroceries } from "./ManageGroceries";
import { AISLES, type Grocery } from "./shared";

export function GroceriesPage() {
  const [managing, setManaging] = useState(false);
  const list = useTable<Grocery>("groceries", { limit: 500, sort: "created_at" });
  if (list.error) return <Page title={label("title.groceries", "Groceries")}><ErrorCard title="Couldn't load the list" message={list.error} onRetry={list.refetch} /></Page>;
  if (list.loading && list.rows.length === 0) return <Page title={label("title.groceries", "Groceries")}><Skeleton variant="card" lines={6} /></Page>;
  const rank = (a: string | null) => { const i = AISLES.indexOf(a ?? "Other"); return i < 0 ? AISLES.length : i; };
  const rows = [...list.rows].sort((a, b) => rank(a.aisle) - rank(b.aisle));
  const left = rows.filter((r) => !r.done).length;
  return (
    <Page title={label("title.groceries", "Groceries")} subtitle={left === 0 && rows.length ? "Everything is in the bag" : `${left} still to buy`}
      actions={rows.length ? <Button variant="soft" icon={managing ? "check" : "pencil"} onClick={() => setManaging(!managing)}>{managing ? "Done editing" : "Edit items"}</Button> : undefined}>
      {rows.length === 0 ? <Empty title="Nothing to buy" hint="Add an item below, or ask the assistant to make the list from the week." object="grocery-bag" /> : null}
      {managing ? <ManageGroceries rows={rows} update={list.update} remove={list.remove} /> : <Checklist
        grouped showProgress
        items={rows.map((r) => ({ id: r.id, label: r.item, done: !!r.done, group: r.aisle ?? "Other", meta: r.for_dish ? `for ${r.for_dish}` : undefined, sample: isSample(r) }))}
        onToggle={(id, done) => { void list.update(id, { done: done }).catch(() => {}); }}
        onAdd={(label, group) => { void list.create({ item: label, aisle: group ?? "Other", done: false }).catch(() => {}); }}
      />}
    </Page>
  );
}
