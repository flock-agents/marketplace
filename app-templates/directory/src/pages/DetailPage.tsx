import { useEffect, useState } from "react";
import { Button, Confirm, Detail, ErrorCard, Form, Image, Page, Skeleton, kitFetch, useRecord, useTable, useToast } from "../flock/ui";
import { fieldsFor, kindsIn, objectFor, type Entry } from "./shared";

interface Props { id: string; onBack: () => void; onSelect: (row: { id: string; name: string } | null) => void }

/** Remounts the page when Try again is pressed, so the entry is fetched afresh. */
export function DetailPage(props: Props) {
  const [attempt, setAttempt] = useState(0);
  return <DetailBody key={attempt} {...props} retry={() => setAttempt((n) => n + 1)} />;
}

function DetailBody({ id, onBack, onSelect, retry }: Props & { retry: () => void }) {
  const { row, loading, error, update } = useRecord<Entry>("entries", id);
  const rows = useTable<Entry>("entries", { where: { id }, limit: 1 });   // its remove() does the delete
  const all = useTable<Entry>("entries", { limit: 500 });   // the kinds in use, offered when editing
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [asking, setAsking] = useState(false);
  useEffect(() => { if (row) onSelect({ id: row.id, name: row.name }); }, [row?.id, row?.name]); // eslint-disable-line react-hooks/exhaustive-deps
  if (loading) return <Page title="Loading"><Skeleton variant="card" lines={5} /></Page>;
  if (error || !row) return <Page title="Not found" actions={<Button variant="ghost" icon="arrow-left" onClick={onBack}>Back</Button>}><ErrorCard title="Couldn't open this entry" message={error ?? "It may have been deleted."} onRetry={retry} /></Page>;
  const remove = async () => {
    setAsking(false);
    let changeId: string | undefined;
    try { changeId = await rows.remove(row.id); } catch { return; }   // the hook already said why
    onSelect(null);
    toast.show({ message: `Deleted ${row.name}`, tone: "success", action: changeId ? { label: "Undo", onClick: () => { void kitFetch(`_data/_changes/${changeId}/undo`, { method: "POST" }).catch(() => toast.show({ message: "Couldn't undo", tone: "danger" })); } } : undefined });
    onBack();
  };
  return (
    <Page
      title={row.name} subtitle={row.kind} width="narrow"
      actions={<>
        <Button variant="ghost" icon="arrow-left" onClick={onBack}>Back</Button>
        {editing ? null : <Button variant="soft" icon="pencil" onClick={() => setEditing(true)}>Edit</Button>}
        <Button variant="ghost" icon="trash" onClick={() => setAsking(true)}>Delete</Button>
      </>}
    >
      {editing ? (
        <Form fields={[...fieldsFor(kindsIn([...all.rows, row]))]} initial={{ ...row }} onCancel={() => setEditing(false)} onSubmit={async (v) => { await update(v as Partial<Entry>); setEditing(false); }} />
      ) : (<>
        <div style={{ maxWidth: 373 }}>{/* 4:3 at 373px wide is 280px tall, so wide screens do not get a 600px block */}
          <Image src={row.image} alt={row.name} ratio="4:3" object={objectFor(row.kind)} />
        </div>
        <Detail fields={[
          { label: "Kind", value: row.kind, kind: "select", tones: { [row.kind]: "accent" } },
          { label: "Phone", value: row.phone },
          { label: "Website", value: row.url, kind: "url" },
          { label: "Notes", value: row.notes },
        ]} />
      </>)}
      <Confirm open={asking} title="Delete this entry?" body="You can undo it for a few seconds." confirmLabel="Delete" tone="danger" onConfirm={remove} onCancel={() => setAsking(false)} />
    </Page>
  );
}
