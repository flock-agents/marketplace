/**
 * Saved planning cases for Calendar Desk's planner: the 26 PLAN_CASES of core's pa-brief-planner.fixtures.ts converted to
 * Calendar Desk's bundle shape, "a multi-day stay gets a packing step", and the cases of the planning step tiers spec
 * (2026-10-07-planning-step-tiers-design.md, §1-§4 and §7).
 *
 * The expectations were written from the spec's rules before any prompt was read; a failing case is fixed in
 * planning-instructions.md (then re-embedded), never by loosening a case. All names are invented.
 *
 * A case describes the STATE (events in the store, steps already made, the user's TODOs, how the owner closed past steps,
 * memory facts per step kind, the one-time cards); harness.ts builds the real bundle from it with runPlanning. Every case
 * carries `answer` (a correct reply) and `wrong` (a plausible incorrect one): the dry test proves the grader passes the
 * first and fails the second without a model. `dry` lists scripted reports Calendar Desk's own checks must refuse.
 *
 * Every event names its expected `type`; the grader fails a report that types it otherwise, and `expect` checks each
 * step's `kind`.
 */
import type { EventType } from "../server/kinds";

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

export interface Step { key: string; kind: string; title: string; dueDate: string; dueTime?: string; showFrom?: string; why: string }
export interface ExistingStep { key: string; title: string; duePlus: number; dueTime?: string; showPlus?: number; closed?: true }
export interface Guest { email: string; name?: string; rsvp?: "yes" | "no" | "maybe" | "awaiting" }
export interface EventSpec {
  ref: string; title: string; source: "google" | "memory"; plus: number; date: string; time?: string; facts: string[]; guests?: Guest[]; location?: string;
  /** The type a correct report gives the event (spec §1). */
  type?: EventType;
  /** Memory facts per step kind: what memory.search answers for the kind's fixed query (pooled across the case's events). */
  memory?: Record<string, string[]>;
  /** The Google calendar the event sits on (never decides the type). */
  calendar?: string;
  /** "changed": the event was planned before at this date/time and has moved. */
  movedFrom?: { plus: number; time?: string };
  steps?: ExistingStep[];
  /** Already planned and unchanged: in the store (so a TODO can name it) but never offered. */
  offered?: false;
  /** Planned before (with its type) and held for this kind's card: offered again only once the card is answered. */
  held?: string;
}
export interface TodoSpec { id: string; title: string; duePlus?: number; by: "you" | "mail" | "calendar-desk"; /** the pointer it is already tied to */ tiedTo?: string }
/** A Calendar Desk step of `kind` the owner closed `daysAgo` days before the run: done, "Not important", or withdrawn by Calendar Desk. */
export interface HabitSpec { kind: string; outcome: "done" | "skipped" | "withdrawn"; daysAgo: number }
/** The kind's one-time card: open (published 2 days ago), answered by a button, closed with Mark done, or open past its 14 days. */
export interface AskSpec { kind: string; state: "open" | "yes" | "no" | "markdone" | "expired"; /** the kind's facts memory held when the card was published */ openFacts?: string[] }
export interface Answer { steps: Record<string, Step[]>; ties: { todo: string; ref: string }[]; /** a type other than the event's own (wrong answers only) */ types?: Record<string, EventType> }
/** A card Calendar Desk published during the report. */
export interface Card { kind: string; title: string; buttons: string[]; expiresInDays: number | null }
/** What the model did, translated back to fixture refs, plus what Calendar Desk did around it. */
export interface Outcome {
  steps: Record<string, Step[]>; ties: { todo: string; ref: string }[];
  /** the type the report gave each event */ types: Record<string, string>;
  /** cards published after the report */ cards: Card[];
  /** kinds whose open card Calendar Desk withdrew during the run (expired, or answered in chat) */ withdrawn: string[];
  /** the bundle the agent was woken with: events by fixture ref, and habits */ bundle: { events: Record<string, any>; habits: Record<string, any> };
}
/** A scripted report (fixture ref -> type and steps; events left out report no steps) Calendar Desk must refuse with `refused`. */
export interface DryReport { name: string; report: Record<string, { type?: EventType; steps: Step[] }>; refused: RegExp }
export interface PlanCase {
  id: string; events: EventSpec[]; todos?: TodoSpec[]; /** Epoch ms the run happens at (default NOW, 07:50). */ now?: number;
  habits?: HabitSpec[]; asks?: AskSpec[];
  /** Live runs of this case (default: the live file's RUNS); the same evidence must give the same plan every run. */ runs?: number;
  expect: (o: Outcome) => string[]; answer: Answer; wrong: Answer; dry?: DryReport[];
}

// --- grader helpers -----------------------------------------------------------------------
export const stepsFor = (o: Outcome, ref: string): Step[] => o.steps[ref] ?? [];
export const kindsFor = (o: Outcome, ref: string): string[] => stepsFor(o, ref).map((s) => s.kind);
export const tieFor = (o: Outcome, todo: string, ref: string) => o.ties.find((t) => t.todo === todo && t.ref === ref);
export const anyFor = (o: Outcome, ref: string): string[] => [...stepsFor(o, ref).map((s) => `step ${s.key}`), ...o.ties.filter((t) => t.ref === ref).map((t) => `tie ${t.todo}`)];
export const showOf = (s: Step): string => s.showFrom ?? s.dueDate;
export const text = (s: Step) => `${s.title ?? ""} ${s.why ?? ""}`;
export const titleOf = (s: Step) => `${s.title ?? ""}`;
const CAB = /\b(cab|taxi|ride)\b/i;
const JOURNEY_KINDS = ["checkin", "cab-airport", "cab-station", "pnr-check", "book-opening"];

export function stepDateProblems(id: string, o: Outcome, e: { ref: string; date: string }, hiddenUntilLater = false): string[] {
  const p: string[] = [];
  for (const s of stepsFor(o, e.ref)) {
    if (!(s.dueDate <= e.date)) p.push(`${id}: step "${s.title}" dueDate ${s.dueDate} is after the event (${e.date})`);
    if (!(showOf(s) <= s.dueDate)) p.push(`${id}: step "${s.title}" showFrom ${s.showFrom} is after its dueDate ${s.dueDate}`);
    if (hiddenUntilLater && showOf(s) <= TODAY && s.dueDate > TODAY) p.push(`${id}: step "${s.title}" shows today (${showOf(s)}) but is due ${s.dueDate}`);
  }
  return p;
}
/** The event's steps have exactly these kinds (order free). */
export function exactKinds(id: string, o: Outcome, ref: string, want: string[]): string[] {
  const got = [...kindsFor(o, ref)].sort(), w = [...want].sort();
  return got.join(",") === w.join(",") ? [] : [`${id}: ${ref} got kinds [${got.join(", ")}], expected exactly [${w.join(", ")}]`];
}
export const nothingFor = (id: string, o: Outcome, ref: string): string[] => (anyFor(o, ref).length ? [`${id}: ${anyFor(o, ref).join(", ")} for ${ref}, expected nothing`] : []);
/** Steps due on a timed event's own day are due before it starts (a ride or check-in after departure is useless). */
export function beforeStart(id: string, o: Outcome, e: EventSpec): string[] {
  if (!e.time) return [];
  return stepsFor(o, e.ref).filter((s) => s.dueDate === e.date && !(s.dueTime && s.dueTime < e.time!))
    .map((s) => `${id}: step "${s.title}" is due on the event's day ${s.dueTime ? `at ${s.dueTime}` : "without a time"}, not before ${e.time}`);
}
/** No step of the event shows before `from` (its window). */
export const hiddenUntil = (id: string, o: Outcome, ref: string, from: string): string[] =>
  stepsFor(o, ref).filter((s) => showOf(s) < from).map((s) => `${id}: step "${s.title}" shows ${showOf(s)}, before its window opens (${from})`);
/** A step of `kind` exists for the event and one of them names the place. */
export function namesPlace(id: string, o: Outcome, ref: string, kind: string, place: RegExp): string[] {
  const ks = stepsFor(o, ref).filter((s) => s.kind === kind);
  if (!ks.length) return [`${id}: no ${kind} step for ${ref}`];
  return ks.some((s) => place.test(text(s))) ? [] : [`${id}: the ${kind} step does not name the place`];
}
/** Exactly these cards were published after the report. */
export function cardsExactly(id: string, o: Outcome, kinds: string[]): string[] {
  const got = o.cards.map((c) => c.kind).sort(), w = [...kinds].sort();
  return got.join(",") === w.join(",") ? [] : [`${id}: cards published [${got.join(", ")}], expected [${w.join(", ")}]`];
}
// Spec §4: one plain question per kind, two buttons naming the answer, expiring 14 days after publishing.
const CARD_COPY: Record<string, { title: string; buttons: string[] }> = {
  "cab-local": { title: "Remind you to book a cab before appointments?", buttons: ["Book a cab reminder", "Don't remind me"] },
  gift: { title: "Remind you to buy a gift before family birthdays?", buttons: ["Gift reminder", "Don't remind me"] },
  "table-booking": { title: "Remind you to book a table before dinners out?", buttons: ["Table reminder", "Don't remind me"] },
};
export function cardCopy(id: string, o: Outcome, kind: string): string[] {
  const c = o.cards.find((x) => x.kind === kind), want = CARD_COPY[kind]!;
  if (!c) return [`${id}: no ${kind} card`];
  const p: string[] = [];
  if (c.title !== want.title) p.push(`${id}: ${kind} card asks "${c.title}", expected "${want.title}"`);
  if (c.buttons.join(" | ") !== want.buttons.join(" | ")) p.push(`${id}: ${kind} card buttons [${c.buttons.join(" | ")}], expected [${want.buttons.join(" | ")}]`);
  if (c.expiresInDays !== 14) p.push(`${id}: ${kind} card expires in ${c.expiresInDays} days, expected 14`);
  return p;
}
const habitOf = (o: Outcome, kind: string) => o.bundle.habits[kind];

// --- builders -----------------------------------------------------------------------------
const D = (n: number) => isoAdd(TODAY, n);
type EvOpts = Omit<EventSpec, "ref" | "date" | "facts"> & { facts?: string[] };
const ev = (ref: string, o: EvOpts): EventSpec => ({ ref, facts: [], ...o, date: D(o.plus) });
const step = (key: string, kind: string, title: string, dueDate: string, showFrom?: string, dueTime?: string, why = "planned for the event"): Step =>
  ({ key, kind, title, dueDate, ...(dueTime ? { dueTime } : {}), ...(showFrom ? { showFrom } : {}), why });
const none: Answer = { steps: {}, ties: [] };
const only = (ref: string, steps: Step[]): Answer => ({ steps: { [ref]: steps }, ties: [] });
const did = (kind: string, daysAgo = 10): HabitSpec => ({ kind, outcome: "done", daysAgo });
const skipped = (kind: string, daysAgo: number): HabitSpec => ({ kind, outcome: "skipped", daysAgo });

const FLIGHT = "Flight 6E-512 BLR→MAA";
const flight2 = ev("e1", { title: FLIGHT, type: "journey", source: "memory", plus: 2, time: "06:10" });
const flight6 = ev("e1", { title: FLIGHT, type: "journey", source: "memory", plus: 6, time: "06:40" });
const DAUGHTER = ["Kavya Example is the user's daughter."];
const bday6 = ev("e2", { title: "Kavya Example's birthday", type: "occasion", source: "memory", plus: 6 }); // no facts: who she is is unknown
const bday6Daughter = ev("e2", { title: "Kavya Example's birthday", type: "occasion", source: "memory", plus: 6, facts: DAUGHTER });
const bday4 = (ref = "e1", o: Partial<EvOpts> = {}) => ev(ref, { title: "Kavya Example's birthday", type: "occasion", source: "memory", plus: 4, facts: DAUGHTER, ...o });
const bday5 = ev("e1", { title: "Kavya Example's birthday", type: "occasion", source: "memory", plus: 5 });
const webinar = ev("e2", { title: "Webinar: Growth hacks 101", type: "other", source: "memory", plus: 3 });
const holiday = ev("e1", { title: "Gandhi Jayanti (holiday)", type: "other", source: "google", plus: 0 });
const checkin = (due: number, show = due, code = "6E-512") => step("checkin", "checkin", `Web check-in: ${code}`, D(due), D(show));
const cabAirport = (due: number, show = due, time = "21:00", code = "6E-512") => step("cab-airport", "cab-airport", `Book a cab to the airport for ${code}`, D(due), D(show), time);
const cabTo = (place: string, due: number, time?: string, show = due, why = "You booked a cab for your last appointment.") => step("cab", "cab-local", `Book a cab to ${place}`, D(due), D(show), time, why);
const HAMPI = "Stay at The Loft - Homestay Hampi (Day 1 of 3)";
const hampi = () => ev("e1", { title: HAMPI, type: "stay", source: "google", plus: 7, steps: [{ key: "travel", title: "Arrange travel to Hampi", duePlus: 6, showPlus: 4 }, { key: "pack", title: "Pack for Hampi trip", duePlus: 6, showPlus: 4 }] });
const GUESTS_YOGESH: Guest[] = [{ name: "Yogesh", email: "yogesh@crafo.ai", rsvp: "yes" }, { email: "ravi@acme.com", rsvp: "awaiting" }];
const LOFT = ev("e1", { title: "Stay at The Loft - Aadhya Homestay Hampi (Day 1 of 3)", type: "stay", source: "google", plus: 6, location: "Huligi, Karnataka 583234, India" });

// Appointments with a place (cab-local fits them; spec §1: doctor, physio, salon, an in-person visit).
const APOLLO = "Apollo Clinic, Indiranagar", SMILE = "Smile Dental, Koramangala", INPRIME = "Inprime office, HSR Layout";
const clinic = (ref = "e1") => ev(ref, { title: "Physio session", type: "appointment", source: "google", plus: 3, time: "10:00", guests: [{ name: "Apollo Front Desk", email: "frontdesk@apolloclinic.in", rsvp: "yes" }], location: APOLLO });
const inprimeVisit = () => ev("e1", { title: "Visit Inprime office", type: "appointment", source: "google", plus: 2, time: "11:30", location: INPRIME });
const dentist = (o: Partial<EvOpts> = {}) => ev("e1", { title: "Dentist appointment", type: "appointment", source: "google", plus: 3, time: "17:00", location: SMILE, ...o });
const SKIN = "Skin Clinic, Jayanagar";
const derm = (ref = "e1", o: Partial<EvOpts> = {}) => ev(ref, { title: "Dermatologist appointment", type: "appointment", source: "google", plus: 4, time: "11:00", location: SKIN, ...o });
const derma = () => cabTo(SKIN, 4, "10:15");
// In-person client meetings elsewhere (cab-local only with evidence; a meeting never asks).
const ACME = "Acme Corp, 4th floor, Prestige Tower, MG Road";
const acmeVisit = (o: Partial<EvOpts> = {}) => ev("e1", { title: "Acme quarterly business review", type: "meeting", source: "google", plus: 3, time: "11:00",
  guests: [{ name: "Yogesh", email: "yogesh@crafo.ai", rsvp: "yes" }, { name: "Priya Example", email: "priya@acme.com", rsvp: "yes" }], location: ACME, ...o });

// A board review on the Thursday at least 6 days out; "2 to 3 working days before" is that week's Monday or Tuesday.
const dow = (() => { const [y, m, d] = TODAY.split("-").map(Number); return new Date(y!, m! - 1, d!).getDay(); })();
const THU = (() => { let n = (4 - dow + 7) % 7; if (n < 6) n += 7; return n; })();
const boardReview = () => ev("e1", { title: "Board review: presenting Q3 results", type: "meeting", source: "google", plus: THU, time: "10:00",
  guests: [{ name: "Board Office", email: "board@crafo.ai", rsvp: "yes" }], facts: ["The user presents the Q3 results at Thursday's board review."] });

/** Report entries for a case, for a DryReport. */
const dryStep = (name: string, ref: string, steps: Step[], refused: RegExp, type?: EventType): DryReport => ({ name, report: { [ref]: { ...(type ? { type } : {}), steps } }, refused });

export const PLAN_CASES: PlanCase[] = [
  // --- flights: Tier 1 is check-in AND a cab to the airport (spec decision 10) ----------------------------------------------
  {
    id: "flight-in-2-days", events: [flight2],
    expect: (o) => [...exactKinds("flight-in-2-days", o, "e1", ["checkin", "cab-airport"]), ...stepDateProblems("flight-in-2-days", o, flight2), ...beforeStart("flight-in-2-days", o, flight2)],
    answer: only("e1", [checkin(1), cabAirport(1)]),
    wrong: only("e1", [checkin(1)]),
  },
  {
    id: "flight-in-6-days", events: [flight6],
    // Check-in opens 24 to 48 h before: both steps stay hidden until then (every offered event is marked planned afterwards,
    // so leaving the flight with nothing would leave it unplanned for good).
    expect: (o) => [...exactKinds("flight-in-6-days", o, "e1", ["checkin", "cab-airport"]), ...hiddenUntil("flight-in-6-days", o, "e1", D(4)),
      ...stepDateProblems("flight-in-6-days", o, flight6, true), ...beforeStart("flight-in-6-days", o, flight6)],
    answer: only("e1", [checkin(5), cabAirport(5)]),
    wrong: only("e1", [checkin(5), cabAirport(5, 0)]),
  },
  // A birthday is an occasion: a gift needs evidence. Guards are paired with a positive in the same bundle so a do-nothing
  // model fails instead of passing vacuously.
  {
    id: "birthday-in-6-days", events: [flight2, bday6],
    expect: (o) => [
      ...(kindsFor(o, "e1").includes("checkin") ? [] : ["birthday-in-6-days: no check-in step for the flight (guard: the model must act on events)"]),
      ...nothingFor("birthday-in-6-days", o, "e2"),
    ],
    answer: { steps: { e1: [checkin(1), cabAirport(1)], e2: [] }, ties: [] },
    wrong: { steps: { e1: [checkin(1), cabAirport(1)], e2: [step("gift", "gift", "Buy a birthday gift for Kavya", D(5), D(3))] }, ties: [] },
  },
  // Spec §7 birthday-daughter A (was birthday-close-family): the relation alone is no evidence for a gift: no step, one card.
  {
    id: "birthday-daughter-A", events: [bday4()],
    expect: (o) => [...nothingFor("birthday-daughter-A", o, "e1"), ...cardsExactly("birthday-daughter-A", o, ["gift"]), ...cardCopy("birthday-daughter-A", o, "gift")],
    answer: { steps: { e1: [] }, ties: [] },
    wrong: only("e1", [step("gift", "gift", "Buy a birthday gift for Kavya", D(3), D(1))]),
  },
  {
    id: "newsletter-webinar", events: [flight2, webinar],
    expect: (o) => [
      ...(kindsFor(o, "e1").includes("checkin") ? [] : ["newsletter-webinar: no check-in step for the flight (guard: the model must act on events)"]),
      ...nothingFor("newsletter-webinar", o, "e2"),
    ],
    answer: { steps: { e1: [checkin(1), cabAirport(1)], e2: [] }, ties: [] },
    wrong: { steps: { e1: [checkin(1), cabAirport(1)], e2: [] }, ties: [], types: { e2: "meeting" } },
  },
  {
    // The daughter's birthday has a gift habit (done last time), so it is the positive guard beside the holiday.
    id: "holiday", events: [holiday, bday6Daughter], habits: [did("gift", 30)],
    expect: (o) => {
      const p: string[] = [];
      const gift = stepsFor(o, "e2").filter((s) => s.kind === "gift");
      if (!gift.length) p.push("holiday: no gift step for the birthday (guard: the model must act on events)");
      for (const s of gift) if (!(s.dueDate < bday6Daughter.date)) p.push(`holiday: gift step dueDate ${s.dueDate} is not before the birthday (${bday6Daughter.date})`);
      return [...p, ...nothingFor("holiday", o, "e1")];
    },
    answer: { steps: { e1: [], e2: [step("gift", "gift", "Buy a birthday gift for Kavya", D(5), D(3), undefined, "You bought a gift for the last birthday.")] }, ties: [] },
    wrong: { steps: { e1: [], e2: [] }, ties: [] },
  },
  {
    id: "user-todo-exists-for-event", events: [flight2],
    todos: [{ id: "task-o1-checkin", title: "Do web check-in for the Chennai flight", duePlus: 1, by: "you" }],
    expect: (o) => {
      const p: string[] = [];
      if (!tieFor(o, "task-o1-checkin", "e1")) p.push("user-todo-exists-for-event: o1 is not tied to e1");
      if (kindsFor(o, "e1").includes("checkin")) p.push("user-todo-exists-for-event: a check-in step although the user has their own check-in TODO");
      return p;
    },
    answer: { steps: { e1: [cabAirport(1)] }, ties: [{ todo: "task-o1-checkin", ref: "e1" }] },
    wrong: only("e1", [checkin(1), cabAirport(1)]),
  },
  {
    id: "email-todo-exists-for-event", events: [bday5],
    todos: [{ id: "task-c1-gift", title: "Buy a gift for Kavya's birthday", duePlus: 3, by: "mail" }],
    expect: (o) => {
      const p: string[] = [];
      if (!tieFor(o, "task-c1-gift", "e1")) p.push("email-todo-exists-for-event: o1 is not tied to e1");
      if (kindsFor(o, "e1").includes("gift")) p.push("email-todo-exists-for-event: a gift step although the mail TODO already covers it");
      return p;
    },
    answer: { steps: { e1: [] }, ties: [{ todo: "task-c1-gift", ref: "e1" }] },
    wrong: only("e1", [step("gift", "gift", "Buy a birthday gift for Kavya", D(3), D(1))]),
  },

  // --- long lead, urgent and changed events ---------------------------------------------------
  {
    // A trip is a stay away from home: papers to carry are a judgement kind (`documents`), and a stay or trip gets `pack`.
    id: "passport-renewal-for-trip",
    events: [ev("e1", { title: "Trip to Lisbon", type: "stay", source: "google", plus: 45, facts: ["The user's passport expires 3 weeks after the trip ends.", "Lisbon is outside India, so the trip needs a valid passport."] })],
    expect: (o) => {
      const p: string[] = [];
      const trip = D(45);
      const steps = stepsFor(o, "e1").filter((s) => s.kind === "documents" && /passport/i.test(text(s)));
      if (!steps.length) p.push("passport-renewal-for-trip: no passport renewal step (kind documents)");
      // Renewal + visa are serial multi-week processes: showing it today is right ("never late, maybe early").
      for (const s of steps) if (!(s.dueDate <= isoAdd(trip, -21))) p.push(`passport-renewal-for-trip: step "${s.title}" dueDate ${s.dueDate} is not at least 21 days before the trip (${trip})`);
      if (!kindsFor(o, "e1").includes("pack")) p.push("passport-renewal-for-trip: no packing step for a trip away from home");
      return [...p, ...stepDateProblems("passport-renewal-for-trip", o, { date: trip, ref: "e1" })];
    },
    answer: only("e1", [step("passport", "documents", "Renew passport", D(20), D(5)), step("pack", "pack", "Pack for Lisbon", D(44), D(42))]),
    wrong: only("e1", [step("passport", "documents", "Renew passport", D(20), D(5))]),
  },
  {
    id: "train-booking-opens-60-days-before",
    events: [ev("e1", { title: "Train 99001 to Jaipur", type: "journey", source: "google", plus: 70, time: "07:15", facts: ["Railway tickets for this train open for booking 60 days before departure."] })],
    expect: (o) => {
      const p: string[] = [];
      const opens = D(10); // event day (+70) minus 60
      const book = stepsFor(o, "e1").filter((s) => s.kind === "book-opening");
      if (!book.length) p.push("train-booking-opens-60-days-before: no book-opening step");
      for (const s of book) if (showOf(s) !== opens || s.dueDate !== opens) p.push(`train-booking-opens-60-days-before: book-opening shows ${showOf(s)} and is due ${s.dueDate}, expected both on the opening day ${opens}`);
      for (const k of kindsFor(o, "e1")) if (!["book-opening", "cab-station", "pnr-check"].includes(k)) p.push(`train-booking-opens-60-days-before: a ${k} step for a train journey`);
      return [...p, ...stepDateProblems("train-booking-opens-60-days-before", o, { date: D(70), ref: "e1" })];
    },
    answer: only("e1", [step("book-tickets", "book-opening", "Book train tickets for Jaipur", D(10), D(10))]),
    wrong: only("e1", [step("book-tickets", "book-opening", "Book train tickets for Jaipur", D(10), D(8))]),
  },
  {
    id: "colleague-conference-nothing-to-prepare",
    events: [flight2, ev("e2", { title: "Conference: Cloud Native Day (Meera Example is speaking)", type: "other", source: "google", plus: 45 })],
    expect: (o) => [
      ...(kindsFor(o, "e1").includes("checkin") ? [] : ["colleague-conference-nothing-to-prepare: no check-in step for the flight (guard: the model must act on events)"]),
      ...nothingFor("colleague-conference-nothing-to-prepare", o, "e2"),
    ],
    answer: { steps: { e1: [checkin(1), cabAirport(1)], e2: [] }, ties: [] },
    wrong: { steps: { e1: [checkin(1), cabAirport(1)], e2: [] }, ties: [], types: { e2: "meeting" } },
  },
  {
    id: "flight-tomorrow-0600-seen-at-2100", now: localMs(TODAY, "21:00"),
    events: [ev("e1", { title: "Flight 6E-204 BLR→DEL", type: "journey", source: "memory", plus: 1, time: "06:00" })],
    expect: (o) => {
      const p: string[] = [...exactKinds("flight-tomorrow-0600-seen-at-2100", o, "e1", ["checkin", "cab-airport"])];
      const tomorrow = D(1);
      for (const s of stepsFor(o, "e1")) {
        if (s.dueDate < TODAY || s.dueDate > tomorrow) p.push(`flight-tomorrow-0600-seen-at-2100: step "${s.title}" dueDate ${s.dueDate} is not tonight or tomorrow`);
        if (s.dueDate === tomorrow && !(s.dueTime && s.dueTime < "06:00")) p.push(`flight-tomorrow-0600-seen-at-2100: step "${s.title}" is due tomorrow without a time before 06:00 (${s.dueTime ?? "no time"})`);
        if (s.dueDate === TODAY && s.dueTime !== undefined && !(s.dueTime > "21:00")) p.push(`flight-tomorrow-0600-seen-at-2100: step "${s.title}" is due today at ${s.dueTime}, which has already passed at 21:00`);
        if (showOf(s) > TODAY) p.push(`flight-tomorrow-0600-seen-at-2100: step "${s.title}" stays hidden until ${showOf(s)}; the owner must see it tonight`);
      }
      return p;
    },
    answer: only("e1", [step("checkin", "checkin", "Web check-in: 6E-204", D(1), TODAY, "05:00"), step("cab-airport", "cab-airport", "Book a cab to the airport for 6E-204", TODAY, TODAY, "22:00")]),
    wrong: only("e1", [step("checkin", "checkin", "Web check-in: 6E-204", D(1), TODAY, "05:00")]),
  },
  {
    // A moved flight re-dates the step it has; a cab to the airport may join it (Tier 1), nothing else.
    id: "changed-event-redates-same-step",
    events: [ev("e1", { title: FLIGHT, type: "journey", source: "memory", plus: 4, time: "06:10", movedFrom: { plus: 2, time: "06:10" }, steps: [{ key: "checkin", title: "Web check-in: 6E-512", duePlus: 1, dueTime: "20:00", showPlus: 1 }] })],
    expect: (o) => {
      const p: string[] = [];
      const steps = stepsFor(o, "e1");
      const same = steps.filter((s) => s.key === "checkin");
      if (!same.length) p.push("changed-event-redates-same-step: no step with the existing key \"checkin\" (the event moved 2 days later)");
      for (const s of same) if (!(s.dueDate > D(1))) p.push(`changed-event-redates-same-step: step "checkin" dueDate ${s.dueDate} was not moved later than the old ${D(1)}`);
      for (const s of steps) if (s.key !== "checkin" && s.kind === "checkin") p.push(`changed-event-redates-same-step: a new key "${s.key}" for the check-in work that "checkin" already covers`);
      for (const k of kindsFor(o, "e1")) if (k !== "checkin" && k !== "cab-airport") p.push(`changed-event-redates-same-step: a ${k} step for a flight`);
      return [...p, ...stepDateProblems("changed-event-redates-same-step", o, { date: D(4), ref: "e1" })];
    },
    answer: only("e1", [checkin(3)]),
    wrong: only("e1", [{ ...checkin(3), key: "web-checkin" }]),
  },

  // --- moved events: in Calendar Desk a move keeps the event's key, so the old step is in `steps` of a "changed" event ----
  {
    id: "moved-flight-reattaches-old-step",
    events: [ev("e1", { title: FLIGHT, type: "journey", source: "memory", plus: 3, time: "06:10", movedFrom: { plus: 5, time: "06:10" }, steps: [{ key: "checkin", title: "Web check-in: 6E-512", duePlus: 4, showPlus: 4 }] })],
    expect: (o) => {
      const p: string[] = [];
      const steps = stepsFor(o, "e1");
      const same = steps.filter((s) => s.key === "checkin");
      if (!same.length) p.push("moved-flight-reattaches-old-step: no step with the existing key \"checkin\" for e1");
      for (const s of same) if (!(s.dueDate <= D(3))) p.push(`moved-flight-reattaches-old-step: step "checkin" dueDate ${s.dueDate} is after the new departure (${D(3)})`);
      for (const s of steps) if (s.key !== "checkin" && s.kind === "checkin") p.push(`moved-flight-reattaches-old-step: a new key "${s.key}" for the check-in work that "checkin" already covers`);
      return [...p, ...stepDateProblems("moved-flight-reattaches-old-step", o, { date: D(3), ref: "e1" })];
    },
    answer: only("e1", [checkin(2)]),
    wrong: only("e1", [{ ...checkin(2), key: "checkin-2" }]),
  },
  {
    // The dentist has a place (a cab-local needs one): the existing cab step keeps its key when re-dated, or is left as it is.
    id: "moved-event-later-keeps-step",
    events: [dentist({ plus: 10, time: "11:00", movedFrom: { plus: 6, time: "11:00" }, steps: [{ key: "cab", title: "Book a cab to the dentist", duePlus: 6, showPlus: 6 }] })],
    expect: (o) => {
      const p: string[] = [];
      for (const s of stepsFor(o, "e1")) if (s.key !== "cab" && (s.kind === "cab-local" || CAB.test(titleOf(s)))) p.push(`moved-event-later-keeps-step: a new key "${s.key}" for a cab that "cab" already covers`);
      for (const s of stepsFor(o, "e1")) if (s.key === "cab" && s.kind !== "cab-local") p.push(`moved-event-later-keeps-step: the cab step re-dated as kind ${s.kind}, expected cab-local`);
      return [...p, ...cardsExactly("moved-event-later-keeps-step", o, []), ...stepDateProblems("moved-event-later-keeps-step", o, { date: D(10), ref: "e1" })];
    },
    answer: only("e1", [cabTo("the dentist", 9)]),
    wrong: only("e1", [{ ...cabTo("the dentist", 9), key: "cab-2" }]),
  },
  // A timed step keeps its lead time when its event moves to another day AND another time (live 2026-10-07). The event is an
  // appointment: a dinner is an occasion (spec §1), where a cab does not fit.
  {
    id: "moved-timed-step-keeps-lead-time",
    events: [ev("e1", { title: "Eye check-up", type: "appointment", source: "google", plus: 4, time: "14:15", location: "Nethra Eye Clinic, Indiranagar",
      movedFrom: { plus: 3, time: "18:00" },
      steps: [{ key: "cab", title: "Book a cab to Nethra Eye Clinic, Indiranagar", duePlus: 3, dueTime: "17:30", showPlus: 3 }] })],
    expect: (o) => {
      const p: string[] = [];
      const steps = stepsFor(o, "e1");
      const cab = steps.filter((s) => s.key === "cab");
      if (cab.length !== 1) p.push(`moved-timed-step-keeps-lead-time: expected the existing "cab" step re-dated once, got ${cab.length}`);
      for (const s of cab) {
        if (s.kind !== "cab-local") p.push(`moved-timed-step-keeps-lead-time: "cab" re-dated as kind ${s.kind}, expected cab-local`);
        if (s.dueDate !== D(4)) p.push(`moved-timed-step-keeps-lead-time: "cab" dueDate ${s.dueDate}, expected the event's new day ${D(4)}`);
        if (s.dueTime !== "13:45") p.push(`moved-timed-step-keeps-lead-time: "cab" dueTime ${s.dueTime ?? "(none)"}, expected 13:45 (30 min before the new 14:15 start)`);
      }
      for (const s of steps) if (s.key !== "cab" && (s.kind === "cab-local" || CAB.test(titleOf(s)))) p.push(`moved-timed-step-keeps-lead-time: a new key "${s.key}" for the cab "cab" covers`);
      return [...p, ...stepDateProblems("moved-timed-step-keeps-lead-time", o, { date: D(4), ref: "e1" })];
    },
    answer: only("e1", [cabTo("Nethra Eye Clinic, Indiranagar", 4, "13:45")]),
    wrong: only("e1", [cabTo("Nethra Eye Clinic, Indiranagar", 4, "14:00")]),
  },
  // A recurring event: the earlier session's step shows in the user's TODOs already tied to ITS event, so it is never tied
  // to the new one; the new session gets its own cab under the same key (owner 2026-10-05), because the owner booked the last one.
  {
    id: "recurring-event-keeps-its-own-steps", habits: [did("cab-local", 6)],
    events: [
      ev("e1", { title: "Physio session", type: "appointment", source: "google", plus: 7, time: "10:00", location: APOLLO }),
      { ...ev("e9", { title: "Physio session", type: "appointment", source: "google", plus: 1, time: "10:00", location: APOLLO, offered: false }) },
    ],
    todos: [{ id: "task-s1-cab", title: "Book a cab to physio", duePlus: 1, by: "calendar-desk", tiedTo: "e9" }],
    expect: (o) => [
      ...(tieFor(o, "task-s1-cab", "e1") ? ["recurring-event-keeps-its-own-steps: the earlier physio session's step was tied to the new one"] : []),
      ...namesPlace("recurring-event-keeps-its-own-steps", o, "e1", "cab-local", /apollo|indiranagar/i),
    ],
    answer: only("e1", [cabTo(APOLLO, 7, "09:15")]),
    wrong: { steps: { e1: [] }, ties: [{ todo: "task-s1-cab", ref: "e1" }] },
  },
  // --- event details (2026-10-06): guests and location are context; the title leads -------------------------
  {
    id: "meeting-with-guests-gets-nothing",
    events: [ev("e1", { title: "Design review", type: "meeting", source: "google", plus: 2, time: "16:00", guests: GUESTS_YOGESH })],
    expect: (o) => [...nothingFor("meeting-with-guests-gets-nothing", o, "e1"), ...cardsExactly("meeting-with-guests-gets-nothing", o, [])],
    answer: none,
    // Reviewing a design is not presenting it: no prepare-ahead.
    wrong: only("e1", [step("prepare", "prepare-ahead", "Prepare for the design review", D(1), D(1))]),
    dry: [dryStep("checkin on a meeting", "e1", [step("checkin", "checkin", "Web check-in", D(1))], /checkin does not fit a meeting/)],
  },
  // Appointments with a place, with and without evidence for a cab (spec §7 "cab-local variants").
  {
    id: "clinic-invite-is-an-appointment", events: [clinic()],
    expect: (o) => [...nothingFor("clinic-invite-is-an-appointment", o, "e1"), ...cardsExactly("clinic-invite-is-an-appointment", o, ["cab-local"])],
    answer: { steps: { e1: [] }, ties: [] },
    wrong: only("e1", [cabTo(APOLLO, 3, "09:15")]),
  },
  {
    id: "clinic-invite-is-an-appointment-cab-on", events: [clinic()], habits: [did("cab-local", 12)],
    expect: (o) => [...exactKinds("clinic-invite-is-an-appointment-cab-on", o, "e1", ["cab-local"]), ...namesPlace("clinic-invite-is-an-appointment-cab-on", o, "e1", "cab-local", /apollo|indiranagar/i),
      ...beforeStart("clinic-invite-is-an-appointment-cab-on", o, clinic()), ...cardsExactly("clinic-invite-is-an-appointment-cab-on", o, [])],
    answer: only("e1", [cabTo(APOLLO, 3, "09:15")]),
    wrong: { steps: { e1: [] }, ties: [] },
  },
  {
    // A solo entry at a place is an in-person visit (an appointment), not a meeting: no guests, does not read like a sync.
    id: "solo-entry-with-location", events: [inprimeVisit()],
    expect: (o) => [...nothingFor("solo-entry-with-location", o, "e1"), ...cardsExactly("solo-entry-with-location", o, ["cab-local"])],
    answer: { steps: { e1: [] }, ties: [] },
    wrong: only("e1", [step("prepare", "other", "Prepare notes for the Inprime visit", D(1), D(1))]),
  },
  {
    id: "solo-entry-with-location-cab-on", events: [inprimeVisit()], habits: [did("cab-local", 12)],
    expect: (o) => [...exactKinds("solo-entry-with-location-cab-on", o, "e1", ["cab-local"]), ...namesPlace("solo-entry-with-location-cab-on", o, "e1", "cab-local", /inprime|hsr/i),
      ...beforeStart("solo-entry-with-location-cab-on", o, inprimeVisit())],
    answer: only("e1", [cabTo(INPRIME, 2, "10:45")]),
    wrong: only("e1", [cabTo(INPRIME, 2, "10:45"), step("prepare", "other", "Prepare notes for the Inprime visit", D(1), D(1))]),
  },
  {
    // A self-entered appointment has no guests: the title, not the missing guests, says what it is (I2).
    id: "self-entered-appointment-with-location", events: [dentist()],
    expect: (o) => [...nothingFor("self-entered-appointment-with-location", o, "e1"), ...cardsExactly("self-entered-appointment-with-location", o, ["cab-local"])],
    answer: { steps: { e1: [] }, ties: [] },
    wrong: { steps: { e1: [] }, ties: [], types: { e1: "meeting" } },
    dry: [dryStep("pack on an appointment", "e1", [step("pack", "pack", "Pack a bag", D(2))], /pack does not fit an appointment/)],
  },
  {
    id: "self-entered-appointment-with-location-cab-on", events: [dentist()], habits: [did("cab-local", 12)],
    expect: (o) => [...exactKinds("self-entered-appointment-with-location-cab-on", o, "e1", ["cab-local"]),
      ...namesPlace("self-entered-appointment-with-location-cab-on", o, "e1", "cab-local", /smile|koramangala/i), ...beforeStart("self-entered-appointment-with-location-cab-on", o, dentist())],
    answer: only("e1", [cabTo(SMILE, 3, "16:15")]),
    wrong: only("e1", [cabTo(SMILE, 3, "16:15"), step("pack", "pack", "Pack a bag", D(2))]),
  },
  {
    // The user's own block (to prepare for a 1:1): no steps of any kind.
    id: "solo-meeting-entry",
    events: [ev("e1", { title: "1:1 prep block", type: "block", source: "google", plus: 1, time: "09:00" })],
    expect: (o) => nothingFor("solo-meeting-entry", o, "e1"),
    answer: none,
    wrong: { steps: { e1: [] }, ties: [], types: { e1: "meeting" } },
    dry: [dryStep("a step on a block", "e1", [step("prep", "other", "Prepare for the 1:1", D(1))], /gets no steps/)],
  },
  {
    id: "memory-event-no-guests",
    events: [ev("e1", { title: FLIGHT, type: "journey", source: "memory", plus: 4, time: "06:10" })],
    expect: (o) => [...exactKinds("memory-event-no-guests", o, "e1", ["checkin", "cab-airport"]), ...hiddenUntil("memory-event-no-guests", o, "e1", D(2)),
      ...stepDateProblems("memory-event-no-guests", o, { ref: "e1", date: D(4) }, true)],
    answer: only("e1", [checkin(3), cabAirport(3)]),
    wrong: only("e1", [checkin(3)]),
  },
  {
    // A parent-teacher meeting with guests is a meeting: nothing (meeting prep is its own routine), no card.
    id: "school-ptm-with-teachers",
    events: [ev("e1", { title: "Agastya School PTM", type: "meeting", source: "google", plus: 3, time: "13:15", guests: [{ name: "Class Teacher", email: "teacher@school.edu.in", rsvp: "yes" }, { name: "Coordinator", email: "coord@school.edu.in", rsvp: "yes" }] })],
    expect: (o) => [...nothingFor("school-ptm-with-teachers", o, "e1"), ...cardsExactly("school-ptm-with-teachers", o, [])],
    answer: none,
    wrong: only("e1", [step("prepare", "prepare-ahead", "Prepare questions for the PTM", D(2), D(2))]),
  },
  // 2026-10-06 live: two "Go to the Inprime office" TODOs (due Tue and Thu) were tied to a Wed meeting at
  // that office. Sharing a place is not the same occasion, and a TODO due after an event cannot be for it.
  {
    id: "same-place-is-not-the-same-occasion",
    events: [ev("e1", { title: "Calendar app review", type: "meeting", source: "google", plus: 1, time: "15:00", location: INPRIME, guests: [{ name: "Yogesh", email: "yogesh@crafo.ai", rsvp: "yes" }] })],
    todos: [
      { id: "task-o1-inprime-tue", title: "Go to the Inprime office", duePlus: 0, by: "you" },
      { id: "task-o2-inprime-thu", title: "Go to the Inprime office", duePlus: 2, by: "you" },
    ],
    expect: (o) => [
      ...["task-o1-inprime-tue", "task-o2-inprime-thu"].filter((id) => tieFor(o, id, "e1")).map((id) => `same-place-is-not-the-same-occasion: ${id} ("Go to the Inprime office") was tied to the Calendar app review e1`),
      ...nothingFor("same-place-is-not-the-same-occasion", o, "e1"), ...cardsExactly("same-place-is-not-the-same-occasion", o, []),
    ],
    answer: none,
    wrong: { steps: {}, ties: [{ todo: "task-o1-inprime-tue", ref: "e1" }] },
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
    wrong: { steps: { e1: [] }, ties: [] },
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
    wrong: { steps: { e1: [] }, ties: [{ todo: "task-o1-gym", ref: "e1" }] },
  },
  // --- a trip away from home gets a packing step; journey steps come only from a journey event or a travel fact ------------
  {
    id: "multi-day-stay-gets-a-packing-step", events: [LOFT],
    expect: (o) => {
      const pack = stepsFor(o, "e1").filter((s) => s.kind === "pack");
      if (!pack.length) return ["multi-day-stay-gets-a-packing-step: no packing step for a 3-day stay away from home"];
      return [...pack.filter((s) => !(s.dueDate < LOFT.date)).map((s) => `multi-day-stay-gets-a-packing-step: step "${s.title}" dueDate ${s.dueDate} is not before the stay (${LOFT.date})`),
        ...kindsFor(o, "e1").filter((k) => k === "cab-local" || JOURNEY_KINDS.includes(k)).map((k) => `multi-day-stay-gets-a-packing-step: a ${k} step for a stay with no journey`),
        ...stepDateProblems("multi-day-stay-gets-a-packing-step", o, LOFT)];
    },
    answer: only("e1", [step("pack", "pack", "Pack for Hampi", D(5), D(4))]),
    wrong: { steps: { e1: [] }, ties: [] },
  },
  {
    // Owner-confirmed live bug (2026-10-07): a stay's location is never a cab target, and with no journey event or travel
    // fact there are no journey steps. Exactly one step: pack.
    id: "stay-far-away-pack-only",
    events: [ev("e1", { title: "Stay at The Loft - Aadhya Homestay Hampi (Day 1 of 3)", type: "stay", source: "google", plus: 6, location: "The Loft - Aadhya Homestay, Huligi, Karnataka", facts: ["The user lives in Bangalore."] })],
    expect: (o) => [...exactKinds("stay-far-away-pack-only", o, "e1", ["pack"]), ...stepDateProblems("stay-far-away-pack-only", o, { ref: "e1", date: D(6) })],
    answer: only("e1", [step("pack", "pack", "Pack for Hampi", D(5), D(4))]),
    wrong: only("e1", [step("pack", "pack", "Pack for Hampi", D(5), D(4)), step("cab-station", "cab-station", "Book a cab to the bus stand for Hampi", D(5), D(5))]),
    dry: [dryStep("cab-local to a stay", "e1", [step("cab", "cab-local", "Book a cab to The Loft", D(6))], /cab-local does not fit a stay/)],
  },

  // --- planning step tiers (spec §7 "New") ---------------------------------------------------------------------------------
  {
    // The calendar and the guests never decide the type: a flight is a journey.
    id: "work-flight-office-calendar",
    events: [ev("e1", { title: "Flight AI-803 BLR→BOM", type: "journey", source: "google", calendar: "Work", plus: 3, time: "09:30",
      guests: [{ name: "Yogesh", email: "yogesh@crafo.ai", rsvp: "yes" }] })],
    expect: (o) => [...exactKinds("work-flight-office-calendar", o, "e1", ["checkin", "cab-airport"]), ...beforeStart("work-flight-office-calendar", o, ev("e1", { title: "", source: "google", plus: 3, time: "09:30" })),
      ...stepDateProblems("work-flight-office-calendar", o, { ref: "e1", date: D(3) })],
    answer: only("e1", [checkin(2, 2, "AI-803"), cabAirport(2, 2, "21:00", "AI-803")]),
    wrong: { steps: { e1: [] }, ties: [], types: { e1: "meeting" } },
  },
  {
    id: "client-meeting-video-link",
    events: [ev("e1", { title: "Acme weekly sync", type: "meeting", source: "google", plus: 2, time: "15:00", guests: [{ name: "Priya Example", email: "priya@acme.com", rsvp: "yes" }], location: "https://meet.google.com/abc-defg-hij" })],
    expect: (o) => [...nothingFor("client-meeting-video-link", o, "e1"), ...cardsExactly("client-meeting-video-link", o, [])],
    answer: none,
    wrong: only("e1", [step("cab", "cab-local", "Book a cab to the Acme sync", D(2), D(2), "14:15")]),
  },
  {
    // In person at the client's office, no evidence, and the card was already asked and closed unanswered: nothing, no card.
    // (A meeting never asks either way.)
    id: "client-visit-in-person-no-evidence", events: [acmeVisit()], asks: [{ kind: "cab-local", state: "markdone" }],
    expect: (o) => [...nothingFor("client-visit-in-person-no-evidence", o, "e1"), ...cardsExactly("client-visit-in-person-no-evidence", o, [])],
    answer: none,
    wrong: only("e1", [cabTo(ACME, 3, "10:15")]),
  },
  {
    id: "client-visit-in-person-cab-on", events: [acmeVisit()], habits: [did("cab-local", 8)],
    expect: (o) => [...exactKinds("client-visit-in-person-cab-on", o, "e1", ["cab-local"]), ...namesPlace("client-visit-in-person-cab-on", o, "e1", "cab-local", /acme|prestige|mg road/i),
      ...beforeStart("client-visit-in-person-cab-on", o, acmeVisit())],
    answer: only("e1", [cabTo(ACME, 3, "10:15", 3, "You booked a cab for your last in-person meeting.")]),
    wrong: { steps: { e1: [] }, ties: [] },
  },
  {
    // The user presents: one prepare-ahead, 2 to 3 working days before (Monday or Tuesday of that week).
    id: "board-review-presenting", events: [boardReview()],
    expect: (o) => {
      const p = [...exactKinds("board-review-presenting", o, "e1", ["prepare-ahead"])];
      for (const s of stepsFor(o, "e1")) if (s.dueDate < D(THU - 3) || s.dueDate > D(THU - 2)) p.push(`board-review-presenting: prepare-ahead due ${s.dueDate}, expected ${D(THU - 3)} or ${D(THU - 2)} (2 to 3 working days before)`);
      return [...p, ...stepDateProblems("board-review-presenting", o, { ref: "e1", date: D(THU) })];
    },
    answer: only("e1", [step("prepare", "prepare-ahead", "Prepare the Q3 board deck", D(THU - 3), D(THU - 3))]),
    wrong: only("e1", [step("prepare", "prepare-ahead", "Prepare the Q3 board deck", D(THU - 1), D(THU - 1))]),
    dry: [dryStep("two prepare-ahead steps", "e1", [step("prepare", "prepare-ahead", "Prepare the deck", D(THU - 3)), step("rehearse", "prepare-ahead", "Rehearse", D(THU - 2))], /at most one prepare-ahead/)],
  },
  {
    id: "board-review-presenting-covered", events: [boardReview()],
    todos: [{ id: "task-o1-deck", title: "Prepare board deck", duePlus: THU - 1, by: "you" }],
    expect: (o) => [...(tieFor(o, "task-o1-deck", "e1") ? [] : ["board-review-presenting-covered: the open \"Prepare board deck\" TODO is not tied to the board review"]),
      ...stepsFor(o, "e1").map((s) => `board-review-presenting-covered: step ${s.key} (${s.kind}) although the owner's TODO covers the preparation`)],
    answer: { steps: { e1: [] }, ties: [{ todo: "task-o1-deck", ref: "e1" }] },
    wrong: only("e1", [step("prepare", "prepare-ahead", "Prepare the Q3 board deck", D(THU - 3), D(THU - 3))]),
  },
  {
    id: "flight-drives-to-airport", events: [{ ...flight2, memory: { "cab-airport": ["Drives to the airport for flights."] } }],
    expect: (o) => exactKinds("flight-drives-to-airport", o, "e1", ["checkin"]),
    answer: only("e1", [checkin(1)]),
    wrong: only("e1", [checkin(1), cabAirport(1)]),
  },
  {
    id: "flight-cab-skipped-twice", events: [flight2], habits: [skipped("cab-airport", 10), skipped("cab-airport", 30)],
    expect: (o) => [...exactKinds("flight-cab-skipped-twice", o, "e1", ["checkin"]),
      ...(habitOf(o, "cab-airport")?.tally === "off" ? [] : [`flight-cab-skipped-twice: the bundle shows cab-airport ${JSON.stringify(habitOf(o, "cab-airport"))}, expected tally off`])],
    answer: only("e1", [checkin(1)]),
    wrong: only("e1", [checkin(1), cabAirport(1)]),
    dry: [dryStep("cab-airport after two skips", "e1", [checkin(1), cabAirport(1)], /dismissed the last two cab-airport steps/)],
  },
  {
    // A done between skips resets: the newest counted close is a done.
    id: "flight-cab-skip-then-done", events: [flight2], habits: [skipped("cab-airport", 30), did("cab-airport", 10)],
    expect: (o) => exactKinds("flight-cab-skip-then-done", o, "e1", ["checkin", "cab-airport"]),
    answer: only("e1", [checkin(1), cabAirport(1)]),
    wrong: only("e1", [checkin(1)]),
  },
  {
    id: "flight-with-stay", events: [{ ...flight2, facts: ["The user is staying 3 nights in Chennai after the flight."] }],
    expect: (o) => [...exactKinds("flight-with-stay", o, "e1", ["checkin", "cab-airport", "pack"]), ...beforeStart("flight-with-stay", o, flight2), ...stepDateProblems("flight-with-stay", o, flight2)],
    answer: only("e1", [checkin(1), cabAirport(1), step("pack", "pack", "Pack for Chennai", D(1), D(1))]),
    wrong: only("e1", [checkin(1), cabAirport(1)]),
  },
  {
    // Tickets already booked (3 days out): a ride to the station and the chart / PNR check; a journey alone gets no pack.
    id: "train-tier-1", events: [ev("e1", { title: "Train 12007 Shatabdi BLR→MAS", type: "journey", source: "google", plus: 3, time: "06:00" })],
    expect: (o) => [...exactKinds("train-tier-1", o, "e1", ["cab-station", "pnr-check"]), ...beforeStart("train-tier-1", o, ev("e1", { title: "", source: "google", plus: 3, time: "06:00" })),
      ...stepDateProblems("train-tier-1", o, { ref: "e1", date: D(3) })],
    answer: only("e1", [step("pnr-check", "pnr-check", "Check the chart and PNR status for 12007", D(2), D(2), "20:00"), step("cab-station", "cab-station", "Book a cab to the station for 12007", D(2), D(2), "21:00")]),
    wrong: only("e1", [step("pnr-check", "pnr-check", "Check the chart and PNR status for 12007", D(2), D(2), "20:00"), step("cab-station", "cab-station", "Book a cab to the station for 12007", D(2), D(2), "21:00"), step("checkin", "checkin", "Web check-in for 12007", D(2), D(2))]),
  },
  // --- asking once ------------------------------------------------------------------------------------------------------------
  {
    id: "appointment-no-evidence", events: [derm()],
    expect: (o) => [...nothingFor("appointment-no-evidence", o, "e1"), ...cardsExactly("appointment-no-evidence", o, ["cab-local"]), ...cardCopy("appointment-no-evidence", o, "cab-local")],
    answer: { steps: { e1: [] }, ties: [] },
    wrong: only("e1", [derma()]),
  },
  {
    id: "appointment-asked-waiting", events: [derm()], asks: [{ kind: "cab-local", state: "open" }],
    expect: (o) => [...nothingFor("appointment-asked-waiting", o, "e1"), ...cardsExactly("appointment-asked-waiting", o, []),
      ...(habitOf(o, "cab-local")?.asked === "waiting" ? [] : [`appointment-asked-waiting: the bundle shows cab-local ${JSON.stringify(habitOf(o, "cab-local"))}, expected asked "waiting"`])],
    answer: { steps: { e1: [] }, ties: [] },
    wrong: only("e1", [derma()]),
  },
  {
    // Held on an earlier run for the card; the owner pressed "Book a cab reminder": the event comes back once as "answered".
    id: "ask-answered-yes", events: [derm("e1", { held: "cab-local" })], asks: [{ kind: "cab-local", state: "yes" }],
    expect: (o) => [
      ...(o.bundle.events.e1?.change === "answered" ? [] : [`ask-answered-yes: the held event came back with change ${o.bundle.events.e1?.change}, expected "answered"`]),
      ...(o.bundle.events.e1?.type === "appointment" ? [] : [`ask-answered-yes: the held event shows type ${o.bundle.events.e1?.type}, expected its stored "appointment"`]),
      ...(habitOf(o, "cab-local")?.tally === "on" ? [] : [`ask-answered-yes: the bundle shows cab-local ${JSON.stringify(habitOf(o, "cab-local"))}, expected tally on (a yes is a stated preference)`]),
      ...exactKinds("ask-answered-yes", o, "e1", ["cab-local"]), ...namesPlace("ask-answered-yes", o, "e1", "cab-local", /skin clinic|jayanagar/i), ...cardsExactly("ask-answered-yes", o, []),
    ],
    answer: only("e1", [cabTo(SKIN, 4, "10:15", 4, "You asked for a cab reminder before appointments.")]),
    wrong: { steps: { e1: [] }, ties: [] },
  },
  {
    id: "ask-answered-no", events: [derm()], asks: [{ kind: "cab-local", state: "no" }],
    expect: (o) => [...nothingFor("ask-answered-no", o, "e1"), ...cardsExactly("ask-answered-no", o, []),
      ...(habitOf(o, "cab-local")?.tally === "off" ? [] : [`ask-answered-no: the bundle shows cab-local ${JSON.stringify(habitOf(o, "cab-local"))}, expected tally off (a no is a stated preference)`])],
    answer: { steps: { e1: [] }, ties: [] },
    wrong: only("e1", [derma()]),
    dry: [dryStep("cab-local after a no", "e1", [derma()], /said no to cab-local/)],
  },
  {
    // Mark done on the card is not an answer: the kind stays held back (no step) and is never asked again.
    id: "ask-mark-done", events: [derm()], asks: [{ kind: "cab-local", state: "markdone" }],
    expect: (o) => [...nothingFor("ask-mark-done", o, "e1"), ...cardsExactly("ask-mark-done", o, []),
      ...(habitOf(o, "cab-local")?.asked === true && habitOf(o, "cab-local")?.tally === "none" ? [] : [`ask-mark-done: the bundle shows cab-local ${JSON.stringify(habitOf(o, "cab-local"))}, expected asked true, tally none`])],
    answer: { steps: { e1: [] }, ties: [] },
    wrong: only("e1", [derma()]),
  },
  {
    // The owner told the Personal Assistant instead: a fact the open card did not see answers it; Calendar Desk withdraws its card.
    id: "ask-answered-in-chat", events: [derm("e1", { memory: { "cab-local": ["Wants a cab reminder before appointments."] } })], asks: [{ kind: "cab-local", state: "open", openFacts: [] }],
    expect: (o) => [...(o.withdrawn.includes("cab-local") ? [] : ["ask-answered-in-chat: the open cab-local card was not withdrawn"]),
      ...exactKinds("ask-answered-in-chat", o, "e1", ["cab-local"]), ...namesPlace("ask-answered-in-chat", o, "e1", "cab-local", /skin clinic|jayanagar/i), ...cardsExactly("ask-answered-in-chat", o, [])],
    answer: only("e1", [cabTo(SKIN, 4, "10:15", 4, "You asked for a cab reminder before appointments.")]),
    wrong: { steps: { e1: [] }, ties: [] },
  },
  {
    // The card has been open 15 days: this run expires it. The kind stays held back and is never asked again.
    id: "ask-expired", events: [derm()], asks: [{ kind: "cab-local", state: "expired" }],
    expect: (o) => [...(o.withdrawn.includes("cab-local") ? [] : ["ask-expired: the card open past 14 days was not withdrawn"]),
      ...nothingFor("ask-expired", o, "e1"), ...cardsExactly("ask-expired", o, [])],
    answer: { steps: { e1: [] }, ties: [] },
    wrong: only("e1", [derma()]),
  },
  // --- types that get nothing at all --------------------------------------------------------------------------------------
  {
    id: "reminder-call-mom", events: [ev("e1", { title: "Call mom", type: "reminder", source: "google", plus: 1, time: "19:00" })],
    expect: (o) => nothingFor("reminder-call-mom", o, "e1"),
    answer: none,
    wrong: { steps: { e1: [] }, ties: [], types: { e1: "meeting" } },
    dry: [dryStep("a step on a reminder", "e1", [step("call", "other", "Call mom", D(1))], /a reminder gets no steps/)],
  },
  {
    id: "time-block-focus", events: [ev("e1", { title: "Focus time", type: "block", source: "google", plus: 1, time: "09:00" })],
    expect: (o) => nothingFor("time-block-focus", o, "e1"),
    answer: none,
    wrong: { steps: { e1: [] }, ties: [], types: { e1: "meeting" } },
    dry: [dryStep("a step on a block", "e1", [step("focus", "other", "Plan the focus session", D(1))], /a block gets no steps/)],
  },
  {
    id: "holiday-other", events: [ev("e1", { title: "Diwali (holiday)", type: "other", source: "google", plus: 5 })],
    expect: (o) => nothingFor("holiday-other", o, "e1"),
    answer: none,
    wrong: { steps: { e1: [] }, ties: [], types: { e1: "occasion" } },
    dry: ["documents", "payment", "other"].map((kind) => dryStep(`${kind} on an other`, "e1", [step("x", kind, "Something for Diwali", D(4))], /gets no steps/)),
  },
  // --- evidence for a cab to an appointment ---------------------------------------------------------------------------------
  {
    id: "appointment-tally-on", events: [ev("e1", { title: "Salon appointment", type: "appointment", source: "google", plus: 2, time: "16:00", location: "Toni and Guy, Indiranagar" })], habits: [did("cab-local", 14)],
    expect: (o) => [...exactKinds("appointment-tally-on", o, "e1", ["cab-local"]), ...namesPlace("appointment-tally-on", o, "e1", "cab-local", /toni|indiranagar/i), ...cardsExactly("appointment-tally-on", o, [])],
    answer: only("e1", [cabTo("Toni and Guy, Indiranagar", 2, "15:15")]),
    wrong: { steps: { e1: [] }, ties: [] },
  },
  {
    id: "appointment-uber-fact", events: [dentist({ memory: { "cab-local": ["Takes an Uber to the dentist."] } })],
    expect: (o) => [...exactKinds("appointment-uber-fact", o, "e1", ["cab-local"]), ...namesPlace("appointment-uber-fact", o, "e1", "cab-local", /smile|koramangala/i), ...cardsExactly("appointment-uber-fact", o, [])],
    answer: only("e1", [cabTo(SMILE, 3, "16:15", 3, "You take a cab to the dentist.")]),
    wrong: { steps: { e1: [] }, ties: [] },
  },
  {
    id: "appointment-drives", events: [dentist({ memory: { "cab-local": ["Drives to appointments."] } })],
    expect: (o) => [...nothingFor("appointment-drives", o, "e1"), ...cardsExactly("appointment-drives", o, [])],
    answer: { steps: { e1: [] }, ties: [] },
    wrong: only("e1", [cabTo(SMILE, 3, "16:15")]),
  },
  {
    // The same event with the same evidence is planned the same way every run.
    id: "meeting-in-person-same-thrice", runs: 3, habits: [did("cab-local", 9)],
    events: [ev("e1", { title: "Partner meeting with Zeta", type: "meeting", source: "google", plus: 3, time: "15:00", location: "Zeta HQ, Bellandur",
      guests: [{ name: "Arun Example", email: "arun@zeta.example", rsvp: "yes" }] })],
    expect: (o) => [...exactKinds("meeting-in-person-same-thrice", o, "e1", ["cab-local"]), ...namesPlace("meeting-in-person-same-thrice", o, "e1", "cab-local", /zeta|bellandur/i)],
    answer: only("e1", [cabTo("Zeta HQ, Bellandur", 3, "14:15", 3, "You booked a cab for your last in-person meeting.")]),
    wrong: { steps: { e1: [] }, ties: [] },
  },
  // --- birthdays: relation alone / gift habit / "no gifts" ------------------------------------------------------------------
  {
    id: "birthday-daughter-B", events: [bday4()], habits: [did("gift", 60)],
    expect: (o) => {
      const p = [...exactKinds("birthday-daughter-B", o, "e1", ["gift"]), ...cardsExactly("birthday-daughter-B", o, [])];
      for (const s of stepsFor(o, "e1")) if (!(s.dueDate < bday4().date)) p.push(`birthday-daughter-B: gift step dueDate ${s.dueDate} is not before the birthday (${bday4().date})`);
      return p;
    },
    answer: only("e1", [step("gift", "gift", "Buy a birthday gift for Kavya", D(3), D(1), undefined, "You bought a gift for the last family birthday.")]),
    wrong: { steps: { e1: [] }, ties: [] },
  },
  {
    id: "birthday-daughter-C", events: [bday4("e1", { memory: { gift: ["The family does not exchange birthday gifts."] } })],
    expect: (o) => [...nothingFor("birthday-daughter-C", o, "e1"), ...cardsExactly("birthday-daughter-C", o, [])],
    answer: { steps: { e1: [] }, ties: [] },
    wrong: only("e1", [step("gift", "gift", "Buy a birthday gift for Kavya", D(3), D(1))]),
  },
  {
    id: "two-kinds-two-cards", events: [derm("e1"), bday4("e2", { plus: 6 })],
    expect: (o) => [...nothingFor("two-kinds-two-cards", o, "e1"), ...nothingFor("two-kinds-two-cards", o, "e2"), ...cardsExactly("two-kinds-two-cards", o, ["cab-local", "gift"])],
    answer: { steps: { e1: [], e2: [] }, ties: [] },
    wrong: { steps: { e1: [derma()], e2: [] }, ties: [] },
  },
  {
    // A dinner out is an occasion; the owner booked a table last time.
    id: "dinner-table-on", habits: [did("table-booking", 20)],
    events: [ev("e1", { title: "Dinner with Arjun Example", type: "occasion", source: "google", plus: 5, time: "20:00", location: "Olive Table, Indiranagar" })],
    expect: (o) => [...exactKinds("dinner-table-on", o, "e1", ["table-booking"]), ...cardsExactly("dinner-table-on", o, []), ...stepDateProblems("dinner-table-on", o, { ref: "e1", date: D(5) })],
    answer: only("e1", [step("book-table", "table-booking", "Book a table at Olive Table, Indiranagar", D(3), D(2), undefined, "You booked a table for your last dinner out.")]),
    wrong: only("e1", [step("cab", "cab-local", "Book a cab to Olive Table, Indiranagar", D(5), D(5), "19:15")]),
  },
];
