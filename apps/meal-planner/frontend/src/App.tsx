import React, { useState, useEffect } from "react";
import MealPlan from "./MealPlan";
import ShoppingList from "./ShoppingList";

type Tab = "meals" | "shopping";

function getTabFromHash(): Tab {
  const hash = window.location.hash.replace("#", "");
  return hash === "shopping" ? "shopping" : "meals";
}

export default function App() {
  const [tab, setTab] = useState<Tab>(getTabFromHash);

  useEffect(() => {
    const onHashChange = () => setTab(getTabFromHash());
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  function switchTab(t: Tab) {
    window.location.hash = t;
    setTab(t);
  }

  return (
    <div className="app">
      <div className="header">
        <h1>🍽️ Meal Planner</h1>
        <div className="tabs">
          <button className={`tab ${tab === "meals" ? "active" : ""}`} onClick={() => switchTab("meals")}>
            Meals
          </button>
          <button className={`tab ${tab === "shopping" ? "active" : ""}`} onClick={() => switchTab("shopping")}>
            Shopping
          </button>
        </div>
      </div>
      {tab === "meals" ? <MealPlan /> : <ShoppingList />}
    </div>
  );
}
