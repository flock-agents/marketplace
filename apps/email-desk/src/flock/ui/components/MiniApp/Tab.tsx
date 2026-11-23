import type { ReactNode } from "react";
export interface TabProps { label: string; count?: string; children: ReactNode }
/** A marker for MiniApp: MiniApp reads its label and count and shows its children when the tab is open. */
export function Tab({ children }: TabProps) { return <>{children}</>; }
