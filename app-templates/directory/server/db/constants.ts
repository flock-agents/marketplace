// Plain constants, no imports: both the server schema and the browser pages read these.
/** Suggestions, not a closed list: a kind is any short text (Doctor, Tailor, ...); the pages offer these and the kinds already in use. */
export const KINDS = ["Plumber", "Electrician", "Restaurant", "Cafe", "Tiffin service", "Cleaning", "Appliance repair", "Nursery", "Other"] as const;
