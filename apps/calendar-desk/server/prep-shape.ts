import type { EventRow } from "./store";

/** What an occurrence looked like when the prep agent judged its series. The date is left out: every occurrence has its own. */
export interface PrepShape {
  startTime: string | null; durationMin: number | null; allDay: boolean; attendeesText: string | null;
  /** Present only when the detail popover was read: null means unknown, never "none". */
  details: { guests: string[]; location: string | null; description: string | null; meetLink: string | null } | null;
}

const hhmm = (ms: number) => { const d = new Date(ms); return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };
const norm = (s: string | null) => (s ?? "").replace(/\s+/g, " ").trim() || null;

export function prepShape(e: EventRow): PrepShape {
  return {
    startTime: e.startAt == null ? null : hhmm(e.startAt),
    durationMin: e.startAt == null || e.endAt == null ? null : Math.round((e.endAt - e.startAt) / 60_000),
    allDay: e.allDay,
    attendeesText: norm(e.attendeesText),
    details: e.detailsAt == null || e.guests == null ? null : {
      guests: e.guests.map((g) => g.email.toLowerCase()).sort(),
      location: norm(e.location), description: norm(e.description), meetLink: norm(e.meetLink),
    },
  };
}

/** Any difference counts as a change. Details read now that were not read at judgement are new to the agent: a change.
 *  Details not read now are unknown: only the agenda is compared. */
export function shapeChanged(was: PrepShape, now: PrepShape): boolean {
  const { details: wasDetails, ...wasAgenda } = was;
  const { details: nowDetails, ...nowAgenda } = now;
  if (JSON.stringify(wasAgenda) !== JSON.stringify(nowAgenda)) return true;
  return nowDetails != null && JSON.stringify(wasDetails) !== JSON.stringify(nowDetails);
}
