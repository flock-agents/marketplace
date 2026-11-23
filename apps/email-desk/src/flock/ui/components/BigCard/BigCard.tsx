import "./bigcard.css";
import "../PropertyChips/chips.css";
import { Value, type ValueKind } from "../Value/Value";
import { cx } from "../../tone";
import { Image } from "../Image/Image";
/** One labelled row on a card (owner 2026-10-21: side-by-side comparison cards). */
export interface BigCardFact { label: string; value: string | number; kind?: ValueKind }
export interface BigCardProps { label?: string; title: string; value?: string | number; kind?: ValueKind; unit?: string; caption?: string; chips?: string[]; facts?: BigCardFact[]; image?: string }
/** TypeScript-only state the renderer owns; agents never set these. */
export interface BigCardState { as?: "div" | "button"; chosen?: boolean; faded?: boolean; badge?: string; disabled?: boolean; onClick?: () => void }
function FactRow({ fact, tag: Tag }: { fact: BigCardFact; tag: "span" | "div" }) {
  return <Tag className="fl-ocard-fact"><span className="fl-ocard-fact-l">{fact.label}</span><span className="fl-ocard-fact-v"><Value kind={fact.kind ?? (typeof fact.value === "number" ? "number" : "text")} value={fact.value} /></span></Tag>;
}
export function BigCard({ label, title, value, kind, unit, caption, chips, facts, image, as = "div", chosen, faded, badge, disabled, onClick }: BigCardProps & BigCardState) {
  const body = (
    <>
      {chosen ? <span className="fl-ocard-badge">{badge ?? "Chosen"}</span> : null}
      {image ? <span className="fl-ocard-img"><Image src={image} alt={title} ratio="4:3" inline /></span> : null}
      {label ? <span className="fl-ocard-label">{label}</span> : null}
      <b className="fl-ocard-title">{title}</b>
      {value !== undefined && value !== "" ? (
        <span className="fl-ocard-value"><Value kind={kind ?? (typeof value === "number" ? "number" : "text")} value={value} />{unit ? <small>{unit}</small> : null}</span>
      ) : null}
      {caption ? <span className="fl-ocard-caption">{caption}</span> : null}
      {facts && facts.length ? (as === "button"
        // a button may hold only phrasing content: the rows are spans there
        ? <span className="fl-ocard-facts">{facts.map((f, i) => <FactRow key={`${f.label}-${i}`} fact={f} tag="span" />)}</span>
        : <div className="fl-ocard-facts">{facts.map((f, i) => <FactRow key={`${f.label}-${i}`} fact={f} tag="div" />)}</div>) : null}
      {chips && chips.length ? (as === "button"
        // a button may hold only phrasing content: the chips are spans there
        ? <span className="fl-props">{chips.map((c, i) => <span className="fl-prop" key={`${c}-${i}`}>{c}</span>)}</span>
        : <ul className="fl-props">{chips.map((c, i) => <li className="fl-prop" key={`${c}-${i}`}>{c}</li>)}</ul>) : null}
    </>
  );
  if (as === "button") {
    return (
      <button type="button" className={cx("fl-ocard", chosen && "fl-ocard-on", faded && !chosen && "fl-ocard-off")} aria-pressed={!!chosen} disabled={disabled} onClick={onClick}>{body}</button>
    );
  }
  return <div className="fl-info">{body}</div>;
}
