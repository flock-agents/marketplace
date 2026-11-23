import "./callout.css";
import type { ReactNode } from "react";
import { cx, type ToneT } from "../../tone";
import { Icon } from "../Icon/Icon";
export interface CalloutProps { tone?: ToneT; icon?: string; title?: string; children: ReactNode }
export function Callout({ tone = "neutral", icon, title, children }: CalloutProps) {
  return (
    <div role="note" className={cx("fl-callout", `fl-callout-${tone}`)}>
      {icon ? <Icon name={icon} size={16} /> : null}
      <div>{title ? <b>{title}</b> : null}{title ? " " : null}{children}</div>
    </div>
  );
}
