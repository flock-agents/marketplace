import type { ComponentType } from "react";
import { AppShell, AgentChat, useApp, useHashRoute, type AppShellProps, type ShellPage } from "./flock/ui";
import { DayPage } from "./pages/DayPage";
import { HistoryPage } from "./pages/HistoryPage";
import { ExercisesPage } from "./pages/ExercisesPage";
import { IdlePage, SETUP_STARTER } from "./pages/IdlePage";
import { isSetUp } from "../server/profile/setup";

// The name, object, accent, starters and labels come from the app's display (GET /api/_app); these are the fallbacks.
const STARTERS = ["What's my plan today?", "How am I doing on calories?", "Show me how to do a dead bug"];
/** The shell's own id for the chat when it is a page (its Chat tab navigates here). */
const CHAT_PAGE = "_chat";
/** While idle the shell shows two tabs: this page (on "today", where the app opens) and the coach's chat. */
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
  const [page, go] = useHashRoute("today", [...Object.keys(VIEWS), CHAT_PAGE]);
  // Idle until the app knows who it is for: one page saying so, and the coach's chat as a page its button opens.
  const idle = !app.loading && !isSetUp((key) => app.settings[key]);
  const View = idle ? () => <IdlePage onTalk={() => go(CHAT_PAGE)} /> : VIEWS[page] ?? VIEWS.today;
  const placement = idle ? "page" : "side";
  return (
    <AppShell
      name={app.name ?? document.title} object={app.display.object ?? "globe"} accent={app.display.accent as AppShellProps["accent"]}
      nav="top" pages={idle ? IDLE_PAGES : PAGES} current={page} onNavigate={go}
      chat={{
        placement,
        render: () => <AgentChat placement={placement} starters={idle ? [SETUP_STARTER] : app.display.starters ?? STARTERS} />,
      }}
    >
      <View />
    </AppShell>
  );
}
