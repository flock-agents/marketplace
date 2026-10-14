import { useEffect, useState } from "react";
import { AppShell, AgentChat, useApp, useHashRoute, label, type AppShellProps } from "./flock/ui";
import { WeekPage } from "./pages/WeekPage";
import { GroceriesPage } from "./pages/GroceriesPage";
import { RecipesPage } from "./pages/RecipesPage";
import { RecipePage } from "./pages/RecipePage";

// The name, object, accent, starters and labels come from the app's display (GET /api/_app); these are the fallbacks.
const STARTERS = ["Plan next week without repeats", "Plan next week from our recipes", "Make the grocery list"];
const PAGE_IDS = ["week", "groceries", "recipes"];

export default function App() {
  const app = useApp();
  const [page, go] = useHashRoute("week");
  const recipeId = page.startsWith("recipe/") ? page.slice(7) : null;
  const current = recipeId ? "recipes" : PAGE_IDS.includes(page) ? page : "week";
  const [selected, setSelected] = useState<{ table: string; id: string; label: string } | null>(null);
  useEffect(() => { if (!recipeId && selected?.table === "recipes") setSelected(null); }, [recipeId]); // eslint-disable-line react-hooks/exhaustive-deps
  const pages = [
    { id: "week", label: label("nav.week", "Week"), icon: "calendar-days" },
    { id: "groceries", label: label("nav.groceries", "Groceries"), icon: "shopping-basket" },
    { id: "recipes", label: label("nav.recipes", "Recipes"), icon: "book-open" },
  ];
  return (
    <AppShell
      name={app.name ?? document.title} object={app.display.object ?? "grocery-bag"} accent={app.display.accent as AppShellProps["accent"]}
      nav="top" pages={pages} current={current} onNavigate={(id) => { setSelected(null); go(id); }}
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
      {recipeId ? <RecipePage id={recipeId} onBack={() => go("recipes")} onSelect={setSelected} />
        : current === "groceries" ? <GroceriesPage />
        : current === "recipes" ? <RecipesPage onOpen={(r) => go(`recipe/${r.id}`)} />
        : <WeekPage onSelect={setSelected} />}
    </AppShell>
  );
}
