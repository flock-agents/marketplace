import "./field.css";
import { useEffect, useId, useState } from "react";
import { cx } from "../../tone";
import { Icon } from "../Icon/Icon";
export type FieldType = "text" | "longtext" | "number" | "money" | "date" | "select" | "multi" | "checkbox" | "person" | "url";
export interface FieldProps {
  type: FieldType; name: string; label: string; value: unknown; onChange: (v: unknown) => void;
  /** select, multi: the choices. text: suggestions only (any text is accepted). */
  options?: string[]; /** select: the words shown for an option's value. */ optionLabels?: Record<string, string>; required?: boolean; error?: string | null; placeholder?: string;
  /** Number and money only: called with true while the text is not a number, false once it is (or is cleared). */
  onInvalid?: (bad: boolean) => void;
}
const str = (v: unknown) => (v === null || v === undefined ? "" : String(v));
const NUMBER_ERROR = "Use a number, like 1800";
const parseNum = (t: string): number | null => { const s = t.trim().replace(/,/g, ""); return s !== "" && Number.isFinite(Number(s)) ? Number(s) : null; };
/** A numeric box keeps its own text so "1." and "-" survive while typing; it emits a number, or null. */
function NumberInput({ id, value, onChange, onBad, describedBy, invalid, required, placeholder, money, name }: {
  id: string; value: unknown; onChange: (v: unknown) => void; onBad: (bad: boolean) => void; describedBy?: string; invalid: boolean; required?: boolean; placeholder?: string; money: boolean; name: string;
}) {
  const [draft, setDraft] = useState(str(value));
  // Follow the value when it is changed from outside (a reset, a loaded record), but never fight what is being typed.
  useEffect(() => { if (parseNum(draft) !== (typeof value === "number" ? value : null)) { setDraft(str(value)); onBad(false); } }, [value]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <span className={cx("fl-inp-wrap", money && "fl-inp-money")}>
      {money ? <span className="fl-inp-prefix" aria-hidden>₹</span> : null}
      <input id={id} name={name} className={cx("fl-inp", invalid && "fl-inp-err")} type="text" inputMode="decimal" autoComplete="off"
        value={draft} placeholder={placeholder} aria-invalid={invalid || undefined} aria-describedby={describedBy} aria-required={required || undefined}
        onChange={(e) => {
          const t = e.target.value; setDraft(t);
          const n = parseNum(t);
          onBad(t.trim() !== "" && n === null);
          onChange(n);
        }} />
    </span>
  );
}
export function Field({ type, name, label, value, onChange, options = [], optionLabels, required, error, placeholder, onInvalid }: FieldProps) {
  const id = useId();
  const errId = `${id}-err`;
  const [numDraftBad, setNumDraftBad] = useState(false);
  const shown = numDraftBad ? NUMBER_ERROR : error;
  const describedBy = shown ? errId : undefined;
  const invalid = !!shown;
  const common = { id, name, "aria-invalid": invalid || undefined, "aria-describedby": describedBy, "aria-required": required || undefined } as const;
  const cls = cx("fl-inp", invalid && "fl-inp-err");
  const labelNode = <>{label}{required ? <span className="fl-req" aria-hidden> *</span> : null}</>;
  let control;
  switch (type) {
    case "longtext":
      control = <textarea {...common} className={cx(cls, "fl-inp-area")} rows={4} value={str(value)} placeholder={placeholder} onChange={(e) => onChange(e.target.value === "" ? null : e.target.value)} />;
      break;
    case "number": case "money":
      control = <NumberInput id={id} name={name} value={value} money={type === "money"} invalid={invalid} required={required} describedBy={describedBy} placeholder={placeholder}
        onBad={(b) => { setNumDraftBad(b); onInvalid?.(b); }} onChange={onChange} />;
      break;
    case "date":
      control = <input {...common} className={cls} type="date" value={str(value)} onChange={(e) => onChange(e.target.value === "" ? null : e.target.value)} />;
      break;
    case "select":
      control = (
        <select {...common} className={cx(cls, "fl-inp-select")} value={str(value)} onChange={(e) => onChange(e.target.value === "" ? null : e.target.value)}>
          <option value="">{placeholder ?? "Select…"}</option>
          {options.map((o) => <option key={o} value={o}>{optionLabels?.[o] ?? o}</option>)}
        </select>
      );
      break;
    case "multi": {
      const cur = Array.isArray(value) ? (value as string[]) : [];
      return (
        <fieldset className="fl-fld fl-fld-multi" aria-describedby={describedBy} aria-invalid={invalid || undefined}>
          <legend className="fl-lbl">{labelNode}</legend>
          <div className="fl-multi">
            {options.map((o) => (
              <label key={o} className="fl-opt"><input type="checkbox" name={name} checked={cur.includes(o)}
                onChange={() => onChange(cur.includes(o) ? cur.filter((x) => x !== o) : [...cur, o])} /><span>{o}</span></label>
            ))}
          </div>
          {shown ? <span id={errId} className="fl-err"><Icon name="circle-alert" size={13} />{shown}</span> : null}
        </fieldset>
      );
    }
    case "checkbox":
      return (
        <div className="fl-fld">
          <label className="fl-opt"><input {...common} type="checkbox" checked={value === true} onChange={(e) => onChange(e.target.checked)} /><span>{labelNode}</span></label>
          {shown ? <span id={errId} className="fl-err"><Icon name="circle-alert" size={13} />{shown}</span> : null}
        </div>
      );
    case "url":
      control = <input {...common} className={cls} type="url" inputMode="url" autoComplete="off" value={str(value)} placeholder={placeholder ?? "https://"} onChange={(e) => onChange(e.target.value === "" ? null : e.target.value)} />;
      break;
    default: { // text, person; options on a text field are suggestions (any text is accepted)
      const listId = type === "text" && options.length ? `${id}-list` : undefined;
      control = (<>
        <input {...common} className={cls} type="text" autoComplete={type === "person" ? "name" : "off"} list={listId} value={str(value)} placeholder={placeholder} onChange={(e) => onChange(e.target.value === "" ? null : e.target.value)} />
        {listId ? <datalist id={listId}>{options.map((o) => <option key={o} value={o} />)}</datalist> : null}
      </>);
    }
  }
  return (
    <div className="fl-fld">
      <label className="fl-lbl" htmlFor={id}>{labelNode}</label>
      {control}
      {shown ? <span id={errId} className="fl-err"><Icon name="circle-alert" size={13} />{shown}</span> : null}
    </div>
  );
}
