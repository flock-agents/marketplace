/**
 * Saved planning cases for Calendar Desk's planner: the 26 PLAN_CASES of core's pa-brief-planner.fixtures.ts
 * converted to Calendar Desk's bundle shape, plus "a multi-day stay gets a packing step".
 *
 * The expectations were written from the spec's rules before any prompt was read; a failing case is fixed in
 * planning-instructions.md (then re-embedded), never by loosening a case. All names are invented.
 *
 * A case describes the STATE (events in the store, steps already made, the user's TODOs); harness.ts builds the real
 * bundle from it with runPlanning. Every case also carries `answer`: a correct reply, used by the dry test to prove
 * the fixture and its grader agree without a model.
 */
export const pad = (n: number) => String(n).padStart(2, "0");
export const ymdOf = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const TODAY = ymdOf(new Date());
/** Date `n` days after `today` (both YYYY-MM-DD). */
export function isoAdd(today: string, n: number): string {
  const [y, m, d] = today.split("-").map(Number);
  return ymdOf(new Date(y!, m! - 1, d! + n));
}
/** The local moment of a date and HH:MM (the process zone is the owner's zone, as Calendar Desk assumes). */
export const localMs = (date: string, time = "00:00") => { const [y, m, d] = date.split("-").map(Number); const [hh, mm] = time.split(":").map(Number); return new Date(y!, m! - 1, d!, hh, mm).getTime(); };
export const NOW = localMs(TODAY, "07:50");

export interface Step { key: string; title: string; dueDate: string; dueTime?: string; showFrom?: string; why: string }
export interface ExistingStep { key: string; title: string; duePlus: number; dueTime?: string; showPlus?: number; closed?: true }
export interface Guest { email: string; name?: string; rsvp?: "yes" | "no" | "maybe" | "awaiting" }
export interface EventSpec {
  ref: string; title: string; source: "google" | "memory"; plus: number; date: string; time?: string; facts: string[]; guests?: Guest[]; location?: string;
  /** "changed": the event was planned before at this date/time and has moved. */
  movedFrom?: { plus: number; time?: string };
  steps?: ExistingStep[];
  /** Already planned and unchanged: in the store (so a TODO can name it) but never offered. */
  offered?: false;
}
export interface TodoSpec { id: string; title: string; duePlus?: number; by: "you" | "mail" | "calendar-desk"; /** the pointer it is already tied to */ tiedTo?: string }
export interface Answer { steps: Record<string, Step[]>; ties: { todo: string; ref: string }[] }
/** What the model did, translated back to fixture refs. */
export interface Outcome { steps: Record<string, Step[]>; ties: { todo: string; ref: string }[] }
export interface PlanCase {
  id: string; events: EventSpec[]; todos?: TodoSpec[]; /** Epoch ms the run happens at (default NOW, 07:50). */ now?: number;
  expect: (o: Outcome) => string[]; answer: Answer;
}

// --- grader helpers -----------------------------------------------------------------------
export const stepsFor = (o: Outcome, ref: string): Step[] => o.steps[ref] ?? [];
export const tieFor = (o: Outcome, todo: string, ref: string) => o.ties.find((t) => t.todo === todo && t.ref === ref);
export const anyFor = (o: Outcome, ref: string): string[] => [...stepsFor(o, ref).map((s) => `step ${s.key}`), ...o.ties.filter((t) => t.ref === ref).map((t) => `tie ${t.todo}`)];
export const showOf = (s: Step): string => s.showFrom ?? s.dueDate;
export const text = (s: Step) => `${s.title ?? ""} ${s.why ?? ""}`;
export const titleOf = (s: Step) => `${s.title ?? ""}`;
export const CHECK_IN = /check[\s-]?in/i;
export const GIFT = /\b(gift|present)\b/i;
const CAB = /\b(cab|taxi|ride)\b/i;
const TRAVEL = /\b(cab|taxi|ride|travel|commute|leave)\b/i;

export function stepDateProblems(id: string, o: Outcome, e: { ref: string; date: string }, hiddenUntilLater = false): string[] {
  const p: string[] = [];
  for (const s of stepsFor(o, e.ref)) {
    if (!(s.dueDate <= e.date)) p.push(`${id}: step "${s.title}" dueDate ${s.dueDate} is after the event (${e.date})`);
    if (!(showOf(s) <= s.dueDate)) p.push(`${id}: step "${s.title}" showFrom ${s.showFrom} is after its dueDate ${s.dueDate}`);
    if (hiddenUntilLater && showOf(s) <= TODAY && s.dueDate > TODAY) p.push(`${id}: step "${s.title}" shows today (${showOf(s)}) but is due ${s.dueDate}`);
  }
  return p;
}

// --- builders -----------------------------------------------------------------------------
const D = (n: number) => isoAdd(TODAY, n);
const ev = (ref: string, o: { title: string; source: "google" | "memory"; plus: number; time?: string; facts?: string[]; guests?: Guest[]; location?: string; movedFrom?: { plus: number; time?: string }; steps?: ExistingStep[]; offered?: false }): EventSpec =>
  ({ ref, facts: [], ...o, date: D(o.plus) });
const step = (key: string, title: string, dueDate: string, showFrom?: string, dueTime?: string, why = "planned for the event"): Step => ({ key, title, dueDate, ...(dueTime ? { dueTime } : {}), ...(showFrom ? { showFrom } : {}), why });
const none: Answer = { steps: {}, ties: [] };

const FLIGHT = "Flight 6E-512 BLR→MAA";
const flight2 = ev("e1", { title: FLIGHT, source: "memory", plus: 2, time: "06:10" });
const flight6 = ev("e1", { title: FLIGHT, source: "memory", plus: 6, time: "06:40" });
const bday6 = ev("e2", { title: "Kavya Example's birthday", source: "memory", plus: 6 }); // no facts: who she is is unknown
const bday6Daughter = ev("e2", { title: "Kavya Example's birthday", source: "memory", plus: 6, facts: ["Kavya Example is the user's daughter."] });
const bday4 = ev("e1", { title: "Kavya Example's birthday", source: "memory", plus: 4, facts: ["Kavya Example is the user's daughter."] });
const bday5 = ev("e1", { title: "Kavya Example's birthday", source: "memory", plus: 5 });
const webinar = ev("e2", { title: "Webinar: Growth hacks 101", source: "memory", plus: 3 });
const holiday = ev("e1", { title: "Gandhi Jayanti (holiday)", source: "google", plus: 0 });
const checkin = (due: number, show = due) => step("checkin", "Web check-in: 6E-512", D(due), D(show));
const HAMPI = "Stay at The Loft - Homestay Hampi (Day 1 of 3)";
const hampi = () => ev("e1", { title: HAMPI, source: "google", plus: 7, steps: [{ key: "travel", title: "Arrange travel to Hampi", duePlus: 6, showPlus: 4 }, { key: "pack", title: "Pack for Hampi trip", duePlus: 6, showPlus: 4 }] });
const GUESTS_YOGESH: Guest[] = [{ name: "Yogesh", email: "yogesh@crafo.ai", rsvp: "yes" }, { email: "ravi@acme.com", rsvp: "awaiting" }];
const LOFT = ev("e1", { title: "Stay at The Loft - Aadhya Homestay Hampi (Day 1 of 3)", source: "google", plus: 6, location: "Huligi, Karnataka 583234, India" });

export const PLAN_CASES: PlanCase[] = [
  {
    id: "flight-in-2-days", events: [flight2],
    expect: (o) => {
      const p: string[] = [];
      if (stepsFor(o, "e1").length !== 1) p.push(`flight-in-2-days: ${stepsFor(o, "e1").length} steps for e1, expected exactly 1`);
      if (!stepsFor(o, "e1").some((s) => CHECK_IN.test(text(s)))) p.push("flight-in-2-days: no check-in step");
      return [...p, ...stepDateProblems("flight-in-2-days", o, flight2)];
    },
    answer: { steps: { e1: [checkin(1)] }, ties: [] },
  },
  {
    id: "flight-in-6-days", events: [flight6],
    expect: (o) => {
      // Every offered event is marked planned afterwards, so "nothing" would leave the flight unplanned for good:
      // a check-in step is required, hidden until after today.
      const p: string[] = [];
      if (!stepsFor(o, "e1").some((s) => CHECK_IN.test(text(s)))) p.push("flight-in-6-days: no check-in step (the flight is never offered again)");
      for (const s of stepsFor(o, "e1")) if (!(showOf(s) > TODAY)) p.push(`flight-in-6-days: step "${s.title}" shows today (${showOf(s)})`);
      return [...p, ...stepDateProblems("flight-in-6-days", o, flight6, true)];
    },
    answer: { steps: { e1: [checkin(5)] }, ties: [] },
  },
  // Owner decision 13: a birthday from memory gets a step ONLY if memory says who the person is. Guards are
  // paired with a positive in the same bundle so a do-nothing model fails instead of passing vacuously.
  {
    id: "birthday-in-6-days", events: [flight2, bday6],
    expect: (o) => {
      const p: string[] = [];
      if (!stepsFor(o, "e1").some((s) => CHECK_IN.test(text(s)))) p.push("birthday-in-6-days: no check-in step for the flight (guard: the model must act on events)");
      if (anyFor(o, "e2").length) p.push(`birthday-in-6-days: ${anyFor(o, "e2").join(", ")} for a birthday with no known relation, expected nothing`);
      return p;
    },
    answer: { steps: { e1: [checkin(1)], e2: [] }, ties: [] },
  },
  {
    id: "birthday-close-family", events: [bday4],
    expect: (o) => {
      const p: string[] = [];
      const gift = stepsFor(o, "e1").filter((s) => GIFT.test(text(s)));
      if (!gift.length) p.push("birthday-close-family: no gift step for the user's daughter's birthday");
      for (const s of gift) if (!(s.dueDate < bday4.date)) p.push(`birthday-close-family: gift step dueDate ${s.dueDate} is not before the birthday (${bday4.date})`);
      return p;
    },
    answer: { steps: { e1: [step("gift", "Buy a birthday gift for Kavya", D(3), D(1))] }, ties: [] },
  },
  {
    id: "newsletter-webinar", events: [flight2, webinar],
    expect: (o) => {
      const p: string[] = [];
      if (!stepsFor(o, "e1").some((s) => CHECK_IN.test(text(s)))) p.push("newsletter-webinar: no check-in step for the flight (guard: the model must act on events)");
      if (anyFor(o, "e2").length) p.push(`newsletter-webinar: ${anyFor(o, "e2").join(", ")} for the webinar, expected nothing`);
      return p;
    },
    answer: { steps: { e1: [checkin(1)], e2: [] }, ties: [] },
  },
  {
    id: "holiday", events: [holiday, bday6Daughter],
    expect: (o) => {
      const p: string[] = [];
      if (!stepsFor(o, "e2").length) p.push("holiday: no step for the birthday (guard: the model must act on events)");
      if (anyFor(o, "e1").length) p.push(`holiday: ${anyFor(o, "e1").join(", ")} for the holiday, expected nothing`);
      return p;
    },
    answer: { steps: { e1: [], e2: [step("gift", "Buy a birthday gift for Kavya", D(5), D(3))] }, ties: [] },
  },
  {
    id: "user-todo-exists-for-event", events: [flight2],
    todos: [{ id: "task-o1-checkin", title: "Do web check-in for the Chennai flight", duePlus: 1, by: "you" }],
    expect: (o) => {
      const p: string[] = [];
      if (!tieFor(o, "task-o1-checkin", "e1")) p.push("user-todo-exists-for-event: o1 is not tied to e1");
      if (stepsFor(o, "e1").some((s) => CHECK_IN.test(titleOf(s)))) p.push("user-todo-exists-for-event: a check-in step although the user has their own check-in TODO");
      return p;
    },
    answer: { steps: { e1: [] }, ties: [{ todo: "task-o1-checkin", ref: "e1" }] },
  },
  {
    id: "email-todo-exists-for-event", events: [bday5],
    todos: [{ id: "task-c1-gift", title: "Buy a gift for Kavya's birthday", duePlus: 3, by: "mail" }],
    expect: (o) => {
      const p: string[] = [];
      if (!tieFor(o, "task-c1-gift", "e1")) p.push("email-todo-exists-for-event: o1 is not tied to e1");
      if (stepsFor(o, "e1").some((s) => GIFT.test(titleOf(s)))) p.push("email-todo-exists-for-event: a gift step although the mail TODO already covers it");
      return p;
    },
    answer: { steps: { e1: [] }, ties: [{ todo: "task-c1-gift", ref: "e1" }] },
  },

  // --- long lead, urgent and changed events ---------------------------------------------------
  {
    id: "passport-renewal-for-trip",
    events: [ev("e1", { title: "Trip to Lisbon", source: "google", plus: 45, facts: ["The user's passport expires 3 weeks after the trip ends.", "Lisbon is outside India, so the trip needs a valid passport."] })],
    expect: (o) => {
      const p: string[] = [];
      const trip = D(45);
      const steps = stepsFor(o, "e1").filter((s) => /passport/i.test(text(s)));
      if (!steps.length) return ["passport-renewal-for-trip: no passport renewal step"];
      for (const s of steps) {
        // Renewal + visa are serial multi-week processes: showing it today is right ("never late, maybe early").
        if (!(s.dueDate <= isoAdd(trip, -21))) p.push(`passport-renewal-for-trip: step "${s.title}" dueDate ${s.dueDate} is not at least 21 days before the trip (${trip})`);
      }
      return [...p, ...stepDateProblems("passport-renewal-for-trip", o, { date: trip, ref: "e1" })];
    },
    answer: { steps: { e1: [step("passport", "Renew passport", D(20), D(5))] }, ties: [] },
  },
  {
    id: "train-booking-opens-60-days-before",
    events: [ev("e1", { title: "Train 99001 to Jaipur", source: "google", plus: 70, time: "07:15", facts: ["Railway tickets for this train open for booking 60 days before departure."] })],
    expect: (o) => {
      const p: string[] = [];
      const opens = D(10); // event day (+70) minus 60
      const steps = stepsFor(o, "e1").filter((s) => /book|ticket/i.test(text(s)));
      if (!steps.length) return ["train-booking-opens-60-days-before: no booking step"];
      for (const s of steps) {
        if (showOf(s) < opens) p.push(`train-booking-opens-60-days-before: step "${s.title}" shows ${showOf(s)}, before booking opens (${opens})`);
        else if (showOf(s) > isoAdd(opens, 3)) p.push(`train-booking-opens-60-days-before: step "${s.title}" shows ${showOf(s)}, more than 3 days after booking opens (${opens})`);
      }
      return [...p, ...stepDateProblems("train-booking-opens-60-days-before", o, { date: D(70), ref: "e1" })];
    },
    answer: { steps: { e1: [step("book-tickets", "Book train tickets for Jaipur", D(10), D(10))] }, ties: [] },
  },
  {
    id: "colleague-conference-nothing-to-prepare",
    events: [flight2, ev("e2", { title: "Conference: Cloud Native Day (Meera Example is speaking)", source: "google", plus: 45 })],
    expect: (o) => {
      const p: string[] = [];
      if (!stepsFor(o, "e1").some((s) => CHECK_IN.test(text(s)))) p.push("colleague-conference-nothing-to-prepare: no check-in step for the flight (guard: the model must act on events)");
      if (anyFor(o, "e2").length) p.push(`colleague-conference-nothing-to-prepare: ${anyFor(o, "e2").join(", ")} for a colleague's conference, expected nothing`);
      return p;
    },
    answer: { steps: { e1: [checkin(1)], e2: [] }, ties: [] },
  },
  {
    id: "flight-tomorrow-0600-seen-at-2100", now: localMs(TODAY, "21:00"),
    events: [ev("e1", { title: "Flight 6E-204 BLR→DEL", source: "memory", plus: 1, time: "06:00" })],
    expect: (o) => {
      const p: string[] = [];
      const tomorrow = D(1);
      const urgent = stepsFor(o, "e1").filter((s) => CHECK_IN.test(text(s)) || /\b(cab|taxi|ride|airport)\b/i.test(text(s)));
      if (!urgent.length) return ["flight-tomorrow-0600-seen-at-2100: no check-in or cab step"];
      for (const s of stepsFor(o, "e1")) {
        if (s.dueDate < TODAY || s.dueDate > tomorrow) p.push(`flight-tomorrow-0600-seen-at-2100: step "${s.title}" dueDate ${s.dueDate} is not tonight or tomorrow`);
        if (s.dueDate === tomorrow && !(s.dueTime && s.dueTime < "06:00")) p.push(`flight-tomorrow-0600-seen-at-2100: step "${s.title}" is due tomorrow without a time before 06:00 (${s.dueTime ?? "no time"})`);
        if (s.dueDate === TODAY && s.dueTime !== undefined && !(s.dueTime > "21:00")) p.push(`flight-tomorrow-0600-seen-at-2100: step "${s.title}" is due today at ${s.dueTime}, which has already passed at 21:00`);
        if (showOf(s) > TODAY) p.push(`flight-tomorrow-0600-seen-at-2100: step "${s.title}" stays hidden until ${showOf(s)}; the owner must see it tonight`);
      }
      return p;
    },
    answer: { steps: { e1: [step("checkin", "Web check-in: 6E-204", D(1), TODAY, "05:00")] }, ties: [] },
  },
  {
    id: "changed-event-redates-same-step",
    events: [ev("e1", { title: FLIGHT, source: "memory", plus: 4, time: "06:10", movedFrom: { plus: 2, time: "06:10" }, steps: [{ key: "checkin", title: "Web check-in: 6E-512", duePlus: 1, dueTime: "20:00", showPlus: 1 }] })],
    expect: (o) => {
      const p: string[] = [];
      const steps = stepsFor(o, "e1");
      const same = steps.filter((s) => s.key === "checkin");
      if (!same.length) p.push("changed-event-redates-same-step: no step with the existing key \"checkin\" (the event moved 2 days later)");
      for (const s of same) if (!(s.dueDate > D(1))) p.push(`changed-event-redates-same-step: step "checkin" dueDate ${s.dueDate} was not moved later than the old ${D(1)}`);
      for (const s of steps) if (s.key !== "checkin" && CHECK_IN.test(text(s))) p.push(`changed-event-redates-same-step: a new key "${s.key}" for the check-in work that "checkin" already covers`);
      return [...p, ...stepDateProblems("changed-event-redates-same-step", o, { date: D(4), ref: "e1" })];
    },
    answer: { steps: { e1: [checkin(3)] }, ties: [] },
  },

  // --- moved events: in Calendar Desk a move keeps the event's key, so the old step is in `steps` of a "changed" event ----
  {
    id: "moved-flight-reattaches-old-step",
    events: [ev("e1", { title: FLIGHT, source: "memory", plus: 3, time: "06:10", movedFrom: { plus: 5, time: "06:10" }, steps: [{ key: "checkin", title: "Web check-in: 6E-512", duePlus: 4, showPlus: 4 }] })],
    expect: (o) => {
      const p: string[] = [];
      const steps = stepsFor(o, "e1");
      const same = steps.filter((s) => s.key === "checkin");
      if (!same.length) p.push("moved-flight-reattaches-old-step: no step with the existing key \"checkin\" for e1");
      for (const s of same) if (!(s.dueDate <= D(3))) p.push(`moved-flight-reattaches-old-step: step "checkin" dueDate ${s.dueDate} is after the new departure (${D(3)})`);
      for (const s of steps) if (s.key !== "checkin" && CHECK_IN.test(titleOf(s))) p.push(`moved-flight-reattaches-old-step: a new key "${s.key}" for the check-in work that "checkin" already covers`);
      return [...p, ...stepDateProblems("moved-flight-reattaches-old-step", o, { date: D(3), ref: "e1" })];
    },
    answer: { steps: { e1: [checkin(2)] }, ties: [] },
  },
  {
    id: "moved-event-later-keeps-step",
    events: [ev("e1", { title: "Dentist appointment", source: "google", plus: 10, time: "11:00", movedFrom: { plus: 6, time: "11:00" }, steps: [{ key: "cab", title: "Book a cab to the dentist", duePlus: 6, showPlus: 6 }] })],
    expect: (o) => {
      const p: string[] = [];
      for (const s of stepsFor(o, "e1")) if (s.key !== "cab" && CAB.test(titleOf(s))) p.push(`moved-event-later-keeps-step: a new key "${s.key}" for a cab that "cab" already covers`);
      return [...p, ...stepDateProblems("moved-event-later-keeps-step", o, { date: D(10), ref: "e1" })];
    },
    answer: { steps: { e1: [step("cab", "Book a cab to the dentist", D(9), D(9))] }, ties: [] },
  },
  // A recurring event: the earlier session's step shows in the user's TODOs already tied to ITS event, so it is never tied
  // to the new one; the new session gets its own cab under the same key (owner 2026-10-05).
  {
    id: "recurring-event-keeps-its-own-steps",
    events: [
      ev("e1", { title: "Physio session", source: "google", plus: 7, time: "10:00" }),
      { ...ev("e9", { title: "Physio session", source: "google", plus: 1, time: "10:00", offered: false }) },
    ],
    todos: [{ id: "task-s1-cab", title: "Book a cab to physio", duePlus: 1, by: "calendar-desk", tiedTo: "e9" }],
    expect: (o) => {
      const p: string[] = [];
      if (tieFor(o, "task-s1-cab", "e1")) p.push("recurring-event-keeps-its-own-steps: the earlier physio session's step was tied to the new one");
      if (!stepsFor(o, "e1").some((s) => CAB.test(titleOf(s)))) p.push("recurring-event-keeps-its-own-steps: the new physio session got no cab step of its own");
      return p;
    },
    answer: { steps: { e1: [step("cab", "Book a cab to physio", D(6), D(6))] }, ties: [] },
  },
  // --- event details (2026-10-06): guests and location are context; the title leads -------------------------
  {
    id: "meeting-with-guests-gets-nothing",
    events: [ev("e1", { title: "Design review", source: "google", plus: 2, time: "16:00", guests: GUESTS_YOGESH })],
    expect: (o) => (stepsFor(o, "e1").length ? [`meeting-with-guests-gets-nothing: steps planned for a meeting: ${stepsFor(o, "e1").map(titleOf).join("; ")}`] : []),
    answer: none,
  },
  {
    id: "clinic-invite-is-an-appointment",
    events: [ev("e1", { title: "Physio session", source: "google", plus: 3, time: "10:00", guests: [{ name: "Apollo Front Desk", email: "frontdesk@apolloclinic.in", rsvp: "yes" }], location: "Apollo Clinic, Indiranagar" })],
    expect: (o) => {
      const travel = stepsFor(o, "e1").filter((s) => TRAVEL.test(text(s)));
      if (!travel.length) return ["clinic-invite-is-an-appointment: no travel step for an appointment at a clinic"];
      return travel.some((s) => /apollo|indiranagar/i.test(text(s))) ? [] : ["clinic-invite-is-an-appointment: the travel step does not name the place"];
    },
    answer: { steps: { e1: [step("cab", "Book a cab to Apollo Clinic, Indiranagar", D(2), D(2))] }, ties: [] },
  },
  {
    id: "solo-entry-with-location",
    events: [ev("e1", { title: "Visit Inprime office", source: "google", plus: 2, time: "11:30", location: "Inprime office, HSR Layout" })],
    expect: (o) => stepsFor(o, "e1").filter((s) => /\b(prepare|prep|agenda|notes|deck|slides)\b/i.test(text(s)) && !/\b(cab|travel|ride)\b/i.test(text(s)))
      .map((s) => `solo-entry-with-location: a meeting-prep step for a solo visit: "${titleOf(s)}"`),
    answer: { steps: { e1: [step("cab", "Book a cab to Inprime office, HSR Layout", D(1), D(1))] }, ties: [] },
  },
  {
    // A self-entered appointment has no guests: the title, not the missing guests, says what it is (I2).
    id: "self-entered-appointment-with-location",
    events: [ev("e1", { title: "Dentist appointment", source: "google", plus: 3, time: "17:00", location: "Smile Dental, Koramangala" })],
    expect: (o) => {
      const travel = stepsFor(o, "e1").filter((s) => TRAVEL.test(text(s)));
      if (!travel.length) return ["self-entered-appointment-with-location: no travel step for a dentist appointment the user entered alone"];
      return travel.some((s) => /smile|koramangala/i.test(text(s))) ? [] : ["self-entered-appointment-with-location: the travel step does not name the place"];
    },
    answer: { steps: { e1: [step("cab", "Book a cab to Smile Dental, Koramangala", D(3), D(3))] }, ties: [] },
  },
  {
    id: "solo-meeting-entry",
    events: [ev("e1", { title: "1:1 prep block", source: "google", plus: 1, time: "09:00" })],
    expect: (o) => (stepsFor(o, "e1").length ? ["solo-meeting-entry: steps for a time block"] : []),
    answer: none,
  },
  {
    id: "memory-event-no-guests",
    events: [ev("e1", { title: FLIGHT, source: "memory", plus: 4, time: "06:10" })],
    expect: (o) => (stepsFor(o, "e1").some((s) => CHECK_IN.test(text(s))) ? [] : ["memory-event-no-guests: the memory flight lost its check-in step (missing guests/location must change nothing)"]),
    answer: { steps: { e1: [checkin(3)] }, ties: [] },
  },
  {
    id: "school-ptm-with-teachers",
    events: [ev("e1", { title: "Agastya School PTM", source: "google", plus: 3, time: "13:15", guests: [{ name: "Class Teacher", email: "teacher@school.edu.in", rsvp: "yes" }, { name: "Coordinator", email: "coord@school.edu.in", rsvp: "yes" }] })],
    expect: (o) => [
      ...stepsFor(o, "e1").filter((s) => /\b(form|fee|sign|document)\b/i.test(text(s)))
        .map((s) => `school-ptm-with-teachers: a form/fee step with no fact asking for it: "${titleOf(s)}"`),
      ...stepsFor(o, "e1").filter((s) => /\b(prepare|prep|questions|agenda|talking points|notes)\b/i.test(text(s)))
        .map((s) => `school-ptm-with-teachers: a meeting-prep step the prep routine covers: "${titleOf(s)}"`),
    ],
    answer: none,
  },
  // 2026-10-06 live: two "Go to the Inprime office" TODOs (due Tue and Thu) were tied to a Wed meeting at
  // that office. Sharing a place is not the same occasion, and a TODO due after an event cannot be for it.
  {
    id: "same-place-is-not-the-same-occasion",
    events: [ev("e1", { title: "Calendar app review", source: "google", plus: 1, time: "15:00", location: "Inprime office, HSR Layout", guests: [{ name: "Yogesh", email: "yogesh@crafo.ai", rsvp: "yes" }] })],
    todos: [
      { id: "task-o1-inprime-tue", title: "Go to the Inprime office", duePlus: 0, by: "you" },
      { id: "task-o2-inprime-thu", title: "Go to the Inprime office", duePlus: 2, by: "you" },
    ],
    expect: (o) => ["task-o1-inprime-tue", "task-o2-inprime-thu"].filter((id) => tieFor(o, id, "e1"))
      .map((id) => `same-place-is-not-the-same-occasion: ${id} ("Go to the Inprime office") was tied to the Calendar app review e1`),
    answer: none,
  },
  // --- an event that already has its steps (core's "planned" cases) ---------------------------------------------------
  // A real already-planned, unchanged event is never re-offered by Calendar Desk (core offered it only for linking). These two
  // present it anyway, with its steps listed and change "new" (the bundle needs a value), to test that the agent adds nothing
  // when existing steps already cover the event: it did not move, so e1 gets steps: [] (any step, even a re-dated one, fails).
  {
    id: "new-todo-ties-to-event-with-steps", events: [hampi()],
    todos: [{ id: "task-o1-site", title: "Finish launch website before Hampi trip", duePlus: 5, by: "you" }],
    expect: (o) => {
      const p: string[] = [];
      if (!tieFor(o, "task-o1-site", "e1")) p.push("new-todo-ties-to-event-with-steps: o1 is not tied to the Hampi stay e1");
      if (stepsFor(o, "e1").length) p.push(`new-todo-ties-to-event-with-steps: steps for an event whose steps already cover it: ${stepsFor(o, "e1").map((s) => s.key).join(", ")}`);
      return p;
    },
    answer: { steps: { e1: [] }, ties: [{ todo: "task-o1-site", ref: "e1" }] },
  },
  {
    id: "event-with-steps-gets-no-new-steps", events: [hampi()],
    todos: [{ id: "task-o1-gym", title: "Renew gym membership", duePlus: 20, by: "you" }],
    expect: (o) => {
      const p: string[] = [];
      if (stepsFor(o, "e1").length) p.push(`event-with-steps-gets-no-new-steps: steps for an event whose steps already cover it: ${stepsFor(o, "e1").map((s) => s.key).join(", ")}`);
      if (tieFor(o, "task-o1-gym", "e1")) p.push("event-with-steps-gets-no-new-steps: the unrelated gym TODO was tied to the Hampi stay");
      return p;
    },
    answer: { steps: { e1: [] }, ties: [] },
  },
  // --- new: a trip away from home gets a packing step ----------------------------------------------------
  {
    id: "multi-day-stay-gets-a-packing-step", events: [LOFT],
    expect: (o) => {
      const pack = stepsFor(o, "e1").filter((s) => /pack/i.test(titleOf(s)));
      if (!pack.length) return ["multi-day-stay-gets-a-packing-step: no packing step for a 3-day stay away from home"];
      return [...pack.filter((s) => !(s.dueDate < LOFT.date)).map((s) => `multi-day-stay-gets-a-packing-step: step "${s.title}" dueDate ${s.dueDate} is not before the stay (${LOFT.date})`),
        ...stepDateProblems("multi-day-stay-gets-a-packing-step", o, LOFT)];
    },
    answer: { steps: { e1: [step("pack", "Pack for Hampi", D(5), D(4))] }, ties: [] },
  },
];
