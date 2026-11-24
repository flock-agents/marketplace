import "../Button/button.css";
import { Children, cloneElement, isValidElement, useEffect, useRef, useState, type ReactElement, type ReactNode } from "react";
import { Button } from "../Button/Button";
import { Choice, type Answer, type ChoiceProps } from "../Choice/Choice";
import { MiniFrame, type MakeAppState } from "../MiniApp/MiniApp";
import type { TabItem } from "../Tabs/Tabs";
export interface QuestionsProps {
  title?: string; subtitle?: string; makeApp?: boolean; submitLabel?: string;
  answers?: Record<string, Answer>; disabled?: boolean;
  onChange: (a: Record<string, Answer>) => void; onSubmit: (a: Record<string, Answer>) => void; onMakeApp?: () => void; makeAppState?: MakeAppState;
  children: ReactNode;
}
export function Questions({ title = "", subtitle, makeApp, submitLabel = "Send answers", answers, disabled, onChange, onSubmit, onMakeApp, makeAppState, children }: QuestionsProps) {
  const qs = Children.toArray(children).filter((c): c is ReactElement<ChoiceProps> => isValidElement(c) && c.type === Choice);
  const keys = qs.map((q) => q.props.tab ?? q.props.question ?? "");
  const [local, setLocal] = useState<Record<string, Answer>>(answers ?? {});
  const [submitted, setSubmitted] = useState(false);
  const firstOpen = (a: Record<string, Answer>) => Math.max(0, keys.findIndex((k) => !a[k]));
  const [open, setOpen] = useState(() => firstOpen(answers ?? {}));
  // `answers` is renderer-owned: take it again whenever its content changes (a reload restoring state).
  const seen = useRef(JSON.stringify(answers));
  useEffect(() => {
    const now = JSON.stringify(answers);
    if (now !== seen.current) { seen.current = now; setLocal(answers ?? {}); }
  }, [answers]);

  const locked = !!disabled || submitted;
  const done = keys.filter((k) => local[k]).length;
  const answer = (i: number, a: Answer) => {
    if (locked) return;
    const next = { ...local, [keys[i]]: a };
    setLocal(next);
    onChange(next);
    const order = keys.map((_, j) => (i + 1 + j) % keys.length);
    const nextOpen = order.find((j) => !next[keys[j]]);
    if (nextOpen !== undefined) setOpen(nextOpen);
  };
  const submit = () => {
    if (locked || done < keys.length) return;
    setSubmitted(true);
    onSubmit(local);
  };
  const tabs: TabItem[] = qs.map((_, i) => ({ id: String(i), label: keys[i], icon: local[keys[i]] ? "check" : undefined, done: !!local[keys[i]] }));
  const panels = qs.map((q, i) => ({
    id: String(i),
    node: cloneElement(q, { answer: local[keys[i]] ?? null, disabled: locked, onAnswer: (a: Answer) => answer(i, a) }),
  }));
  return (
    <MiniFrame title={title} subtitle={subtitle} makeApp={makeApp} onMakeApp={onMakeApp} makeAppState={makeAppState} tabs={tabs} active={String(open)} onTab={(id) => setOpen(Number(id))} panels={panels}
      footer={<>
        <span className="fl-mini-count">{done} of {keys.length} chosen</span>
        <Button disabled={locked || done < keys.length} onClick={submit}>{submitLabel}</Button>
      </>} />
  );
}
