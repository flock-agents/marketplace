import { useState } from "react";
import { Button, Card, Confirm, Empty, Form, InlinePanel, Page, RowList, useTable, useToast, label } from "../flock/ui";
import { nextDue, normaliseReminder, repeatText, splitDue } from "./dates";
import { REPEATS, memberLabel, nowLocal, reminderFields, undo, whenLabel, type Member, type Reminder, type Selected } from "./shared";

/** One reminder's add or edit form: a date and a time, joined into `due` on save. */
function ReminderForm({ reminder, names, onSave, onCancel }: { reminder?: Reminder; names: string[]; onSave: (row: Partial<Reminder>) => Promise<void>; onCancel: () => void }) {
  const [errors, setErrors] = useState<Record<string, string>>({});
  const initial = reminder ? { ...reminder, ...splitDue(reminder.due) } : { date: nowLocal().slice(0, 10), repeat: "none" };
  const submit = async (values: Record<string, unknown>) => {
    const r = normaliseReminder(values, REPEATS);
    if (!r.ok) { setErrors(r.errors); return; }
    setErrors({});
    await onSave(r.row);
  };
  return <Form fields={[...reminderFields(names)]} initial={initial} errors={errors} submitLabel={reminder ? "Save" : "Add"} onSubmit={submit} onCancel={onCancel} />;
}

/** The family's reminders, the one due soonest first; one-offs already past at the end. */
export function RemindersPage({ selected, onSelect }: { selected: Selected; onSelect: (s: Selected) => void }) {
  const toast = useToast();
  const [adding, setAdding] = useState(false);
  const [asking, setAsking] = useState(false);
  const now = nowLocal();
  const list = useTable<Reminder>("reminders", { sort: "due", limit: 200 });
  const family = useTable<Member>("members", { sort: "name", limit: 100 });
  const names = family.rows.map((m) => m.name);
  const next = (r: Reminder) => nextDue(r, now);
  const rows = [...list.rows].sort((a, b) => (next(a) ?? "~").localeCompare(next(b) ?? "~") || a.due.localeCompare(b.due));   // "~" sorts after any date
  const picked = selected?.table === "reminders" ? list.rows.find((r) => r.id === selected.id) : undefined;
  const pick = (r: Reminder) => onSelect(selected?.id === r.id ? null : { table: "reminders", id: r.id, label: r.title });
  const add = async (row: Partial<Reminder>) => { await list.create(row); setAdding(false); };
  const remove = async (r: Reminder) => {
    setAsking(false);
    let changeId: string | undefined;
    try { changeId = await list.remove(r.id); } catch { return; }   // the hook already said why
    onSelect(null);
    toast.show({ message: `Deleted ${r.title}`, tone: "success", action: changeId ? { label: "Undo", onClick: () => undo(changeId!, () => toast.show({ message: "Couldn't undo", tone: "danger" })) } : undefined });
  };
  const due = list.rows.filter((r) => next(r)).length;
  return (
    <Page title={label("title.reminders", "Reminders")} subtitle={`${due} coming round`} actions={<Button variant="app" icon="plus" onClick={() => setAdding(true)}>Add</Button>}>
      {adding ? (
        <InlinePanel label="New reminder" onClose={() => setAdding(false)}>
          <Card title="New reminder"><ReminderForm names={names} onSave={add} onCancel={() => setAdding(false)} /></Card>
        </InlinePanel>
      ) : null}
      <RowList
        rows={rows} loading={list.loading} error={list.error} hasMore={list.hasMore} onLoadMore={list.loadMore}
        title={(r) => r.title}
        meta={(r) => [repeatText(r), memberLabel(r.who, family.rows) || "Everyone"].join(" · ")}
        trailing={(r) => { const n = next(r); return <span className="fc-next">{n ? whenLabel(n, now.slice(0, 10)) : "Done"}</span>; }}
        onRowClick={pick}
        empty={<Empty title="No reminders yet" hint="Add one, such as the dentist on Friday, or ask the assistant to." object="calendar" action={<Button onClick={() => setAdding(true)}>Add a reminder</Button>} />}
        // The picked reminder opens in place, under its row.
        expanded={picked ? {
          at: picked.id, label: `Edit ${picked.title}`, onClose: () => onSelect(null),
          content: (
            <Card title={`Edit ${picked.title}`} actions={<Button size="sm" variant="ghost" icon="trash" onClick={() => setAsking(true)}>Delete</Button>}>
              <ReminderForm key={picked.id} reminder={picked} names={names} onSave={async (row) => { await list.update(picked.id, row); onSelect(null); }} onCancel={() => onSelect(null)} />
              <Confirm open={asking} title="Delete this reminder?" body="You can undo it for a few seconds." confirmLabel="Delete" tone="danger" onConfirm={() => void remove(picked)} onCancel={() => setAsking(false)} />
            </Card>
          ),
        } : null}
      />
    </Page>
  );
}
