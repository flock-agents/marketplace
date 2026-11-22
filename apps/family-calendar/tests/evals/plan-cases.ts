// The plan-prep eval's cases. The expectations were written from what a parent would say the family must physically do before
// each event, BEFORE the planning prompt (flock.app.json routines[plan-prep].prompt) was written or read back. A failing case is
// fixed in the prompt, never by loosening the case.
//
// Each case is one event as plan-prep offers it (the payload shape of server/calendar.ts planPrep), on Sunday 22 Nov 2026, 10 am.

export const TODAY = "2026-11-22";

export interface CaseStep { key: string; title: string; due: string; show_from: string; closed: boolean }
export interface PlanCase {
  id: string;
  says: string;                       // what a parent would expect, in words
  event: { title: string; date: string; start_time: string | null; who: string | null; location: string | null; notes: string | null; kind: "event" | "deadline";
    sources: string[]; change: "new" | "moved"; was?: { date: string; start_time: string | null }; steps: CaseStep[] };
  /** How many steps the report may give this event. */
  steps: [min: number, max: number];
  /** Each group: at least one step's title must contain one of these words (lower case). */
  mustMention?: string[][];
  /** No step's title may contain any of these. */
  never?: string[];
  /** A step mentioning one of these words must be due on or before this date. */
  dueBy?: { words: string[]; date: string };
  /** A moved event: this open key must be reported again, re-dated on or before the new date, and no other new key added. */
  redate?: string;
}

const ev = (e: Partial<PlanCase["event"]> & Pick<PlanCase["event"], "title" | "date">): PlanCase["event"] =>
  ({ start_time: null, who: null, location: null, notes: null, kind: "event", sources: ["MyClassBoard"], change: "new", steps: [], ...e });

export const CASES: PlanCase[] = [
  { id: "annual-day-costume", says: "The school wants a farmer costume: buy or arrange it before the day. Nothing else.",
    event: ev({ title: "Annual Day", date: "2026-12-12", start_time: "10:00", who: "Agastya", location: "Greenwood High auditorium",
      notes: "Class 3 dance item. Children to come dressed as farmers; parents to arrange the costume (dhoti, turban, small basket)." }),
    steps: [1, 2], mustMention: [["costume", "dhoti", "turban", "outfit"]], dueBy: { words: ["costume", "dhoti", "turban", "outfit"], date: "2026-12-11" } },

  { id: "school-trip-form", says: "Sign and return the consent form by the 27th; the Rs 800 goes with it.",
    event: ev({ title: "School trip to Science City", date: "2026-12-04", who: "Agastya",
      notes: "Consent form must be signed and returned to the class teacher by 27 Nov, with Rs 800 in an envelope." }),
    steps: [1, 2], mustMention: [["form", "consent"]], dueBy: { words: ["form", "consent"], date: "2026-11-27" } },

  { id: "ptm", says: "A parent-teacher meeting needs nothing done before it.",
    event: ev({ title: "Parent-Teacher Meeting", date: "2026-12-05", start_time: "09:00", who: "Agastya", location: "Class 3B", notes: "Your slot: 9:00 to 9:10." }),
    steps: [0, 0] },

  { id: "fee-deadline", says: "Pay the fee by the due date. One step.",
    event: ev({ title: "Term 3 fee due", date: "2026-12-10", kind: "deadline", who: "Agastya", notes: "Rs 42,000. Pay through the school portal; a late fee applies after 10 Dec." }),
    steps: [1, 1], mustMention: [["pay", "fee"]], dueBy: { words: ["pay", "fee"], date: "2026-12-10" } },

  { id: "birthday-party", says: "A child's party invitation: buy a gift; saying yes to the host is fine too.",
    event: ev({ title: "Riya's 7th birthday party", date: "2026-12-06", start_time: "16:00", who: "Agastya", location: "Funcity, Koramangala",
      notes: "Invitation from Riya's mother. Please RSVP by 2 Dec.", sources: ["Shiva's email"] }),
    steps: [1, 2], mustMention: [["gift", "present"]], dueBy: { words: ["gift", "present"], date: "2026-12-06" } },

  { id: "family-flight", says: "The flight is booked. At most a cab to the airport or the web check-in; never booking or paying for the flight.",
    event: ev({ title: "Flight to Delhi (6E 2134)", date: "2026-12-20", start_time: "06:10", location: "Bengaluru airport T1",
      notes: "PNR K7QX2M, 4 passengers, booked and paid.", sources: ["Shiva's email"] }),
    steps: [0, 2], never: ["ticket", "pay"] },

  { id: "cancelled-in-title", says: "The source says it is cancelled: nothing to do.",
    event: ev({ title: "CANCELLED: Inter-school swimming gala", date: "2026-12-02", who: "Agastya", notes: "The gala stands cancelled because of pool maintenance. Do not send swimming kits." }),
    steps: [0, 0] },

  { id: "moved-with-step", says: "Annual Day moved two days earlier: re-date the costume step to before the new day, with its key, and add nothing.",
    event: ev({ title: "Annual Day", date: "2026-12-08", start_time: "10:00", who: "Agastya", notes: "Moved to Tuesday 8 Dec. Farmer costume as before.",
      change: "moved", was: { date: "2026-12-12", start_time: "10:00" },
      steps: [{ key: "buy-costume", title: "Buy Agastya's farmer costume", due: "2026-12-10", show_from: "2026-12-05", closed: false }] }),
    steps: [1, 1], redate: "buy-costume" },

  { id: "doctor-visit", says: "A booked check-up needs nothing bought, paid or signed before it.",
    event: ev({ title: "Paediatrician check-up", date: "2026-11-30", start_time: "17:30", who: "Agastya", location: "Rainbow Children's Hospital, Marathahalli",
      notes: "DTP booster due. Appointment confirmed.", sources: ["Shiva's email"] }),
    steps: [0, 1], never: ["book", "pay"] },

  { id: "vague-circular", says: "A circular with nothing asked of the family yet: nothing.",
    event: ev({ title: "Circular: winter uniform", date: "2026-12-01", notes: "Students may wear the winter uniform from December. Details to follow." }),
    steps: [0, 0] },
];
