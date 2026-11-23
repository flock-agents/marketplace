// What the pages share: the app's own routes (read live, written with the server's reason on a refusal) and the rows as
// the pages hold them. The types are the server's, imported as types only: nothing of the server is bundled into a page.
import { useCallback, useEffect, useRef, useState } from "react";
import { KitError, kitFetch, subscribeEvents } from "../flock/ui";
import type { HouseView, PersonRow, shoppingApps } from "../../server/family";
import type { DishView, MealView, WeekView } from "../../server/meals";
import type { CartView, LineRow } from "../../server/cart";
import type { Rule, Slot } from "../../server/slotStore";
import type { itemView, PantryRow, pantryView } from "../../server/items";

export type { CartView, DishView, HouseView, LineRow, MealView, PantryRow, PersonRow, WeekView };
/** The shopping apps: the main one, the fallback, the connected ones, and Order without asking. */
export type Shopping = ReturnType<typeof shoppingApps>;
/** The Pantry (GET /api/pantry) and one item's page (GET /api/items/:id). */
export type PantryView = ReturnType<typeof pantryView>;
export type ItemView = NonNullable<ReturnType<typeof itemView>>;
/** A saved recipe as the kit's data route gives it: its lists still JSON text. */
export type RecipeRow = { id: string; name: string; links: string | null; source: string | null; thumbnail: string | null; notes: string | null;
  ingredients: string | null; tags: string | null; for_people: string | null };
export type Family = { people: PersonRow[]; house: HouseView; slots: Slot[]; rules: Rule[]; shopping: Shopping };

/** Why a call failed, in the server's own words when it gave a reason. */
export const why = (e: unknown): string =>
  e instanceof KitError ? String(e.body?.reason ?? e.message) : e instanceof Error && e.message ? e.message : "Something went wrong";

/** A write to one of the app's routes. A refusal throws with the server's reason, which a Form shows under its fields, and
 *  its HTTP status (`statusOf`). */
export async function send<T = unknown>(path: string, body: object = {}, method: "POST" | "PATCH" | "DELETE" = "POST"): Promise<T> {
  try { return await kitFetch<T>(path, { method, body: method === "DELETE" ? undefined : JSON.stringify(body) }); }
  catch (e) { throw Object.assign(new Error(why(e)), { status: e instanceof KitError ? e.status : undefined }); }
}
/** The HTTP status a failed `send` was answered with, when there was one. */
export const statusOf = (e: unknown): number | undefined => (e as { status?: number } | null)?.status;

/** One of the app's read routes, read again whenever one of `tables` changes (by anyone) and after a reconnect. */
export function useLive<T>(path: string, tables: string[]) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);   // only the latest read may land
  const watched = tables.join(",");
  const refetch = useCallback(async () => {
    const mine = ++seq.current;
    try { const d = await kitFetch<T>(path); if (mine === seq.current) { setData(d); setError(null); } }
    catch (e) { if (mine === seq.current) setError(why(e)); }
    finally { if (mine === seq.current) setLoading(false); }
  }, [path]);
  // Another path is another thing to show: what was read for the old one goes.
  useEffect(() => { setData(null); setLoading(true); void refetch(); }, [refetch]);
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | undefined;
    const soon = () => { clearTimeout(t); t = setTimeout(() => void refetch(), 150); };
    const off = subscribeEvents((e) => { if (watched.split(",").includes(e.table)) soon(); }, soon);
    return () => { clearTimeout(t); off(); };
  }, [watched, refetch]);
  return { data, loading, error, refetch };
}

/** "Mon, Wed" from a list; a dash of nothing when it is empty. */
export const joined = (v: readonly string[] | null | undefined): string => (v ?? []).join(", ");
/** Names typed with commas between them, as a list. */
export const typedList = (v: unknown): string[] => String(v ?? "").split(",").map((s) => s.trim()).filter(Boolean);
