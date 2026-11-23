import "./section.css";
import type { ReactNode } from "react";
import { cx } from "../../tone";
export interface SectionProps { title?: string; actions?: ReactNode; emphasis?: "plain" | "subtle"; children: ReactNode }
export function Section({ title, actions, emphasis = "plain", children }: SectionProps) {
  return (
    <section className={cx("fl-section", `fl-section-${emphasis}`)}>
      {title || actions ? (
        <div className="fl-section-head">
          {title ? <h2>{title}</h2> : null}
          {actions ? <div className="fl-section-actions">{actions}</div> : null}
        </div>
      ) : null}
      <div className="fl-section-body">{children}</div>
    </section>
  );
}
