// The Zepp adapter's fixed parts: its connector, who its rows are written by, and how far back each pass reads.
import { syncAuthor } from "../types";

export const ZEPP_ID = "zepp";
/** The marketplace Zepp connector the app calls, as the paired coach (the person's own Zepp login stays in the connector). */
export const ZEPP_SKILL_ID = "zepp";
/** Who the sync's rows are written by, as the kit records it ("app:zepp-sync", unchanged from the hand-built app). */
export const SYNC_AUTHOR = syncAuthor(ZEPP_ID);
/** How many days back each pass reads: a missed run, or numbers Zepp synced late, are caught up within this window. */
export const LOOKBACK_DAYS = 7;
