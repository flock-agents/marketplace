// The plan-prep eval's cases. The expectations were written from what a parent would say the family must physically do before
// each event, BEFORE the planning prompt (flock.app.json routines[plan-prep].prompt) was written or read back. A failing case is
// fixed in the prompt, never by loosening the case.
//
// Round 2 (planner parity, contract addendum 2026-11-22): plan-prep takes Calendar Desk's planning rules (event types, step
// kinds, ties to existing TODOs, habits, long lead, moved re-dating). Every case now names the event's type and the kinds its
// steps may have, and the cases from "tie-existing-todo" on are Calendar Desk's planner cases adapted to family events
// (origin feat/calendar-desk-copies, apps/calendar-desk/evals/fixtures.ts). These expectations were written from Calendar
// Desk's rules and cases BEFORE the family prompt was rewritten.
//
// Each case is one event as plan-prep offers it (the payload shape of server/calendar.ts planPrep), on Sunday 22 Nov 2026, 10 am.

export const TODAY = "2026-11-22";
export const MEMBERS = ["Shiva", "Ankita", "Agastya", "Nani"];

export interface CaseStep { key: string; kind?: string; title: string; due: string; due_time?: string; show_from: string; closed: boolean }
export interface CaseTodo { id: string; title: string; dueDate?: string; source: "user" | "mail" | "app:family-calendar"; event?: string }
export interface PlanCase {
  id: string;
  says: string;                       // what a parent would expect, in words
  event: { title: string; date: string; start_time: string | null; who: string | null; location: string | null; notes: string | null; kind: "event" | "deadline";
    sources: string[]; change: "new" | "moved"; was?: { date: string; start_time: string | null }; steps: CaseStep[] };
  /** The types a correct report may give the event. */
  type: string[];
  /** How many steps the report may give this event. */
  steps: [min: number, max: number];
  /** The step kinds allowed here (any other is a failure); each of `required` must appear. */
  kinds?: { allowed?: string[]; required?: string[] };
  /** Each group: at least one step's title must contain one of these words (lower case). */
  mustMention?: string[][];
  /** No step's title may contain any of these. */
  never?: string[];
  /** A step mentioning one of these words must be due on or before this date. */
  dueBy?: { words: string[]; date: string };
  /** A moved event: this open key must be reported again, re-dated on or before the new date, and no other new key added;
   *  `due`/`due_time` when given are the exact re-dated values. */
  redate?: { key: string; due?: string; due_time?: string };
  /** The owner's TODO list (the reply to GET /api/internal/todos) and which of them must, or must not, be tied to this event. */
  todos?: CaseTodo[]; tie?: string[]; noTie?: string[];
  /** The `habits` block of the payload (Calendar Desk's shape). */
  habits?: Record<string, { tier: string | number; tally: "on" | "off" | "none"; facts: string[] }>;
}

const ev = (e: Partial<PlanCase["event"]> & Pick<PlanCase["event"], "title" | "date">): PlanCase["event"] =>
  ({ start_time: null, who: null, location: null, notes: null, kind: "event", sources: ["MyClassBoard"], change: "new", steps: [], ...e });

export const CASES: PlanCase[] = [
  { id: "annual-day-costume", says: "The school wants a farmer costume: buy or arrange it before the day. Nothing else.",
    event: ev({ title: "Annual Day", date: "2026-12-12", start_time: "10:00", who: "Agastya", location: "Greenwood High auditorium",
      notes: "Class 3 dance item. Children to come dressed as farmers; parents to arrange the costume (dhoti, turban, small basket)." }),
    type: ["occasion"], steps: [1, 2], kinds: { allowed: ["buy-for-event", "other"] },
    mustMention: [["costume", "dhoti", "turban", "outfit"]], dueBy: { words: ["costume", "dhoti", "turban", "outfit"], date: "2026-12-11" } },

  { id: "school-trip-form", says: "Sign and return the consent form by the 27th; the Rs 800 goes with it.",
    event: ev({ title: "School trip to Science City", date: "2026-12-04", who: "Agastya",
      notes: "Consent form must be signed and returned to the class teacher by 27 Nov, with Rs 800 in an envelope." }),
    type: ["occasion", "journey"], steps: [1, 2], kinds: { allowed: ["sign-and-return", "payment", "send-to-school"], required: ["sign-and-return"] },
    mustMention: [["form", "consent"]], dueBy: { words: ["form", "consent"], date: "2026-11-27" } },

  { id: "ptm", says: "A parent-teacher meeting needs nothing done before it.",
    event: ev({ title: "Parent-Teacher Meeting", date: "2026-12-05", start_time: "09:00", who: "Agastya", location: "Class 3B", notes: "Your slot: 9:00 to 9:10." }),
    type: ["meeting"], steps: [0, 0] },

  { id: "fee-deadline", says: "Pay the fee by the due date. One step.",
    event: ev({ title: "Term 3 fee due", date: "2026-12-10", kind: "deadline", who: "Agastya", notes: "Rs 42,000. Pay through the school portal; a late fee applies after 10 Dec." }),
    type: ["deadline"], steps: [1, 1], kinds: { allowed: ["payment"], required: ["payment"] },
    mustMention: [["pay", "fee"]], dueBy: { words: ["pay", "fee"], date: "2026-12-10" } },

  { id: "birthday-party", says: "A child's party invitation: buy a gift; saying yes to the host is fine too.",
    event: ev({ title: "Riya's 7th birthday party", date: "2026-12-06", start_time: "16:00", who: "Agastya", location: "Funcity, Koramangala",
      notes: "Invitation from Riya's mother. Please RSVP by 2 Dec.", sources: ["Shiva's email"] }),
    type: ["occasion"], steps: [1, 2], kinds: { allowed: ["gift", "send-to-school", "other"], required: ["gift"] },
    mustMention: [["gift", "present"]], dueBy: { words: ["gift", "present"], date: "2026-12-06" } },

  { id: "family-flight", says: "The flight is booked: the web check-in and a cab to the airport, as Calendar Desk does; never booking or paying for the flight.",
    event: ev({ title: "Flight to Delhi (6E 2134)", date: "2026-12-20", start_time: "06:10", location: "Bengaluru airport T1",
      notes: "PNR K7QX2M, 4 passengers, booked and paid.", sources: ["Shiva's email"] }),
    type: ["journey"], steps: [1, 2], kinds: { allowed: ["checkin", "cab-airport"] }, never: ["ticket", "pay"] },

  { id: "cancelled-in-title", says: "The source says it is cancelled: nothing to do.",
    event: ev({ title: "CANCELLED: Inter-school swimming gala", date: "2026-12-02", who: "Agastya", notes: "The gala stands cancelled because of pool maintenance. Do not send swimming kits." }),
    type: ["other"], steps: [0, 0] },

  { id: "moved-with-step", says: "Annual Day moved four days earlier: re-date the costume step by as much, with its key, and add nothing.",
    event: ev({ title: "Annual Day", date: "2026-12-08", start_time: "10:00", who: "Agastya", notes: "Moved to Tuesday 8 Dec. Farmer costume as before.",
      change: "moved", was: { date: "2026-12-12", start_time: "10:00" },
      steps: [{ key: "buy-costume", kind: "buy-for-event", title: "Buy Agastya's farmer costume", due: "2026-12-10", show_from: "2026-12-05", closed: false }] }),
    type: ["occasion"], steps: [1, 1], redate: { key: "buy-costume", due: "2026-12-06" } },

  { id: "doctor-visit", says: "A booked check-up: at most a cab to the hospital (Calendar Desk's judgement for a real place away from home); nothing bought, paid or signed.",
    event: ev({ title: "Paediatrician check-up", date: "2026-11-30", start_time: "17:30", who: "Agastya", location: "Rainbow Children's Hospital, Marathahalli",
      notes: "DTP booster due. Appointment confirmed.", sources: ["Shiva's email"] }),
    type: ["appointment"], steps: [0, 1], kinds: { allowed: ["cab-local"] }, never: ["pay"] },

  { id: "vague-circular", says: "A circular with nothing asked of the family yet: nothing.",
    event: ev({ title: "Circular: winter uniform", date: "2026-12-01", notes: "Students may wear the winter uniform from December. Details to follow." }),
    type: ["other"], steps: [0, 0] },

  // --- Calendar Desk's planner cases, adapted to family events -------------------------------------------------------------
  { id: "tie-existing-todo", says: "The family already has 'sign the trip form' on its list: tie it to the trip, and make no form step.",
    event: ev({ title: "School trip to Bannerghatta", date: "2026-12-03", who: "Agastya", notes: "Signed consent form to the class teacher by 26 Nov." }),
    todos: [{ id: "t-form", title: "Sign Agastya's Bannerghatta trip form", dueDate: "2026-11-26", source: "user" },
      { id: "t-milk", title: "Pay the milk bill", dueDate: "2026-11-25", source: "user" }],
    type: ["occasion", "journey"], steps: [0, 1], tie: ["t-form"], noTie: ["t-milk"], never: ["form", "consent", "sign"] },

  { id: "same-place-is-not-the-same-occasion", says: "A TODO for another child's recital at the same school is not about Annual Day: no tie; Annual Day still gets its own costume step.",
    event: ev({ title: "Annual Day", date: "2026-12-12", start_time: "10:00", who: "Agastya", location: "Greenwood High auditorium",
      notes: "Children to come dressed as farmers; parents to arrange the costume." }),
    todos: [{ id: "t-recital", title: "Buy Meera's costume for the Greenwood dance recital", dueDate: "2026-11-28", source: "user" }],
    type: ["occasion"], steps: [1, 2], noTie: ["t-recital"], kinds: { allowed: ["buy-for-event", "other"] }, mustMention: [["costume", "dhoti", "outfit"]] },

  { id: "passport-renewal-for-trip", says: "A holiday abroad with a passport that expires: renew it at least three weeks before the flight; check-in and the airport cab as for any flight.",
    event: ev({ title: "Flight to Singapore (SQ 509), family holiday", date: "2027-01-30", start_time: "23:40", location: "Bengaluru airport T2",
      notes: "Agastya's passport expires on 15 Feb 2027; Singapore needs 6 months' validity. Renew it before travel.", sources: ["Shiva's email"] }),
    type: ["journey", "stay"], steps: [1, 3], kinds: { allowed: ["documents", "checkin", "cab-airport", "pack"], required: ["documents"] },
    mustMention: [["passport"]], dueBy: { words: ["passport"], date: "2027-01-09" } },

  { id: "cab-skipped-twice", says: "The family dismissed the last two airport cabs as not important: no cab step, the check-in still.",
    event: ev({ title: "Flight to Pune (AI 803)", date: "2026-11-28", start_time: "11:20", location: "Bengaluru airport T1", notes: "Booked for 2.", sources: ["Ankita's email"] }),
    habits: { "cab-airport": { tier: 1, tally: "off", facts: [] } },
    type: ["journey"], steps: [1, 1], kinds: { allowed: ["checkin"], required: ["checkin"] }, never: ["cab", "taxi"] },

  { id: "moved-timed-step-keeps-lead-time", says: "Sports day moved a day later: the 7 am kit step moves with it, same key, same lead (7:00 on the new day).",
    event: ev({ title: "Sports Day", date: "2026-12-06", start_time: "08:00", who: "Agastya", location: "Greenwood High grounds", notes: "Moved to Sunday because of rain.",
      change: "moved", was: { date: "2026-12-05", start_time: "08:00" },
      steps: [{ key: "pack-kit", kind: "buy-for-event", title: "Get Agastya's house T-shirt ready", due: "2026-12-05", due_time: "07:00", show_from: "2026-12-04", closed: false }] }),
    type: ["occasion"], steps: [1, 1], redate: { key: "pack-kit", due: "2026-12-06", due_time: "07:00" } },

  { id: "reminder-nothing", says: "A note to call someone gets nothing.",
    event: ev({ title: "Call the plumber about the geyser", date: "2026-11-24", start_time: "10:00", sources: ["Family group"] }),
    type: ["reminder"], steps: [0, 0] },

  { id: "family-birthday-dinner", says: "Nani's 80th: she is family, so a gift; the table is already booked, so no table step.",
    event: ev({ title: "Nani's 80th birthday dinner", date: "2026-12-13", start_time: "19:30", location: "Karavalli, Residency Road",
      notes: "Table booked for 12 under Shiva.", sources: ["Shiva's email"] }),
    type: ["occasion"], steps: [1, 1], kinds: { allowed: ["gift"], required: ["gift"] }, never: ["table", "book"] },

  { id: "train-tier-1", says: "A booked train: a cab to the station and the chart / PNR check, nothing else.",
    event: ev({ title: "Train 12007 Shatabdi to Chennai", date: "2026-11-25", start_time: "06:00", location: "KSR Bengaluru", notes: "PNR 4521897623, 3 passengers.", sources: ["Shiva's email"] }),
    type: ["journey"], steps: [2, 2], kinds: { allowed: ["cab-station", "pnr-check"], required: ["cab-station", "pnr-check"] } },
];
