import { useEffect, useState } from "react";
import { AppShell, AgentChat, useApp, useHashRoute, label, type AppShellProps } from "./flock/ui";
import { GalleryPage } from "./pages/GalleryPage";
import { DetailPage } from "./pages/DetailPage";

// The name, object, accent, starters and labels come from the app's display (GET /api/_app); these are the fallbacks.
const STARTERS = ["Find someone by name", "Add an entry from my last email"];

export default function App() {
  const app = useApp();
  const [page, go] = useHashRoute("gallery");
  const [selected, setSelected] = useState<{ id: string; name: string } | null>(null);
  const detailId = page.startsWith("entry/") ? page.slice(6) : null;
  useEffect(() => { if (!detailId) setSelected(null); }, [detailId]);   // the chat only knows the entry that is open
  const pages = [{ id: "gallery", label: label("nav.gallery", "All"), icon: "layout-grid" }];
  return (
    <AppShell
      name={app.name ?? document.title} object={app.display.object ?? "phone"} accent={app.display.accent as AppShellProps["accent"]}
      nav="auto" pages={pages} current={detailId ? "gallery" : page} onNavigate={go}
      chat={{
        placement: "side",
        render: () => (
          <AgentChat
            placement="side"
            context={selected ? { table: "entries", id: selected.id, label: selected.name } : null}
            starters={app.display.starters ?? STARTERS}
          />
        ),
      }}
    >
      {detailId
        ? <DetailPage id={detailId} onBack={() => go("gallery")} onSelect={setSelected} />
        : <GalleryPage onOpen={(row) => { setSelected(row); go(`entry/${row.id}`); }} />}
    </AppShell>
  );
}
