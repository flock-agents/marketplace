import "./states.css";
import type { ReactNode } from "react";
import { ObjectIcon } from "../ObjectIcon/ObjectIcon";
export interface EmptyProps { title: string; hint?: string; object?: string; action?: ReactNode }
export function Empty({ title, hint, object, action }: EmptyProps) {
  return (
    <div className="fl-empty">
      {object ? <ObjectIcon name={object} size={48} /> : null}
      <b>{title}</b>{hint ? <small>{hint}</small> : null}{action}
    </div>
  );
}
