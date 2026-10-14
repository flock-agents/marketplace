import { useState } from "react";
import { Button, Callout, Card, Empty, FilterPill, Form, Page, Search, StatStrip, Table, useTable, label } from "../flock/ui";
import { DealPanel } from "./DealPanel";
import { anyValue, cap, dueLast, fields, many, one, stageLabel, stageLabels, STAGES, STAGE_TONES, valueByStage, type Deal, type Selected } from "./shared";

export function TablePage({ selected, onSelect }: { selected: Selected; onSelect: (s: Selected) => void }) {
  const [stage, setStage] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [adding, setAdding] = useState(false);
  const list = useTable<Deal>("deals", { where: stage ? { stage } : undefined, sort: "due", q: q || undefined });
  const all = useTable<Deal>("deals", { limit: 500 });   // the numbers above the table ignore the filter
  const add = async (values: Record<string, any>) => { await list.create(values as Partial<Deal>); setAdding(false); };
  const titled = label("title.table", "All deals");
  const allTitle = titled === "All deals" ? `All ${many()}` : titled;   // follows a renamed noun unless the title itself was reworded
  return (
    <Page title={allTitle} subtitle={`${all.rows.length}${all.hasMore ? "+" : ""} ${all.rows.length === 1 && !all.hasMore ? one() : many()}`} actions={<Button variant="app" icon="plus" onClick={() => setAdding(true)}>Add</Button>}>
      {all.error ? <Callout tone="danger" title="Couldn't load the totals">{all.error}</Callout> : anyValue(all.rows) ? <StatStrip stats={valueByStage(all.rows)} /> : null}
      {selected?.table === "deals" ? <DealPanel key={selected.id} id={selected.id} onClose={() => onSelect(null)} onSelect={onSelect} /> : null}
      {adding ? (
        <Card title={`New ${one()}`}>
          <Form fields={[...fields()]} initial={{ stage: "Lead" }} submitLabel="Add" onSubmit={add} onCancel={() => setAdding(false)} />
        </Card>
      ) : null}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <Search value={q} onChange={setQ} placeholder={`Search ${many()}`} />
        <FilterPill label="Stage" options={STAGES.map(stageLabel)} value={stage ? stageLabel(stage) : null} onChange={(v) => setStage(v === null ? null : STAGES.find((s) => stageLabel(s) === v) ?? v)} />
      </div>
      <Table
        rows={dueLast(list.rows)} loading={list.loading} error={list.error} hasMore={list.hasMore} onLoadMore={list.loadMore}
        selectedId={selected?.table === "deals" ? selected.id : undefined}
        onRowClick={(d) => onSelect(selected?.id === d.id ? null : { table: "deals", id: d.id, label: d.title })}
        empty={<Empty title={`No ${many()}`} hint={q || stage ? "Nothing matches. Clear the search or the filter." : "Add one, or ask the assistant to."} object="briefcase" action={<Button onClick={() => setAdding(true)}>{`Add a ${one()}`}</Button>} />}
        columns={[
          { key: "title", label: cap(one()), width: "wide" },
          { key: "stage", label: "Stage", kind: "select", tones: STAGE_TONES, labels: stageLabels() },
          { key: "owner", label: "Owner", kind: "person" },
          ...(anyValue(all.rows) ? [{ key: "value" as const, label: "Value", kind: "money" as const, align: "end" as const }] : []),
          { key: "next_step", label: "Next step", width: "wide", phone: "hide" },
          { key: "due", label: "Due", kind: "date" },
        ]}
      />
    </Page>
  );
}
