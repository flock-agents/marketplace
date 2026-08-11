export interface Meal {
  id: number;
  date: string;
  slot: "breakfast" | "lunch" | "dinner" | "snack";
  name: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface ShoppingItem {
  id: number;
  name: string;
  quantity: string | null;
  status: "pending" | "bought";
  created_at: string;
  updated_at: string;
}

export interface CreateMealRequest {
  date: string;
  slot: string;
  name: string;
  notes?: string;
}

export interface UpdateMealRequest {
  date?: string;
  slot?: string;
  name?: string;
  notes?: string;
}

export interface CreateShoppingItemRequest {
  name: string;
  quantity?: string;
}

export interface UpdateShoppingItemRequest {
  name?: string;
  quantity?: string;
  status?: "pending" | "bought";
}
