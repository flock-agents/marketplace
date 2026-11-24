import "./form.css";
import { useEffect, useRef, useState } from "react";
import { Button } from "../Button/Button";
import { Field, type FieldProps } from "../Field/Field";
export interface FormProps {
  fields: Omit<FieldProps, "value" | "onChange" | "onInvalid">[]; initial?: Record<string, unknown>;
  onSubmit: (values: Record<string, unknown>) => Promise<void> | void; submitLabel?: string; onCancel?: () => void;
  errors?: Record<string, string>;
}
const isEmpty = (type: string, v: unknown) => v === null || v === undefined || v === "" || (Array.isArray(v) && v.length === 0) || (type === "checkbox" && v !== true);
export function Form({ fields, initial, onSubmit, submitLabel = "Save", onCancel, errors }: FormProps) {
  const [values, setValues] = useState<Record<string, unknown>>(() => ({ ...initial }));
  const [local, setLocal] = useState<Record<string, string>>({});
  const [edited, setEdited] = useState<Set<string>>(new Set()); // fields whose server error is stale
  const [invalid, setInvalid] = useState<Set<string>>(new Set()); // number fields holding text that is not a number
  const touched = useRef(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const errorsKey = JSON.stringify(errors ?? {});
  useEffect(() => { setEdited(new Set()); }, [errorsKey]);
  const initialKey = JSON.stringify(initial ?? {});
  // A late-loaded record fills the form, but never over what the user has typed.
  useEffect(() => { if (!touched.current) setValues({ ...initial }); }, [initialKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const errFor = (name: string) => local[name] ?? (edited.has(name) ? undefined : errors?.[name]);
  const change = (name: string, v: unknown) => {
    touched.current = true;
    setValues((s) => ({ ...s, [name]: v }));
    setLocal((s) => { if (!(name in s)) return s; const { [name]: _, ...rest } = s; return rest; });
    setEdited((s) => new Set(s).add(name));
  };
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const missing: Record<string, string> = {};
    for (const f of fields) if (f.required && !invalid.has(f.name) && isEmpty(f.type, values[f.name])) missing[f.name] = "Required";
    setLocal(missing); setFailure(null);
    if (Object.keys(missing).length || invalid.size) return;
    setBusy(true);
    try { await onSubmit(values); }
    catch (err) {
      if (!alive.current) return;
      // The kit's 400 carries { field, message }: put it under that field.
      const e = err as { field?: unknown; message?: unknown } | null;
      if (e && typeof e.field === "string" && typeof e.message === "string" && fields.some((f) => f.name === e.field)) setLocal((s) => ({ ...s, [e.field as string]: e.message as string }));
      else setFailure(err instanceof Error && err.message ? err.message : "Could not save. Try again.");
    }
    finally { if (alive.current) setBusy(false); }
  };
  return (
    <form className="fl-form" onSubmit={submit} noValidate>
      {fields.map((f) => <Field key={f.name} {...f} error={errFor(f.name) ?? f.error ?? null} value={values[f.name] ?? null} onChange={(v) => change(f.name, v)}
        onInvalid={(bad) => setInvalid((s) => { if (bad === s.has(f.name)) return s; const n = new Set(s); if (bad) n.add(f.name); else n.delete(f.name); return n; })} />)}
      {failure ? <div role="alert" className="fl-form-fail">{failure}</div> : null}
      <div className="fl-form-actions">
        <Button type="submit" loading={busy}>{submitLabel}</Button>
        {onCancel ? <Button variant="ghost" onClick={onCancel} disabled={busy}>Cancel</Button> : null}
      </div>
    </form>
  );
}
