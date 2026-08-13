import type { CalendarEvent } from "@shared/types";

interface Props {
  events: CalendarEvent[];
  currentDate: Date;
  onDayClick: (date: Date) => void;
  visibleMembers: Set<number | null>;
}

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function getWeekDays(date: Date): Date[] {
  const start = new Date(date);
  start.setDate(start.getDate() - start.getDay());
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    return d;
  });
}

function sameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function eventOverlapsDay(event: CalendarEvent, day: Date): boolean {
  const dayStart = new Date(day);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(day);
  dayEnd.setHours(23, 59, 59, 999);
  const eStart = new Date(event.startTime);
  const eEnd = new Date(event.endTime);
  return eStart <= dayEnd && eEnd >= dayStart;
}

function isMultiDay(event: CalendarEvent): boolean {
  const s = new Date(event.startTime);
  const e = new Date(event.endTime);
  return s.toDateString() !== e.toDateString();
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: true });
}

export function WeekView({ events, currentDate, onDayClick, visibleMembers }: Props) {
  const days = getWeekDays(currentDate);
  const today = new Date();

  return (
    <div className="week-grid">
      {days.map((day) => {
        const dayEvents = events.filter((e) => {
          if (!eventOverlapsDay(e, day)) return false;
          return visibleMembers.has(e.memberId);
        });

        const isToday = sameDay(day, today);
        const isWeekend = day.getDay() === 0 || day.getDay() === 6;

        return (
          <div
            key={day.toISOString()}
            className={`day-col${isToday ? " is-today" : ""}${isWeekend ? " is-weekend" : ""}`}
            onClick={() => onDayClick(day)}
          >
            <div className="day-header">
              <span className="day-name">{DAY_NAMES[day.getDay()]}</span>
              <span className={`day-num${isToday ? " today-badge" : ""}`}>{day.getDate()}</span>
            </div>
            <div className="day-events">
              {dayEvents.slice(0, 5).map((e) => {
                const multi = isMultiDay(e);
                return (
                  <div
                    key={e.id}
                    className={`event-chip status-${e.status}${multi ? " multi-day" : ""}`}
                    style={{ "--chip-color": e.memberColor || "var(--flock-accent)" } as React.CSSProperties}
                    title={`${e.title}${multi ? " (multi-day)" : ""} — ${formatTime(e.startTime)}`}
                  >
                    {multi && <span className="chip-icon">↔</span>}
                    <span className="chip-label">{e.title}</span>
                  </div>
                );
              })}
              {dayEvents.length > 5 && (
                <div className="event-chip overflow-chip">
                  +{dayEvents.length - 5} more
                </div>
              )}
              {dayEvents.length === 0 && (
                <div className="day-empty">No events</div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
