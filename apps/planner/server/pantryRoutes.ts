// The Pantry endpoints (docs/V3-FLOW-SPEC.md "Pantry = what is in the kitchen"). Mounted on a Hono app so tests can
// drive them without the SDK. Every reply carries the kitchen as the app now sees it: the agent echoes that, never memory.
import type { Hono } from "hono";
import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import { answerPantry, answerProblem, pantryView, type PantryAnswer } from "./pantryCheck";
import { inferMealOutcomes } from "./mealOutcomes";
import { refreshShopping } from "./shopping";
import { stock } from "./db/schema";
import type { SettingsReader } from "./timeline";

type Emit = (table: string, id: string, op: "insert" | "update" | "delete") => void;
const body = async (c: { req: { json(): Promise<unknown> } }): Promise<unknown> => { try { return await c.req.json(); } catch { return null; } };

export function mountPantryRoutes(hono: Hono<any>, db: BunSQLiteDatabase<any>, settings: SettingsReader, emit?: Emit, clock: () => Date = () => new Date()) {
  // What is in the kitchen, by kind, with how sure the app is of each item, and the items due for a check-in.
  hono.get("/api/pantry", (c) => {
    const now = clock();
    inferMealOutcomes(db, settings, now, emit);   // meals surely over have drawn their share before stock is read
    return c.json(pantryView(db, settings, now));
  });

  // { items: [{ ingredient_id, have?: "yes" | "low" | "out" }] } — no `have` is a yes (silence = all there).
  hono.post("/api/pantry/answer", async (c) => {
    const b = await body(c);
    const problem = answerProblem(b);
    if (problem) return c.json({ ok: false, reason: problem }, 400);
    const now = clock();
    const result = answerPantry(db, settings, (b as { items: PantryAnswer[] }).items, now, emit);
    if (result.applied.some((a) => a.have !== "yes")) refreshShopping(db, settings, now, emit);
    return c.json({ ok: true, ...result, pantry: pantryView(db, settings, now) });
  });

  // "We already have X": { ingredient_id, item, qty?, unit?, use_by? } — covers its meals until use_by (else its shelf life).
  hono.post("/api/pantry/have", async (c) => {
    const b = await body(c) as Record<string, unknown> | null;
    if (!b || typeof b.ingredient_id !== "string" || typeof b.item !== "string" || !b.item.trim()) return c.json({ ok: false, reason: "ingredient_id and item are required" }, 400);
    const now = clock();
    const row = db.insert(stock).values({
      ingredient_id: b.ingredient_id, item: b.item.trim(), qty: typeof b.qty === "number" ? b.qty : null, unit: typeof b.unit === "string" ? b.unit : null,
      use_by: typeof b.use_by === "string" ? b.use_by : null, bought_at: now.toISOString(), source: "owner", updated_by: "app",
    }).returning().get() as { id: string };
    emit?.("stock", row.id, "insert");
    refreshShopping(db, settings, now, emit);
    return c.json({ ok: true, stock_id: row.id, pantry: pantryView(db, settings, now) });
  });
}
