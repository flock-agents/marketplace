import { Empty, ErrorCard, Section, Table } from "../flock/ui";
import type { GoalLine, GoalStatus } from "../../server/today/goals";
import { useLive } from "./useLive";
import { whenText } from "./shared";

const DAYS = 7;
const TABLES = ["metrics", "events", "_settings"] as const;
const TONES: Partial<Record<GoalStatus, string>> = { done: "is-good", on_track: "is-good", to_go: "is-short", over: "is-over" };
type Day = { date: string; goals: GoalLine[] };

const amount = (n: number) => n.toLocaleString("en-IN", { maximumFractionDigits: 1 });

/** Every tracked goal that had a number in the week, in focus first: the table's columns. */
function trackedLabels(days: Day[]): GoalLine[] {
  const seen = new Map<string, GoalLine>();
  for (const d of days) for (const g of d.goals) if (g.current !== null && !seen.has(g.label)) seen.set(g.label, g);
  return [...seen.values()].sort((a, b) => Number(b.focus) - Number(a.focus));
}

/** One cell: the day's number, toned against its target when there is one; blank on a day nothing was logged. */
function Cell({ line }: { line: GoalLine | undefined }) {
  if (!line || line.current === null) return <span className="db-day-cell is-empty">–</span>;
  const title = line.target === null ? undefined : `Target ${amount(line.target)} ${line.unit}`;
  return <span className={`db-day-cell ${TONES[line.status] ?? ""}`} title={title}>{amount(line.current)}</span>;
}

/** The last week's finished days, every tracked number side by side. Today is not here: its numbers are still coming in. */
export function PastDays() {
  const { data, error, refetch } = useLive<{ days: Day[] }>(`days?days=${DAYS}`, TABLES);
  const days = data?.days ?? [];
  const columns = trackedLabels(days);
  const rows = days.map((d) => ({ id: d.date, ...Object.fromEntries(d.goals.map((g) => [g.label, g])) }) as Record<string, unknown> & { id: string });
  return (
    <Section title="Past days">
      {error ? <ErrorCard title="Couldn't load the past days" message={error} onRetry={refetch} />
        : data && columns.length === 0 ? <Empty title="Nothing logged in the past week" hint="Finished days show here, every tracked number side by side." object="globe" />
        : <Table density="compact" loading={!data} rows={rows} columns={[
            { key: "id", label: "Day", width: "narrow", render: (r: { id: string }) => whenText(r.id) },
            ...columns.map((g) => ({ key: g.label, label: `${g.label} (${g.unit})`, align: "end" as const, render: (r: Record<string, unknown>) => <Cell line={r[g.label] as GoalLine | undefined} /> })),
          ]} />}
    </Section>
  );
}
