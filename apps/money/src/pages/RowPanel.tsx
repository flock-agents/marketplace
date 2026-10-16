import { useState } from "react";
import type { FieldDef } from "./shared";
import { Button, Card, Confirm, Detail, ErrorCard, Form, Skeleton, kitFetch, useRecord, useTable, useToast } from "../flock/ui";

type DetailField = { label: string; value: any; kind?: "text" | "number" | "money" | "compact" | "signed" | "date" | "select" | "person" | "url" };

interface Props<R extends { id: string }> {
  table: string; id: string; noun: string;
  heading: (row: R) => string;
  detail: (row: R) => DetailField[];
  fields: FieldDef[];
  /** Row to form values (a transaction's sign becomes Spent / Received). */
  toForm?: (row: R) => Record<string, any>;
  /** Form values to the patch sent to the table. */
  fromForm?: (values: Record<string, any>) => Partial<R>;
  onClose: () => void;
}

/** Remounts the panel when Try again is pressed, so the row is fetched afresh. */
export function RowPanel<R extends { id: string }>(props: Props<R>) {
  const [attempt, setAttempt] = useState(0);
  return <RowBody key={attempt} {...props} retry={() => setAttempt((n) => n + 1)} />;
}

/** One picked row, open for editing or deleting. Delete asks first and offers Undo through the kit's change log. */
function RowBody<R extends { id: string }>({ table, id, noun, heading, detail, fields, toForm, fromForm, onClose, retry }: Props<R> & { retry: () => void }) {
  const { row, loading, error, update } = useRecord<R>(table, id);
  const list = useTable<R>(table, { where: { id }, limit: 1 });   // its remove() does the delete
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [asking, setAsking] = useState(false);
  const close = <Button size="sm" variant="ghost" icon="x" onClick={onClose}>Close</Button>;
  if (loading) return <Skeleton variant="card" lines={4} />;
  if (error || !row) return <Card title={noun}>{close}<ErrorCard title={`Couldn't open this ${noun.toLowerCase()}`} message={error ?? "It may have been deleted."} onRetry={retry} /></Card>;
  const remove = async () => {
    setAsking(false);
    let changeId: string | undefined;
    try { changeId = await list.remove(row.id); } catch { return; }   // the hook already said why
    onClose();
    toast.show({
      message: `Deleted ${heading(row)}`, tone: "success",
      action: changeId ? { label: "Undo", onClick: () => { void kitFetch(`_data/_changes/${changeId}/undo`, { method: "POST" }).catch(() => toast.show({ message: "Couldn't undo", tone: "danger" })); } } : undefined,
    });
  };
  return (
    <Card title={heading(row)}>
      <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 8 }}>   {/* below the title, so a long name keeps its width on a phone */}
        {editing ? null : <Button size="sm" variant="soft" icon="pencil" onClick={() => setEditing(true)}>Edit</Button>}
        <Button size="sm" variant="ghost" icon="trash" onClick={() => setAsking(true)}>Delete</Button>
        {close}
      </div>
      {editing ? (
        <Form fields={fields} initial={toForm ? toForm(row) : { ...row }} onCancel={() => setEditing(false)} onSubmit={async (v) => { await update(fromForm ? fromForm(v) : (v as Partial<R>)); setEditing(false); }} />
      ) : <Detail fields={detail(row)} />}
      <Confirm open={asking} title={`Delete this ${noun.toLowerCase()}?`} body="You can undo it for a few seconds." confirmLabel="Delete" tone="danger" onConfirm={remove} onCancel={() => setAsking(false)} />
    </Card>
  );
}
