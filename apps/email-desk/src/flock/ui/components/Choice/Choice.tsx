import "./choice.css";
import "../Button/button.css";
import "../Field/field.css";
import { useEffect, useId, useRef, useState } from "react";
import { BigCard, type BigCardProps } from "../BigCard/BigCard";
import { Button } from "../Button/Button";
import { cx } from "../../tone";
export type OptionCard = BigCardProps;
export type Answer = { picked: string[] } | { written: string };
export interface ChoiceProps {
  question?: string; tab?: string; options: (string | OptionCard)[]; multi?: boolean; write?: boolean;
  answer?: Answer | null; disabled?: boolean; submitLabel?: string; onAnswer: (a: Answer) => void;
}
const keyOf = (o: string | OptionCard) => (typeof o === "string" ? o : o.title);
/** Ruling 48: in chat the card row scrolls sideways; it says which edge has more cards past it so the CSS can fade
 * that edge (a class toggle, no re-render). Apps carry the classes too but style nothing on them. */
function markEdges(row: HTMLElement) {
  const max = row.scrollWidth - row.clientWidth;
  row.classList.toggle("fl-ocards-more-l", max > 1 && row.scrollLeft > 1);
  row.classList.toggle("fl-ocards-more-r", max > 1 && row.scrollLeft < max - 1);
}
function useEdgeMarks(cards: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const row = ref.current;
    if (!cards || !row) return;
    const mark = () => markEdges(row);
    mark();
    row.addEventListener("scroll", mark, { passive: true });
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(mark);
    ro?.observe(row);
    return () => { row.removeEventListener("scroll", mark); ro?.disconnect(); };
  }, [cards]);
  return ref;
}
export function Choice({ question, options, multi, write = true, answer, disabled, submitLabel = "Send", onAnswer }: ChoiceProps) {
  const ownId = useId();
  const [sel, setSel] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const picked = answer && "picked" in answer ? answer.picked : null;
  const written = answer && "written" in answer ? answer.written : null;
  const answered = !!answer;
  const on = (k: string) => (answered ? !!picked?.includes(k) : multi ? sel.includes(k) : false);
  const press = (k: string) => {
    if (disabled) return;
    if (!multi) { onAnswer({ picked: [k] }); return; }
    setSel((s) => (s.includes(k) ? s.filter((x) => x !== k) : [...s, k]));
  };
  const send = () => { onAnswer({ picked: options.map(keyOf).filter((k) => sel.includes(k)) }); };
  const useDraft = () => { const t = draft.trim(); if (t && !disabled) onAnswer({ written: t }); };
  const cards = options.length > 0 && typeof options[0] !== "string";
  const rowRef = useEdgeMarks(cards);
  return (
    <div className="fl-choice" role="group" aria-label={question}>
      {question ? <p className="fl-choice-q">{question}</p> : null}
      {cards ? (
        // a card reached by keyboard is brought fully into the sideways-scrolling row
        <div className="fl-ocards" ref={rowRef}
          onFocus={(e) => { if (e.target !== e.currentTarget) e.target.scrollIntoView?.({ block: "nearest", inline: "nearest" }); }}>
          {(options as OptionCard[]).map((o) => (
            <BigCard key={o.title} {...o} as="button" chosen={on(o.title)} faded={answered} disabled={disabled} onClick={() => press(o.title)} />
          ))}
          {written !== null ? <BigCard as="button" label="Written by you" title={written} chosen faded={answered} disabled={disabled} onClick={() => setDraft(written)} /> : null}
        </div>
      ) : (
        <div className="fl-choice-opts">
          {(options as string[]).map((o) => (
            <button key={o} type="button" className={cx("fl-btn", "fl-btn-soft", "fl-choice-opt")} aria-pressed={on(o)} disabled={disabled} onClick={() => press(o)}>{o}</button>
          ))}
          {written !== null ? <button type="button" className={cx("fl-btn", "fl-btn-soft", "fl-choice-opt")} aria-pressed disabled={disabled} onClick={() => setDraft(written)}>Written by you: {written}</button> : null}
        </div>
      )}
      {multi ? <span className="fl-choice-send"><Button disabled={disabled || sel.length === 0} onClick={send}>{submitLabel}</Button></span> : null}
      {write ? (
        <div className="fl-mini-write">
          <label className="fl-sr" htmlFor={ownId}>Your own answer</label>
          <input id={ownId} className="fl-inp" type="text" value={draft} placeholder="Or write your own answer…" disabled={disabled}
            onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing) { e.preventDefault(); useDraft(); } }} />
          <Button variant="soft" disabled={disabled || !draft.trim()} onClick={useDraft}>Use this</Button>
        </div>
      ) : null}
    </div>
  );
}
