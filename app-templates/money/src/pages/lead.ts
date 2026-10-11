import type { MonthTotals } from "./shared";

/** What the Overview leads with. Holdings make it a wealth page (net worth first); without any, the app is being used for
 *  spending (a budget, running costs), so this month's spending leads and the net-worth card waits until investments are added. */
export function overviewLead(holdingCount: number, now: Pick<MonthTotals, "income" | "expenses"> | undefined): { hero: "netWorth" | "spending"; strip: ("income" | "spent" | "saved")[] } {
  const hero = holdingCount > 0 ? "netWorth" : "spending";
  if (!now) return { hero, strip: [] };
  if (hero === "spending") return { hero, strip: now.income > 0 ? ["income", "saved"] : [] };
  return { hero, strip: ["income", "spent", "saved"] };
}
