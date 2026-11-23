import "../Field/field.css";
import "./lineitems.css";
import { useId, useState } from "react";
import { cx } from "../../tone";
import { formatINR } from "../../format";
import { Icon } from "../Icon/Icon";
import { gstTotals, lineAmount, GST_RATES, parseGstRate } from "../../gst";

export interface LineItem { id?: string; description: string; qty: number | null; unit_price: number | null; gst_rate: number | null }
export interface LineTotalsRow { label: string; value: number; strong?: boolean }
export interface LineItemsProps {
  rows: LineItem[];
  onChange?: (rows: LineItem[]) => void;
  rates?: number[];
  split?: "intra" | "inter" | "none";
  totals?: LineTotalsRow[];
  readOnly?: boolean;
  addLabel?: string;
  /** The seller is not registered for GST: no GST column or rate pickers, no tax in the worked-out totals, new lines at 0%. */
  noTax?: boolean;
}

const num = (n: number | null | undefined) => (typeof n === "number" && Number.isFinite(n) ? n : 0);
const money = (n: number) => formatINR(n, { exact: true });
const pct = (r: number) => `${r}%`;

/** The GST cell: the offered rates plus "Custom %", which opens a box for any rate from 0 to 100 (two decimals at most).
 *  A stored rate that is not offered (12% from before the 2025 change, 3% on gold) opens as Custom with its value. */
function RateCell({ rate, rates, line, onRate }: { rate: number | null; rates: number[]; line: number; onRate: (r: number) => void }) {
  const offered = rate === null || rates.includes(rate);
  const [custom, setCustom] = useState(!offered);
  const [text, setText] = useState(offered ? "" : String(rate));
  // A rate changed from outside (a row removed above, an agent's edit) re-syncs the cell: an offered rate closes Custom,
  // any other opens it with that value. A rate the box itself just set leaves it alone.
  const [seen, setSeen] = useState(rate);
  if (rate !== seen) {
    setSeen(rate);
    if (rate !== null && parseGstRate(text) !== rate) {
      setCustom(!rates.includes(rate));
      setText(rates.includes(rate) ? "" : String(rate));
    }
  }
  const open = custom || !offered;
  const bad = open && parseGstRate(text) === null;
  return (
    <div className="fl-li-cell fl-li-rate">
      <span className="fl-li-lbl" aria-hidden>GST</span>
      <select className="fl-inp fl-inp-select" value={open ? "custom" : String(rate ?? 0)} aria-label={`GST rate, line ${line}`}
        onChange={(e) => {
          if (e.target.value === "custom") { setCustom(true); setText(rate === null ? "" : String(rate)); return; }
          setCustom(false); onRate(Number(e.target.value));
        }}>
        {rates.map((x) => <option key={x} value={x}>{pct(x)}</option>)}
        <option value="custom">Custom %</option>
      </select>
      {open ? (
        <input className="fl-inp" type="text" inputMode="decimal" value={text} placeholder="e.g. 3" aria-label={`Custom GST %, line ${line}`} aria-invalid={bad || undefined}
          onChange={(e) => { setText(e.target.value); const n = parseGstRate(e.target.value); if (n !== null) onRate(n); }} />
      ) : null}
    </div>
  );
}

/** Subtotal, the tax per rate (CGST + SGST, or IGST) and the total, worked out from the rows (see gst.ts). */
export function lineItemTotals(rows: LineItem[], split: "intra" | "inter" | "none" = "intra"): LineTotalsRow[] {
  return gstTotals(rows, split).rows;
}

export function LineItems({ rows, onChange, rates = [...GST_RATES], split = "intra", totals, readOnly, addLabel = "Add a line", noTax }: LineItemsProps) {
  const uid = useId();
  const editable = !!onChange && !readOnly;
  const set = (i: number, patch: Partial<LineItem>) => onChange?.(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const parse = (v: string): number | null => { const n = Number(v); return v.trim() !== "" && Number.isFinite(n) && n >= 0 ? n : null; };
  const shown = totals ?? lineItemTotals(noTax ? rows.map((r) => ({ ...r, gst_rate: 0 })) : rows, split);
  return (
    <div className={cx("fl-li", noTax && "fl-li-notax")}>
      <div className="fl-li-head" aria-hidden>
        <span>Description</span><span>Qty</span><span>Price</span>{noTax ? null : <span>GST</span>}<span className="fl-li-end">Amount</span>{editable ? <span /> : null}
      </div>
      <ul className="fl-li-rows">
        {rows.map((r, i) => {
          const id = `${uid}-${i}`;
          return (
            <li className={cx("fl-li-row", editable && "fl-li-edit")} key={r.id ?? `new-${i}`}>
              {editable ? (
                <>
                  <label className="fl-li-cell fl-li-desc"><span className="fl-li-lbl">Description</span>
                    <input id={`${id}-d`} className="fl-inp" type="text" value={r.description} placeholder="What you are billing for" onChange={(e) => set(i, { description: e.target.value })} aria-label={`Description, line ${i + 1}`} /></label>
                  <label className="fl-li-cell"><span className="fl-li-lbl">Qty</span>
                    <input className="fl-inp" type="number" inputMode="decimal" min="0" step="any" value={r.qty ?? ""} onChange={(e) => set(i, { qty: parse(e.target.value) })} aria-label={`Quantity, line ${i + 1}`} /></label>
                  <label className="fl-li-cell"><span className="fl-li-lbl">Price</span>
                    <input className="fl-inp" type="number" inputMode="decimal" min="0" step="any" value={r.unit_price ?? ""} onChange={(e) => set(i, { unit_price: parse(e.target.value) })} aria-label={`Unit price in rupees, line ${i + 1}`} /></label>
                  {noTax ? null : <RateCell rate={r.gst_rate} rates={rates} line={i + 1} onRate={(gst_rate) => set(i, { gst_rate })} />}
                </>
              ) : (
                <>
                  <span className="fl-li-cell fl-li-desc fl-li-text">{r.description}</span>
                  <span className="fl-li-cell fl-li-text"><span className="fl-li-lbl">Qty</span>{num(r.qty)}</span>
                  <span className="fl-li-cell fl-li-text"><span className="fl-li-lbl">Price</span>{money(num(r.unit_price))}</span>
                  {noTax ? null : <span className="fl-li-cell fl-li-text"><span className="fl-li-lbl">GST</span>{pct(num(r.gst_rate))}</span>}
                </>
              )}
              <span className="fl-li-cell fl-li-amt"><span className="fl-li-lbl">Amount</span><b>{money(lineAmount(r))}</b></span>
              {editable ? (
                <button type="button" className="fl-li-rm" aria-label={`Remove line ${i + 1}`} onClick={() => onChange!(rows.filter((_, j) => j !== i))}><Icon name="x" size={16} /></button>
              ) : null}
            </li>
          );
        })}
      </ul>
      {editable ? (
        <button type="button" className="fl-li-add" onClick={() => onChange!([...rows, { description: "", qty: 1, unit_price: null, gst_rate: noTax ? 0 : rates.includes(18) ? 18 : rates[0] ?? 0 }])}>
          <Icon name="plus" size={16} />{addLabel}
        </button>
      ) : null}
      <dl className="fl-li-totals">
        {shown.map((t, i) => (
          <div key={`${t.label}-${i}`} className={cx("fl-li-trow", t.strong && "fl-li-grand")}><dt>{t.label}</dt><dd>{money(t.value)}</dd></div>
        ))}
      </dl>
    </div>
  );
}
