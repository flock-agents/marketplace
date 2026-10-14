import { useState } from "react";
import { Button, Card, Confirm, Form, Table, kitFetch, useToast } from "../flock/ui";
import { FIELDS, type Task } from "./shared";

interface Props {
  rows: Task[];
  update: (id: string, patch: Partial<Task>) => Promise<unknown>;
  remove: (id: string) => Promise<string | undefined>;   // resolves with the change id, which Undo uses
}

/** Edit or delete any item. Delete asks first, then offers Undo (the kit's change log puts the same row back). */
export function ManageItems({ rows, update, remove }: Props) {
  const toast = useToast();
  const [editing, setEditing] = useState<Task | null>(null);
  const [asking, setAsking] = useState<Task | null>(null);
  const del = async (row: Task) => {
    setAsking(null);
    let changeId: string | undefined;
    try { changeId = await remove(row.id); } catch { return; }   // the hook already said why
    toast.show({
      message: `Deleted ${row.label}`, tone: "success",
      action: changeId ? { label: "Undo", onClick: () => { void kitFetch(`_data/_changes/${changeId}/undo`, { method: "POST" }).catch(() => toast.show({ message: "Couldn't undo", tone: "danger" })); } } : undefined,
    });
  };
  return (
    <>
      <Table
        rows={rows}
        // Edit opens in place, under the item's own row.
        expanded={editing ? {
          at: editing.id, label: `Edit ${editing.label}`, onClose: () => setEditing(null),
          content: (
            <Card title="Edit item">
              <Form fields={[...FIELDS]} initial={{ ...editing }} onCancel={() => setEditing(null)} onSubmit={async (v) => { await update(editing.id, v as Partial<Task>); setEditing(null); }} />
            </Card>
          ),
        } : null}
        columns={[
          { key: "label", label: "Item", width: "wide" },
          { key: "group_name", label: "Group" },
          { key: "who", label: "Who", kind: "person" },
          { key: "due", label: "Due", kind: "date" },
          { key: "id", label: "", align: "end", render: (r: Task) => (
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
