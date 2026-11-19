import "./pages/planner.css";
import { AppShell, AgentChat, useApp, useHashRoute, label, type AppShellProps } from "./flock/ui";
import { WeekPage } from "./pages/WeekPage";
import { ShoppingPage } from "./pages/ShoppingPage";
import { RecipesPage } from "./pages/RecipesPage";
import { FamilyPage } from "./pages/FamilyPage";

// The name, object, accent, starters and labels come from the app's display (GET /api/_app); these are the fallbacks.
const STARTERS = ["Plan next week", "Add paneer to the next order", "Save a recipe video"];
const PAGE_IDS = ["week", "shopping", "recipes", "family"];

export default function App() {
  const app = useApp();
  const [page, go] = useHashRoute("week", PAGE_IDS);
  const pages = [
    { id: "week", label: label("nav.week", "Week"), icon: "calendar-days" },
    { id: "shopping", label: label("nav.shopping", "Shopping"), icon: "shopping-basket" },
    { id: "recipes", label: label("nav.recipes", "Recipes"), icon: "book-open" },
    { id: "family", label: label("nav.family", "Family"), icon: "users" },
  ];
  return (
    <AppShell
      name={app.name ?? document.title} object={app.display.object ?? "grocery-bag"} accent={app.display.accent as AppShellProps["accent"]}
      nav="top" pages={pages} current={page} onNavigate={go}
      chat={{ placement: "side", render: () => <AgentChat placement="side" starters={app.display.starters ?? STARTERS} /> }}
    >
      {page === "shopping" ? <ShoppingPage /> : page === "recipes" ? <RecipesPage /> : page === "family" ? <FamilyPage /> : <WeekPage />}
    </AppShell>
  );
}
