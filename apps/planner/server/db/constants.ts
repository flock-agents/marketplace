// Plain constants, no imports: both the server schema and the browser pages read these.
export const SLOTS = ["Breakfast", "Lunch", "Dinner"] as const;
export const AISLES = ["Vegetables", "Dairy", "Staples", "Spices", "Other"] as const;

export const MEAL_STATUSES = ["planned", "confirmed"] as const;
export const MEAL_OUTCOMES = ["cooked", "skipped"] as const;

/** v3 background jobs (docs/V3-FLOW-SPEC.md "Asking the agent for help"). */
export const AGENT_JOB_KINDS = ["review_meal", "fill_recipe", "suggest_swaps", "parse_reply", "use_by", "pick_service", "find_patterns", "meal_ideas"] as const;
/** What a learned_prefs row is about (find_patterns answers). engagement_time: rule {time:"HH:MM"}, when the family
 *  usually engages with the meal plan; meal_latest / order_window: rule {time:"HH:MM", …}. */
export const LEARNED_PREF_KINDS = ["drop_item", "add_item", "service", "swap", "meal_latest", "order_window", "taste", "engagement_time"] as const;
export const CHOICE_KINDS = ["item_dropped", "item_added", "item_restored", "swap_accepted", "swap_declined", "service_picked",
  "meal_cooked", "meal_skipped", "draft_let_go", "undo_auto"] as const;
export const MESSAGE_SLOTS = ["reminder", "heads_up", "price"] as const;
export const COACH_CHECKS = ["pending", "ok", "flagged"] as const;

/** How the shopping timeline buys a thing: dairy ~daily, vegetables every couple of days, pantry and spices rarely. */
export const BUY_CATEGORIES = ["dairy", "vegetables", "pantry", "spices"] as const;
export const GROCERY_SOURCES = ["meal", "staple", "manual"] as const;
export const GROCERY_STATUSES = ["pending", "confirmed", "ordered", "skipped", "have_stock"] as const;

/** Long-shelf-life categories the family is assumed to already have: never auto-added to the shopping list just
 *  because a staple's cadence comes due (timeline.ts's ensureStapleGroceries) or a recipe uses one
 *  (mealGroceries.ts's AUTO_CATEGORIES). The only door either has into the timeline is the family's own pantry
 *  check-in (server/pantryCheck.ts) selecting it. */
/** Pantry rough stock levels (staples.level / ingredients.level). */
export const PANTRY_LEVELS = ["plenty", "low", "out"] as const;

export const HELD_BACK_CATEGORIES = ["pantry", "spices"] as const;

/** Home shelf life (days) per category when an ingredient has no shelf_life_days of its own yet (server/stock.ts). */
export const DEFAULT_SHELF_LIFE_DAYS: Record<string, number> = {
  leafy_greens: 2, dairy: 2, meat: 1, bakery: 3, fruits: 4, vegetables: 5,
  snacks: 60, grains: 180, pantry: 180, oils: 180, pulses: 365, spices: 365, household: 365,
};
export const UNKNOWN_SHELF_LIFE_DAYS = 3;   // an uncategorised item: assume it spoils fast, never that it lasts

// v3 (docs/V3-FLOW-SPEC.md): a draft stays live until a family member's yes, then becomes an order; a draft with no
// yes by order_at + shop.yes_wait_h (or one the owner lets go) is let go, its open items rolling into the next draft.
export const CART_STATUSES = ["draft", "ordered", "let_go"] as const;

/** The grocery connectors compared at order time; the owner named these three (Instamart can be added later). */
export const DEFAULT_SERVICES = ["zepto", "zomato-blinkit", "bigbasket"];

/** Per-category ShoppingPrefs defaults (server/quantity.ts); mirrors flock.app.json's prefs.category_defaults. */
export const DEFAULT_CATEGORY_PREFS: Record<string, Record<string, unknown>> = {"vegetables": {"pack_min": 250, "pack_max": 1000, "pack_unit": "g", "stock_days": 2, "price": "balanced", "brands_preferred": [], "brands_avoid": [], "substitutions": "ask", "service": "any", "never_auto_add": false}, "leafy_greens": {"pack_min": 1, "pack_max": 2, "pack_unit": "pc", "stock_days": 1, "price": "balanced", "brands_preferred": [], "brands_avoid": [], "substitutions": "ask", "service": "any", "never_auto_add": false}, "fruits": {"pack_min": 500, "pack_max": 2000, "pack_unit": "g", "stock_days": 3, "price": "balanced", "brands_preferred": [], "brands_avoid": [], "substitutions": "ask", "service": "any", "never_auto_add": false}, "dairy": {"pack_min": 500, "pack_max": 2000, "pack_unit": "ml", "stock_days": 1, "price": "balanced", "brands_preferred": ["Amul", "Mother Dairy"], "brands_avoid": [], "substitutions": "ask", "service": "any", "never_auto_add": false}, "bakery": {"pack_min": 1, "pack_max": 2, "pack_unit": "pc", "stock_days": 2, "price": "balanced", "brands_preferred": [], "brands_avoid": [], "substitutions": "allowed", "service": "any", "never_auto_add": false}, "grains": {"pack_min": 1000, "pack_max": 5000, "pack_unit": "g", "stock_days": 30, "price": "balanced", "brands_preferred": ["Aashirvaad", "India Gate"], "brands_avoid": [], "substitutions": "ask", "service": "any", "never_auto_add": false}, "pulses": {"pack_min": 500, "pack_max": 2000, "pack_unit": "g", "stock_days": 30, "price": "balanced", "brands_preferred": ["Tata Sampann"], "brands_avoid": [], "substitutions": "ask", "service": "any", "never_auto_add": false}, "pantry": {"pack_min": 500, "pack_max": 2000, "pack_unit": "g", "stock_days": 30, "price": "cheapest", "brands_preferred": [], "brands_avoid": [], "substitutions": "allowed", "service": "any", "never_auto_add": false}, "oils": {"pack_min": 1000, "pack_max": 5000, "pack_unit": "ml", "stock_days": 45, "price": "balanced", "brands_preferred": ["Fortune"], "brands_avoid": [], "substitutions": "ask", "service": "any", "never_auto_add": false}, "spices": {"pack_min": 50, "pack_max": 200, "pack_unit": "g", "stock_days": 60, "price": "balanced", "brands_preferred": ["MDH", "Everest"], "brands_avoid": [], "substitutions": "ask", "service": "any", "never_auto_add": false}, "meat": {"pack_min": 250, "pack_max": 1000, "pack_unit": "g", "stock_days": 1, "price": "premium", "brands_preferred": ["Licious"], "brands_avoid": [], "substitutions": "never", "service": "any", "never_auto_add": true}, "snacks": {"pack_min": 1, "pack_max": 3, "pack_unit": "pc", "stock_days": 7, "price": "balanced", "brands_preferred": [], "brands_avoid": [], "substitutions": "allowed", "service": "any", "never_auto_add": true}, "household": {"pack_min": 1, "pack_max": 2, "pack_unit": "pc", "stock_days": 30, "price": "cheapest", "brands_preferred": [], "brands_avoid": [], "substitutions": "allowed", "service": "any", "never_auto_add": true}};

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const isTime = (v: unknown): v is string => typeof v === "string" && TIME_RE.test(v);
const timeProblem = (key: string) => (v: unknown): string | null => (isTime(v) ? null : `${key} must be a 24-hour time, HH:MM`);
const intProblem = (key: string, min: number, max: number) => (v: unknown): string | null =>
  typeof v === "number" && Number.isInteger(v) && v >= min && v <= max ? null : `${key} must be a whole number from ${min} to ${max}`;
const numProblem = (key: string, min: number, max: number) => (v: unknown): string | null =>
  typeof v === "number" && Number.isFinite(v) && v >= min && v <= max ? null : `${key} must be a number from ${min} to ${max}`;

/** The app's owner-facing settings (ARCHITECTURE.md "A setting"): declared here with their checks, passed to mountKit, and
 *  repeated without the checks in flock.app.json "settings" for the planner's catalogue. */
export const SETTINGS = [
  { key: "cook.morning", type: "string" as const, default: "07:30", scope: "owner" as const,
    label: "When breakfast and lunch are cooked", check: timeProblem("cook.morning") },
  { key: "cook.lunch", type: "string" as const, default: "13:00", scope: "owner" as const,
    label: "When lunch is eaten (meal time default)", check: timeProblem("cook.lunch") },
  { key: "cook.evening", type: "string" as const, default: "19:00", scope: "owner" as const,
    label: "When dinner is cooked", check: timeProblem("cook.evening") },
  { key: "quiet.start", type: "string" as const, default: "22:30", scope: "owner" as const,
    label: "Quiet hours start: no reminders after this", check: timeProblem("quiet.start") },
  { key: "quiet.end", type: "string" as const, default: "06:30", scope: "owner" as const,
    label: "Quiet hours end", check: timeProblem("quiet.end") },
  { key: "reminder.buffer_min", type: "integer" as const, default: 30, scope: "owner" as const,
    label: "Extra minutes before a prep step must start", check: intProblem("reminder.buffer_min", 0, 240) },
  { key: "spend.weekly_limit", type: "number" as const, default: 2000, scope: "owner" as const,
    label: "₹ a week (Mon-Sun) a cart is flagged for crossing", check: numProblem("spend.weekly_limit", 0, 1_000_000) },
  { key: "price.jump_pct", type: "number" as const, default: 20, scope: "owner" as const,
    label: "% above usual price an item is flagged, not added", check: numProblem("price.jump_pct", 0, 500) },
  { key: "services", type: "json" as const, default: DEFAULT_SERVICES, scope: "owner" as const,
    label: "Grocery services compared at order time",
    check: (v: unknown) => Array.isArray(v) && v.length > 0 && v.every((s) => typeof s === "string" && s.trim()) ? null : "services must be a non-empty list of service ids" },
  { key: "buy.delivery_lead_min", type: "integer" as const, default: 60, scope: "owner" as const,
    label: "Minutes an item must arrive before the cooking slot that uses it", check: intProblem("buy.delivery_lead_min", 0, 480) },
  { key: "buy.fresh_window_days", type: "json" as const, default: { dairy: 1, vegetables: 2, pantry: 7, spices: 14 }, scope: "owner" as const,
    label: "Days one order may cover, per category",
    check: (v: unknown) => v && typeof v === "object" && !Array.isArray(v) && BUY_CATEGORIES.every((k) => typeof (v as Record<string, unknown>)[k] === "number" && (v as Record<string, number>)[k] > 0)
      ? null : "buy.fresh_window_days must give a positive number of days for dairy, vegetables, pantry and spices" },
  { key: "buy.earliest_order", type: "string" as const, default: "06:30", scope: "owner" as const,
    label: "No order is placed earlier than this", check: timeProblem("buy.earliest_order") },
  { key: "buy.preferred_order_time", type: "string" as const, default: "18:00", scope: "owner" as const,
    label: "The evening before an item is needed, order it at this time instead of waiting for the morning (Zepto's evening deals, and the family's own habit) — falls back to the morning cutoff once this slot has already passed",
    check: timeProblem("buy.preferred_order_time") },
  // v3: a meal's needs leave the draft only once it is surely over — its latest time (docs/V3-FLOW-SPEC.md).
  { key: "meal.latest.breakfast", type: "string" as const, default: "11:00", scope: "owner" as const,
    label: "Breakfast can be cooked as late as", check: timeProblem("meal.latest.breakfast") },
  { key: "meal.latest.lunch", type: "string" as const, default: "15:00", scope: "owner" as const,
    label: "Lunch can be cooked as late as", check: timeProblem("meal.latest.lunch") },
  { key: "meal.latest.dinner", type: "string" as const, default: "23:00", scope: "owner" as const,
    label: "Dinner can be cooked as late as", check: timeProblem("meal.latest.dinner") },
  { key: "shop.reminder_time", type: "string" as const, default: "20:00", scope: "owner" as const,
    label: "The evening before a shopping window, the reminder goes out at", check: timeProblem("shop.reminder_time") },
  { key: "shop.heads_up_min", type: "integer" as const, default: 15, scope: "owner" as const,
    label: "Minutes before a shopping window the draft is shared", check: intProblem("shop.heads_up_min", 5, 240) },
  { key: "shop.yes_wait_h", type: "number" as const, default: 3, scope: "owner" as const,
    label: "Hours to wait for a yes before the draft is let go quietly", check: numProblem("shop.yes_wait_h", 0.5, 24) },
  { key: "plan.horizon_days", type: "integer" as const, default: 7, scope: "owner" as const,
    label: "Rolling plan length, in days", check: intProblem("plan.horizon_days", 1, 30) },
  { key: "plan.confirm_ahead_days", type: "integer" as const, default: 2, scope: "owner" as const,
    label: "Days within which an unconfirmed day is raised with the family", check: intProblem("plan.confirm_ahead_days", 0, 14) },
  { key: "prefs.category_defaults", type: "json" as const, default: DEFAULT_CATEGORY_PREFS, scope: "owner" as const,
    label: "Default shopping prefs per category (an ingredient's own prefs override these)",
    check: (v: unknown) => v && typeof v === "object" && !Array.isArray(v) ? null : "prefs.category_defaults must be an object keyed by category" },
];
