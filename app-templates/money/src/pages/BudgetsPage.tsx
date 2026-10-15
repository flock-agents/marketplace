import { Callout, Empty, Page, Progress, SampleChip, Section, Skeleton, isSample, label } from "../flock/ui";
import { monthName, thisMonth, useRoute, type BudgetLine } from "./shared";

export function BudgetsPage() {
  const { data, error } = useRoute<BudgetLine[]>("budget-status", ["transactions", "budgets"]);
  const over = (data ?? []).filter((b) => b.spent > b.limit).map((b) => b.category);
  return (
    <Page title={label("title.budgets", "Budgets")} subtitle={`${monthName(thisMonth(), true)} · spent against each limit`}>
      {over.length ? <Callout tone="danger" icon="triangle-alert" title="Over budget">{over.join(" and ")} {over.length > 1 ? "are" : "is"} past the limit this month.</Callout> : null}
      {error ? <Callout tone="danger" title="Couldn't load the budgets">{error}</Callout>
        : !data ? <Skeleton variant="card" lines={4} />
        : !data.length ? <Empty title="No budgets yet" hint="Ask the assistant to set a limit for each category." object="receipt" />
        : (
          <Section>
            <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
              {data.map((b, i) => <div key={`${b.category}-${i}`}>{isSample(b) ? <SampleChip /> : null}<div className={isSample(b) ? "fl-sample-fade" : undefined}><Progress label={b.category} value={b.spent} limit={b.limit} kind="money" /></div></div>)}
            </div>
          </Section>
        )}
    </Page>
  );
}
