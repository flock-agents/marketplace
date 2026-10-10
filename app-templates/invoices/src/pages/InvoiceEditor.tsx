import { useEffect, useMemo, useState } from "react";
import { Button, Callout, Field, LineItems, kitFetch, useTable, type LineItem } from "../flock/ui";
import { GST_RATES } from "../../server/db/constants";
import { computeTotals, isInterState } from "../../server/db/invoice-math";
import { cap, localToday, many, one, useInvoiceSettings, type Customer, type InvoiceDetail, type InvoiceRow } from "./shared";

const blankLine = (): LineItem => ({ description: "", qty: 1, unit_price: null, gst_rate: 18 });
const addDays = (iso: string, n: number) => { const [y, m, d] = iso.split("-").map(Number); const x = new Date(y, m - 1, d + n); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`; };

/** Names for the customer picker; a repeated name gets its GSTIN or a counter so each option is distinct. */
const labelled = (cs: Customer[]) => {
  const seen = new Map<string, number>();
  return cs.map((c) => { const n = (seen.get(c.name) ?? 0) + 1; seen.set(c.name, n); return { c, label: n === 1 ? c.name : `${c.name} (${c.gstin ?? n})` }; });
};

/** Make an invoice, or change one: header fields, line items with live totals. Saves through the kit's data routes. */
/** `removed`: the change ids of the lines this save deleted, so the caller can offer Undo for them. */
export function InvoiceEditor({ detail, onSaved, onCancel }: { detail: InvoiceDetail | null; onSaved: (id: string, number: string, removed: string[]) => void; onCancel: () => void }) {
  const customers = useTable<Customer>("customers", { sort: "name", limit: 500 });
  const settings = useInvoiceSettings();   // the seller's state code decides IGST while editing (the server copies it at issue)
  const options = useMemo(() => labelled(customers.rows), [customers.rows]);
  const today = localToday();
  const [number, setNumber] = useState(detail?.invoice.number ?? "");
  const [customerId, setCustomerId] = useState<string | null>(detail?.invoice.customer_id ?? null);
  const [issue, setIssue] = useState<string | null>(detail?.invoice.issue_date ?? today);
  const [due, setDue] = useState<string | null>(detail?.invoice.due_date ?? addDays(today, 15));
  const [notes, setNotes] = useState<string | null>(detail?.invoice.notes ?? null);
  const [lines, setLines] = useState<LineItem[]>(detail ? detail.lines.map((l) => ({ id: l.id, description: l.description, qty: l.qty, unit_price: l.unit_price, gst_rate: l.gst_rate })) : [blankLine()]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  useEffect(() => {   // the next free number, fetched once for a new invoice
    if (detail) return;
    let live = true;
    void kitFetch<{ number: string }>(`next-number?year=${today.slice(0, 4)}`).then((r) => { if (live) setNumber((n) => n || r.number); }).catch(() => {});
    return () => { live = false; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const customer = customers.rows.find((c) => c.id === customerId) ?? detail?.customer ?? null;
  const inter = isInterState(settings, customer?.gstin);
  // An issued invoice keeps the registration it was issued under; a new invoice or a draft follows the settings.
  const registered = detail && detail.invoice.status !== "draft" && detail.gst_registered !== undefined ? detail.gst_registered : !!settings.business.gstin;
  const totals = computeTotals(lines, inter, registered);

  const save = async () => {
    const e: Record<string, string> = {};
    if (!number.trim()) e.number = "Give the invoice a number";
    if (!customerId) e.customer = `Pick a ${one()} (add one on the ${cap(many())} page first)`;
    if (!issue) e.issue = "Pick the issue date";
    if (!due) e.due = "Pick the due date";
    else if (issue && due < issue) e.due = "The due date is before the issue date";
    const kept = lines.filter((l) => l.description.trim() || l.unit_price !== null);
    if (!kept.length) e.lines = "Add at least one line";
    else if (kept.some((l) => !l.description.trim())) e.lines = "Every line needs a description";
    else if (kept.some((l) => l.unit_price === null || (l.qty ?? 0) <= 0)) e.lines = "Every line needs a quantity above zero and a price";
    setErrors(e); setFailure(null);
    if (Object.keys(e).length) return;
    setSaving(true);
    try {
      const taken = await kitFetch<{ rows: InvoiceRow[] }>(`invoice-list?q=${encodeURIComponent(number.trim())}&limit=200&today=${today}`);
      if (taken.rows.some((r) => r.number.toLowerCase() === number.trim().toLowerCase() && r.id !== detail?.invoice.id)) { setErrors({ number: "That number is already used" }); setSaving(false); return; }
      const head = { number: number.trim(), customer_id: customerId, issue_date: issue, due_date: due, notes: notes?.trim() || null };
      let id = detail?.invoice.id;
      if (id) await kitFetch(`_data/invoices/${id}`, { method: "PATCH", body: JSON.stringify(head) });
      else id = (await kitFetch<{ row: { id: string } }>("_data/invoices", { method: "POST", body: JSON.stringify({ ...head, status: "draft" }) })).row.id;
      const keptIds = new Set(kept.map((l) => l.id).filter(Boolean));
      const removed: string[] = [];
      for (const old of detail?.lines ?? []) if (!keptIds.has(old.id)) {
        const r = await kitFetch<{ changeId?: string }>(`_data/invoice_lines/${old.id}`, { method: "DELETE" });
        if (r?.changeId) removed.push(r.changeId);
      }
      for (const l of kept) {
        const body = JSON.stringify({ invoice_id: id, description: l.description.trim(), qty: l.qty, unit_price: l.unit_price, gst_rate: l.gst_rate ?? 0 });
        const was = detail?.lines.find((x) => x.id === l.id);
        if (l.id && was) { if (was.description !== l.description.trim() || was.qty !== l.qty || was.unit_price !== l.unit_price || was.gst_rate !== l.gst_rate) await kitFetch(`_data/invoice_lines/${l.id}`, { method: "PATCH", body }); }
        else await kitFetch("_data/invoice_lines", { method: "POST", body });
      }
      onSaved(id, number.trim(), removed);
    } catch (err) {
      setFailure((err as Error).message || "Couldn't save the invoice");
      setSaving(false);
    }
  };

  return (
    <form className="inv-edit" onSubmit={(ev) => { ev.preventDefault(); void save(); }} noValidate>
      {failure ? <Callout tone="danger" title="Couldn't save">{failure}</Callout> : null}
      <div className="inv-head-row">
        <Field type="text" name="number" label="Invoice number" value={number} onChange={(v) => setNumber(String(v ?? ""))} required error={errors.number} />
        <Field type="select" name="customer" label={cap(one())} required error={errors.customer} placeholder={`Choose a ${one()}`}
          options={options.map((o) => o.label)} value={options.find((o) => o.c.id === customerId)?.label ?? null}
          onChange={(v) => setCustomerId(options.find((o) => o.label === v)?.c.id ?? null)} />
        <Field type="date" name="issue_date" label="Issue date" value={issue} onChange={(v) => setIssue(v as string | null)} required error={errors.issue} />
        <Field type="date" name="due_date" label="Due date" value={due} onChange={(v) => setDue(v as string | null)} required error={errors.due} />
      </div>
      {!registered ? <p className="inv-note">Not GST-registered, so no tax is added.</p> : customer ? <p className="inv-note">{inter ? `${customer.name} is in another state (GSTIN ${customer.gstin?.slice(0, 2)}), so IGST applies.` : "Same state or no GSTIN, so tax is split into CGST and SGST."}</p> : null}
      <div>
        <LineItems rows={lines} onChange={setLines} rates={[...GST_RATES]} split={inter ? "inter" : "intra"} totals={totals.rows} noTax={!registered} />
        {errors.lines ? <p role="alert" style={{ color: "var(--block)", fontSize: 13, margin: "8px 0 0" }}>{errors.lines}</p> : null}
      </div>
      <Field type="longtext" name="notes" label="Notes (shown on the invoice)" value={notes} onChange={(v) => setNotes(v as string | null)} />
      <div className="inv-actions">
        <Button type="submit" variant="app" loading={saving}>{detail ? "Save changes" : "Save invoice"}</Button>
        <Button variant="ghost" onClick={onCancel} disabled={saving}>Cancel</Button>
      </div>
    </form>
  );
}
