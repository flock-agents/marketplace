// The app's fixed vocabulary and its one setting. No Drizzle or Bun import here: the pages read these too.

export const SLOTS = ["Breakfast", "Lunch", "Dinner"] as const;

/** A person's age group: portions and the planning rules follow it. */
export const GROUPS = ["child", "adult", "elder"] as const;
/** A house rule: a vegetarian day, an egg day, a fasting day, a day without onion and garlic, or the family's own. */
export const RULE_KINDS = ["veg", "egg", "fasting", "no_onion_garlic", "other"] as const;
/** How often an everyday item is needed: every day, a number of times a week, or on named weekdays. */
export const EVERY = ["day", "week", "weekdays"] as const;
/** An order's life: scheduled → placed (waiting for the person's payment) → paid, or not paid; or cancelled before it is placed. */
export const ORDER_STATUSES = ["scheduled", "placed", "paid", "not_paid", "cancelled"] as const;
/** How long an item keeps: fresh items are bought for the days that use them, long-life ones once, in the week's first order. */
export const KEEPS = ["fresh", "long"] as const;

/** The grocery apps an order can go to, by their Flock connection id. */
export const GROCERY_APPS = ["zepto", "swiggy-instamart", "zomato-blinkit", "bigbasket"] as const;
export type GroceryApp = (typeof GROCERY_APPS)[number];
export const APP_NAMES: Record<GroceryApp, string> = { zepto: "Zepto", "swiggy-instamart": "Swiggy Instamart", "zomato-blinkit": "Blinkit", bigbasket: "BigBasket" };

/** When a later order of the week is placed: the evening before its first day, or that morning when the evening is taken. */
export const ORDER_TIME = "18:00";
export const MORNING_TIME = "08:00";

/** The app's one owner-facing setting: declared here with its check, passed to mountKit, and repeated without the check in
 *  flock.app.json "settings". */
export const SETTINGS = [
  { key: "grocery_app", type: "string" as const, default: "zepto", scope: "owner" as const, label: "The grocery app orders go to",
    check: (v: unknown) => (GROCERY_APPS as readonly unknown[]).includes(v) ? null : `grocery_app must be one of: ${GROCERY_APPS.join(", ")}` },
];

/** Meal Planner 2.0's tables. The upgrade keeps them as they are (mountKit keepTables): never changed, dropped or shown. */
export const OLD_TABLES = ["ingredients", "recipes", "recipe_ingredients", "meals", "meal_recipes", "diners", "diner_portions", "standing_consumption", "staples", "carts", "groceries", "prep_reminders", "shopping_prefs", "stock", "agent_jobs", "choice_log", "learned_prefs", "message_log"];
