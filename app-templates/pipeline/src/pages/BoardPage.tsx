import { useState } from "react";
import { Board, Button, Callout, Card, Empty, Form, InlinePanel, Page, Skeleton, StatStrip, Value, useTable, label } from "../flock/ui";
import { DealPanel } from "./DealPanel";
import { anyValue, cap, fields, many, one, stageLabel, STAGES, STAGE_TONES, valueByStage, type Deal, type Selected } from "./shared";

export function BoardPage({ selected, onSelect }: { selected: Selected; onSelect: (s: Selected) => void }) {
  const list = useTable<Deal>("deals", { limit: 500 });
  const [adding, setAdding] = useState(false);
  const onBoard = list.rows.filter((d) => STAGES.includes(d.stage));   // a deal with an unknown stage has no lane
  const add = async (values: Record<string, any>) => { await list.create(values as Partial<Deal>); setAdding(false); };
  return (
    <Page title={label("title.board", "Deals")} subtitle={`${onBoard.length}${list.hasMore ? "+" : ""} ${onBoard.length === 1 && !list.hasMore ? one() : many()}`} actions={<Button variant="app" icon="plus" onClick={() => setAdding(true)}>Add</Button>} width="full">
      {adding ? (
        <InlinePanel label={`New ${one()}`} onClose={() => setAdding(false)}>
          <Card title={`New ${one()}`}>
            <Form fields={[...fields()]} initial={{ stage: "Lead" }} submitLabel="Add" onSubmit={add} onCancel={() => setAdding(false)} />
          </Card>
        </InlinePanel>
      ) : null}
      {anyValue(list.rows) ? <StatStrip stats={valueByStage(list.rows)} /> : null}
      {list.error ? <Callout tone="danger" title={`Couldn't load the ${many()}`}>{list.error}</Callout>
        : list.loading && !list.rows.length ? <Skeleton variant="card" lines={4} />
        : list.rows.length === 0 ? (
        <Empty title={`No ${many()} yet`} hint="Add the first one, or ask the assistant to." object="briefcase" action={<Button onClick={() => setAdding(true)}>{`Add a ${one()}`}</Button>} />
      ) : (
        <Board
          // The picked card opens in place, under the card in its column.
          expanded={selected?.table === "deals" ? {
            at: selected.id, label: selected.label, onClose: () => onSelect(null),
            content: (
              <DealPanel key={selected.id} id={selected.id} onClose={() => onSelect(null)} onSelect={onSelect} />
            ),
          } : null}
          columns={STAGES.map((s) => ({ id: s, label: stageLabel(s), tone: STAGE_TONES[s as keyof typeof STAGE_TONES] }))}
          rows={list.rows}
          columnOf={(d) => d.stage}
          onMove={(d, to) => { void list.update(d.id, { stage: to }).catch(() => {}); }}
          onCardClick={(d) => onSelect(selected?.id === d.id ? null : { table: "deals", id: d.id, label: d.title })}
          card={(d: Deal) => (
            <div style={{ display: "grid", gap: 4 }}>
              <b>{d.title}</b>
              {d.value !== null && d.value !== undefined ? <Value kind="compact" value={d.value} /> : null}
              {d.next_step ? <span>{d.next_step}</span> : null}
              <span style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <Value kind="person" value={d.owner} />
                <Value kind="date" value={d.due} />
              </span>
            </div>
          )}
        />
      )}
    </Page>
  );
}
