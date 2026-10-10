// Plain constants, no imports: both the server schema and the browser pages read these.
export const CATEGORIES = ["Salary", "Freelance", "Interest & dividends", "Other income", "Rent", "Groceries", "Eating out", "Travel", "Utilities", "Shopping", "Investments"] as const;
export const KINDS = ["Equity funds", "Index funds", "Stocks", "Fixed deposits", "Gold", "PPF"] as const;
/** Money in under these is income. Add new kinds of income here (and to CATEGORIES). */
export const INCOME_CATEGORIES = ["Salary", "Freelance", "Interest & dividends", "Other income"] as const;
/** Money out under INVESTMENTS is invested; money in is a redemption. Any other positive amount is a refund and nets against its category. */
export const INVESTMENTS = "Investments";
/** Gain on what was put in, as a percentage to one decimal: the Change column of a holding. */
export const changePct = (value: number, invested: number): number | null => (invested > 0 ? Math.round(((value - invested) / invested) * 1000) / 10 : null);
