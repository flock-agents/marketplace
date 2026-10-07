// The one list of step kinds and the event types they fit. The report validator, the outcome tally
// and the planning prompt's table are all built from this file, so they cannot drift apart.
export type EventType = "journey" | "stay" | "occasion" | "appointment" | "meeting" | "reminder" | "block" | "other";
export const EVENT_TYPES: readonly EventType[] = ["journey", "stay", "occasion", "appointment", "meeting", "reminder", "block", "other"];

// 1 = follows from the event; 2 = depends on the person (needs evidence); rule = fixed rule; judgement = facts and title decide.
export type Tier = 1 | 2 | "rule" | "judgement";
export interface KindSpec {
  kind: string; tier: Tier; types: EventType[]; for: string;
  defaultKey: string | null; // null: the key is free
  query?: string; // fixed memory search for the kind's habits
  // The one-time card for a Tier 2 kind, and when an event needs the kind: its type is `on` and, with `words`, its title has one
  // of them as a whole word (case-folded). A meeting is never listed: its cab-local needs evidence and never asks.
  ask?: { title: string; yes: string; no: string; on: EventType; words?: string[] };
}

const DONT = "Don't remind me";
export const KINDS: readonly KindSpec[] = [
  { kind: "checkin", tier: 1, types: ["journey", "stay"], for: "web check-in for a flight", defaultKey: "checkin" },
  { kind: "cab-airport", tier: 1, types: ["journey", "stay"], for: "ride to the airport for the user's flight", defaultKey: "cab-airport", query: "drive airport cab" },
  { kind: "cab-station", tier: 1, types: ["journey", "stay"], for: "ride to a station or bus boarding point", defaultKey: "cab-station" },
  { kind: "pnr-check", tier: 1, types: ["journey", "stay"], for: "train chart / PNR status check", defaultKey: "pnr-check" },
  { kind: "book-opening", tier: 1, types: ["journey", "stay"], for: "book on the day booking opens", defaultKey: "book-tickets" },
  // A journey qualifies only when it comes with a stay; the prompt states that rule.
  { kind: "pack", tier: 1, types: ["stay", "journey"], for: "pack for a stay away from home", defaultKey: "pack" },
  { kind: "cab-local", tier: 2, types: ["appointment", "meeting"], for: "ride to an in-person place at its location", defaultKey: "cab",
    query: "cab Uber Ola drive appointment", ask: { title: "Remind you to book a cab before appointments?", yes: "Book a cab reminder", no: DONT, on: "appointment" } },
  { kind: "gift", tier: 2, types: ["occasion"], for: "gift for a birthday or anniversary", defaultKey: "gift",
    query: "gift birthday", ask: { title: "Remind you to buy a gift before family birthdays?", yes: "Gift reminder", no: DONT, on: "occasion", words: ["birthday", "anniversary"] } },
  { kind: "table-booking", tier: 2, types: ["occasion"], for: "reserve a table for a dinner or outing", defaultKey: "book-table",
    query: "restaurant table reservation", ask: { title: "Remind you to book a table before dinners out?", yes: "Table reminder", no: DONT, on: "occasion",
      words: ["dinner", "lunch", "brunch", "restaurant", "table", "outing"] } },
  { kind: "prepare-ahead", tier: "rule", types: ["meeting"], for: "prepare a presentation, demo, pitch or board deck", defaultKey: "prepare" },
  { kind: "documents", tier: "judgement", types: ["journey", "stay", "appointment"], for: "passport, visa, forms, papers to carry", defaultKey: null },
  { kind: "payment", tier: "judgement", types: ["journey", "stay", "occasion", "appointment"], for: "a fee or payment due before the event", defaultKey: null },
  { kind: "other", tier: "judgement", types: ["journey", "stay", "occasion", "appointment"], for: "anything else today's rules allow", defaultKey: null },
];

export function kindSpec(kind: string): KindSpec | undefined {
  return KINDS.find((k) => k.kind === kind);
}

/**
 * The Tier 2 kinds an event of this type and title would need, decided in code so the same event always gets the same answer.
 * A cab-local needs the event's location, as the report validator does.
 */
export function kindsToAsk(type: EventType, title: string, location: string | null | undefined): string[] {
  const words = new Set(title.toLowerCase().match(/\p{L}+/gu) ?? []);
  return KINDS.filter((k) => k.ask && k.ask.on === type
    && (!k.ask.words || k.ask.words.some((w) => words.has(w)))
    && (k.kind !== "cab-local" || !!location?.trim())).map((k) => k.kind);
}

// Markdown table rendered into the planning prompt.
export function kindTable(): string {
  const rows = KINDS.map((k) => {
    const key = k.defaultKey === null ? "free" : k.defaultKey === k.kind ? "same as kind" : `\`${k.defaultKey}\``;
    return `| \`${k.kind}\` | ${k.tier} | ${k.types.join(", ")} | ${k.for} | ${key} |`;
  });
  return ["| kind | tier | allowed on types | for | default key |", "|---|---|---|---|---|", ...rows].join("\n");
}
