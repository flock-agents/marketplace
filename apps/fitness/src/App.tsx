import type { ComponentType } from "react";
import { AppShell, AgentChat, useApp, useHashRoute, type AppShellProps, type ShellPage } from "./flock/ui";
import { DayPage } from "./pages/DayPage";
import { HistoryPage } from "./pages/HistoryPage";
import { ExercisesPage } from "./pages/ExercisesPage";

// The name, object, accent, starters and labels come from the app's display (GET /api/_app); these are the fallbacks.
const STARTERS = ["What's my plan today?", "How am I doing on calories?", "Show me how to do a dead bug"];
const PAGES: ShellPage[] = [
  { id: "today", label: "Today", icon: "target" },
  { id: "yesterday", label: "Yesterday", icon: "calendar-minus" },
  { id: "history", label: "History", icon: "chart-line" },
];
/** The exercise library opens from the Today page's workout plan (and from shared links), not from the tabs. */
const VIEWS: Record<string, ComponentType> = {
  today: () => <DayPage which="today" />,
  yesterday: () => <DayPage which="yesterday" />,
  history: HistoryPage,
  exercises: ExercisesPage,
};

export default function App() {
  const app = useApp();
  const [page, go] = useHashRoute("today", Object.keys(VIEWS));
  const View = VIEWS[page];
  return (
    <AppShell
      name={app.name ?? document.title} object={app.display.object ?? "globe"} accent={app.display.accent as AppShellProps["accent"]}
      nav="top" pages={PAGES} current={page} onNavigate={go}
      chat={{
        placement: "side",
        render: () => <AgentChat placement="side" starters={app.display.starters ?? STARTERS} />,
      }}
    >
      <View />
    </AppShell>
  );
}
