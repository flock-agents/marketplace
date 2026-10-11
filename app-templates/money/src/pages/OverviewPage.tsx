import { Callout, Chart, Empty, ErrorCard, HeroStat, Page, RowList, Section, Skeleton, StatStrip, Value, useTable, label } from "../flock/ui";
import { overviewLead } from "./lead";
import { monthName, useRoute, type Holding, type MonthTotals, type Selected, type Transaction } from "./shared";

export function OverviewPage({ selected, onSelect }: { selected: Selected; onSelect: (s: Selected) => void }) {
  const holdings = useTable<Holding>("holdings", { limit: 200 });
  const recent = useTable<Transaction>("transactions", { sort: "-date", limit: 6 });
  const { data: months, error: monthsError } = useRoute<MonthTotals[]>("monthly-totals", ["transactions"]);
  const worth = holdings.rows.reduce((a, h) => a + h.value, 0), invested = holdings.rows.reduce((a, h) => a + h.invested, 0);
  const gain = invested ? ((worth - invested) / invested) * 100 : undefined;
  const now = months?.[months.length - 1];
  const lead = overviewLead(holdings.rows.length, now);
  const prev = months && months.length > 1 ? months[months.length - 2] : undefined;
  return (
    <Page title={label("title.overview", "Overview")} subtitle={now ? `${monthName(now.month, true)} so far` : undefined}>
      {holdings.error ? <ErrorCard title="Couldn't load your net worth" message={holdings.error} onRetry={holdings.refetch} />
        : holdings.loading && !holdings.rows.length ? <Skeleton variant="card" lines={2} />
        : lead.hero === "netWorth" ? <HeroStat
          label="Net worth" value={worth} kind="compact" delta={gain}
          caption={`${holdings.rows.length} ${holdings.rows.length === 1 ? "holding" : "holdings"} · change is since invested`}
        />
        : <HeroStat
          label={now ? `Spent in ${monthName(now.month, true)}` : "Spent this month"} value={now?.expenses ?? 0} kind="compact"
          caption={prev ? `${monthName(prev.month, true)}: ₹${prev.expenses.toLocaleString("en-IN")}` : "Add transactions to see this"}
        />}
      {monthsError ? <Callout tone="danger" title="Couldn't load this month's totals">{monthsError}</Callout> : null}
      {lead.strip.length ? (
        <StatStrip stats={[
          ...(lead.strip.includes("income") ? [{ label: "income", value: now!.income, kind: "compact" as const }] : []),
          ...(lead.strip.includes("spent") ? [{ label: "spent", value: now!.expenses, kind: "compact" as const }] : []),
          ...(lead.strip.includes("saved") ? [{ label: "saved", value: now!.income - now!.expenses, kind: "compact" as const, hint: "Income minus spending. Money put into investments counts as saved." }] : []),
        ]} />
      ) : null}
      <Section title="Income and spending">
        <Chart
          type="bar" kind="money"
          data={(months ?? []).map((m) => ({ label: monthName(m.month), income: m.income, expenses: m.expenses }))}
          series={[{ key: "income", label: "Income", tone: "success" }, { key: "expenses", label: "Spending", tone: "neutral" }]}
        />
      </Section>
      <Section title="Recent">
        <RowList
          rows={recent.rows} loading={recent.loading} error={recent.error}
          title={(t) => t.merchant}
          meta={(t) => t.category}
          trailing={(t) => <Value kind="signed" value={t.amount} />}
          onRowClick={(t) => onSelect(selected?.id === t.id ? null : { table: "transactions", id: t.id, label: t.merchant })}
          empty={<Empty title="No transactions yet" hint="Add one on the Transactions page, or ask the assistant." object="receipt" />}
        />
      </Section>
    </Page>
  );
}
