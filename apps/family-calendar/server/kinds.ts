// The one list of step kinds and the event types they fit, for plan-prep and plan_done: Calendar Desk's (origin
// feat/calendar-desk-copies, apps/calendar-desk/server/kinds.ts) as they are, with a family calendar's differences only:
// the type `deadline` (a day something is due by: a fee, a form, a renewal; the calendar's own `kind: "deadline"`), and three
// family kinds, `sign-and-return`, `buy-for-event` and `send-to-school`. The report validator, the habits tally and the
// planning prompt's table are all built from this file, so they cannot drift apart.
export type EventType = "journey" | "stay" | "occasion" | "appointment" | "meeting" | "reminder" | "block" | "other" | "deadline";
export const EVENT_TYPES: readonly EventType[] = ["journey", "stay", "occasion", "appointment", "meeting", "reminder", "block", "other", "deadline"];

// 1 = follows from the event; 2 = depends on the person (the planner judges it: rule 5); rule = fixed rule; judgement = the event decides.
export type Tier = 1 | 2 | "rule" | "judgement";
export interface KindSpec { kind: string; tier: Tier; types: EventType[]; for: string; defaultKey: string | null }

export const KINDS: readonly KindSpec[] = [
  { kind: "checkin", tier: 1, types: ["journey", "stay"], for: "web check-in for a flight", defaultKey: "checkin" },
  { kind: "cab-airport", tier: 1, types: ["journey", "stay"], for: "ride to the airport for the family's flight", defaultKey: "cab-airport" },
  { kind: "cab-station", tier: 1, types: ["journey", "stay"], for: "ride to a station or bus boarding point", defaultKey: "cab-station" },
  { kind: "pnr-check", tier: 1, types: ["journey", "stay"], for: "train chart / PNR status check", defaultKey: "pnr-check" },
  { kind: "book-opening", tier: 1, types: ["journey", "stay"], for: "book on the day booking opens", defaultKey: "book-tickets" },
  { kind: "pack", tier: 1, types: ["stay", "journey"], for: "pack for a stay away from home", defaultKey: "pack" },
  { kind: "cab-local", tier: 2, types: ["appointment", "meeting"], for: "ride to an in-person place at its location", defaultKey: "cab" },
  { kind: "gift", tier: 2, types: ["occasion"], for: "gift for a birthday, an anniversary or a party the family is invited to", defaultKey: "gift" },
  { kind: "table-booking", tier: 2, types: ["occasion"], for: "reserve a table for a dinner or outing", defaultKey: "book-table" },
  { kind: "prepare-ahead", tier: "rule", types: ["meeting"], for: "prepare a presentation, demo, pitch or board deck", defaultKey: "prepare" },
  { kind: "documents", tier: "judgement", types: ["journey", "stay", "appointment", "deadline"], for: "passport, visa, forms, papers to carry or renew", defaultKey: null },
  { kind: "payment", tier: "judgement", types: ["journey", "stay", "occasion", "appointment", "deadline"], for: "a fee or payment due before the event", defaultKey: null },
  { kind: "sign-and-return", tier: "judgement", types: ["occasion", "journey", "stay", "appointment", "deadline"], for: "a consent form or slip to sign and hand back", defaultKey: null },
  { kind: "buy-for-event", tier: "judgement", types: ["occasion", "journey", "stay", "appointment"], for: "something the event asks the family to buy or get ready: a costume, supplies, a kit", defaultKey: null },
  { kind: "send-to-school", tier: "judgement", types: ["occasion", "journey", "appointment", "deadline"], for: "something to send or hand in: a photo, a copy of a document, money in an envelope, a reply", defaultKey: null },
  { kind: "other", tier: "judgement", types: ["journey", "stay", "occasion", "appointment", "deadline"], for: "anything else today's rules allow", defaultKey: null },
];

export const kindSpec = (kind: string): KindSpec | undefined => KINDS.find((k) => k.kind === kind);
/** Types no kind fits: a reminder, a block, an other and a meeting outside its two kinds get no steps. */
export const typeTakesSteps = (t: EventType): boolean => KINDS.some((k) => k.types.includes(t));

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
const plain = (s: string) => fold(s.replace(/[^\p{L}\p{M}\p{N}\s]/gu, " "));
const MEETING_HOST = /\b(meet\.google\.com|zoom\.us|teams\.microsoft\.com)\b/i;

/** Where a step of this kind is for (Calendar Desk's placeOf): the venue for cab-local and table-booking, the person for gift. */
export function placeOf(kind: string, event: { title: string; location?: string | null }): string | null {
  if (kind === "cab-local" || kind === "table-booking") {
    const loc = event.location?.trim() ?? "";
    if (!loc || loc.includes("://") || MEETING_HOST.test(loc)) return null;
    return plain(loc.split(",")[0]!) || null;
  }
  if (kind === "gift") {
    const person = event.title.replace(/&/g, " and ").replace(/['’]s\b/gi, "").replace(/\b\d+(st|nd|rd|th)\b/gi, " ")
      .replace(/\b(birthday|anniversary|party|bash|celebration|day|dinner|lunch)\b/gi, " ");
    return plain(person) || null;
  }
  return null;
}
