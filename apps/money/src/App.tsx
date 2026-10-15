import { useEffect, useState } from "react";
import { AppShell, AgentChat, useApp, useHashRoute, label, type AppShellProps } from "./flock/ui";
import { OverviewPage } from "./pages/OverviewPage";
import { TransactionsPage } from "./pages/TransactionsPage";
import { BudgetsPage } from "./pages/BudgetsPage";
import { InvestmentsPage } from "./pages/InvestmentsPage";
import { GoalsPage } from "./pages/GoalsPage";
import type { Selected } from "./pages/shared";

// The name, object, accent, starters and labels come from the app's display (GET /api/_app); these are the fallbacks.
const STARTERS = ["Why is travel over budget?", "How much can we invest this month?", "Compare with last month"];

export default function App() {
  const app = useApp();
  const [page, go] = useHashRoute("overview");
  const [selected, setSelected] = useState<Selected>(null);
  useEffect(() => setSelected(null), [page]);   // the chat follows the page: a row picked elsewhere is not what the viewer is looking at now
  const pages = [
    { id: "overview", label: label("nav.overview", "Overview"), icon: "layout-dashboard" },
    { id: "transactions", label: label("nav.transactions", "Transactions"), icon: "arrow-left-right" },
    { id: "budgets", label: label("nav.budgets", "Budgets"), icon: "gauge" },
    { id: "investments", label: label("nav.investments", "Investments"), icon: "trending-up" },
    { id: "goals", label: label("nav.goals", "Goals"), icon: "target" },
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
      {page === "transactions" ? <TransactionsPage selected={selected} onSelect={setSelected} />
        : page === "budgets" ? <BudgetsPage />
        : page === "investments" ? <InvestmentsPage selected={selected} onSelect={setSelected} />
        : page === "goals" ? <GoalsPage selected={selected} onSelect={setSelected} />
        : <OverviewPage selected={selected} onSelect={setSelected} />}
    </AppShell>
  );
}
