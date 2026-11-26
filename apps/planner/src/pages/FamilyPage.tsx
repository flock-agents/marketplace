import { useState, type ReactNode } from "react";
import { Button, Callout, Card, Confirm, Detail, Empty, ErrorCard, Form, Heading, InlinePanel, Page, PropertyChips, Row, RowList, Section, Skeleton, Stack, label, useApp, useToast, type FormProps } from "../flock/ui";
import { WEEKDAYS } from "../../server/dates";
import { COOK_NEW_RECIPES, GROUPS } from "../../server/db/constants";
import { targetsOf, targetsText } from "../../server/targets";
import { agentName, cookDetails, cookingDaysText, cookVisitsText, profileWaiting } from "./format";
import { joined, send, useLive, why, type Family, type PersonRow } from "./shared";

/** The meals eaten out or ordered in every week, from each slot's skip days: "Sun Dinner: ordered in". */
const skipsText = (slots: Family["slots"]): string => {
  const said = slots.flatMap((s) => s.skip_days.map((d) => `${d.day} ${s.name}: ${d.skip === "eaten_out" ? "eaten out" : "ordered in"}`));
  return said.length ? said.join("; ") : "None";
};
const GROUP_LABELS: Record<string, string> = { child: "Child", adult: "Adult", elder: "Elder" };
const NEW_RECIPE_LABELS: Record<string, string> = { open: "Open to new recipes", set_menu: "Better with familiar dishes" };
const COOK_WORDS = ["makes_well", "wont_make", "time_limit", "note"] as const;
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
  { type: "multi", name: "days", label: "Days the cook comes", options: [...WEEKDAYS] },
  { type: "text", name: "arrival", label: "Arrives at (24-hour time; a comma between two visits)", required: true, placeholder: "07:30, or 06:00, 16:30" },
  { type: "text", name: "makes_well", label: "Makes well" },
  { type: "text", name: "wont_make", label: "Doesn't make well, or won't make" },
  { type: "text", name: "time_limit", label: "The cook's time", placeholder: "leaves early: a dish or two in the morning" },
  { type: "select", name: "new_recipes", label: "New recipes", options: [...COOK_NEW_RECIPES], optionLabels: NEW_RECIPE_LABELS },
  { type: "longtext", name: "note", label: "Note" },
];
/** The fields of a form as the routes take them: an emptied field is sent as null, which clears it. */
const cleared = (v: Record<string, unknown>, names: readonly string[]) => Object.fromEntries(names.map((n) => [n, v[n] ?? null]));
/** The family, and only the family: who eats at home, the cook (every day is planned: the cook's days off the family cooks), the meals
 *  planned (the slots) and the food rules. People and the cook are edited where they are shown, through the same routes (and the
 *  same checks) as the agent; the slots and the rules are shown as the setup saved them (they change through the agent). The main shopping app,
 *  its fallback and Order without asking are on Flock's Settings tab, under "How we order". */
export function FamilyPage() {
  const family = useLive<Family>("family", ["people", "house", "slots", "rules"]);
  const agent = agentName(useApp().display);
  const toast = useToast();
  const [editing, setEditing] = useState<string | null>(null);
  const [removing, setRemoving] = useState<PersonRow | null>(null);
  if (family.error && !family.data) return <Page title={label("title.family", "Family")}><ErrorCard title="Couldn't load the family" message={family.error} onRetry={() => void family.refetch()} /></Page>;
  if (!family.data) return <Page title={label("title.family", "Family")}><Skeleton variant="card" lines={6} /></Page>;
  const { people, house, slots, rules } = family.data;

  const close = () => setEditing(null);
  /** Save through one of the family routes, then show what the app now holds. A refusal is thrown to the form that asked. */
  const save = async (path: string, body: object) => { await send(path, body); close(); void family.refetch(); };
  const toggle = (key: string) => setEditing(editing === key ? null : key);
  const edit = (key: string, text = "Edit", disabled = false) => <Button size="sm" variant="soft" icon="pencil" disabled={disabled} onClick={() => toggle(key)}>{text}</Button>;
  /** An editor opened in place, under the part it edits. */
  const panel = (key: string, title: string, content: ReactNode) => editing === key ? (
    <InlinePanel label={title} onClose={close} className="pl-panel">
      <Stack gap="md"><Heading level={3}>{title}</Heading>{content}</Stack>
    </InlinePanel>
  ) : null;
  const removePerson = async (p: PersonRow) => {
    setRemoving(null);
    try { await send("family/people", { name: p.name, remove: true }); close(); void family.refetch(); toast.show({ message: `${p.name} is no longer in the family`, tone: "success" }); }
    catch (e) { toast.show({ message: `Couldn't save: ${why(e)}`, tone: "danger" }); }
  };
  const cook = house.cook_name
    ? [house.cook_name, house.cook_days.length ? cookingDaysText(house.cook_days) : null, cookVisitsText(house.cook_visits)].filter(Boolean).join(", ")
    : "No cook yet";
  /** The arrival as typed ("6:00, 16:30") as set_cook takes it: one time, or the visits, each keeping the meals it had. */
  const arrivalOf = (typed: unknown): string | { at: string; meals?: string[] }[] => {
    const times = String(typed ?? "").split(",").map((t) => t.trim().replace(/^(\d):/, "0$1:")).filter(Boolean);
    return times.length > 1 ? times.map((at) => house.cook_visits.find((v) => v.at === at) ?? { at }) : times[0] ?? "";
  };
  const opened = editing?.startsWith("person:") ? people.find((p) => `person:${p.id}` === editing) : undefined;

  return (
    <Page title={label("title.family", "Family")} subtitle={`Who eats at home, the cook and the house rules: what ${agent} plans your meals from`}>
      {profileWaiting(house) ? (
        <Callout tone="info">{`Your profile from the old Meal Planner was kept. ${agent} turns it into this page on the next weekly plan; tell ${agent} to do it now.`}</Callout>
      ) : null}

      <Section title="People" actions={<Button size="sm" variant="ghost" icon="plus" onClick={() => toggle("add-person")}>Add</Button>}>
        {panel("add-person", "Add a person", (
          <Form fields={NEW_PERSON} initial={{ group: "adult" }} submitLabel="Add" onCancel={close}
            onSubmit={(v) => save("family/people", { name: v.name, ...cleared(v, PERSON_NAMES) })} />
        ))}
        <RowList rows={people} title={(p) => p.name}
          meta={(p) => [p.group ? (GROUP_LABELS[p.group] ?? p.group).toLowerCase() : null, p.relationship, p.diet, p.portions].filter(Boolean).join(" · ") || undefined}
          onRowClick={(p) => toggle(`person:${p.id}`)}
          empty={editing === "add-person" ? <></> : <Empty title="Nobody is in the family yet" hint={`Add each person who eats at home, or tell ${agent} about them.`} />}
          expanded={opened ? {
            at: opened.id, label: `Edit ${opened.name}`, onClose: close,
            content: (
              <Card title={`Edit ${opened.name}`} actions={<Button size="sm" variant="ghost" icon="trash" onClick={() => setRemoving(opened)}>Remove</Button>}>
                <Form key={opened.id} fields={PERSON_WORDS} initial={{ ...opened, targets: targetsText(targetsOf(opened.targets)) }} onCancel={close}
                  onSubmit={(v) => save("family/people", { name: opened.name, ...cleared(v, PERSON_NAMES) })} />
              </Card>
            ),
          } : null} />
      </Section>

      <Section title="Cooking">
        <Detail fields={[
          { label: "Cook", value: cook },
          ...(house.cook_name ? cookDetails(house) : []),
          { label: "Meals planned", value: slots.length ? slots.map((s) => [s.name, s.days.length ? `on ${joined(s.days)}` : null, s.usual_people.length ? `for ${joined(s.usual_people)}` : null].filter(Boolean).join(" ")).join("; ") : "Breakfast, Lunch and Dinner" },
          { label: "Eaten out or ordered in every week", value: skipsText(slots) },
        ]} />
        <Row>{edit("cook", "Cook")}</Row>
        {panel("cook", "Cook", (
          <Form fields={COOK_FIELDS} onCancel={close}
            initial={{ name: house.cook_name, days: house.cook_days, arrival: house.cook_visits.map((v) => v.at).join(", "), makes_well: house.cook_makes_well, wont_make: house.cook_wont_make,
              time_limit: house.cook_time_limit, new_recipes: house.cook_new_recipes, note: house.cook_note }}
            onSubmit={(v) => save("family/cook", { name: v.name, days: v.days ?? [], arrival: arrivalOf(v.arrival), ...cleared(v, [...COOK_WORDS, "new_recipes"]) })} />
        ))}
      </Section>

      <Section title="Food rules">
        {rules.length
          ? <PropertyChips items={rules.map((r) => ({ label: [r.who ?? "Everyone", r.days?.length ? r.days.join(", ") : null].filter(Boolean).join(", "), value: r.hard ? r.quote : `${r.quote} (${r.frequency ?? "sometimes"})` }))} />
          : <p className="pl-quiet">No rules yet.</p>}
        {house.notes ? <p className="pl-notes">{house.notes}</p> : null}
      </Section>

      <Confirm open={!!removing} title={removing ? `Remove ${removing.name} from the family?` : ""} body="Meals are no longer planned for them. Dishes already planned for them stay as they are."
        confirmLabel="Remove" tone="danger" onConfirm={() => { if (removing) void removePerson(removing); }} onCancel={() => setRemoving(null)} />
    </Page>
  );
}
