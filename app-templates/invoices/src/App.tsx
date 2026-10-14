import { useEffect, useState } from "react";
import { AppShell, AgentChat, useApp, useHashRoute, label, type AppShellProps } from "./flock/ui";
import { InvoicesPage } from "./pages/InvoicesPage";
import { CustomersPage } from "./pages/CustomersPage";
import { SettingsPage } from "./pages/SettingsPage";
import { cap, many, type Selected } from "./pages/shared";

// The name, object, accent, starters and labels come from the app's display (GET /api/_app); these are the fallbacks.
const STARTERS = ["Which invoices are overdue?", "Draft a reminder for the oldest overdue invoice", "Make an invoice for a customer from my last email"];

export default function App() {
  const app = useApp();
  const [page, go] = useHashRoute("invoices");
  const [selected, setSelected] = useState<Selected>(null);
  useEffect(() => setSelected(null), [page]);   // the chat follows the page: a record picked elsewhere is not what the viewer is looking at now
  const pages = [
    { id: "invoices", label: label("nav.invoices", "Invoices"), icon: "receipt" },
    { id: "customers", label: label("nav.customers", "Customers") === "Customers" ? cap(many()) : label("nav.customers", "Customers"),   // follows a renamed noun unless the nav name itself was reworded
      icon: "users" },
    { id: "settings", label: "Settings", icon: "settings" },
  ];
  return (
    <AppShell
      name={app.name ?? document.title} object={app.display.object ?? "receipt"} accent={(app.display.accent ?? "teal") as AppShellProps["accent"]}
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
      {page === "settings" ? <SettingsPage /> : page === "customers" ? <CustomersPage selected={selected} onSelect={setSelected} /> : <InvoicesPage selected={selected} onSelect={setSelected} />}
    </AppShell>
  );
}
