import { useState, useEffect, useCallback } from "react";
import type { CalendarEvent, Member, Reminder, ViewMode } from "@shared/types";
import { api } from "./lib/api";
import { WeekView } from "./components/WeekView";
import { DayView } from "./components/DayView";
import { ReminderList } from "./components/ReminderList";
import { MemberBar } from "./components/MemberBar";
import "./styles.css";

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function getWeekRange(date: Date) {
  const start = new Date(date);
  start.setDate(start.getDate() - start.getDay());
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 7);
  return { from: start.toISOString(), to: end.toISOString() };
}

function getDayRange(date: Date) {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { from: start.toISOString(), to: end.toISOString() };
}

export default function App() {
  const [view, setView] = useState<ViewMode>("week");
  const [currentDate, setCurrentDate] = useState(new Date());
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [visibleMemberIds, setVisibleMemberIds] = useState<Set<number | null>>(new Set());

  const loadData = useCallback(async () => {
    const range = view === "week" ? getWeekRange(currentDate) : getDayRange(currentDate);
    const [evts, mems, rems] = await Promise.all([
      api.events.list(range),
      api.members.list(),
      api.reminders.list({ ...range, status: undefined }),
    ]);
    setEvents(evts);
    setMembers(mems);
    setReminders(rems);
    setVisibleMemberIds((prev) => {
      const next = new Set(prev);
      for (const m of mems) next.add(m.id);
      next.add(null);
      return next;
    });
  }, [view, currentDate]);

  useEffect(() => { loadData(); }, [loadData]);

  const navigate = (delta: number) => {
    setCurrentDate((d) => {
      const n = new Date(d);
      if (view === "week") n.setDate(n.getDate() + delta * 7);
      else n.setDate(n.getDate() + delta);
      return n;
    });
  };

  const goToday = () => setCurrentDate(new Date());

  const toggleMember = (id: number) => {
    setVisibleMemberIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const onDayClick = (date: Date) => {
    setCurrentDate(date);
    setView("day");
  };

  const dateLabel =
    view === "week"
      ? (() => {
          const start = new Date(currentDate);
          start.setDate(start.getDate() - start.getDay());
          const end = new Date(start);
          end.setDate(end.getDate() + 6);
          if (start.getMonth() === end.getMonth()) {
            return `${MONTH_NAMES[start.getMonth()]} ${start.getDate()}–${end.getDate()}, ${start.getFullYear()}`;
          }
          return `${MONTH_NAMES[start.getMonth()].slice(0, 3)} ${start.getDate()} – ${MONTH_NAMES[end.getMonth()].slice(0, 3)} ${end.getDate()}, ${end.getFullYear()}`;
        })()
      : currentDate.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" });

  return (
    <div className="app">
      <header className="header">
        <div className="header-left">
          <h1 className="app-title">Family Calendar</h1>
        </div>
        <div className="header-right">
          <button className="flock-btn today-btn" onClick={goToday}>Today</button>
          <div className="view-toggle">
            <button
              className={`toggle-btn ${view === "week" ? "active" : ""}`}
              onClick={() => setView("week")}
            >
              Week
            </button>
            <button
              className={`toggle-btn ${view === "day" ? "active" : ""}`}
              onClick={() => setView("day")}
            >
              Day
            </button>
          </div>
        </div>
      </header>

      <div className="nav-date">
        <button className="nav-arrow" onClick={() => navigate(-1)}>
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M12.5 15L7.5 10L12.5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
        </button>
        <span className="current-label">{dateLabel}</span>
        <button className="nav-arrow" onClick={() => navigate(1)}>
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M7.5 15L12.5 10L7.5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
        </button>
      </div>

      <MemberBar members={members} visibleMembers={visibleMemberIds} onToggle={toggleMember} />

      <main className="main-content">
        {view === "week" ? (
          <WeekView events={events} currentDate={currentDate} onDayClick={onDayClick} visibleMembers={visibleMemberIds} />
        ) : (
          <DayView events={events} currentDate={currentDate} visibleMembers={visibleMemberIds} />
        )}
      </main>

      <ReminderList reminders={reminders} onUpdate={loadData} />
    </div>
  );
}
