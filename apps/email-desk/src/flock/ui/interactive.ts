import type { KeyboardEvent, MouseEvent } from "react";
const INNER = "a,button,input,select,textarea,[role=button]";
/** A click that landed on the container itself or on plain content, not on a link or control inside it. */
export function ownClick(e: MouseEvent): boolean {
  const c = (e.target as Element).closest(INNER);
  return c === null || c === e.currentTarget;
}
/** Enter or Space pressed on the container itself, not bubbled up from a control inside it. */
export function ownActivate(e: KeyboardEvent): boolean {
  return (e.key === "Enter" || e.key === " ") && e.target === e.currentTarget;
}
