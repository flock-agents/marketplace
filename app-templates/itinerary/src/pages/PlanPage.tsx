import { useState } from "react";
import { Button, Calendar, Card, Empty, Form, Icon, Page, Skeleton, ErrorCard, useTable, label } from "../flock/ui";
import { RowPanel } from "./RowPanel";
import { KIND_LOOK, PLAN_FIELDS, normaliseTime, today, type PlanItem, type Selected } from "./shared";

export function PlanPage({ selected, onSelect }: { selected: Selected; onSelect: (s: Selected) => void }) {
  const list = useTable<PlanItem>("plan", { sort: "day", limit: 200 });
  const [adding, setAdding] = useState(false);
  const add = async (v: Record<string, any>) => { await list.create({ ...v, time: normaliseTime(v.time) } as Partial<PlanItem>); setAdding(false); };
  return (
    <Page title={label("title.plan", "Plan")} subtitle={`${list.rows.length} ${list.rows.length === 1 ? "thing" : "things"}, day by day`} actions={<Button variant="app" icon="plus" onClick={() => setAdding(true)}>Add</Button>}>
      {adding ? (
        <Card title="New plan item">
          <Form
            fields={PLAN_FIELDS}
            initial={{ kind: "do" }} submitLabel="Add" onSubmit={add} onCancel={() => setAdding(false)}
          />
        </Card>
      ) : null}
      {selected?.table === "plan" ? (
        <RowPanel<PlanItem>
          key={selected.id} table="plan" id={selected.id} noun="Plan item" onClose={() => onSelect(null)}
          heading={(r) => r.title}
          detail={(r) => [
            { label: "Day", value: r.day, kind: "date" }, { label: "Time", value: r.time }, { label: "Kind", value: KIND_LOOK[r.kind]?.label ?? r.kind }, { label: "Detail", value: r.detail },
          ]}
          fields={PLAN_FIELDS}
          fromForm={(v) => ({ ...v, time: normaliseTime(v.time) }) as Partial<PlanItem>}
        />
      ) : null}
      {list.error ? <ErrorCard title="Couldn't load the plan" message={list.error} onRetry={list.refetch} />
        : list.loading && !list.rows.length ? <Skeleton variant="card" lines={5} />
        : !list.rows.length ? <Empty title="Nothing planned yet" hint="Add a flight, a stay or a dinner, or ask the assistant to." object="plane" />
        : (
          <Calendar
            view="timeline" rows={list.rows} today={today()}
            date={(r) => r.day} time={(r) => r.time ?? ""} tone={(r) => KIND_LOOK[r.kind]?.tone ?? "neutral"}
            onSelect={(r) => onSelect(selected?.id === r.id ? null : { table: "plan", id: r.id, label: r.title })}
            title={(r) => (
              <span style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "6px 10px", minWidth: 0, width: "100%" }}>
                <span style={{ display: "flex", flexDirection: "column", minWidth: 0, flex: "1 1 190px" }}>
                  <b style={{ fontWeight: 550, display: "flex", alignItems: "center", gap: 7 }}>
                    <span style={{ color: "var(--ink-3)", display: "inline-flex", flex: "none" }}><Icon name={KIND_LOOK[r.kind]?.icon ?? "sun"} size={14} /></span>
                    {r.title}
                  </b>
                  {r.detail ? <small style={{ color: "var(--ink-3)", fontSize: 12.5 }}>{r.detail}</small> : null}
                </span>
              </span>
            )}
          />
        )}
    </Page>
  );
}
