import { useState } from "react";
import { Button, Confirm, Field, Heading, Row, Stack } from "../flock/ui";
import { send, why, type DishView } from "./shared";

type Line = { key: number; item: string; amount: number | null; unit: string };

/** A meal's dishes as the slot-day change takes them: each with its note and what it needs bought, kept as they are. */
export const dishesSent = (dishes: DishView[]) => dishes.map((d) => ({ dish: d.name, note: d.portion_note,
  ingredients: d.ingredients.map((i) => ({ item: i.item, amount: i.amount, unit: i.unit })) }));

/** One dish, open under its row on the Week page: its name, the portions, and what it needs bought. `dish` null is a new dish
 *  for the meal at `at`; `dishes` are the meal's dishes now. Saved as the meal's whole list of dishes through the route the
 *  agent's set_slot_day uses (the same checks; the meal is then the family's own, never planned over). A new dish with no
 *  items listed has them read by the app. */
export function DishPanel({ dish, dishes, at, onDone }: { dish: DishView | null; dishes: DishView[]; at: { date: string; slot: string }; onDone: () => void }) {
  const [name, setName] = useState(dish?.name ?? "");
  const [note, setNote] = useState(dish?.portion_note ?? "");
  const [lines, setLines] = useState<Line[]>(() => (dish?.ingredients ?? []).map((i, key) => ({ key, item: i.item, amount: i.amount, unit: i.unit ?? "" })));
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const setLine = (key: number, patch: Partial<Line>) => setLines((all) => all.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const addLine = () => setLines((all) => [...all, { key: Math.max(-1, ...all.map((l) => l.key)) + 1, item: "", amount: null, unit: "" }]);

  const run = async (list: object[]) => {
    setBusy(true); setProblem(null);
    try { await send("slot-days", { date: at.date, slot: at.slot, dishes: list }); onDone(); }
    catch (e) { setProblem(why(e)); setBusy(false); }
  };
  const others = dishesSent(dishes);
  const save = () => {
    if (!name.trim()) { setProblem("Give the dish a name."); return; }
    const bad = lines.find((l) => l.item.trim() && l.amount != null && !(l.amount > 0));
    if (bad) { setProblem(`The amount of ${bad.item.trim()} must be above 0, or left empty.`); return; }
    const items = lines.filter((l) => l.item.trim()).map((l) => ({ item: l.item.trim(), amount: l.amount, unit: l.unit.trim() || null }));
    const one = { dish: name.trim(), note: note.trim() || null, ...(items.length || dish ? { ingredients: items } : {}) };
    void run(dish ? dishes.map((d, i) => (d.id === dish.id ? one : others[i])) : [...others, one]);
  };

  return (
    <form className="pl-panel" onSubmit={(e) => { e.preventDefault(); save(); }} noValidate>
      <Stack gap="md">
        <Heading level={3}>{dish ? `Edit ${dish.name}` : `Add a dish to ${at.slot}`}</Heading>
        <Field type="text" name="name" label="Dish" required value={name} onChange={(v) => setName(String(v ?? ""))} />
        <Field type="text" name="portion_note" label="Portions" placeholder="4 for me, 1 for wife" value={note} onChange={(v) => setNote(String(v ?? ""))} />
        <Stack gap="sm">
          <Heading level={3}>What it needs bought</Heading>
          {lines.map((l) => (
            <div className="pl-ingredient" key={l.key}>
              <Field type="text" name={`item-${l.key}`} label="Item" value={l.item} onChange={(v) => setLine(l.key, { item: String(v ?? "") })} />
              <Field type="number" name={`amount-${l.key}`} label="Amount" value={l.amount} onChange={(v) => setLine(l.key, { amount: typeof v === "number" ? v : null })} />
              <Field type="text" name={`unit-${l.key}`} label="Unit" placeholder="g, pc, l" value={l.unit} onChange={(v) => setLine(l.key, { unit: String(v ?? "") })} />
              <Button size="sm" variant="ghost" icon="x" onClick={() => setLines((all) => all.filter((x) => x.key !== l.key))}>Remove</Button>
            </div>
          ))}
          <Row><Button size="sm" variant="soft" icon="plus" onClick={addLine}>Add an item</Button></Row>
        </Stack>
        {problem ? <p role="alert" className="pl-fail">{problem}</p> : null}
        <Row justify="between">
          <Row>
            <Button type="submit" loading={busy}>Save</Button>
            <Button variant="ghost" disabled={busy} onClick={onDone}>Cancel</Button>
          </Row>
          {dish ? <Button variant="ghost" icon="trash" disabled={busy} onClick={() => setAsking(true)}>Remove dish</Button> : null}
        </Row>
      </Stack>
      {dish ? (
        <Confirm open={asking} title={`Remove ${dish.name}?`} body="It is taken off this meal."
          confirmLabel="Remove" tone="danger" onConfirm={() => { setAsking(false); void run(dishes.filter((d) => d.id !== dish.id).map((d) => others[dishes.indexOf(d)])); }} onCancel={() => setAsking(false)} />
      ) : null}
    </form>
  );
}
