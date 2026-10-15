import { useEffect, useState } from "react";
import { AppShell, AgentChat, useApp, useHashRoute, label, type AppShellProps } from "./flock/ui";
import { ListPage } from "./pages/ListPage";
import { DetailPage } from "./pages/DetailPage";

// The name, object, accent, starters and labels come from the app's display (GET /api/_app); these are the fallbacks.
const STARTERS = ["What is overdue?", "Add an item from my last email"];

export default function App() {
  const app = useApp();
  const [page, go] = useHashRoute("list");
  const [selected, setSelected] = useState<{ id: string; title: string } | null>(null);
  const detailId = page.startsWith("item/") ? page.slice(5) : null;
  useEffect(() => { if (!detailId) setSelected(null); }, [detailId]);   // the chat only knows the row that is open
  const pages = [{ id: "list", label: label("nav.list", "All"), icon: "list" }];
  return (
    <AppShell
      name={app.name ?? document.title} object={app.display.object ?? "clipboard"} accent={app.display.accent as AppShellProps["accent"]}
      nav="auto" pages={pages} current={detailId ? "list" : page} onNavigate={go}
      chat={{
        placement: "side",
        render: () => (
          <AgentChat
            placement="side"
            context={selected ? { table: "items", id: selected.id, label: selected.title } : null}
            starters={app.display.starters ?? STARTERS}
          />
        ),
      }}
    >
      {detailId
        ? <DetailPage id={detailId} onBack={() => go("list")} onSelect={setSelected} />
        : <ListPage onOpen={(row) => { setSelected(row); go(`item/${row.id}`); }} />}
    </AppShell>
  );
}
