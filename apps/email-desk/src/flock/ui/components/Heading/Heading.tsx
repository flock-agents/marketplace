import "./heading.css";
import type { ReactNode } from "react";
export interface HeadingProps { level?: 1 | 2 | 3; children: ReactNode; subtitle?: string }
export function Heading({ level = 2, children, subtitle }: HeadingProps) {
  const Tag = `h${level}` as "h1" | "h2" | "h3";
  return (
    <div className="fl-heading">
      <Tag className={`fl-h${level}`}>{children}</Tag>
      {subtitle ? <p className="fl-heading-sub">{subtitle}</p> : null}
    </div>
  );
}
