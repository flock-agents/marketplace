import { useEffect, useState } from "react";
import { AppShell, AgentChat, useApp, useHashRoute, label, type AppShellProps } from "./flock/ui";
import { TodayPage } from "./pages/TodayPage";
import { BookPage } from "./pages/BookPage";
import { ServicesPage } from "./pages/ServicesPage";
import type { Selected } from "./pages/shared";

// The name, object, accent, starters and labels come from the app's display (GET /api/_app); these are the fallbacks.
const STARTERS = ["Who is booked in today?", "Book a client in for tomorrow morning", "When is the next free hour on Friday?"];
const PAGE_IDS = ["today", "book", "services"];

export default function App() {
  const app = useApp();
  const [page, go] = useHashRoute("today", PAGE_IDS);
  const [selected, setSelected] = useState<Selected>(null);
  const [bookDate, setBookDate] = useState<string | undefined>();
  useEffect(() => setSelected(null), [page]);   // the chat follows the page: a booking picked elsewhere is not what the viewer is looking at now
  const pages = [
    { id: "today", label: label("nav.today", "Today"), icon: "calendar-days" },
    { id: "book", label: label("nav.book", "Book"), icon: "calendar-plus" },
    { id: "services", label: label("nav.services", "Services"), icon: "list" },
  ];
  return (
    <AppShell
      name={app.name ?? document.title} object={app.display.object ?? "calendar"} accent={(app.display.accent ?? "teal") as AppShellProps["accent"]}
      nav="auto" pages={pages} current={page} onNavigate={(id) => { setBookDate(undefined); go(id); }}
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
      {page === "book" ? <BookPage date={bookDate} onBooked={() => go("today")} />
        : page === "services" ? <ServicesPage selected={selected} onSelect={setSelected} />
        : <TodayPage selected={selected} onSelect={setSelected} onBook={(d) => { setBookDate(d); go("book"); }} />}
    </AppShell>
  );
}
