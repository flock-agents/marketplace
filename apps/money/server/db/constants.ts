// Plain constants, no imports: both the server schema and the browser pages read these.
export const CATEGORIES = ["Salary", "Freelance", "Interest & dividends", "Other income", "Rent", "Groceries", "Eating out", "Travel", "Utilities", "Shopping", "Investments"] as const;
export const KINDS = ["Equity funds", "Index funds", "Stocks", "Fixed deposits", "Gold", "PPF"] as const;
/** Money in under these is income. Add new kinds of income here (and to CATEGORIES). */
export const INCOME_CATEGORIES = ["Salary", "Freelance", "Interest & dividends", "Other income"] as const;
/** Money out under INVESTMENTS is invested; money in is a redemption. Any other positive amount is a refund and nets against its category. */
export const INVESTMENTS = "Investments";
/** Gain on what was put in, as a percentage to one decimal: the Change column of a holding. */
export const changePct = (value: number, invested: number): number | null => (invested > 0 ? Math.round(((value - invested) / invested) * 1000) / 10 : null);

/** What the Overview leads with. "auto": net worth once the owner has real (not sample) holdings, this month's spending before that. */
export const OVERVIEW_LEADS = ["auto", "spending", "netWorth"] as const;
export const overviewLeadProblem = (v: unknown): string | null =>
  typeof v === "string" && (OVERVIEW_LEADS as readonly string[]).includes(v) ? null : `overviewLead must be one of ${OVERVIEW_LEADS.join(", ")}`;

/** App settings (also listed in flock.app.json): changing one needs no code change. */
export const SETTINGS = [
  { key: "overviewLead", type: "string" as const, default: "auto", scope: "owner" as const,
    label: 'What the Overview leads with: "spending" (this month\'s spending: a budget or running-costs app), "netWorth" (investments and wealth), or "auto" (net worth once real holdings are added). Set it from what the app is for',
    check: overviewLeadProblem, rules: { pattern: "^(auto|spending|netWorth)$", message: "overviewLead must be one of auto, spending, netWorth" } },
];
