import type { MonthTotals } from "./shared";

export type LeadSetting = "auto" | "spending" | "netWorth";
/** The stored overviewLead setting, or "auto" when it is missing or not one of the three. */
export const leadSetting = (raw: unknown): LeadSetting => (raw === "spending" || raw === "netWorth" ? raw : "auto");

/** What the Overview leads with. `realHoldings` counts only the owner's own holdings (the template's samples do not count). "auto":
 *  holdings make it a wealth page (net worth first); without any it is a spending page (a budget, running costs) and this month's
 *  spending leads. "spending" and "netWorth" force it, set from the app's purpose when it is made. */
export function overviewLead(realHoldings: number, now: Pick<MonthTotals, "income" | "expenses"> | undefined, setting: LeadSetting = "auto"): { hero: "netWorth" | "spending"; strip: ("income" | "spent" | "saved")[] } {
  const hero = setting === "auto" ? (realHoldings > 0 ? "netWorth" : "spending") : setting;
  if (!now) return { hero, strip: [] };
  if (hero === "spending") return { hero, strip: now.income > 0 ? ["income", "saved"] : [] };
  return { hero, strip: ["income", "spent", "saved"] };
}
