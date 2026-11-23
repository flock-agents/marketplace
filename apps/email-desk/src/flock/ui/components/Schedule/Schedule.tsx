import "./schedule.css";
import { Fragment, useEffect, useState, type ReactNode } from "react";
import { cx, type ToneT } from "../../tone";
import { Icon } from "../Icon/Icon";
import { SampleChip, isSample, sampleFade, sampleSoft } from "../Sample/Sample";
import { inlineFor, parseAddKey, scheduleAddKey, type InlineSlot } from "../InlinePanel/InlinePanel";
import { MONTHS, WEEKDAYS, addDays, dayOfMonth, monthIndex, weekdayIndex } from "../Calendar/dates";

export interface ScheduleProps<R> {
  rows: R[]; date: (r: R) => string; title: (r: R) => ReactNode;
  time?: (r: R) => string; start?: (r: R) => string | number; secondary?: (r: R) => ReactNode; tone?: (r: R) => ToneT;
  icon?: (r: R) => string | undefined; trailing?: (r: R) => ReactNode;
  slot?: (r: R) => string; slots?: string[];
  today?: string; from?: string; days?: number; showEarlier?: boolean; selectedId?: string;
  onSelect?: (r: R) => void; onAdd?: (date: string, slot?: string) => void;
  rowKey?: (r: R) => string;
  /** A form or detail shown in place: under the row whose key is `expanded.at`, or under the add spot `scheduleAddKey(date, slot?)`. */
  expanded?: InlineSlot | null;
}

const rowId = (r: unknown) => String((r as { id?: unknown })?.id ?? "");
const keyOf = <R,>(p: ScheduleProps<R>, r: R) => p.rowKey?.(r) ?? rowId(r);
const pad2 = (n: number) => String(n).padStart(2, "0");
const isoLocal = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
/** The date a value falls on. A bare date or local date-time keeps its date; a time with Z or an offset becomes the viewer's local date. */
const iso10 = (s: string) => (/T.*(Z|[+-]\d\d:?\d\d)$/.test(s) && !isNaN(Date.parse(s)) ? isoLocal(new Date(s)) : s.slice(0, 10));
const localToday = () => isoLocal(new Date());

/** Today's local date, kept fresh across midnight and when the tab comes back to the front. */
export function useToday(override?: string): string {
  const [now, setNow] = useState(localToday);
  useEffect(() => {
    if (override) return;
    const refresh = () => setNow(localToday());
    const n = new Date();
    const toMidnight = new Date(n.getFullYear(), n.getMonth(), n.getDate() + 1).getTime() - n.getTime() + 1000;
    const t = setTimeout(refresh, toMidnight);
    document.addEventListener("visibilitychange", refresh);
    return () => { clearTimeout(t); document.removeEventListener("visibilitychange", refresh); };
  }, [override, now]);
  return override ?? now;
}

/** Minutes since midnight for sorting: a number, "HH:MM", or a label that starts with h[:mm][am|pm] such as "9 – 10am" or "1pm". Unreadable sorts last. */
export function startMinutes(v: string | number | undefined): number {
  if (typeof v === "number") return v;
  if (/^\s*noon\b/i.test(v ?? "")) return 12 * 60;
  if (/^\s*midnight\b/i.test(v ?? "")) return 0;
  const m = /^\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i.exec(v ?? "");
  if (!m) return Infinity;
  let h = Number(m[1]); const min = Number(m[2] ?? 0);
  let suffix = m[3]?.toLowerCase();
  if (!suffix) {
    // "10 – 11am": the range shares the end's suffix, unless it crosses noon ("11 – 1pm" and "11 – 12pm" start at 11am).
    const end = /(\d{1,2})(?::\d{2})?\s*(am|pm)/i.exec(v!.slice(m[0].length));
    if (end) suffix = end[2].toLowerCase() === "pm" && (h % 12) <= (Number(end[1]) % 12) ? "pm" : "am";
  }
  if (suffix === "pm" && h < 12) h += 12;
  if (suffix === "am" && h === 12) h = 0;
  return h * 60 + min;
}
const wd = (iso: string) => WEEKDAYS[weekdayIndex(iso)];
const long = (d: string) => `${wd(d)}, ${MONTHS[monthIndex(d)]} ${dayOfMonth(d)}`;
const short = (d: string) => `${wd(d)} ${dayOfMonth(d)}`;

function pick<R>(row: R, onSelect?: (r: R) => void) {
  if (!onSelect) return {};
  return {
    role: "button" as const, tabIndex: 0, onClick: () => onSelect(row),
    onKeyDown: (e: React.KeyboardEvent) => { if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); onSelect(row); } },
  };
}

type Block = { kind: "day"; d: string } | { kind: "gap"; from: string; to: string };

export function Schedule<R>(p: ScheduleProps<R>) {
  const today = useToday(p.today);
  const tomorrow = addDays(today, 1);
  const start = p.from ?? today;
  const count = p.days ?? 7;
  const range = Array.from({ length: count }, (_, i) => addDays(start, i));
  const [earlier, setEarlier] = useState(!!p.showEarlier);
  const past = range.filter((d) => d < today);
  const upcoming = range.filter((d) => d >= today);

  const dated = p.rows.map((r) => ({ r, d: iso10(p.date(r)) }));
  const slotIx = (r: R) => { const s = p.slot?.(r); const i = s && p.slots ? p.slots.indexOf(s) : -1; return i < 0 ? 99 : i; };
  const startOf = (r: R) => startMinutes(p.start ? p.start(r) : p.time?.(r));
  const itemsOn = (d: string) => dated.filter((x) => x.d === d).map((x) => x.r).sort((a, b) => slotIx(a) - slotIx(b) || startOf(a) - startOf(b) || 0);

  // A day the open add form is for is never folded away: its "+ Add" opens right there, with the form under it.
  const opening = parseAddKey(p.expanded?.at)?.date;
  const blocks = (days: string[]): Block[] => {
    const out: Block[] = [];
    for (const d of days) {
      const big = d === today || d === tomorrow;
      if (big || itemsOn(d).length > 0 || d === opening) { out.push({ kind: "day", d }); continue; }
      const last = out[out.length - 1];
      if (last?.kind === "gap") last.to = d; else out.push({ kind: "gap", from: d, to: d });
    }
    return out;
  };

  const renderBlocks = (days: string[]) => blocks(days).map((b) => b.kind === "gap"
    ? <Gap key={`g${b.from}`} from={b.from} to={b.to} onAdd={p.onAdd} />
    : <Day key={b.d} p={p} d={b.d} big={b.d === today || b.d === tomorrow} label={b.d === today ? "Today" : b.d === tomorrow ? "Tomorrow" : undefined} today={b.d === today} items={itemsOn(b.d)} />);

  return (
    <div className="fl-sch">
      {past.length > 0 ? (
        <>
          <button type="button" className="fl-sch-earlier" aria-expanded={earlier} onClick={() => setEarlier(!earlier)}>
            {earlier ? "Hide earlier" : `Earlier · ${past.length} ${past.length === 1 ? "day" : "days"}`}
          </button>
          {earlier ? renderBlocks(past) : null}
        </>
      ) : null}
      {renderBlocks(upcoming)}
    </div>
  );
}

function AddRow({ d, slot, onAdd, big, open }: { d: string; slot?: string; onAdd: (d: string, s?: string) => void; big?: boolean; open?: boolean }) {
  const what = slot ? slot.toLowerCase() : "";
  return (
    <li className="fl-sch-addli">
      {big && slot ? <span className="fl-sch-slot">{slot}</span> : null}
      <button type="button" className="fl-sch-add" aria-label={`Add ${what} on ${long(d)}`.replace("  ", " ")} aria-expanded={open || undefined} onClick={() => onAdd(d, slot)}>
        <span aria-hidden="true">+</span> Add{what ? ` ${what}` : ""}
      </button>
    </li>
  );
}

function Day<R>({ p, d, big, label, today, items }: { p: ScheduleProps<R>; d: string; big: boolean; label?: string; today: boolean; items: R[] }) {
  const id = `fl-sch-${d}`;
  const slots = big ? p.slots : undefined;
  // Big days list each slot in order: its items, or an inviting add row. Items outside every slot follow.
  const inSlot = (r: R, s: string) => p.slot?.(r) === s;
  const rest = slots ? items.filter((r) => !slots.some((s) => inSlot(r, s))) : items;
  const none = items.length === 0 && !slots && !(p.expanded && p.expanded.at === scheduleAddKey(d));
  const below = (key: string) => inlineFor(p.expanded, key, (panel) => <li className="fl-sch-inline" data-fl-inline="">{panel}</li>);
  const addOpen = (slot?: string) => p.expanded?.at === scheduleAddKey(d, slot);
  // An add form for the whole day on a day listed by slot has no "+ Add" of its own: it opens at the end of the day.
  const dayForm = slots ? below(scheduleAddKey(d)) : null;
  return (
    <section className={cx("fl-sch-day", big && "fl-sch-big")} role="group" aria-labelledby={id} data-today={today}>
      <h3 id={id} className="fl-sch-dlab" aria-label={big ? `${label}, ${long(d)}` : long(d)}>
        {big ? (<><b>{label}</b><small>{long(d)}</small></>) : (<><b>{dayOfMonth(d)}</b><small>{MONTHS[monthIndex(d)]}, {wd(d)}</small></>)}
      </h3>
      <ul className="fl-sch-items">
        {slots ? slots.flatMap((s) => {
          const here = items.filter((r) => inSlot(r, s));
          return here.length ? here.map((r, i) => <Fragment key={`${s}${i}`}><Item p={p} r={r} big />{below(keyOf(p, r))}</Fragment>)
            : p.onAdd ? [<Fragment key={s}><AddRow d={d} slot={s} onAdd={p.onAdd} big open={addOpen(s)} />{below(scheduleAddKey(d, s))}</Fragment>] : [];
        }) : null}
        {rest.map((r, i) => <Fragment key={`r${i}`}><Item p={p} r={r} big={big} />{below(keyOf(p, r))}</Fragment>)}
        {none ? <li className="fl-sch-none">Nothing planned.</li> : null}
        {!slots && p.onAdd ? <><AddRow d={d} onAdd={p.onAdd} open={addOpen()} />{below(scheduleAddKey(d))}</> : null}
        {dayForm}
      </ul>
    </section>
  );
}

function Item<R>({ p, r, big }: { p: ScheduleProps<R>; r: R; big?: boolean }) {
  const tone = p.tone?.(r) ?? "neutral";
  const label = p.slot?.(r) ?? p.time?.(r) ?? "";
  const icon = big ? p.icon?.(r) : undefined;
  const sec = p.secondary?.(r);
  const trail = p.trailing?.(r);
  const sel = !!p.selectedId && (rowId(r) === p.selectedId || keyOf(p, r) === p.selectedId);
  const sample = isSample(r), fade = sampleFade(sample);
  return (
    <li className={cx("fl-sch-item", `fl-sch-t-${tone}`)} data-sel={sel || undefined} aria-current={sel ? "true" : undefined}>
      <div className="fl-sch-in" {...pick(r, p.onSelect)}>
        <i aria-hidden="true" />
        <span className={cx("fl-sch-time", fade)}>{label}</span>
        {icon ? <span className="fl-sch-ti" aria-hidden="true"><Icon name={icon} size={16} /></span> : null}
        <span className={cx("fl-sch-main", fade)}><b>{p.title(r)}</b>{sec ? <small>{sec}</small> : null}</span>
      </div>
      {sample ? <SampleChip /> : null}
      {trail != null && trail !== false ? <div className={cx("fl-sch-trail", sampleSoft(sample))}>{trail}</div> : null}
    </li>
  );
}

function Gap({ from, to, onAdd }: { from: string; to: string; onAdd?: (d: string, s?: string) => void }) {
  return (
    <div className="fl-sch-gap">
      <span>{from === to ? short(from) : `${short(from)} – ${short(to)}`} · nothing planned</span>
      {onAdd ? <button type="button" onClick={() => onAdd(from)} aria-label={`Add on ${long(from)}`}>Add</button> : null}
    </div>
  );
}
