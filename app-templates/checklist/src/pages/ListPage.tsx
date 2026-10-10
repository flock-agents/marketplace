import { useState } from "react";
import { Button, Checklist, Empty, ErrorCard, FilterPill, Page, Skeleton, useTable, label, isSample } from "../flock/ui";
import { ManageItems } from "./ManageItems";
import { formatDue, orderTasks, type Task } from "./shared";

export function ListPage() {
  const [who, setWho] = useState<string | null>(null);
  const [managing, setManaging] = useState(false);
  const list = useTable<Task>("tasks", { limit: 500, sort: "created_at" });
  if (list.error) return <Page title={label("title.list", "Checklist")}><ErrorCard title="Couldn't load the list" message={list.error} onRetry={list.refetch} /></Page>;
  if (list.loading && list.rows.length === 0) return <Page title={label("title.list", "Checklist")}><Skeleton variant="card" lines={6} /></Page>;
  const people = [...new Set(list.rows.map((r) => r.who).filter((w): w is string => !!w))].sort();
  const shown = who ? list.rows.filter((r) => r.who === who) : list.rows;
  const left = shown.filter((r) => !r.done).length;   // agrees with the progress bar, which counts what is shown
  const lastGroup = list.rows[list.rows.length - 1]?.group_name ?? "General";
  return (
    <Page title={label("title.list", "Checklist")} subtitle={left === 0 && shown.length ? "All done" : `${left} to go`}
      actions={list.rows.length ? <Button variant="soft" icon={managing ? "check" : "pencil"} onClick={() => setManaging(!managing)}>{managing ? "Done editing" : "Edit items"}</Button> : undefined}>
      {people.length > 0 ? (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <FilterPill label="Who" options={people} value={who} onChange={setWho} />
        </div>
      ) : null}
      {list.rows.length === 0 ? <Empty title="Nothing on the list yet" hint="Add the first item below, or ask the assistant to make the list." object="notebook" /> : null}
      {managing ? <ManageItems rows={shown} update={list.update} remove={list.remove} /> : <Checklist
        grouped showProgress
        items={orderTasks(shown).map((r) => ({ id: r.id, label: r.label, done: !!r.done, group: r.group_name ?? "General", meta: [r.who, formatDue(r.due, !!r.done)].filter(Boolean).join(" · ") || undefined, sample: isSample(r) }))}
        onToggle={(id, done) => { void list.update(id, { done }).catch(() => {}); }}
        onAdd={(label, group) => { void list.create({ label, group_name: group ?? lastGroup, done: false, who }).catch(() => {}); }}
      />}
    </Page>
  );
}
