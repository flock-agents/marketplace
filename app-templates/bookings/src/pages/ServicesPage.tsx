import { useState } from "react";
import { Button, Callout, Card, Confirm, Detail, Empty, Form, InlinePanel, Page, Table, kitFetch, useTable, useToast, label } from "../flock/ui";
import { SERVICE_FIELDS, type Selected, type Service } from "./shared";

export function ServicesPage({ selected, onSelect }: { selected: Selected; onSelect: (s: Selected) => void }) {
  const list = useTable<Service>("services", { sort: "name", limit: 100 });
  const toast = useToast();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(false);
  const [asking, setAsking] = useState(false);
  const picked = selected?.table === "services" ? list.rows.find((s) => s.id === selected.id) : undefined;
  const add = async (v: Record<string, any>) => { await list.create(v as Partial<Service>); setAdding(false); };
  const remove = async (s: Service) => {
    setAsking(false);
    let changeId: string | undefined;
    try { changeId = await list.remove(s.id); } catch { return; }   // the hook already said why
    onSelect(null);
    toast.show({ message: `Deleted ${s.name}`, tone: "success", action: changeId ? { label: "Undo", onClick: () => { void kitFetch(`_data/_changes/${changeId}/undo`, { method: "POST" }).catch(() => toast.show({ message: "Couldn't undo", tone: "danger" })); } } : undefined });
  };
  return (
    <Page title={label("title.services", "Services")} subtitle="What people can book, and how long each takes" actions={<Button variant="app" icon="plus" onClick={() => setAdding(true)}>Add</Button>}>
      {adding ? (
        <InlinePanel label="New service" onClose={() => setAdding(false)}>
          <Card title="New service"><Form fields={[...SERVICE_FIELDS]} initial={{ minutes: 30 }} submitLabel="Add" onSubmit={add} onCancel={() => setAdding(false)} /></Card>
        </InlinePanel>
      ) : null}
      <Table
        // The picked service opens in place, under its row.
        expanded={picked ? {
          at: picked.id, label: picked.name, onClose: () => { setEditing(false); onSelect(null); },
          content: (
            <Card
              title={picked.name}
              actions={<>
                {editing ? null : <Button size="sm" variant="soft" icon="pencil" onClick={() => setEditing(true)}>Edit</Button>}
                <Button size="sm" variant="ghost" icon="trash" onClick={() => setAsking(true)}>Delete</Button>
                <Button size="sm" variant="ghost" icon="x" onClick={() => { setEditing(false); onSelect(null); }}>Close</Button>
              </>}
            >
              {editing ? (
                <>
                  <Callout tone="info">A change to the minutes applies to new bookings. Bookings already made keep the time they were booked for.</Callout>
                  <Form fields={[...SERVICE_FIELDS]} initial={{ ...picked }} onCancel={() => setEditing(false)} onSubmit={async (v) => { await list.update(picked.id, v as Partial<Service>); setEditing(false); }} />
                </>
              ) : (
                <Detail fields={[{ label: "Takes", value: picked.minutes, kind: "minutes" }, { label: "Price", value: picked.price, kind: "money" }]} />
              )}
              <Confirm open={asking} title="Delete this service?" body="Bookings already made for it stay, shown as a deleted service. You can undo it for a few seconds." confirmLabel="Delete" tone="danger" onConfirm={() => void remove(picked)} onCancel={() => setAsking(false)} />
            </Card>
          ),
        } : null}
        rows={list.rows} loading={list.loading} error={list.error} hasMore={list.hasMore} onLoadMore={list.loadMore}
        selectedId={picked?.id}
        onRowClick={(s) => { setEditing(false); onSelect(selected?.id === s.id ? null : { table: "services", id: s.id, label: s.name }); }}
        empty={<Empty title="No services yet" hint="Add what you offer, such as a consultation." object="calendar" action={<Button onClick={() => setAdding(true)}>Add a service</Button>} />}
        columns={[
          { key: "name", label: "Service", width: "wide" },
          { key: "minutes", label: "Takes", kind: "minutes" },
          { key: "price", label: "Price", kind: "money", align: "end" },
        ]}
      />
    </Page>
  );
}
