import { useMemo, useState } from "react";
import { Button, Card, Empty, FilterPill, Form, InlinePanel, Page, Search, StatStrip, Table, label, useTable } from "../flock/ui";
import { FIELDS, STATUSES, STATUS_TONES, PRIORITY_TONES, today, type Item } from "./shared";

export function ListPage({ onOpen }: { onOpen: (row: { id: string; title: string }) => void }) {
  const [status, setStatus] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [adding, setAdding] = useState(false);
  const list = useTable<Item>("items", { where: status ? { status } : undefined, sort: "due", q: q || undefined });
  const all = useTable<Item>("items", { limit: 500 });   // the numbers above the list ignore the filter
  const t = today(), weekAhead = today(7);
  const open = all.rows.filter((r) => r.status !== "Done");
  // The numbers come from the first 500 rows. Past that they read "500+" rather than pretend to be exact.
  const n = (count: number): string | number => (all.hasMore ? `${count}+` : count);
  const stats = [
    { label: "open", value: n(open.length) },
    { label: "waiting", value: n(all.rows.filter((r) => r.status === "Waiting").length) },
    { label: "overdue", value: n(open.filter((r) => r.due && r.due < t).length) },
    { label: "due this week", value: n(open.filter((r) => r.due && r.due >= t && r.due <= weekAhead).length) },
  ];
  // Open rows first (by due date, as the server sorted them), Done last.
  const rows = useMemo(() => [...list.rows.filter((r) => r.status !== "Done"), ...list.rows.filter((r) => r.status === "Done")], [list.rows]);
  const add = async (values: Record<string, any>) => { await list.create(values as Partial<Item>); setAdding(false); };
  return (
    <Page title={label("title.list", "Tracker")} subtitle={`${all.hasMore ? `${all.rows.length}+` : all.rows.length} in the list`} actions={<Button variant="app" icon="plus" onClick={() => setAdding(true)}>Add</Button>}>
      {adding ? (
        <InlinePanel label="New row" onClose={() => setAdding(false)}>
          <Card title="New row">
            <Form fields={[...FIELDS]} initial={{ status: "New", priority: "Normal" }} submitLabel="Add" onSubmit={add} onCancel={() => setAdding(false)} />
          </Card>
        </InlinePanel>
      ) : null}
      <StatStrip stats={stats} />
      <div className="row" style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <Search value={q} onChange={setQ} placeholder="Search the list" />
        <FilterPill label="Status" options={STATUSES} value={status} onChange={setStatus} />
      </div>
      <Table
        rows={rows} loading={list.loading} error={list.error} hasMore={list.hasMore} onLoadMore={list.loadMore}
        onRowClick={(row) => onOpen(row as Item)}
        empty={<Empty title="Nothing here yet" hint={q || status ? "Nothing matches. Clear the search or the filter." : "Add the first row, or ask the assistant to."} object="clipboard" action={<Button onClick={() => setAdding(true)}>Add a row</Button>} />}
        columns={[
          { key: "title", label: "Title", width: "wide" },
          { key: "status", label: "Status", kind: "select", tones: STATUS_TONES },
          { key: "owner", label: "Owner", kind: "person" },
          { key: "due", label: "Due", kind: "date" },
          { key: "priority", label: "Priority", kind: "select", tones: PRIORITY_TONES },
        ]}
      />
    </Page>
  );
}
