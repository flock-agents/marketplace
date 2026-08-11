import React, { useState } from "react";
import MealPlan from "./MealPlan";
import ShoppingList from "./ShoppingList";

type Tab = "meals" | "shopping";

export default function App() {
  const [tab, setTab] = useState<Tab>("meals");

  return (
    <div className="app">
      <div className="header">
        <h1>🍽️ Meal Planner</h1>
        <div className="tabs">
          <button className={`tab ${tab === "meals" ? "active" : ""}`} onClick={() => setTab("meals")}>
            Meals
          </button>
          <button className={`tab ${tab === "shopping" ? "active" : ""}`} onClick={() => setTab("shopping")}>
            Shopping
          </button>
        </div>
      </div>
      {tab === "meals" ? <MealPlan /> : <ShoppingList />}
    </div>
  );
}
