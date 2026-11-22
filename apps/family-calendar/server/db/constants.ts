// Plain constants, no imports: both the server schema and the browser pages read these.

/** How often an event happens. `none` is a one-off on its `date`. A repeating event happens every day, every week on its date's
 *  weekday, every month on its date's day or every year on its date (a 29 February on the 28th in other years), from its `date` on. */
export const REPEATS = ["none", "daily", "weekly", "monthly", "yearly"] as const;

/** A family member's colour: a theme tone, never a hex colour. Their events carry it in the week view. */
export const COLOURS = ["accent", "info", "success", "warning", "danger"] as const;

/** What an event is: something that happens (`event`), or a day something is due by (`deadline`: a fee, a form, a renewal). */
export const KINDS = ["event", "deadline"] as const;

/** An event stays on the calendar when it is called off: `cancelled`, shown struck through on its day. */
export const STATUSES = ["active", "cancelled"] as const;

/** A to-do of an event: `open` until someone ticks it (`done`), or the app takes it back (`withdrawn`: its event was cancelled). */
export const TODO_STATUSES = ["open", "done", "withdrawn"] as const;
