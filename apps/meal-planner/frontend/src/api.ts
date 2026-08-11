const BASE = "";

async function request(path: string, opts?: RequestInit) {
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: { "Content-Type": "application/json", ...opts?.headers },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw Object.assign(new Error(body.error || `HTTP ${res.status}`), { status: res.status, body });
  }
  return res.json();
}

export interface Meal {
  id: number;
  date: string;
  slot: string;
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

export const meals = {
  list: (from: string, to: string): Promise<Meal[]> =>
    request(`/api/meals?from=${from}&to=${to}`),
  create: (data: { date: string; slot: string; name: string; notes?: string }): Promise<Meal> =>
    request("/api/meals", { method: "POST", body: JSON.stringify(data) }),
  update: (id: number, data: Partial<Meal>): Promise<Meal> =>
    request(`/api/meals/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  delete: (id: number): Promise<{ ok: boolean }> =>
    request(`/api/meals/${id}`, { method: "DELETE" }),
};

export const shopping = {
  list: (): Promise<ShoppingItem[]> =>
    request("/api/shopping"),
  create: (data: { name: string; quantity?: string }): Promise<ShoppingItem> =>
    request("/api/shopping", { method: "POST", body: JSON.stringify(data) }),
  update: (id: number, data: Partial<ShoppingItem>): Promise<ShoppingItem> =>
    request(`/api/shopping/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  delete: (id: number): Promise<{ ok: boolean }> =>
    request(`/api/shopping/${id}`, { method: "DELETE" }),
  clearBought: (): Promise<{ ok: boolean; removed: number }> =>
    request("/api/shopping/clear-bought", { method: "POST" }),
};
