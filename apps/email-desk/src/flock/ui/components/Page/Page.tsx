import "./page.css";
import type { ReactNode } from "react";
import { cx } from "../../tone";
export interface PageProps { title?: string; subtitle?: string; actions?: ReactNode; width?: "narrow" | "wide" | "full"; children: ReactNode }
export function Page({ title, subtitle, actions, width = "wide", children }: PageProps) {
  return (
    <div className={cx("fl-page", `fl-page-${width}`)}>
      {title || subtitle || actions ? (
        <header className="fl-page-head">
          <div>{title ? <h1>{title}</h1> : null}{subtitle ? <small>{subtitle}</small> : null}</div>
          {actions ? <div className="fl-page-actions">{actions}</div> : null}
        </header>
      ) : null}
      <div className="fl-page-body">{children}</div>
    </div>
  );
}
