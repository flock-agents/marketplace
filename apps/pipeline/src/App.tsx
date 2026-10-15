import { useEffect, useState } from "react";
import { AppShell, AgentChat, useApp, useHashRoute, label, type AppShellProps } from "./flock/ui";
import { BoardPage } from "./pages/BoardPage";
import { TablePage } from "./pages/TablePage";
import type { Selected } from "./pages/shared";

// The name, object, accent, starters and labels come from the app's display (GET /api/_app); these are the fallbacks.
const STARTERS = ["What has gone quiet?", "What is due this week?", "What should I follow up on first?"];

export default function App() {
  const app = useApp();
  const [page, go] = useHashRoute("board");
  const [selected, setSelected] = useState<Selected>(null);
  useEffect(() => setSelected(null), [page]);   // the chat follows the page: a deal picked elsewhere is not what the viewer is looking at now
  const pages = [
    { id: "board", label: label("nav.board", "Board"), icon: "kanban" },
    { id: "table", label: label("nav.table", "Table"), icon: "table" },
  ];
  return (
    <AppShell
      name={app.name ?? document.title} object={app.display.object ?? "briefcase"} accent={app.display.accent as AppShellProps["accent"]}
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
      {page === "table" ? <TablePage selected={selected} onSelect={setSelected} /> : <BoardPage selected={selected} onSelect={setSelected} />}
    </AppShell>
  );
}
