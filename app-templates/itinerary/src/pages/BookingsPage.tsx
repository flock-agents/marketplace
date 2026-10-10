import { useState } from "react";
import { Button, Card, Empty, Form, Page, Table, useTable, label } from "../flock/ui";
import { RowPanel } from "./RowPanel";
import { BOOKING_FIELDS, STATUS_TONES, type Booking, type Selected } from "./shared";

export function BookingsPage({ selected, onSelect }: { selected: Selected; onSelect: (s: Selected) => void }) {
  const list = useTable<Booking>("bookings", { sort: "when" });
  const [adding, setAdding] = useState(false);
  const add = async (v: Record<string, any>) => { await list.create(v as Partial<Booking>); setAdding(false); };
  const pending = list.rows.filter((b) => b.status === "Pending").length;
  return (
    <Page title={label("title.bookings", "Bookings")} subtitle={pending ? `${pending} still to confirm` : "Everything confirmed"} actions={<Button variant="app" icon="plus" onClick={() => setAdding(true)}>Add</Button>}>
      {adding ? (
        <Card title="New booking">
          <Form
            fields={BOOKING_FIELDS}
            initial={{ status: "Pending" }} submitLabel="Add" onSubmit={add} onCancel={() => setAdding(false)}
          />
        </Card>
      ) : null}
      {selected?.table === "bookings" ? (
        <RowPanel<Booking>
          key={selected.id} table="bookings" id={selected.id} noun="Booking" onClose={() => onSelect(null)}
          heading={(b) => b.what}
          detail={(b) => [
            { label: "Status", value: b.status, kind: "select", tones: STATUS_TONES }, { label: "Date", value: b.when, kind: "date" },
            { label: "Cost", value: b.cost, kind: "money" }, { label: "Reference", value: b.ref },
          ]}
          fields={BOOKING_FIELDS}
        />
      ) : null}
      <Table
        rows={list.rows} loading={list.loading} error={list.error} hasMore={list.hasMore} onLoadMore={list.loadMore}
        selectedId={selected?.table === "bookings" ? selected.id : undefined}
        onRowClick={(b) => onSelect(selected?.id === b.id ? null : { table: "bookings", id: b.id, label: b.what })}
        empty={<Empty title="No bookings yet" hint="Add a flight or a stay, or ask the assistant to." object="plane" />}
        columns={[
          { key: "what", label: "Booking", width: "wide" },
          { key: "status", label: "Status", kind: "select", tones: STATUS_TONES },
          { key: "cost", label: "Cost", kind: "money", align: "end" },
          { key: "when", label: "Date", kind: "date" },
          { key: "ref", label: "Reference" },
        ]}
      />
    </Page>
  );
}
