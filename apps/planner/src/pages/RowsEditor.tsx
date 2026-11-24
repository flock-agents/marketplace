import { useState } from "react";
import { Button, Field, Row, Stack } from "../flock/ui";
import { why } from "./shared";

export type EditorColumn = { name: string; label: string; type: "text" | "select" | "multi"; options?: string[]; optionLabels?: Record<string, string>; placeholder?: string };
type Values = Record<string, unknown>;

/** A short list edited as a whole (the house rules, the extra meals, the meals ordered in): one row of fields per entry,
 *  rows added and removed, then saved together. `onSave` throws with the reason when the list is refused. */
export function RowsEditor({ columns, initial, addLabel, onSave, onCancel }: {
  columns: EditorColumn[]; initial: Values[]; addLabel: string; onSave: (rows: Values[]) => Promise<void>; onCancel: () => void;
}) {
  const [rows, setRows] = useState(() => initial.map((values, key) => ({ key, values })));
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const set = (key: number, name: string, v: unknown) => setRows((all) => all.map((r) => (r.key === key ? { ...r, values: { ...r.values, [name]: v } } : r)));
  const save = async () => {
    setBusy(true); setProblem(null);
    try { await onSave(rows.map((r) => r.values)); } catch (e) { setProblem(why(e)); setBusy(false); }
  };
  return (
    <form onSubmit={(e) => { e.preventDefault(); void save(); }} noValidate>
      <Stack gap="md">
        {rows.map((r) => (
          <div className="pl-editrow" key={r.key}>
            {columns.map((c) => (
              <Field key={c.name} type={c.type} name={`${c.name}-${r.key}`} label={c.label} options={c.options} optionLabels={c.optionLabels} placeholder={c.placeholder}
                value={r.values[c.name] ?? null} onChange={(v) => set(r.key, c.name, v)} />
            ))}
            <Button size="sm" variant="ghost" icon="x" onClick={() => setRows((all) => all.filter((x) => x.key !== r.key))}>Remove</Button>
          </div>
        ))}
        <Row><Button size="sm" variant="soft" icon="plus" onClick={() => setRows((all) => [...all, { key: Math.max(-1, ...all.map((x) => x.key)) + 1, values: {} }])}>{addLabel}</Button></Row>
        {problem ? <p role="alert" className="pl-fail">{problem}</p> : null}
        <Row>
          <Button type="submit" loading={busy}>Save</Button>
          <Button variant="ghost" disabled={busy} onClick={onCancel}>Cancel</Button>
        </Row>
      </Stack>
    </form>
  );
}
