import { useState } from "react";
import { Button, Card, Confirm, Detail, ErrorCard, Form, Skeleton, kitFetch, useRecord, useTable, useToast } from "../flock/ui";
import { cap, fields, one, stageLabels, STAGE_TONES, type Deal, type Selected } from "./shared";

type Props = { id: string; onClose: () => void; onSelect: (s: Selected) => void };

/** Remounts the panel when Try again is pressed, so the deal is fetched afresh. */
export function DealPanel(props: Props) {
  const [attempt, setAttempt] = useState(0);
  return <DealBody key={attempt} {...props} retry={() => setAttempt((n) => n + 1)} />;
}

/** The picked deal, open for editing or deleting. Delete asks first and offers Undo through the kit's change log. */
function DealBody({ id, onClose, onSelect, retry }: Props & { retry: () => void }) {
  const { row, loading, error, update } = useRecord<Deal>("deals", id);
  const list = useTable<Deal>("deals", { where: { id }, limit: 1 });   // its remove() does the delete
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [asking, setAsking] = useState(false);
  if (loading) return <Skeleton variant="card" lines={4} />;
  if (error || !row) return <Card title={cap(one())} actions={<Button size="sm" variant="ghost" icon="x" onClick={onClose}>Close</Button>}><ErrorCard title={`Couldn't open this ${one()}`} message={error ?? "It may have been deleted."} onRetry={retry} /></Card>;
  const remove = async () => {
    setAsking(false);
    let changeId: string | undefined;
    try { changeId = await list.remove(row.id); } catch { return; }   // the hook already said why
    onSelect(null);
    toast.show({
      message: `Deleted ${row.title}`, tone: "success",
      action: changeId ? { label: "Undo", onClick: () => { void kitFetch(`_data/_changes/${changeId}/undo`, { method: "POST" }).catch(() => toast.show({ message: "Couldn't undo", tone: "danger" })); } } : undefined,
    });
  };
  return (
    <Card
      title={row.title}
      actions={<>
        {editing ? null : <Button size="sm" variant="soft" icon="pencil" onClick={() => setEditing(true)}>Edit</Button>}
        <Button size="sm" variant="ghost" icon="trash" onClick={() => setAsking(true)}>Delete</Button>
        <Button size="sm" variant="ghost" icon="x" onClick={onClose}>Close</Button>
      </>}
    >
      {editing ? (
        <Form fields={[...fields()]} initial={{ ...row }} onCancel={() => setEditing(false)} onSubmit={async (v) => { await update(v as Partial<Deal>); setEditing(false); }} />
      ) : (
        <Detail fields={[
          { label: "Stage", value: row.stage, kind: "select", tones: STAGE_TONES, labels: stageLabels() },
          { label: "Owner", value: row.owner, kind: "person" },
          ...(row.value !== null && row.value !== undefined ? [{ label: "Value", value: row.value, kind: "money" as const }] : []),
          { label: "Next step", value: row.next_step },
          { label: "Due", value: row.due, kind: "date" },
        ]} />
      )}
      <Confirm open={asking} title={`Delete this ${one()}?`} body="You can undo it for a few seconds." confirmLabel="Delete" tone="danger" onConfirm={remove} onCancel={() => setAsking(false)} />
    </Card>
  );
}
