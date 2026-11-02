import { useEffect, useState } from "react";
import { AppShell, AgentChat, useApp, useHashRoute, label, type AppShellProps } from "./flock/ui";
import { WeekPage } from "./pages/WeekPage";
import { GroceriesPage } from "./pages/GroceriesPage";
import { PantryPage } from "./pages/PantryPage";
import { RecipesPage } from "./pages/RecipesPage";
import { RecipePage } from "./pages/RecipePage";
import { IngredientsPage } from "./pages/IngredientsPage";
import { IngredientPage } from "./pages/IngredientPage";
import { GlobalSearch } from "./pages/GlobalSearch";

// The name, object, accent, starters and labels come from the app's display (GET /api/_app); these are the fallbacks.
const STARTERS = ["Plan next week without repeats", "Plan next week from our recipes", "Make the grocery list"];
const PAGE_IDS = ["week", "groceries", "pantry", "recipes", "ingredients"];

export default function App() {
  const app = useApp();
  const [page, go] = useHashRoute("week");
  const recipeId = page.startsWith("recipe/") ? page.slice(7) : null;
  const ingredientId = page.startsWith("ingredient/") ? page.slice(11) : null;
  const groceryFocus = page.startsWith("groceries/") ? page.slice(10).split(",").filter(Boolean) : [];
  const current = recipeId ? "recipes" : ingredientId ? "ingredients" : groceryFocus.length ? "groceries" : PAGE_IDS.includes(page) ? page : "week";
  const [selected, setSelected] = useState<{ table: string; id: string; label: string } | null>(null);
  useEffect(() => { if (!recipeId && selected?.table === "recipes") setSelected(null); }, [recipeId]); // eslint-disable-line react-hooks/exhaustive-deps
  const pages = [
    { id: "week", label: label("nav.week", "Week"), icon: "calendar-days" },
    { id: "groceries", label: label("nav.groceries", "Shopping"), icon: "shopping-basket" },
    { id: "pantry", label: label("nav.pantry", "Pantry"), icon: "package" },
    { id: "recipes", label: label("nav.recipes", "Recipes"), icon: "book-open" },
    { id: "ingredients", label: label("nav.ingredients", "Ingredients"), icon: "carrot" },
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
      <GlobalSearch onOpen={(route) => { setSelected(null); go(route); }} />
      {ingredientId ? <IngredientPage id={ingredientId} onBack={() => go("ingredients")} onOpenRecipe={(id) => go(`recipe/${id}`)} />
        : recipeId ? <RecipePage id={recipeId} onBack={() => go("recipes")} onSelect={setSelected} />
        : current === "groceries" ? <GroceriesPage focus={groceryFocus} />
        : current === "pantry" ? <PantryPage />
        : current === "ingredients" ? <IngredientsPage onOpen={(i) => go(`ingredient/${i.id}`)} />
        : current === "recipes" ? <RecipesPage onOpen={(r) => go(`recipe/${r.id}`)} />
        : <WeekPage onSelect={setSelected} onOpenGroceries={(ids) => { setSelected(null); go(`groceries/${ids.join(",")}`); }} />}
    </AppShell>
  );
}
