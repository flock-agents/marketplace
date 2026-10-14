import { Empty, ErrorCard, Page, Progress, SampleChip, Section, Skeleton, StatStrip, isSample, useTable, label } from "../flock/ui";
import type { BudgetRow } from "./shared";

export function BudgetPage() {
  const list = useTable<BudgetRow>("trip_budget", { limit: 100 });
  const spent = list.rows.reduce((n, r) => n + (r.spent ?? 0), 0);
  const limit = list.rows.reduce((n, r) => n + r.limit_amount, 0);
  return (
    <Page title={label("title.budget", "Budget")} subtitle="Spent against what we planned for each part of the trip">
      {list.error ? <ErrorCard title="Couldn't load the budget" message={list.error} onRetry={list.refetch} />
        : list.loading && !list.rows.length ? <Skeleton variant="card" lines={4} />
        : !list.rows.length ? <Empty title="No budget yet" hint="Ask the assistant to set a limit for flights, stay and food." object="plane" />
        : (
          <>
            <StatStrip stats={[
              { label: "spent", value: spent, kind: "money" },
              { label: "planned", value: limit, kind: "money" },
              { label: limit >= spent ? "left" : "over", value: Math.abs(limit - spent), kind: "money" },
            ]} />
            <Section>
              <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
                {list.rows.map((r) => <div key={r.id}>{isSample(r) ? <SampleChip /> : null}<div className={isSample(r) ? "fl-sample-fade" : undefined}><Progress label={r.category} value={r.spent ?? 0} limit={r.limit_amount} kind="money" /></div></div>)}
              </div>
            </Section>
          </>
        )}
    </Page>
  );
}
