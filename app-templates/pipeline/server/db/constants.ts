// Plain constants, no imports: both the server schema and the browser pages read these.
/** The stages, left to right. Agents must use exactly these; a deal with any other stage is not shown on the board. */
export const STAGES = ["Lead", "Talking", "Proposal", "Won", "Lost"] as const;
