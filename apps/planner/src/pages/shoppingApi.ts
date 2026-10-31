// The order calls the pages make (docs/V3-FLOW-SPEC.md). Relative paths only: kitFetch prefixes the app's own ./api/.
import { kitFetch } from "../flock/ui";
import type { OrderWindow } from "./shopping";

/** The owner's "Order with <service>": their explicit yes; the app wakes the agent to place it. */
export const orderWith = (cartId: string, service: string) =>
  kitFetch<{ ok: boolean; service: string }>(`carts/${cartId}/order`, { method: "POST", body: JSON.stringify({ service }) });

/** "Let it go": nothing is ordered; the draft's items move to the next order. */
export const letGo = (cartId: string) => kitFetch(`carts/${cartId}/let-go`, { method: "POST" });

/** Drop lines from a draft (a logged choice), or put them back (the Undo). Keys: ingredient id, else "item:<name>". */
export const dropFromDraft = (cartId: string, keys: string[]) =>
  kitFetch("shopping/draft/items", { method: "POST", body: JSON.stringify({ cart_id: cartId, remove: keys }) });
export const restoreToDraft = (cartId: string, keys: string[]) =>
  kitFetch("shopping/draft/items", { method: "POST", body: JSON.stringify({ cart_id: cartId, restore: keys }) });

export interface OrderPatterns { windows: OrderWindow[]; last_computed_at: string | null }
export const orderPatterns = () => kitFetch<OrderPatterns>("shopping/patterns");
export const setPinnedWindows = (windows: OrderWindow[]) =>
  kitFetch<OrderPatterns>("shopping/patterns/pinned", { method: "PUT", body: JSON.stringify({ windows }) });

/** What one meal needs, what is in stock and the order covering it. Fields are optional: the page falls back to the
 *  meal's own grocery rows for anything the server leaves out. */
export interface MealReadiness {
  status?: "ready" | "ordering" | "missing";
  ingredients?: { name: string; need?: string | null; in_stock?: boolean; status?: string | null; cart_id?: string | null }[];
  cart?: { id: string; status: string; buy_at?: string; order_at?: string | null; chosen_service?: string | null } | null;
}
export const mealReadiness = (mealId: string) => kitFetch<MealReadiness>(`meals/${mealId}/readiness`);

/** The server's readiness for many meals (the Week chips) — the one rule, incl. a passed order deadline. */
export const mealsReadiness = (ids: string[]) =>
  kitFetch<{ statuses: Record<string, "ready" | "ordering" | "missing" | "none"> }>(`meals/readiness?ids=${ids.map(encodeURIComponent).join(",")}`);
