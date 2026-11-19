import { useState } from "react";
import { Button, Card, DateRange, Empty, Field, Form, Row, RowList, Stack, useTable, type FormProps } from "../flock/ui";
import { dayLabel, todayStr, WEEKDAYS } from "../../server/dates";
import { EVERY, KEEPS } from "../../server/db/constants";
import { pausedNow, regularText, textList } from "./format";
import type { RegularRow } from "./shared";

const EVERY_LABELS: Record<string, string> = { day: "Every day", week: "Some times a week", weekdays: "On chosen days" };
const KEEPS_LABELS: Record<string, string> = { fresh: "Fresh: bought for the days it is needed", long: "Keeps long: bought once, in the week's first order" };
const FIELDS: FormProps["fields"] = [
  { type: "text", name: "item", label: "Item", required: true },
  { type: "number", name: "amount", label: "How much each time", required: true },
  { type: "text", name: "unit", label: "Unit", required: true, placeholder: "l, g, pc, pack" },
  { type: "select", name: "every", label: "How often", required: true, options: [...EVERY], optionLabels: EVERY_LABELS },
  { type: "number", name: "times_per_week", label: "Times a week (for some times a week)" },
  { type: "multi", name: "weekdays", label: "Days (for chosen days)", options: [...WEEKDAYS] },
  { type: "text", name: "for_whom", label: "For whom (leave empty for the house)" },
  { type: "select", name: "keeps", label: "How long it keeps", options: [...KEEPS], optionLabels: KEEPS_LABELS },
];

/** What the form holds, as the row to save. The same checks as the assistant's own route: a refusal is shown under the form. */
function rowOf(v: Record<string, unknown>): Partial<RegularRow> {
  const amount = v.amount as number, times = v.times_per_week == null ? null : (v.times_per_week as number), days = (v.weekdays as string[] | null) ?? [];
  if (!(amount > 0)) throw new Error("How much must be a number above 0.");
  if (v.every === "week" && times != null && !(Number.isInteger(times) && times >= 1 && times <= 7)) throw new Error("Times a week must be a whole number from 1 to 7.");
  if (v.every === "weekdays" && !days.length) throw new Error("Pick at least one day.");
  return {
    item: String(v.item).trim(), amount, unit: String(v.unit).trim(), every: String(v.every),
    times_per_week: v.every === "week" ? times ?? 1 : null, weekdays: v.every === "weekdays" ? JSON.stringify(days) : null,
    for_whom: v.for_whom ? String(v.for_whom).trim() || null : null, keeps: v.keeps ? String(v.keeps) : "fresh",
  };
}

/** The everyday items: how much and how often, whether each is being ordered, a pause for a holiday, and an edit form. All
 *  of it opens under the item's own row. A change here rebuilds the orders not yet placed. */
export function EverydayItems() {
  const list = useTable<RegularRow>("regulars", { sort: "item", limit: 200 });
  const today = todayStr();
  const [open, setOpen] = useState<{ id: string; what: "edit" | "pause" } | null>(null);
  const [until, setUntil] = useState<string | null>(null);
  const picked = open ? list.rows.find((r) => r.id === open.id) : undefined;
  const toggle = (r: RegularRow, what: "edit" | "pause") => {
    if (open?.id === r.id && open.what === what) { setOpen(null); return; }
    setUntil(pausedNow(r, today) ? r.paused_until : null); setOpen({ id: r.id, what });
  };
  // The hook says why when a save fails, and puts the row back.
  const patch = async (r: RegularRow, values: Partial<RegularRow>, close = true) => { try { await list.update(r.id, values); if (close) setOpen(null); } catch { /* told already */ } };
  const name = (r: RegularRow) => (r.for_whom ? `${r.item} (for ${r.for_whom})` : r.item);

  return (
    <div className="pl-lines">
    <RowList
      rows={list.rows} loading={list.loading} error={list.error} hasMore={list.hasMore} onLoadMore={list.loadMore}
      title={name}
      meta={(r) => (r.active ? regularText(r, today) : `${regularText(r, today)} · not being ordered`)}
      trailing={(r) => (
        <>
          <Field type="checkbox" name={`active-${r.id}`} label="Order it" value={!!r.active} onChange={(v) => void patch(r, { active: v === true ? 1 : 0 }, false)} />
          <Button size="sm" variant="ghost" icon="pause" onClick={() => toggle(r, "pause")}>{pausedNow(r, today) ? "Paused" : "Pause"}</Button>
          <Button size="sm" variant="ghost" icon="pencil" onClick={() => toggle(r, "edit")}>Edit</Button>
        </>
      )}
      empty={<Empty title="No everyday items yet" hint="Tell the assistant what you buy again and again, like milk every day or bread twice a week." object="grocery-bag" />}
      expanded={picked && open ? {
        at: picked.id, label: `${open.what === "edit" ? "Edit" : "Pause"} ${picked.item}`, onClose: () => setOpen(null),
        content: open.what === "edit" ? (
          <Card title={`Edit ${name(picked)}`}>
            <Form key={picked.id} fields={FIELDS} initial={{ ...picked, weekdays: textList(picked.weekdays) }} onCancel={() => setOpen(null)}
              onSubmit={async (v) => { await list.update(picked.id, rowOf(v)); setOpen(null); }} />
          </Card>
        ) : (
          <Card title={`Pause ${name(picked)}`} meta="It is left off the orders from today up to and including the day you pick, for a holiday or a trip.">
            <Stack gap="md">
              {/* The pause always starts today: only the last day is picked. */}
              <DateRange from={today} to={until} presets={[]} onChange={(r) => setUntil(r.to && r.to >= today ? r.to : null)} />
              <Row>
                <Button disabled={!until} onClick={() => void patch(picked, { paused_until: until })}>{until ? `Pause until ${dayLabel(until)}` : "Pick the last day"}</Button>
                {pausedNow(picked, today) ? <Button variant="soft" onClick={() => void patch(picked, { paused_until: null })}>Order it again now</Button> : null}
                <Button variant="ghost" onClick={() => setOpen(null)}>Cancel</Button>
              </Row>
            </Stack>
          </Card>
        ),
      } : null}
    />
    </div>
  );
}
