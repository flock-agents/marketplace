import { Chart, Empty, Page, Section, StatStrip, Table, useTable, label } from "../flock/ui";
import { RowPanel } from "./RowPanel";
import { HOLDING_FIELDS, withChange, type Holding, type Selected } from "./shared";

export function InvestmentsPage({ selected, onSelect }: { selected: Selected; onSelect: (s: Selected) => void }) {
  const list = useTable<Holding>("holdings", { sort: "-value", limit: 200 });
  const byKind = new Map<string, number>();
  for (const h of list.rows) byKind.set(h.kind, (byKind.get(h.kind) ?? 0) + h.value);
  const worth = list.rows.reduce((a, h) => a + h.value, 0), invested = list.rows.reduce((a, h) => a + h.invested, 0);
  return (
    <Page title={label("title.investments", "Investments")} subtitle={`${list.rows.length} ${list.rows.length === 1 ? "holding" : "holdings"}`}>
      {list.rows.length ? (
        <StatStrip stats={[
          { label: "worth today", value: worth, kind: "compact" },
          { label: "invested", value: invested, kind: "compact" },
          { label: "gain", value: worth - invested, kind: "compact" },
        ]} />
      ) : null}
      <Section title="Where the money is">
        <Chart type="share" kind="compact" data={[...byKind].sort((a, b) => b[1] - a[1]).map(([label, value]) => ({ label, value }))} series={[{ key: "value", label: "Value" }]} />
      </Section>
      {selected?.table === "holdings" ? (
        <RowPanel<Holding>
          key={selected.id} table="holdings" id={selected.id} noun="Holding" onClose={() => onSelect(null)}
          heading={(h) => h.name}
          detail={(h) => [
            { label: "Kind", value: h.kind }, { label: "Invested", value: h.invested, kind: "money" }, { label: "Worth today", value: h.value, kind: "money" },
          ]}
          fields={HOLDING_FIELDS}
        />
      ) : null}
      <Table
        rows={list.rows.map(withChange)} loading={list.loading} error={list.error}
        selectedId={selected?.table === "holdings" ? selected.id : undefined}
        onRowClick={(h) => onSelect(selected?.id === h.id ? null : { table: "holdings", id: h.id, label: h.name })}
        empty={<Empty title="No investments yet" hint="Ask the assistant to add what you hold." object="receipt" />}
        columns={[
          { key: "name", label: "Holding", width: "wide" },
          { key: "kind", label: "Kind" },
          { key: "invested", label: "Invested", kind: "compact", align: "end" },
          { key: "value", label: "Value", kind: "compact", align: "end" },
          { key: "change", label: "Change", kind: "percent", align: "end" },
        ]}
      />
    </Page>
  );
}
