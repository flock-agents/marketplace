import { useState } from "react";
import { Button, Card, Confirm, Form, Table, kitFetch, useToast } from "../flock/ui";
import { GROCERY_FIELDS, type Grocery } from "./shared";

interface Props {
  rows: Grocery[];
  update: (id: string, patch: Partial<Grocery>) => Promise<unknown>;
  remove: (id: string) => Promise<string | undefined>;   // resolves with the change id, which Undo uses
}

/** Edit or delete any grocery item. Delete asks first, then offers Undo (the kit's change log puts the same row back). */
export function ManageGroceries({ rows, update, remove }: Props) {
  const toast = useToast();
  const [editing, setEditing] = useState<Grocery | null>(null);
  const [asking, setAsking] = useState<Grocery | null>(null);
  const del = async (row: Grocery) => {
    setAsking(null);
    let changeId: string | undefined;
    try { changeId = await remove(row.id); } catch { return; }   // the hook already said why
    toast.show({
      message: `Deleted ${row.item}`, tone: "success",
      action: changeId ? { label: "Undo", onClick: () => { void kitFetch(`_data/_changes/${changeId}/undo`, { method: "POST" }).catch(() => toast.show({ message: "Couldn't undo", tone: "danger" })); } } : undefined,
    });
  };
  return (
    <>
      <Table
        rows={rows}
        // Edit opens in place, under the item's own row.
        expanded={editing ? {
          at: editing.id, label: `Edit ${editing.item}`, onClose: () => setEditing(null),
          content: (
            <Card title="Edit item">
              <Form fields={[...GROCERY_FIELDS]} initial={{ ...editing }} onCancel={() => setEditing(null)} onSubmit={async (v) => { await update(editing.id, v as Partial<Grocery>); setEditing(null); }} />
            </Card>
          ),
        } : null}
        columns={[
          { key: "item", label: "Item", width: "wide" },
          { key: "qty", label: "Qty", phone: "hide" },
          { key: "category", label: "Category", phone: "hide" },
          { key: "needed_by", label: "Needed by", kind: "date", phone: "hide" },
          { key: "in_stock_until", label: "Have it until", kind: "date", phone: "hide" },
          { key: "aisle", label: "Aisle" },
          { key: "for_dish", label: "For" },
          { key: "id", label: "", align: "end", render: (r: Grocery) => (
            <span style={{ display: "inline-flex", gap: 4 }}>
              <Button size="sm" variant="ghost" icon="pencil" onClick={() => setEditing(r)}>Edit</Button>
              <Button size="sm" variant="ghost" icon="trash" onClick={() => setAsking(r)}>Delete</Button>
            </span>
          ) },
        ]}
      />
      <Confirm open={!!asking} title="Delete this item?" body="You can undo it for a few seconds." confirmLabel="Delete" tone="danger" onConfirm={() => asking && void del(asking)} onCancel={() => setAsking(null)} />
    </>
  );
}
