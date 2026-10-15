import "./App.css";
import { useEffect, useState } from "react";
import { AppShell, AgentChat, useApp, useHashRoute, label, type AppShellProps } from "./flock/ui";
import { WeekPage } from "./pages/WeekPage";
import { EventsPage } from "./pages/EventsPage";
import { RemindersPage } from "./pages/RemindersPage";
import type { Selected } from "./pages/shared";

// The name, object, accent, starters and labels come from the app's display (GET /api/_app); these are the fallbacks.
const STARTERS = ["What's on this week?", "Remind everyone about the dentist on Friday", "Who is picking up the kids on Thursday?"];
const PAGE_IDS = ["week", "events", "reminders"];

export default function App() {
  const app = useApp();
  const [page, go] = useHashRoute("week", PAGE_IDS);
  const [selected, setSelected] = useState<Selected>(null);
  useEffect(() => setSelected(null), [page]);   // the chat follows the page: a row picked elsewhere is not what the viewer is looking at now
  const pages = [
    { id: "week", label: label("nav.week", "Week"), icon: "calendar-days" },
    { id: "events", label: label("nav.events", "Events"), icon: "list" },
    { id: "reminders", label: label("nav.reminders", "Reminders"), icon: "bell" },
  ];
  return (
    <AppShell
      name={app.name ?? document.title} object={app.display.object ?? "calendar"} accent={(app.display.accent ?? "blue") as AppShellProps["accent"]}
      nav="auto" pages={pages} current={page} onNavigate={go}
      chat={{
        placement: "side",
        render: () => (
          <AgentChat
            placement="side"
            context={selected}
            starters={app.display.starters ?? STARTERS}
          />
        ),
      }}
    >
      {page === "events" ? <EventsPage selected={selected} onSelect={setSelected} />
        : page === "reminders" ? <RemindersPage selected={selected} onSelect={setSelected} />
        : <WeekPage selected={selected} onSelect={setSelected} />}
    </AppShell>
  );
}
