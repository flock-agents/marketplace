// Plain constants, no imports: both the server schema and the browser pages read these.

/** How often a reminder comes round, or an event happens. `none` is a one-off: a reminder on its `due` date and time, an
 *  event on its `date`. A repeating event happens every day, every week on its date's weekday, or every month on its date's
 *  day, from its `date` on. */
export const REPEATS = ["none", "daily", "weekly", "monthly"] as const;

/** A family member's colour: a theme tone, never a hex colour. Their events and reminders carry it in the week view. */
export const COLOURS = ["accent", "info", "success", "warning", "danger"] as const;
