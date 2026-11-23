// Plain constants, no imports: both the server schema and the browser pages read these.

/** How often an event happens. `none` is a one-off on its `date`. A repeating event happens every day, every week on its date's
 *  weekday, every month on its date's day or every year on its date (a 29 February on the 28th in other years), from its `date` on. */
export const REPEATS = ["none", "daily", "weekly", "monthly", "yearly"] as const;

/** How a monthly event comes round (`monthly_by`; empty is `date`): on its date's day of the month (`date`: the 6th), on the same
 *  weekday of the month as its date (`weekday`: 6 Dec 2026 is the 1st Sunday, so every 1st Sunday), or on the last such weekday
 *  of the month (`last_weekday`: its date is a last Friday, so every last Friday). */
export const MONTHLY_BY = ["date", "weekday", "last_weekday"] as const;

/** A family member's colour: a theme tone, never a hex colour. Their events carry it in the week view. */
export const COLOURS = ["accent", "info", "success", "warning", "danger"] as const;

/** What an event is: something that happens (`event`), or a day something is due by (`deadline`: a fee, a form, a renewal). */
export const KINDS = ["event", "deadline"] as const;

/** An event stays on the calendar when it is called off: `cancelled`, shown struck through on its day. */
export const STATUSES = ["active", "cancelled"] as const;

/** A to-do of an event: `open` until someone ticks it (`done`), the app takes it back (`withdrawn`: its event was cancelled), or
 *  Flock finds the family already has a TODO for that work (`covered`: tied to the event there, never made again here). */
export const TODO_STATUSES = ["open", "done", "withdrawn", "covered"] as const;
