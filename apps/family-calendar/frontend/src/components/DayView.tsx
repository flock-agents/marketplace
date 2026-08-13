import type { CalendarEvent } from "@shared/types";

interface Props {
  events: CalendarEvent[];
  currentDate: Date;
  visibleMembers: Set<number | null>;
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: true });
}

function formatRange(start: string, end: string) {
  return `${formatTime(start)} – ${formatTime(end)}`;
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

const CATEGORY_LABELS: Record<string, string> = {
  school: "🎒 School",
  work: "💼 Work",
  social: "🎉 Social",
  medical: "🏥 Medical",
  household: "🏠 Household",
  other: "📌 Other",
};

const STATUS_LABELS: Record<string, string> = {
  confirmed: "Confirmed",
  tentative: "Tentative",
  done: "Done",
};

export function DayView({ events, currentDate, visibleMembers }: Props) {
  const dayEvents = events
    .filter((e) => {
      if (!eventOverlapsDay(e, currentDate)) return false;
      return visibleMembers.has(e.memberId);
    })
    .sort((a, b) => a.startTime.localeCompare(b.startTime));

  if (dayEvents.length === 0) {
    return (
      <div className="empty-state">
        <div className="empty-icon">📭</div>
        <div className="empty-title">No events today</div>
        <div className="empty-subtitle">Enjoy the free time!</div>
      </div>
    );
  }

  return (
    <div className="day-timeline">
      {dayEvents.map((e) => {
        const multi = isMultiDay(e);
        return (
          <div
            key={e.id}
            className={`timeline-event status-${e.status}`}
            style={{ "--event-color": e.memberColor || "var(--flock-accent)" } as React.CSSProperties}
          >
            <div className="timeline-color-bar" />
            <div className="timeline-time-col">
              <span className="timeline-time">{formatTime(e.startTime)}</span>
              <span className="timeline-time-end">{formatTime(e.endTime)}</span>
            </div>
            <div className="timeline-details">
              <h3 className="timeline-title">
                {e.memberEmoji && <span className="timeline-emoji">{e.memberEmoji}</span>}
                {e.title}
                {multi && <span className="multi-day-badge">Multi-day</span>}
              </h3>
              <div className="timeline-meta">
                <span className="meta-time">{formatRange(e.startTime, e.endTime)}</span>
                <span className="meta-category">{CATEGORY_LABELS[e.category] || e.category}</span>
                <span className={`meta-status status-badge-${e.status}`}>{STATUS_LABELS[e.status] || e.status}</span>
              </div>
              {e.notes && <p className="timeline-notes">{e.notes}</p>}
            </div>
          </div>
        );
      })}
    </div>
  );
}
