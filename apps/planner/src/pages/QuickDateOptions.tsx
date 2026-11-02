import { useState } from "react";
import { Button, Field } from "../flock/ui";
import { parseQuickWhen, QUICK_UNIT_OPTIONS, type DateOption, type QuickUnit } from "./shared";

/** A row of quick date picks ("3 days", "1 week", …, scaled to the item's own shelf life by the caller), a
 *  free-text "3h" / "5d" / "1w" / bare-number-plus-unit input for anything in between, and "Pick a date" for an
 *  exact calendar day. Shared by the per-item inline panel and the bulk action bar — same options, same picker,
 *  different place it's shown. */
export function QuickDateOptions({ options, onPick }: { options: DateOption[]; onPick: (date: string) => void }) {
  const [custom, setCustom] = useState(false);
  const [text, setText] = useState("");
  const [unit, setUnit] = useState<QuickUnit>("days");
  const [error, setError] = useState<string | null>(null);
  if (custom) return <Field type="date" name="pick-date" label="Pick a date" value={null} onChange={(v) => { if (v) onPick(v as string); }} />;
  const submit = () => {
    const value = parseQuickWhen(text, unit, new Date());
    if (!value) { setError("Try 3h, 5d, 1w, a number, or a date like Nov 2"); return; }
    setError(null); setText(""); onPick(value);
  };
  return (
    <div className="pl-qd-wrap">
      <div className="pl-qd">
        {options.map((o) => <Button key={o.label} size="sm" variant="soft" onClick={() => onPick(o.value)}>{o.label}</Button>)}
        <Button size="sm" variant="ghost" onClick={() => setCustom(true)}>Pick a date</Button>
      </div>
      <div className="pl-qd-custom">
        <input className="fl-inp pl-qd-input" type="text" inputMode="text" placeholder="e.g. 3h, 5d, 1w, or Nov 2" value={text}
          aria-label="Postpone by (e.g. 3h, 5d, 1w) or a date"
          onChange={(e) => { setText(e.target.value); setError(null); }}
          onKeyDown={(e) => { if (e.key === "Enter") submit(); }} />
        <select className="fl-inp-select pl-qd-unit" aria-label="Unit, when the text above is just a number" value={unit} onChange={(e) => setUnit(e.target.value as QuickUnit)}>
          {QUICK_UNIT_OPTIONS.map((u) => <option key={u.id} value={u.id}>{u.label}</option>)}
        </select>
        <Button size="sm" variant="soft" disabled={!text.trim()} onClick={submit}>Set</Button>
      </div>
      {error ? <span className="fl-err">{error}</span> : null}
    </div>
  );
}
