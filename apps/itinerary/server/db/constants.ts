// Plain constants, no imports: both the server schema and the browser pages read these.
export const KINDS = ["flight", "stay", "food", "do"] as const;
export const PEOPLE = ["Shared", "Maya", "Priya", "Ananya"] as const;
export const STATUSES = ["Confirmed", "Pending", "Cancelled"] as const;
