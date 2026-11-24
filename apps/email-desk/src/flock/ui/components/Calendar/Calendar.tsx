import "./calendar.css";
import { Fragment, useState, type ReactNode } from "react";
import { cx, type ToneT } from "../../tone";
import { Icon } from "../Icon/Icon";
import { SampleChip, isSample, sampleFade, sampleSoft } from "../Sample/Sample";
import { inlineFor, type InlineSlot } from "../InlinePanel/InlinePanel";
import { WEEKDAYS, MONTHS, addDays, dayOfMonth, monthIndex, monthMatrix, mondayOf, weekDays, weekdayIndex } from "./dates";

export interface CalendarProps<R> {
  view: "month" | "schedule" | "week-grid" | "timeline";
  rows: R[]; date: (r: R) => string; title: (r: R) => ReactNode;
  time?: (r: R) => string; tone?: (r: R) => ToneT;
  lane?: (r: R) => string; lanes?: string[];
  icon?: (r: R) => string | undefined; trailing?: (r: R) => ReactNode; selectedId?: string;
  weekStart?: string; today?: string;
  onSelect?: (r: R) => void; onAdd?: (date: string, lane?: string) => void;
  /** timeline and schedule views: a form or detail shown in place under the row whose id is `expanded.at`. */
  expanded?: InlineSlot | null;
}

const rowId = (r: unknown) => String((r as { id?: unknown })?.id ?? "");
const dayName = (iso: string) => WEEKDAYS[weekdayIndex(iso)];
const iso10 = (s: string) => s.slice(0, 10);
const localToday = () => { const n = new Date(); return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`; };
/** "9:30" -> "09:30" so times compare as text in clock order. */
const padTime = (t: string) => t.replace(/^(\d):/, "0$1:");

/** Click-and-keyboard activation for an element that is only a button when `onSelect` exists. */
function pick<R>(row: R, onSelect?: (r: R) => void) {
  if (!onSelect) return {};
  return {
    role: "button" as const, tabIndex: 0, onClick: () => onSelect(row),
    onKeyDown: (e: React.KeyboardEvent) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect(row); } },
  };
}

export function Calendar<R>(p: CalendarProps<R>) {
  const dated = p.rows.map((r) => ({ r, d: iso10(p.date(r)) }));
  const byDay = (d: string) => dated.filter((x) => x.d === d).map((x) => x.r);
  const earliest = dated.map((x) => x.d).sort()[0];
  const anchor = p.weekStart ?? p.today ?? earliest ?? localToday();
  const timeOf = (r: R) => p.time?.(r) ?? "";
  const byTime = (a: R, b: R) => padTime(timeOf(a)).localeCompare(padTime(timeOf(b)));
  const weekFrom = mondayOf(p.weekStart ?? anchor);
  const toneOf = (r: R) => p.tone?.(r) ?? "neutral";
  const body =
    p.view === "month" ? <MonthView p={p} anchor={anchor} byDay={byDay} byTime={byTime} toneOf={toneOf} />
    : p.view === "schedule" ? <ScheduleView p={p} start={weekFrom} byDay={byDay} byTime={byTime} toneOf={toneOf} />
    : p.view === "week-grid" ? <WeekGrid p={p} start={weekFrom} toneOf={toneOf} />
    : <Timeline p={p} dated={dated} byTime={byTime} toneOf={toneOf} />;
  return <div className={cx("fl-cal", `fl-cal-${p.view}`)}>{body}</div>;
}

interface Common<R> { p: CalendarProps<R>; toneOf: (r: R) => ToneT }

function AddButton({ date, lane, onAdd }: { date: string; lane?: string; onAdd?: (d: string, l?: string) => void }) {
  if (!onAdd) return null;
  return <button type="button" className="fl-cal-add" aria-label={`Add on ${date}${lane ? ` ${lane}` : ""}`} onClick={() => onAdd(date, lane)}>+</button>;
}

const isSel = <R,>(p: CalendarProps<R>, r: R) => !!p.selectedId && rowId(r) === p.selectedId;
const selAttrs = <R,>(p: CalendarProps<R>, r: R) => (isSel(p, r) ? { "data-sel": "true", "aria-current": "true" as const } : {});

function ScheduleView<R>({ p, start, byDay, byTime, toneOf }: Common<R> & { start: string; byDay: (d: string) => R[]; byTime: (a: R, b: R) => number }) {
  const days = weekDays(start);
  const [picked, setPicked] = useState<string | undefined>();
  const sel = picked && days.includes(picked) ? picked : (p.today && days.includes(p.today) ? p.today : days[0]);
  const events = byDay(sel).sort(byTime);
  return (
    <>
      <div className="fl-cal-strip">
        {days.map((d) => (
          <button key={d} type="button" className="fl-cal-wd" aria-label={`${dayName(d)} ${dayOfMonth(d)}`} aria-pressed={d === sel}
            aria-current={d === p.today ? "date" : undefined} onClick={() => setPicked(d)}>
            <span>{dayName(d)}</span><b>{dayOfMonth(d)}</b><i hidden={byDay(d).length === 0} />
          </button>
        ))}
      </div>
      {events.length === 0 ? <p className="fl-cal-none">Nothing on this day.</p> : (
        <ul className="fl-cal-events">
          {events.map((r, i) => (
            <Fragment key={rowId(r) || i}>
            <li className={cx("fl-cal-ev", `fl-cal-t-${toneOf(r)}`)} {...selAttrs(p, r)}>
              <i aria-hidden="true" className={sampleFade(isSample(r))} />
              <div className="fl-cal-ev-main" {...pick(r, p.onSelect)}><b className={sampleFade(isSample(r))}>{p.title(r)}</b>{isSample(r) ? <> <SampleChip /></> : null}</div>
              {p.time ? <small className={sampleFade(isSample(r))}>{p.time(r)}</small> : null}
            </li>
            {inlineFor(p.expanded, rowId(r), (panel) => <li className="fl-cal-inline" data-fl-inline="">{panel}</li>)}
            </Fragment>
          ))}
        </ul>
      )}
      {p.onAdd ? <AddButton date={sel} onAdd={p.onAdd} /> : null}
    </>
  );
}

function WeekGrid<R>({ p, start, toneOf }: Common<R> & { start: string }) {
  const days = weekDays(start);
  const laneOf = (r: R) => p.lane?.(r) ?? "";
  const lanes = p.lanes ?? (() => { const seen: string[] = []; p.rows.forEach((r) => { const l = laneOf(r); if (!seen.includes(l)) seen.push(l); }); return seen.length ? seen : [""]; })();
  const cols = `minmax(72px, 72px) repeat(7, minmax(96px, 1fr))`;
  return (
    <div className="fl-cal-wg" role="grid" style={{ gridTemplateColumns: cols }}>
      <div role="row">
        <div className="fl-cal-gh" role="presentation" />
        {days.map((d) => (
          <div key={d} role="columnheader" className="fl-cal-gh" aria-current={d === p.today ? "date" : undefined}>{dayName(d)}<b>{dayOfMonth(d)}</b></div>
        ))}
      </div>
      {lanes.map((lane) => (
        <div role="row" key={lane}>
          <div role="rowheader" className="fl-cal-rh">{lane}</div>
          {days.map((d) => {
            const here = p.rows.filter((r) => iso10(p.date(r)) === d && laneOf(r) === lane);
            return (
              <div key={d} role="gridcell" className="fl-cal-cell" aria-label={`${dayName(d)} ${dayOfMonth(d)} ${lane}`.trim()}>
                {here.length === 0 ? <AddButton date={d} lane={lane || undefined} onAdd={p.onAdd} />
                  : here.map((r, i) => (
                    <div key={i} className={cx("fl-cal-pick", `fl-cal-t-${toneOf(r)}`)} {...selAttrs(p, r)} data-tone={p.tone ? toneOf(r) : undefined} {...pick(r, p.onSelect)}>{isSample(r) ? <><span className="fl-sample-fade">{p.title(r)}</span> <SampleChip /></> : p.title(r)}</div>
                  ))}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

function MonthView<R>({ p, anchor, byDay, byTime, toneOf }: Common<R> & { anchor: string; byDay: (d: string) => R[]; byTime: (a: R, b: R) => number }) {
  const weeks = monthMatrix(anchor);
  const month = monthIndex(anchor);
  const label = `${MONTHS[month]} ${anchor.slice(0, 4)}`;
  const [picked, setPicked] = useState<string | undefined>();
  return (
    <>
      <div className="fl-cal-cap">{label}</div>
      <div className="fl-cal-mo" role="grid" aria-label={label}>
        <div role="row">{WEEKDAYS.map((w) => <div key={w} role="columnheader" className="fl-cal-mo-h fl-cal-cap">{w}</div>)}</div>
        {weeks.map((wk) => (
          <div role="row" key={wk[0]}>
            {wk.map((d) => {
              const evs = byDay(d).sort(byTime);
              return (
                <div key={d} role="gridcell" className="fl-cal-mo-c" data-out={monthIndex(d) !== month} data-sel={d === picked} onClick={() => setPicked(d)} aria-current={d === p.today ? "date" : undefined}>
                  <span className="fl-cal-mo-n">{dayOfMonth(d)}</span>
                  <div className="fl-cal-chips">
                    {evs.slice(0, 3).map((r, i) => (
                      <div key={i} className={cx("fl-cal-chip", `fl-cal-t-${toneOf(r)}`)} {...selAttrs(p, r)} {...pick(r, p.onSelect)}>{isSample(r) ? <><span className="fl-sample-fade">{p.title(r)}</span><span className="fl-sample-sr"> (Sample)</span></> : p.title(r)}</div>
                    ))}
                    {evs.length > 3 ? <span className="fl-cal-more">+{evs.length - 3} more</span> : null}
                  </div>
                  {evs.length === 0 ? <AddButton date={d} onAdd={p.onAdd} /> : null}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </>
  );
}

function Timeline<R>({ p, dated, byTime, toneOf }: Common<R> & { dated: { r: R; d: string }[]; byTime: (a: R, b: R) => number }) {
  const days = [...new Set(dated.map((x) => x.d))].sort();
  return (
    <div className="fl-cal-tl">
      {days.map((d) => {
        const id = `fl-cal-d-${d}`;
        return (
          <section key={d} className="fl-cal-day" role="group" aria-labelledby={id}>
            <h3 id={id} className="fl-cal-dlab" data-today={d === p.today}>
              <span>{dayName(d)}</span><b>{dayOfMonth(d)}</b><small>{MONTHS[monthIndex(d)]}</small>
            </h3>
            <ul className="fl-cal-items">
              {dated.filter((x) => x.d === d).map((x) => x.r).sort(byTime).map((r, i) => { const trail = p.trailing?.(r); return (
                <Fragment key={rowId(r) || i}>
                <li className={cx("fl-cal-item", `fl-cal-t-${toneOf(r)}`)} {...selAttrs(p, r)}>
                  <div className="fl-cal-item-in" data-icon={p.icon?.(r) ? "true" : undefined} {...pick(r, p.onSelect)}>
                    <i aria-hidden="true" />
                    <time className={sampleFade(isSample(r))}>{p.time?.(r) ?? ""}</time>
                    {p.icon?.(r) ? <span className="fl-cal-ti" aria-hidden="true"><Icon name={p.icon(r)!} size={15} /></span> : null}
                    <b className={sampleFade(isSample(r))}>{p.title(r)}</b>
                  </div>
                  {isSample(r) ? <SampleChip /> : null}
                  {trail != null && trail !== false ? <div className={cx("fl-cal-trail", sampleSoft(isSample(r)))}>{trail}</div> : null}
                </li>
                {inlineFor(p.expanded, rowId(r), (panel) => <li className="fl-cal-inline" data-fl-inline="">{panel}</li>)}
                </Fragment>
              ); })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
