import { useState } from "react";
import { Button, Card, Chart, Empty, ErrorCard, Form, Page, RowList, Section, Skeleton, StatStrip, Tabs, Value, useTable, label } from "../flock/ui";
import { EVENT_FIELDS, KIND_TONES, deltaOf, kindOf, latestPerLabel, localDate, statValue, whenText, type DashEvent, type Metric } from "./shared";
import { useDelete } from "./useDelete";

export function OverviewPage() {
  const [picked, setPicked] = useState<string | null>(null);
  const [editing, setEditing] = useState<DashEvent | null>(null);
  // The page reads the newest 500 readings; a label with no reading among them drops off the strip, so agents post every label together.
  const metrics = useTable<Metric>("metrics", { sort: "-created_at", limit: 500 });
  const events = useTable<DashEvent>("events", { sort: "-at", limit: 8 });
  const delEvent = useDelete<DashEvent>(events.remove, "event", (e) => e.title);
  const delReading = useDelete<Metric>(metrics.remove, "reading", (m) => `${m.label} ${m.value}`);
  if (metrics.error) return <Page title={label("title.overview", "Dashboard")}><ErrorCard title="Couldn't load the numbers" message={metrics.error} onRetry={metrics.refetch} /></Page>;
  if (metrics.loading && metrics.rows.length === 0) return <Page title={label("title.overview", "Dashboard")}><Skeleton variant="card" lines={5} /></Page>;
  const latest = latestPerLabel(metrics.rows).slice(0, 5);
  const shown = latest.find((m) => m.label === picked)?.label ?? latest[0]?.label;
  const mine = metrics.rows.filter((m) => m.label === shown);   // newest first
  const trend = [...mine].reverse();                            // oldest first for the line
  const unit = mine[0]?.unit ?? null;
  const perDay = new Map<string, number>();
  for (const m of trend) perDay.set(localDate(m.created_at), (perDay.get(localDate(m.created_at)) ?? 0) + 1);
  const pointLabel = (m: Metric) => whenText(m.created_at, (perDay.get(localDate(m.created_at)) ?? 0) > 1);   // the time only when a day has several points
  const newest = latest.reduce((a, m) => (m.created_at > a ? m.created_at : a), "");
  const k = kindOf(unit);
  return (
    <Page title={label("title.overview", "Dashboard")} subtitle={newest ? `Updated ${whenText(newest)}` : undefined}>
      {latest.length >= 2 ? (
        <StatStrip stats={latest.map((m) => ({ label: m.label, ...statValue(m), delta: deltaOf(metrics.rows, m.label) ?? undefined, hint: m.unit ? `in ${m.unit}` : undefined }))} />
      ) : null}
      {latest.length === 0 ? <Empty title="No numbers yet" hint="Ask the assistant to start posting readings, or add a row to metrics." object="globe" /> : (
        <>
          <Section title="Trend">
            {latest.length > 1 ? <Tabs tabs={latest.map((m) => ({ id: m.label, label: m.label }))} value={shown!} onChange={setPicked} /> : null}
            <Chart type="line" kind={k === "number" ? undefined : k} data={trend.map((m) => ({ label: pointLabel(m), [shown!]: m.value }))} series={[{ key: shown!, label: shown!, tone: "accent" }]} />
          </Section>
          <Section title={`${shown} readings`}>
            <RowList
              rows={mine.slice(0, 5)}
              title={(m) => { const s = statValue(m); return <Value kind={s.kind ?? (typeof s.value === "number" ? "number" : "text")} value={s.value} />; }}
              meta={(m) => whenText(m.created_at)}
              trailing={(m) => <Button size="sm" variant="ghost" icon="trash" onClick={() => delReading.ask(m)}>Delete</Button>}
            />
          </Section>
        </>
      )}
      <Section title="Recent">
        <div className="db-recent"><RowList
          rows={events.rows} loading={events.loading} error={events.error}
          // Edit opens in place, under the event's own row.
          expanded={editing ? {
            at: editing.id, label: `Edit ${editing.title}`, onClose: () => setEditing(null),
            content: (
              <Card title="Edit event">
                <Form fields={[...EVENT_FIELDS]} initial={{ ...editing }} onCancel={() => setEditing(null)} onSubmit={async (v) => { await events.update(editing.id, v as Partial<DashEvent>); setEditing(null); }} />
              </Card>
            ),
          } : null}
          title={(e) => e.title}
          meta={(e) => whenText(e.at)}
          trailing={(e) => (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
              <Value kind="select" value={e.kind ?? "Note"} tones={KIND_TONES} />
              <Button size="sm" variant="ghost" icon="pencil" onClick={() => setEditing(e)}>Edit</Button>
              <Button size="sm" variant="ghost" icon="trash" onClick={() => delEvent.ask(e)}>Delete</Button>
            </span>
          )}
          empty={<Empty title="Nothing has happened yet" hint="Events the assistant posts show up here." object="globe" />}
        /></div>
      </Section>
      {delEvent.dialog}{delReading.dialog}
    </Page>
  );
}
