import { useState } from "react";
import { Button, Card, DateRange, Empty, FilterPill, Form, InlinePanel, Page, Search, Table, useTable, label } from "../flock/ui";
import { RowPanel } from "./RowPanel";
import { CATEGORIES, TRANSACTION_FIELDS, toTransaction, type Selected, type Transaction } from "./shared";

export function TransactionsPage({ selected, onSelect }: { selected: Selected; onSelect: (s: Selected) => void }) {
  const [range, setRange] = useState<{ from: string | null; to: string | null }>({ from: null, to: null });
  const [category, setCategory] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [adding, setAdding] = useState(false);
  const where: Record<string, string> = {};
  if (category) where.category = category;
  if (range.from) where["date[gte]"] = range.from;
  if (range.to) where["date[lte]"] = range.to;
  const list = useTable<Transaction>("transactions", { where, sort: "-date", q: q || undefined });
  const add = async (v: Record<string, any>) => {
    await list.create(toTransaction(v));
    setAdding(false);
  };
  const filtered = !!(q || category || range.from || range.to);
  return (
    <Page title={label("title.transactions", "Transactions")} actions={<Button variant="app" icon="plus" onClick={() => setAdding(true)}>Add</Button>}>
      {adding ? (
        <InlinePanel label="New transaction" onClose={() => setAdding(false)}>
          <Card title="New transaction">
            <Form
              fields={TRANSACTION_FIELDS}
              initial={{ direction: "Spent" }} submitLabel="Add" onSubmit={add} onCancel={() => setAdding(false)}
            />
          </Card>
        </InlinePanel>
      ) : null}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <Search value={q} onChange={setQ} placeholder="Search merchants" />
        <FilterPill label="Category" options={CATEGORIES} value={category} onChange={setCategory} />
        <DateRange from={range.from} to={range.to} onChange={setRange} presets={["this-month", "last-30", "this-year"]} />
      </div>
      <Table
        // The picked row opens in place, under the row itself.
        expanded={selected?.table === "transactions" ? {
          at: selected.id, label: selected.label, onClose: () => onSelect(null),
          content: (
            <RowPanel<Transaction>
              key={selected.id} table="transactions" id={selected.id} noun="Transaction" onClose={() => onSelect(null)}
              heading={(t) => t.merchant}
              detail={(t) => [
                { label: "Date", value: t.date, kind: "date" }, { label: "Amount", value: t.amount, kind: "signed" },
                { label: "Category", value: t.category },
              ]}
              fields={TRANSACTION_FIELDS}
              toForm={(t) => ({ ...t, direction: t.amount > 0 ? "Received" : "Spent", amount: Math.abs(t.amount) })}
              fromForm={toTransaction}
            />
          ),
        } : null}
        rows={list.rows} loading={list.loading} error={list.error} hasMore={list.hasMore} onLoadMore={list.loadMore}
        selectedId={selected?.table === "transactions" ? selected.id : undefined}
        onRowClick={(t) => onSelect(selected?.id === t.id ? null : { table: "transactions", id: t.id, label: t.merchant })}
        empty={<Empty title="No transactions" hint={filtered ? "Nothing matches. Clear the search or the filters." : "Add one, or ask the assistant to."} object="receipt" />}
        columns={[
          { key: "date", label: "Date", kind: "date" },
          { key: "merchant", label: "Merchant", width: "wide" },
          { key: "category", label: "Category" },
          { key: "amount", label: "Amount", kind: "signed", align: "end" },
        ]}
      />
    </Page>
  );
}
