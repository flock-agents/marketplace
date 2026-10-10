import { useState } from "react";
import { Button, Card, Confirm, Detail, Empty, ErrorCard, Form, Page, Search, Skeleton, Table, useRecord, useTable, useToast, label } from "../flock/ui";
import { countText } from "../../server/db/constants";
import { cap, many, one, undoChange, type Customer, type Selected } from "./shared";

const FIELDS = [
  { type: "text", name: "name", label: "Name", required: true },
  { type: "text", name: "gstin", label: "GSTIN (15 characters)", placeholder: "29AABCT5521M1ZP" },
  { type: "text", name: "email", label: "Email" },
  { type: "text", name: "phone", label: "Phone" },
  { type: "longtext", name: "address", label: "Address" },
] as const;

/** GSTIN is optional, but when given it must be 15 letters and digits (the first two are the state code). */
export const gstinProblem = (v: unknown): string | null => {
  const g = String(v ?? "").trim();
  return g === "" || /^\d{2}[A-Z0-9]{13}$/i.test(g) ? null : "A GSTIN has 15 characters, starting with the 2-digit state code";
};

export function CustomersPage({ selected, onSelect }: { selected: Selected; onSelect: (s: Selected) => void }) {
  const [q, setQ] = useState("");
  const [adding, setAdding] = useState(false);
  const list = useTable<Customer>("customers", { sort: "name", q: q || undefined });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const add = async (values: Record<string, any>) => {
    const bad = gstinProblem(values.gstin); if (bad) { setErrors({ gstin: bad }); return; }
    setErrors({});
    await list.create({ ...values, gstin: values.gstin ? String(values.gstin).trim().toUpperCase() : null } as Partial<Customer>); setAdding(false);
  };
  return (
    <Page title={label("title.customers", "Customers") === "Customers" ? cap(many()) : label("title.customers", "Customers")} subtitle={countText(list.rows.length, list.hasMore, one(), many())} actions={<Button variant="app" icon="plus" onClick={() => setAdding(true)}>Add</Button>}>
      {selected?.table === "customers" ? <CustomerPanel key={selected.id} id={selected.id} onClose={() => onSelect(null)} /> : null}
      {adding ? <Card title={`New ${one()}`}><Form fields={[...FIELDS]} errors={errors} submitLabel="Add" onSubmit={add} onCancel={() => { setAdding(false); setErrors({}); }} /></Card> : null}
      <Search value={q} onChange={setQ} placeholder={`Search ${many()}`} />
      <Table
        rows={list.rows} loading={list.loading} error={list.error} hasMore={list.hasMore} onLoadMore={list.loadMore}
        selectedId={selected?.table === "customers" ? selected.id : undefined}
        onRowClick={(c: Customer) => onSelect(selected?.id === c.id ? null : { table: "customers", id: c.id, label: c.name })}
        empty={<Empty title={`No ${many()}`} hint={q ? "Nothing matches. Clear the search." : "Add the people you bill, or ask the assistant to."} object="handshake" action={<Button onClick={() => setAdding(true)}>Add a {one()}</Button>} />}
        columns={[
          { key: "name", label: cap(one()), width: "wide" },
          { key: "gstin", label: "GSTIN" },
          { key: "phone", label: "Phone" },
          { key: "email", label: "Email", phone: "hide" },
        ]}
      />
    </Page>
  );
}

function CustomerPanel(props: { id: string; onClose: () => void }) {
  const [attempt, setAttempt] = useState(0);
  return <CustomerBody key={attempt} {...props} retry={() => setAttempt((n) => n + 1)} />;
}

/** The picked customer, open for editing or deleting. Delete asks first and offers Undo through the kit's change log. */
function CustomerBody({ id, onClose, retry }: { id: string; onClose: () => void; retry: () => void }) {
  const { row, loading, error, update } = useRecord<Customer>("customers", id);
  const list = useTable<Customer>("customers", { where: { id }, limit: 1 });   // its remove() does the delete
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [asking, setAsking] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  if (loading) return <Skeleton variant="card" lines={4} />;
  if (error || !row) return <Card title={cap(one())} actions={<Button size="sm" variant="ghost" icon="x" onClick={onClose}>Close</Button>}><ErrorCard title={`Couldn't open this ${one()}`} message={error ?? "It may have been deleted."} onRetry={retry} /></Card>;
  const remove = async () => {
    setAsking(false);
    let changeId: string | undefined;
    try { changeId = await list.remove(row.id); } catch { return; }   // the hook already said why
    onClose();
    toast.show({ message: `Deleted ${row.name}`, tone: "success", action: changeId ? { label: "Undo", onClick: () => { void undoChange(changeId!).catch(() => toast.show({ message: "Couldn't undo", tone: "danger" })); } } : undefined });
  };
  return (
    <Card
      title={row.name}
      actions={<>
        {editing ? null : <Button size="sm" variant="soft" icon="pencil" onClick={() => setEditing(true)}>Edit</Button>}
        <Button size="sm" variant="ghost" icon="trash" onClick={() => setAsking(true)}>Delete</Button>
        <Button size="sm" variant="ghost" icon="x" onClick={onClose}>Close</Button>
      </>}
    >
      {editing ? (
        <Form fields={[...FIELDS]} initial={{ ...row }} errors={errors} onCancel={() => { setEditing(false); setErrors({}); }}
          onSubmit={async (v) => {
            const bad = gstinProblem(v.gstin); if (bad) { setErrors({ gstin: bad }); return; }
            setErrors({}); await update({ ...v, gstin: v.gstin ? String(v.gstin).trim().toUpperCase() : null } as Partial<Customer>); setEditing(false);
          }} />
      ) : (
        <Detail fields={[
          { label: "GSTIN", value: row.gstin },
          { label: "Email", value: row.email },
          { label: "Phone", value: row.phone },
          { label: "Address", value: row.address },
        ]} />
      )}
      <Confirm open={asking} title={`Delete ${row.name}?`} body="Invoices already issued keep the name, address and GSTIN they were billed to; drafts lose the customer. You can undo it for a few seconds." confirmLabel="Delete" tone="danger" onConfirm={remove} onCancel={() => setAsking(false)} />
    </Card>
  );
}
