import "./states.css";
import { cx } from "../../tone";
export interface SkeletonProps { lines?: number; variant?: "row" | "card" | "stat" }
export function Skeleton({ lines = 3, variant = "row" }: SkeletonProps) {
  return <div className={cx("fl-skeleton", `fl-skeleton-${variant}`)} aria-hidden="true">{Array.from({ length: lines }, (_, i) => <i key={i} />)}</div>;
}
