// The one list of step kinds and the event types they fit. The report validator, the outcome tally
// and the planning prompt's table are all built from this file, so they cannot drift apart.
export type EventType = "journey" | "stay" | "occasion" | "appointment" | "meeting" | "reminder" | "block" | "other";
export const EVENT_TYPES: readonly EventType[] = ["journey", "stay", "occasion", "appointment", "meeting", "reminder", "block", "other"];

// 1 = follows from the event; 2 = depends on the person (needs evidence); rule = fixed rule; judgement = facts and title decide.
export type Tier = 1 | 2 | "rule" | "judgement";
export interface KindSpec {
  kind: string; tier: Tier; types: EventType[]; for: string;
  defaultKey: string | null; // null: the key is free
  query?: string; // fixed memory search for the kind's habits (any of its words); never a word naming the event itself
}

/** How many facts each kind's fixed memory search reads and the planner is shown. */
export const KIND_FACTS_LIMIT = 3;
export const KINDS: readonly KindSpec[] = [
  { kind: "checkin", tier: 1, types: ["journey", "stay"], for: "web check-in for a flight", defaultKey: "checkin" },
  { kind: "cab-airport", tier: 1, types: ["journey", "stay"], for: "ride to the airport for the user's flight", defaultKey: "cab-airport", query: "drive airport cab" },
  { kind: "cab-station", tier: 1, types: ["journey", "stay"], for: "ride to a station or bus boarding point", defaultKey: "cab-station" },
  { kind: "pnr-check", tier: 1, types: ["journey", "stay"], for: "train chart / PNR status check", defaultKey: "pnr-check" },
  { kind: "book-opening", tier: 1, types: ["journey", "stay"], for: "book on the day booking opens", defaultKey: "book-tickets" },
  // A journey qualifies only when it comes with a stay; the prompt states that rule.
  { kind: "pack", tier: 1, types: ["stay", "journey"], for: "pack for a stay away from home", defaultKey: "pack" },
  { kind: "cab-local", tier: 2, types: ["appointment", "meeting"], for: "ride to an in-person place at its location", defaultKey: "cab", query: "cab Uber Ola drive" },
  { kind: "gift", tier: 2, types: ["occasion"], for: "gift for a birthday or anniversary", defaultKey: "gift", query: "gift" },
  { kind: "table-booking", tier: 2, types: ["occasion"], for: "reserve a table for a dinner or outing", defaultKey: "book-table", query: "table reservation" },
  { kind: "prepare-ahead", tier: "rule", types: ["meeting"], for: "prepare a presentation, demo, pitch or board deck", defaultKey: "prepare" },
  { kind: "documents", tier: "judgement", types: ["journey", "stay", "appointment"], for: "passport, visa, forms, papers to carry", defaultKey: null },
  { kind: "payment", tier: "judgement", types: ["journey", "stay", "occasion", "appointment"], for: "a fee or payment due before the event", defaultKey: null },
  { kind: "other", tier: "judgement", types: ["journey", "stay", "occasion", "appointment"], for: "anything else today's rules allow", defaultKey: null },
];

export function kindSpec(kind: string): KindSpec | undefined {
  return KINDS.find((k) => k.kind === kind);
}

// Markdown table rendered into the planning prompt.
export function kindTable(): string {
  const rows = KINDS.map((k) => {
    const key = k.defaultKey === null ? "free" : k.defaultKey === k.kind ? "same as kind" : `\`${k.defaultKey}\``;
    return `| \`${k.kind}\` | ${k.tier} | ${k.types.join(", ")} | ${k.for} | ${key} |`;
  });
  return ["| kind | tier | allowed on types | for | default key |", "|---|---|---|---|---|", ...rows].join("\n");
}

/** The person-dependent kinds whose steps record where they were for: a venue for a ride or a table, a person for a gift. */
export const PLACE_KINDS: readonly string[] = ["cab-local", "gift", "table-booking"];

const fold = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

/**
 * Where a step of this kind is for, so the owner's habit there can be learned: the venue (the location up to its first comma)
 * for cab-local and table-booking, the person (the title without a possessive, "birthday" or "anniversary") for gift.
 * Null for other kinds, an empty location, or a location that is a link.
 */
export function placeOf(kind: string, event: { title: string; location?: string | null }): string | null {
  if (kind === "cab-local" || kind === "table-booking") {
    const loc = event.location?.trim() ?? "";
    if (!loc || /^[a-z][a-z0-9+.-]*:\/\//i.test(loc)) return null;
    return fold(loc.split(",")[0]!) || null;
  }
  if (kind === "gift") {
    const person = event.title.replace(/['\u2019]s\b/gi, "").replace(/\b(birthday|anniversary)\b/gi, " ").replace(/[^\p{L}\p{N}\s]/gu, " ");
    return fold(person) || null;
  }
  return null;
}
