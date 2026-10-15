// Plain constants, no imports: both the server schema and the browser pages read these.

/** How often a reminder comes round. `none` is a one-off on its `due` date and time. */
export const REPEATS = ["none", "daily", "weekly", "monthly"] as const;

/** A family member's colour: a theme tone, never a hex colour. Their events and reminders carry it in the week view. */
export const COLOURS = ["accent", "info", "success", "warning", "danger"] as const;
