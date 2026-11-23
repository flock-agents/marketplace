import "./itempicker.css";
import "../Button/button.css";
import { useState } from "react";
import { Button } from "../Button/Button";
import { Image } from "../Image/Image";
import { Tabs } from "../Tabs/Tabs";
import { Value } from "../Value/Value";
import { cx } from "../../tone";
import { figure, formatINR } from "../../format";

/** One thing to pick some of: a dish, a product. `price` is each, in rupees. */
export interface PickItem { id: string; name: string; meta?: string; price?: number | string; image?: string; group?: string; max?: number }
/** What was picked: each item's id, name and how many. */
export interface PickedItem { id: string; name: string; qty: number }
export interface ItemPickerProps {
  items: PickItem[];
  /** The button that sends the picks; default "Add to cart". */
  submitLabel?: string;
  onSubmit: (picked: PickedItem[]) => void;
}
/** TypeScript-only state the renderer owns: the picks already sent (shown, locked), a lock, and how many rows a group
 *  shows before "Show all N". */
export interface ItemPickerState { answer?: PickedItem[] | null; disabled?: boolean; collapseAfter?: number }

/** The most of one item a picker takes when the item names no `max`. */
export const ITEM_MAX = 20;

export function ItemPicker({ items, submitLabel = "Add to cart", onSubmit, answer, disabled, collapseAfter }: ItemPickerProps & ItemPickerState) {
  const [counts, setCounts] = useState<Record<string, number>>({});
  const groups = [...new Set(items.map((i) => i.group).filter((g): g is string => !!g))];
  const [tab, setTab] = useState(groups[0] ?? "");
  const [all, setAll] = useState<Record<string, boolean>>({});
  const sent = !!answer;
  const qty = (id: string) => (sent ? answer!.find((p) => p.id === id)?.qty ?? 0 : counts[id] ?? 0);
  const locked = sent || !!disabled;
  const set = (it: PickItem, n: number) => {
    if (locked) return;
    const max = typeof it.max === "number" && it.max > 0 ? it.max : ITEM_MAX;
    setCounts((c) => ({ ...c, [it.id]: Math.max(0, Math.min(max, n)) }));
  };
  // A dish a menu lists in two sections (Recommended and its own) is one item: one count, picked once.
  const unique = items.filter((i, k) => items.findIndex((j) => j.id === i.id) === k);
  const picked: PickedItem[] = unique.filter((i) => qty(i.id) > 0).map((i) => ({ id: i.id, name: i.name, qty: qty(i.id) }));
  const count = picked.reduce((n, p) => n + p.qty, 0);
  // The total only when every picked item has a price: a part-total would read as the whole.
  const prices = picked.map((p) => figure(items.find((i) => i.id === p.id)?.price));
  const total = prices.every((v) => v !== null) ? picked.reduce((n, p, i) => n + p.qty * (prices[i] as number), 0) : null;
  const pictures = items.some((i) => !!i.image);

  // With groups, one tab per group (the picks are kept across tabs); a group's count shows what is picked in it.
  const shown = groups.length > 1 ? items.filter((i) => i.group === tab) : items;
  const key = groups.length > 1 ? tab : "";
  const cut = collapseAfter && !all[key] && shown.length > collapseAfter + 2 ? collapseAfter : shown.length;
  const inGroup = (g: string) => unique.filter((i) => items.some((j) => j.id === i.id && j.group === g)).reduce((n, i) => n + qty(i.id), 0);

  return (
    <div className={cx("fl-pick", locked && "fl-pick-locked")}>
      {groups.length > 1 ? (
        <Tabs tabs={groups.map((g) => ({ id: g, label: g, count: inGroup(g) || undefined }))} value={tab} onChange={setTab} />
      ) : null}
      <ul className="fl-pick-items">
        {shown.slice(0, cut).map((it) => {
          const n = qty(it.id);
          return (
            <li key={it.id} className={cx("fl-pick-item", n > 0 && "fl-pick-on")}>
              {pictures ? <span className="fl-pick-img"><Image src={it.image ?? null} alt={it.name} /></span> : null}
              <span className="fl-pick-main">
                <b className="fl-pick-name">{it.name}</b>
                {it.meta ? <small className="fl-pick-meta">{it.meta}</small> : null}
                {it.price !== undefined && it.price !== "" ? <span className="fl-pick-price"><Value kind="money" value={it.price} /></span> : null}
              </span>
              <span className="fl-pick-qty">
                {n === 0 ? (
                  sent ? null : <button type="button" className="fl-btn fl-btn-soft fl-pick-add" disabled={locked} onClick={() => set(it, 1)} aria-label={`Add ${it.name}`}>Add</button>
                ) : (
                  <span className="fl-pick-step" role="group" aria-label={`${it.name}: ${n}`}>
                    <button type="button" disabled={locked} onClick={() => set(it, n - 1)} aria-label={`One less ${it.name}`}>−</button>
                    <output aria-live="polite">{n}</output>
                    <button type="button" disabled={locked || n >= (typeof it.max === "number" && it.max > 0 ? it.max : ITEM_MAX)} onClick={() => set(it, n + 1)} aria-label={`One more ${it.name}`}>+</button>
                  </span>
                )}
              </span>
            </li>
          );
        })}
      </ul>
      {cut < shown.length ? <button type="button" className="fl-pick-more" onClick={() => setAll((a) => ({ ...a, [key]: true }))}>Show all {shown.length}</button> : null}
      <div className="fl-pick-foot">
        <span className="fl-pick-sum">
          {count === 0 ? "Nothing picked yet" : `${count} ${count === 1 ? "item" : "items"}`}
          {count > 0 && total !== null ? <b className="fl-num">{formatINR(total)}</b> : null}
        </span>
        <Button disabled={locked || count === 0} onClick={() => onSubmit(picked)}>{sent ? "Sent" : submitLabel}</Button>
      </div>
    </div>
  );
}
