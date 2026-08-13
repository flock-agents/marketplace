export interface Meal {
  id: number;
  date: string;
  slot: "breakfast" | "lunch" | "dinner" | "custom";
  name: string;
  notes: string | null;
  label: string | null;
  created_at: string;
  updated_at: string;
}

export interface LinkedMealRef {
  meal_id: number;
  meal_name: string;
  meal_date: string;
}

export interface ShoppingItem {
  id: number;
  name: string;
  quantity: string | null;
  status: "pending" | "bought";
  linked_meals: LinkedMealRef[];
  created_at: string;
  updated_at: string;
}

export interface CreateMealRequest {
  date: string;
  slot: string;
  name: string;
  notes?: string;
  label?: string;
}

export interface UpdateMealRequest {
  date?: string;
  slot?: string;
  name?: string;
  notes?: string;
  label?: string;
}

export interface CreateShoppingItemRequest {
  name: string;
  quantity?: string;
  linkedMealIds?: number[];
}

export interface UpdateShoppingItemRequest {
  name?: string;
  quantity?: string;
  status?: "pending" | "bought";
}
