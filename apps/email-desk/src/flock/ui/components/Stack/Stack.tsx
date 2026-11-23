import "./stack.css";
import type { ReactNode } from "react";
import { cx } from "../../tone";
export type Gap = "xs" | "sm" | "md" | "lg";
export interface StackProps { gap?: Gap; align?: "start" | "center" | "end"; children: ReactNode }
/** Things one under another, spaced by the scale (COMPONENTS.md "Layout"): the way to space a custom block's parts. */
export function Stack({ gap = "md", align, children }: StackProps) {
  return <div className={cx("fl-stack", `fl-gap-${gap}`, align && `fl-align-${align}`)}>{children}</div>;
}
export interface RowProps { gap?: Gap; align?: "start" | "center" | "end" | "baseline"; justify?: "start" | "between" | "end"; wrap?: boolean; children: ReactNode }
/** Things side by side, spaced by the scale, wrapping when they do not fit: chips, buttons, a label and its value. */
export function Row({ gap = "sm", align = "center", justify, wrap = true, children }: RowProps) {
  return <div className={cx("fl-hstack", `fl-gap-${gap}`, `fl-align-${align}`, justify && `fl-justify-${justify}`, wrap && "fl-hstack-wrap")}>{children}</div>;
}
