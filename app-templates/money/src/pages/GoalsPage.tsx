import { Fragment } from "react";
import { Button, Callout, formatINR, Empty, InlinePanel, Page, Progress, Section, Skeleton, useTable, label, isSample, SampleChip } from "../flock/ui";
import { RowPanel } from "./RowPanel";
import { GOAL_FIELDS, shortDate, type Goal, type Selected } from "./shared";

/** A goal past its target is a success, not an overspend: the bar stops at full and the label says reached. */
const labelOf = (g: Goal) => [g.goal, g.saved >= g.target ? (g.saved > g.target ? `reached · ${formatINR(g.saved - g.target, { compact: true })} over` : "reached") : null, g.by ? `by ${shortDate(g.by)}` : null].filter(Boolean).join(" · ");

export function GoalsPage({ selected, onSelect }: { selected: Selected; onSelect: (s: Selected) => void }) {
  const list = useTable<Goal>("goals", { sort: "by", limit: 100 });
  return (
    <Page title={label("title.goals", "Goals")} subtitle={list.rows.length ? `${list.rows.length} saving for` : undefined}>
      {list.error ? <Callout tone="danger" title="Couldn't load the goals">{list.error}</Callout>
        : list.loading && !list.rows.length ? <Skeleton variant="card" lines={3} />
        : !list.rows.length ? <Empty title="No goals yet" hint="Ask the assistant to set one up." object="receipt" />
        : (
          <Section>
            <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
              {list.rows.map((g) => (
                <Fragment key={g.id}>
                <div style={{ display: "flex", alignItems: "flex-end", gap: 8 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>{isSample(g) ? <SampleChip /> : null}<div className={isSample(g) ? "fl-sample-fade" : undefined}><Progress label={labelOf(g)} value={Math.min(g.saved, g.target)} limit={g.target} kind="compact" /></div></div>
                  <Button size="sm" variant="ghost" icon="pencil" onClick={() => onSelect(selected?.id === g.id ? null : { table: "goals", id: g.id, label: g.goal })}>Edit</Button>
                </div>
                {/* The goal opens in place, under its own bar. */}
                {selected?.table === "goals" && selected.id === g.id ? (
                  <InlinePanel label={g.goal} onClose={() => onSelect(null)}>
                    <RowPanel<Goal>
                      key={selected.id} table="goals" id={selected.id} noun="Goal" onClose={() => onSelect(null)}
                      heading={(x) => x.goal}
                      detail={(x) => [
                        { label: "Saved", value: x.saved, kind: "money" }, { label: "Target", value: x.target, kind: "money" }, { label: "By", value: x.by, kind: "date" },
                      ]}
                      fields={GOAL_FIELDS}
                    />
                  </InlinePanel>
                ) : null}
                </Fragment>
              ))}
            </div>
          </Section>
        )}
    </Page>
  );
}
