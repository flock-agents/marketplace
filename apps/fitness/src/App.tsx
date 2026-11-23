import type { ComponentType } from "react";
import { AppShell, AgentChat, label, useApp, useHashRoute, type AppShellProps, type ShellPage } from "./flock/ui";
import { DayPage } from "./pages/DayPage";
import { HistoryPage } from "./pages/HistoryPage";
import { ExercisesPage } from "./pages/ExercisesPage";
import { IdlePage, SETUP_STARTER } from "./pages/IdlePage";
import { isSetUp } from "../server/profile/setup";

// The name, object, accent, starters and labels come from the app's display (GET /api/_app); these are the fallbacks.
const STARTERS = ["What's my plan today?", "How am I doing on calories?", "Show me how to do a dead bug"];
/** While idle the shell shows this one page (on "today", where the app opens); its button opens the coach's usual chat. */
const IDLE_PAGES: ShellPage[] = [{ id: "today", label: "Getting started", icon: "info" }];
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
  // Idle until the app knows who it is for: one page saying so, whose button opens the coach's chat with the setup ask.
  const idle = !app.loading && !isSetUp((key) => app.settings[key]);
  const View = idle ? IdlePage : VIEWS[page] ?? VIEWS.today;
  // The title is the display's title.overview label (the app's own name unless renamed: titleFromName), else the app's name.
  const title = app.display.labels?.["title.overview"] ? label("title.overview", "Fitness") : app.name ?? document.title;
  return (
    <AppShell
      name={title} object={app.display.object ?? "globe"} accent={app.display.accent as AppShellProps["accent"]}
      nav="top" pages={idle ? IDLE_PAGES : PAGES} current={page} onNavigate={go}
      chat={{
        placement: "side",
        render: () => <AgentChat placement="side" starters={idle ? [SETUP_STARTER] : app.display.starters ?? STARTERS} />,
      }}
    >
      <View />
    </AppShell>
  );
}
