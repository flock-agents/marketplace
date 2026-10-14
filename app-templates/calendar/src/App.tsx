import { useState } from "react";
import { AppShell, AgentChat, useApp, useHashRoute, type AppShellProps } from "./flock/ui";
import { CalendarPage } from "./pages/CalendarPage";
import type { Selected } from "./pages/shared";

// The name, object, accent, starters and labels come from the app's display (GET /api/_app); these are the fallbacks.
const STARTERS = ["What's on this week?", "Am I free on Saturday afternoon?", "Add a dentist appointment next Tuesday at 10"];

export default function App() {
  const app = useApp();
  const [, go] = useHashRoute("calendar");
  const [selected, setSelected] = useState<Selected>(null);
  return (
    <AppShell
      name={app.name ?? document.title} object={app.display.object ?? "calendar"} accent={(app.display.accent ?? "violet") as AppShellProps["accent"]}
      nav="none" current="calendar" onNavigate={go}
      chat={{
        placement: "side",
        render: () => <AgentChat placement="side" context={selected} starters={app.display.starters ?? STARTERS} />,
      }}
    >
      <CalendarPage selected={selected} onSelect={setSelected} />
    </AppShell>
  );
}
