import "./card.css";
import type { ReactNode } from "react";
import { cx } from "../../tone";
export interface CardProps { title?: ReactNode; meta?: ReactNode; actions?: ReactNode; onClick?: () => void; children?: ReactNode; emphasis?: "plain" | "subtle" }
export function Card({ title, meta, actions, onClick, children, emphasis = "plain" }: CardProps) {
  // A clickable card is not itself a button: that would wrap the action buttons. The title is a real button whose
  // ::after stretches over the card, and the actions sit above that overlay.
  const titleNode = onClick
    ? <button type="button" className="fl-card-hit" onClick={onClick} aria-label={title ? undefined : "Open"}>{title}</button>
    : title;
  return (
    <div className={cx("fl-card", emphasis === "subtle" && "fl-card-subtle", onClick && "fl-card-click")}>
      {titleNode || meta || actions ? (
        <header className="fl-card-head">
          <div className="fl-card-text">{titleNode ? <b className="fl-card-title">{titleNode}</b> : null}{meta ? <small className="fl-card-meta">{meta}</small> : null}</div>
          {actions ? <div className="fl-card-actions">{actions}</div> : null}
        </header>
      ) : null}
      {children ? <div className="fl-card-body">{children}</div> : null}
    </div>
  );
}
