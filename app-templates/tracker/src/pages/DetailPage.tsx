import { useEffect, useState } from "react";
import { Button, Confirm, Detail, ErrorCard, Form, Page, Skeleton, kitFetch, useRecord, useTable, useToast } from "../flock/ui";
import { FIELDS, PRIORITY_TONES, STATUS_TONES, type Item } from "./shared";

interface Props { id: string; onBack: () => void; onSelect: (row: { id: string; title: string } | null) => void }

/** Remounts the page when Try again is pressed, so the row is fetched afresh. */
export function DetailPage(props: Props) {
  const [attempt, setAttempt] = useState(0);
  return <DetailBody key={attempt} {...props} retry={() => setAttempt((n) => n + 1)} />;
}

function DetailBody({ id, onBack, onSelect, retry }: Props & { retry: () => void }) {
  const { row, loading, error, update } = useRecord<Item>("items", id);
  const rows = useTable<Item>("items", { where: { id }, limit: 1 });   // its remove() does the delete
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [asking, setAsking] = useState(false);
  useEffect(() => { if (row) onSelect({ id: row.id, title: row.title }); }, [row?.id, row?.title]); // eslint-disable-line react-hooks/exhaustive-deps
  if (loading) return <Page title="Loading"><Skeleton variant="card" lines={5} /></Page>;
  if (error || !row) return <Page title="Not found" actions={<Button variant="ghost" icon="arrow-left" onClick={onBack}>Back</Button>}><ErrorCard title="Couldn't open this row" message={error ?? "It may have been deleted."} onRetry={retry} /></Page>;
  const remove = async () => {
    setAsking(false);
    let changeId: string | undefined;
    try { changeId = await rows.remove(row.id); } catch { return; }   // the hook already said why
    onSelect(null);
    toast.show({
      message: `Deleted ${row.title}`, tone: "success",
      action: changeId ? { label: "Undo", onClick: () => { void kitFetch(`_data/_changes/${changeId}/undo`, { method: "POST" }).catch(() => toast.show({ message: "Couldn't undo", tone: "danger" })); } } : undefined,
    });
    onBack();
  };
  return (
    <Page
      title={row.title} subtitle={row.status}
      actions={<>
        <Button variant="ghost" icon="arrow-left" onClick={onBack}>Back</Button>
        {editing ? null : <Button variant="soft" icon="pencil" onClick={() => setEditing(true)}>Edit</Button>}
        <Button variant="ghost" icon="trash" onClick={() => setAsking(true)}>Delete</Button>
      </>}
    >
      {editing ? (
        <Form fields={[...FIELDS]} initial={{ ...row }} onCancel={() => setEditing(false)} onSubmit={async (v) => { await update(v as Partial<Item>); setEditing(false); }} />
      ) : (
        <Detail fields={[
          { label: "Status", value: row.status, kind: "select", tones: STATUS_TONES },
          { label: "Owner", value: row.owner, kind: "person" },
          { label: "Due", value: row.due, kind: "date" },
          { label: "Priority", value: row.priority, kind: "select", tones: PRIORITY_TONES },
          { label: "Notes", value: row.notes },
        ]} />
      )}
      <Confirm open={asking} title="Delete this row?" body="You can undo it for a few seconds." confirmLabel="Delete" tone="danger" onConfirm={remove} onCancel={() => setAsking(false)} />
    </Page>
  );
}
