import { useEffect, useState } from "react";
import { AppShell, AgentChat, useApp, useHashRoute, label, type AppShellProps } from "./flock/ui";
import { PlanPage } from "./pages/PlanPage";
import { BookingsPage } from "./pages/BookingsPage";
import { PackingPage } from "./pages/PackingPage";
import { BudgetPage } from "./pages/BudgetPage";
import type { Selected } from "./pages/shared";

// The name, object, accent, starters and labels come from the app's display (GET /api/_app); these are the fallbacks.
const STARTERS = ["What is planned for tomorrow?", "What's left to book?", "Plan a rainy-day backup for Sunday"];

export default function App() {
  const app = useApp();
  const [page, go] = useHashRoute("plan");
  const [selected, setSelected] = useState<Selected>(null);
  useEffect(() => setSelected(null), [page]);   // the chat follows the page: a row picked elsewhere is not what the viewer is looking at now
  const pages = [
    { id: "plan", label: label("nav.plan", "Plan"), icon: "calendar-days" },
    { id: "bookings", label: label("nav.bookings", "Bookings"), icon: "ticket" },
    { id: "packing", label: label("nav.packing", "Packing"), icon: "luggage" },
    { id: "budget", label: label("nav.budget", "Budget"), icon: "wallet" },
  ];
  return (
    <AppShell
      name={app.name ?? document.title} object={app.display.object ?? "plane"} accent={(app.display.accent ?? "blue") as AppShellProps["accent"]}
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
      {page === "bookings" ? <BookingsPage selected={selected} onSelect={setSelected} />
        : page === "packing" ? <PackingPage />
        : page === "budget" ? <BudgetPage />
        : <PlanPage selected={selected} onSelect={setSelected} />}
    </AppShell>
  );
}
