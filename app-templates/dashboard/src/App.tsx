import { AppShell, AgentChat, useApp, useHashRoute, type AppShellProps } from "./flock/ui";
import { OverviewPage } from "./pages/OverviewPage";

// The name, object, accent, starters and labels come from the app's display (GET /api/_app); these are the fallbacks.
const STARTERS = ["What changed today?", "Add a number to track", "What happened this week?"];

export default function App() {
  const app = useApp();
  const [, go] = useHashRoute("overview");
  return (
    <AppShell
      name={app.name ?? document.title} object={app.display.object ?? "globe"} accent={app.display.accent as AppShellProps["accent"]}
      nav="none" current="overview" onNavigate={go}
      chat={{
        placement: "side",
        render: () => <AgentChat placement="side" starters={app.display.starters ?? STARTERS} />,
      }}
    >
      <OverviewPage />
    </AppShell>
  );
}
