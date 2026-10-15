// Plain functions, no imports: the week page uses them and server/slots.test.ts tests them.
// A meal is several dishes: each dish is its own `meals` row, and the rows sharing a date and a slot are one meal.

type DishRow = { id: string; date: string; slot: string; dish: string; created_at?: string; _sample?: boolean };

/** One line of the week: a date and slot with every dish planned for it, in the order they were added. */
export interface MealSlot<M extends DishRow> { id: string; date: string; slot: string; dishes: M[]; _sample?: true }

/** The key of the meal a dish belongs to. */
export const slotKey = (m: { date: string; slot: string }): string => `${m.date}|${m.slot}`;

/** The dish rows grouped into one meal per date and slot. A meal is a sample only when every dish in it is. */
export function groupMeals<M extends DishRow>(rows: M[]): MealSlot<M>[] {
  const by = new Map<string, MealSlot<M>>();
  for (const m of rows) {
    const k = slotKey(m);
    const g = by.get(k) ?? { id: k, date: m.date, slot: m.slot, dishes: [] };
    g.dishes.push(m);
    by.set(k, g);
  }
  // Rows added this session have no created_at yet (the optimistic row): they go last.
  const at = (m: M) => m.created_at ?? "￿";
  return [...by.values()].map((g) => {
    g.dishes.sort((a, b) => (at(a) < at(b) ? -1 : at(a) > at(b) ? 1 : 0));
    return g.dishes.every((d) => d._sample === true) ? { ...g, _sample: true as const } : g;
  });
}

/** The row "+ Add" writes: one more dish on the same date and slot, never a change to the dishes already there. */
export const newDish = (at: { date: string; slot: string }, v: { dish: string; recipe_id: string | null }) =>
  ({ date: at.date, slot: at.slot, dish: v.dish, recipe_id: v.recipe_id });

/** The meal's other dishes, for the editor of one of them. */
export const otherDishes = <M extends DishRow>(rows: M[], meal: M): M[] => rows.filter((m) => m.id !== meal.id && slotKey(m) === slotKey(meal));
