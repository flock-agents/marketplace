import { useState } from "react";
import { Bullets, Button, Callout, Card, Confirm, Detail, Empty, ErrorCard, Field, Form, Heading, InlinePanel, Page, Section, Skeleton, Stack, label, useToast, type FormProps } from "../flock/ui";
import { clockText, WEEKDAYS } from "../../server/dates";
import { APP_NAMES, GROCERY_APPS, GROUPS, RULE_KINDS, SLOTS } from "../../server/db/constants";
import { RowsEditor } from "./RowsEditor";
import { profileWaiting } from "./format";
import { joined, send, typedList, useLive, why, type Family, type PersonRow } from "./shared";

const GROUP_LABELS: Record<string, string> = { child: "Child", adult: "Adult", elder: "Elder" };
const RULE_LABELS: Record<string, string> = { veg: "Vegetarian", egg: "Eggs, no meat", fasting: "Fasting", no_onion_garlic: "No onion or garlic", other: "Other" };
/** A person's own words, kept as they said them. The name is asked only for a new person: it is how a person is found. */
const PERSON_WORDS: FormProps["fields"] = [
  { type: "text", name: "relationship", label: "Relationship", placeholder: "wife, son, father" },
  { type: "select", name: "group", label: "Age group", required: true, options: [...GROUPS], optionLabels: GROUP_LABELS },
  { type: "text", name: "portions", label: "Portions", placeholder: "3 rotis at dinner" },
  { type: "text", name: "diet", label: "Diet" },
  { type: "text", name: "allergies", label: "Allergies" },
  { type: "text", name: "dislikes", label: "Dislikes" },
  { type: "text", name: "targets", label: "Targets", placeholder: "more protein, 1800 kcal" },
  { type: "longtext", name: "note", label: "Note" },
];
const PERSON_NAMES = PERSON_WORDS.map((f) => f.name);
const NEW_PERSON: FormProps["fields"] = [{ type: "text", name: "name", label: "Name", required: true }, ...PERSON_WORDS];
const COOK_FIELDS: FormProps["fields"] = [
  { type: "text", name: "name", label: "Name", required: true },
  { type: "multi", name: "days", label: "Days they come", options: [...WEEKDAYS] },
  { type: "text", name: "arrival", label: "Arrives at (24-hour time)", required: true, placeholder: "07:30" },
  { type: "text", name: "makes_well", label: "Makes well" },
  { type: "longtext", name: "note", label: "Note" },
];
/** The fields of a form as the routes take them: an emptied field is sent as null, which clears it. */
const cleared = (v: Record<string, unknown>, names: readonly string[]) => Object.fromEntries(names.map((n) => [n, v[n] ?? null]));

/** The family's profile: who eats at home, the house rules, the cook, the extra meals, the meals ordered in every week and
 *  the grocery app. Every part is edited where it is shown, through the same routes (and the same checks) as the assistant. */
export function FamilyPage() {
  const family = useLive<Family>("family", ["people", "house", "_settings"]);
  const toast = useToast();
  const [editing, setEditing] = useState<string | null>(null);
  const [removing, setRemoving] = useState<PersonRow | null>(null);
  if (family.error && !family.data) return <Page title={label("title.family", "Family")}><ErrorCard title="Couldn't load the family" message={family.error} onRetry={() => void family.refetch()} /></Page>;
  if (!family.data) return <Page title={label("title.family", "Family")}><Skeleton variant="card" lines={6} /></Page>;
  const { people, house, grocery_app } = family.data;

  const close = () => setEditing(null);
  /** Save through one of the family routes, then show what the app now holds. A refusal is thrown to the form that asked. */
  const save = async (path: string, body: object) => { await send(path, body); close(); void family.refetch(); };
  const edit = (key: string) => <Button size="sm" variant="soft" icon="pencil" onClick={() => setEditing(editing === key ? null : key)}>Edit</Button>;
  const removePerson = async (p: PersonRow) => {
    setRemoving(null);
    try { await send("family/people", { name: p.name, remove: true }); void family.refetch(); toast.show({ message: `${p.name} is no longer in the family`, tone: "success" }); }
    catch (e) { toast.show({ message: `Couldn't save: ${why(e)}`, tone: "danger" }); }
  };
  const setGroceryApp = async (app: unknown) => {
    if (!app || app === grocery_app) return;
    try { await send("_app/settings", { grocery_app: app }, "PATCH"); void family.refetch(); toast.show({ message: `New orders go to ${APP_NAMES[app as keyof typeof APP_NAMES] ?? app}`, tone: "success" }); }
    catch (e) { toast.show({ message: `Couldn't change the grocery app: ${why(e)}`, tone: "danger" }); }
  };
  const slotNames = [...SLOTS, ...house.extra_slots.map((s) => s.name)];

  return (
    <Page title={label("title.family", "Family")} subtitle="What the assistant plans the meals and the orders from">
      {profileWaiting(house) ? (
        <Callout tone="info">Your profile from the old Meal Planner was kept. The assistant turns it into this page on its next weekly run; tell it to do it now.</Callout>
      ) : null}
      <Section title="People" actions={<Button size="sm" variant="app" icon="plus" onClick={() => setEditing(editing === "add-person" ? null : "add-person")}>Add</Button>}>
        {editing === "add-person" ? (
          <InlinePanel label="Add a person" onClose={close} className="pl-panel">
            <Stack gap="md">
              <Heading level={3}>Add a person</Heading>
              <Form fields={NEW_PERSON} initial={{ group: "adult" }} submitLabel="Add" onCancel={close}
                onSubmit={(v) => save("family/people", { name: v.name, ...cleared(v, PERSON_NAMES) })} />
            </Stack>
          </InlinePanel>
        ) : null}
        {people.length ? people.map((p) => (
          <Card key={p.id} title={p.name} meta={[p.relationship, p.group ? GROUP_LABELS[p.group] ?? p.group : null].filter(Boolean).join(" · ") || undefined}
            actions={<>{edit(`person:${p.id}`)}<Button size="sm" variant="ghost" icon="trash" onClick={() => setRemoving(p)}>Remove</Button></>}>
            {editing === `person:${p.id}` ? (
              <Form key={p.id} fields={PERSON_WORDS} initial={{ ...p }} onCancel={close}
                onSubmit={(v) => save("family/people", { name: p.name, ...cleared(v, PERSON_NAMES) })} />
            ) : (
              <Detail fields={[
                { label: "Portions", value: p.portions }, { label: "Diet", value: p.diet }, { label: "Allergies", value: p.allergies },
                { label: "Dislikes", value: p.dislikes }, { label: "Targets", value: p.targets }, ...(p.note ? [{ label: "Note", value: p.note }] : []),
              ]} />
            )}
          </Card>
        )) : editing === "add-person" ? null : <Empty title="Nobody is in the family yet" hint="Add each person who eats at home, or tell the assistant about them." />}
      </Section>

      <Section title="The house">
        <Card title="House rules" meta="Days the whole house eats a certain way" actions={edit("rules")}>
          {editing === "rules" ? (
            <RowsEditor addLabel="Add a rule" onCancel={close}
              columns={[
                { name: "kind", label: "Rule", type: "select", options: [...RULE_KINDS], optionLabels: RULE_LABELS },
                { name: "days", label: "Days (with commas)", type: "text", placeholder: "Tue, Thu or Ekadashi" },
                { name: "note", label: "Note", type: "text" },
              ]}
              initial={house.rules.map((r) => ({ kind: r.kind, days: joined(r.days), note: r.note ?? "" }))}
              onSave={(rows) => save("family/rules", { rules: rows.filter((r) => r.kind || r.days).map((r) => ({ kind: r.kind, days: typedList(r.days), note: r.note || null })) })} />
          ) : house.rules.length ? <Bullets items={house.rules.map((r) => [`${RULE_LABELS[r.kind] ?? r.kind} on ${joined(r.days)}`, r.note].filter(Boolean).join(": "))} />
            : <p className="pl-quiet">No rules yet.</p>}
        </Card>

        <Card title="Cook" meta="Who cooks, and when they come" actions={edit("cook")}>
          {editing === "cook" ? (
            <Form fields={COOK_FIELDS} onCancel={close}
              initial={{ name: house.cook_name, days: house.cook_days, arrival: house.cook_arrival, makes_well: house.cook_makes_well, note: house.cook_note }}
              onSubmit={(v) => save("family/cook", { name: v.name, days: v.days ?? [], arrival: String(v.arrival ?? "").trim().replace(/^(\d):/, "0$1:"), ...cleared(v, ["makes_well", "note"]) })} />
          ) : house.cook_name ? (
            <Detail fields={[
              { label: "Name", value: house.cook_name }, { label: "Days", value: joined(house.cook_days) },
              { label: "Arrives at", value: house.cook_arrival ? clockText(house.cook_arrival) : null },
              { label: "Makes well", value: house.cook_makes_well }, ...(house.cook_note ? [{ label: "Note", value: house.cook_note }] : []),
            ]} />
          ) : <p className="pl-quiet">No cook yet.</p>}
        </Card>

        <Card title="Extra meals" meta="Meals besides Breakfast, Lunch and Dinner, like a tiffin" actions={edit("slots")}>
          {editing === "slots" ? (
            <RowsEditor addLabel="Add a meal" onCancel={close}
              columns={[
                { name: "name", label: "Meal", type: "text", placeholder: "Agastya's tiffin" },
                { name: "days", label: "Days (none means every day)", type: "multi", options: [...WEEKDAYS] },
                { name: "for", label: "For (names with commas)", type: "text" },
              ]}
              initial={house.extra_slots.map((s) => ({ name: s.name, days: s.days ?? [], for: joined(s.for) }))}
              onSave={(rows) => save("family/slots", { extra_slots: rows.filter((r) => r.name || r.for).map((r) => {
                const days = (r.days as string[] | null) ?? [], who = typedList(r.for);
                return { name: r.name, ...(days.length ? { days } : {}), ...(who.length ? { for: who } : {}) };
              }) })} />
          ) : house.extra_slots.length ? <Bullets items={house.extra_slots.map((s) => [s.name, s.days?.length ? `on ${joined(s.days)}` : "every day", s.for?.length ? `for ${joined(s.for)}` : null].filter(Boolean).join(" · "))} />
            : <p className="pl-quiet">None yet.</p>}
        </Card>

        <Card title="Ordered in every week" meta="Meals the family orders in or eats out: nothing is planned or bought for them" actions={edit("order-in")}>
          {editing === "order-in" ? (
            <RowsEditor addLabel="Add a meal" onCancel={close}
              columns={[
                { name: "day", label: "Day", type: "select", options: [...WEEKDAYS] },
                { name: "slot", label: "Meal", type: "select", options: slotNames },
                { name: "note", label: "Note", type: "text" },
              ]}
              initial={house.order_in.map((o) => ({ day: o.day, slot: o.slot, note: o.note ?? "" }))}
              onSave={(rows) => save("family/slots", { order_in: rows.filter((r) => r.day || r.slot).map((r) => ({ day: r.day, slot: r.slot, note: r.note || null })) })} />
          ) : house.order_in.length ? <Bullets items={house.order_in.map((o) => [`${o.day} ${o.slot}`, o.note].filter(Boolean).join(": "))} />
            : <p className="pl-quiet">None yet.</p>}
        </Card>

        <Card title="Notes" meta="Anything else about how the house eats" actions={edit("notes")}>
          {editing === "notes" ? (
            <Form fields={[{ type: "longtext", name: "notes", label: "Notes" }]} initial={{ notes: house.notes }} onCancel={close}
              onSubmit={(v) => save("family/rules", { notes: v.notes ?? null })} />
          ) : house.notes ? <p className="pl-notes">{house.notes}</p> : <p className="pl-quiet">No notes yet.</p>}
        </Card>

        <Card title="Grocery app" meta="Where new orders are placed. Orders already made keep the app they were made for.">
          <Field type="select" name="grocery_app" label="Grocery app" options={[...GROCERY_APPS]} optionLabels={APP_NAMES} value={grocery_app} onChange={(v) => void setGroceryApp(v)} />
        </Card>
      </Section>

      <Confirm open={!!removing} title={removing ? `Remove ${removing.name} from the family?` : ""} body="Meals are no longer planned for them. Dishes already planned for them stay as they are."
        confirmLabel="Remove" tone="danger" onConfirm={() => { if (removing) void removePerson(removing); }} onCancel={() => setRemoving(null)} />
    </Page>
  );
}
