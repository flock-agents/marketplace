import { AppShell, AgentChat, useApp, useHashRoute, type AppShellProps } from "./flock/ui";
import { ListPage } from "./pages/ListPage";

// The name, object, accent, starters and labels come from the app's display (GET /api/_app); these are the fallbacks.
const STARTERS = ["What is still open for me?", "Add a group for the weekend", "Who has the most still to do?"];

export default function App() {
  const app = useApp();
  const [, go] = useHashRoute("list");
  return (
    <AppShell
      name={app.name ?? document.title} object={app.display.object ?? "notebook"} accent={app.display.accent as AppShellProps["accent"]}
      nav="none" current="list" onNavigate={go}
      chat={{
        placement: "side",
        render: () => <AgentChat placement="side" starters={app.display.starters ?? STARTERS} />,
      }}
    >
      <ListPage />
    </AppShell>
  );
}
