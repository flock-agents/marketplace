import "./columns.css";
import type { ReactNode } from "react";
import { cx } from "../../tone";
export type ColumnsRatio = "1:1" | "2:1" | "1:2" | "1:1:1";
export interface ColumnsProps { ratio?: ColumnsRatio; children: ReactNode }
export function Columns({ ratio = "1:1", children }: ColumnsProps) {
  return <div className={cx("fl-cols", `fl-cols-${ratio.replaceAll(":", "-")}`)}>{children}</div>;
}
