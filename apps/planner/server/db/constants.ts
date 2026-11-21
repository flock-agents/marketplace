// The app's fixed vocabulary and its one setting. No Drizzle or Bun import here: the pages read these too.

export const SLOTS = ["Breakfast", "Lunch", "Dinner"] as const;

/** A person's age group: portions and the planning rules follow it. */
export const GROUPS = ["child", "adult", "elder"] as const;
/** A house rule: vegetarian (no meat, no eggs), eggs but no meat, no eggs, no meat, fasting, no onion and garlic, or the family's
 *  own (its note says it). A rule with no days holds every day ("mostly vegetarian"). */
export const RULE_KINDS = ["veg", "egg", "no_eggs", "no_meat", "fasting", "no_onion_garlic", "other"] as const;
/** How each rule reads on the Family page: what the rule allows or forbids, never the opposite. */
export const RULE_LABELS: Record<(typeof RULE_KINDS)[number], string> = { veg: "Vegetarian", egg: "Eggs but no meat", no_eggs: "No eggs", no_meat: "No meat",
  fasting: "Fasting", no_onion_garlic: "No onion or garlic", other: "Other" };
/** Whether the cook tries new recipes (reels, the internet) or is better with a set menu of familiar dishes. */
export const COOK_NEW_RECIPES = ["open", "set_menu"] as const;
/** How often an item is bought, as set_regular (the older way to state an item's cycle) takes it. */
export const EVERY = ["day", "week", "weekdays"] as const;
/** A cart's life: one `open` cart per app is the one being filled; `ordering` while the agent places it; then `placed` (waiting
 *  for the person's payment), `paid` or `not_paid`; `cancelled` before it is placed. */
export const ORDER_STATUSES = ["open", "ordering", "placed", "paid", "not_paid", "cancelled"] as const;
/** Why a line is in a cart: an everyday item, a meal's ingredient, an item running low, one the family added, or one returned
 *  from an order nobody paid for. */
export const LINE_SOURCES = ["everyday", "meal", "low", "added", "returned"] as const;
export type LineSource = (typeof LINE_SOURCES)[number];
/** How often an item is bought: every day, every few days, or about monthly. */
export const ITEM_GROUPS = ["daily", "few_days", "monthly"] as const;

/** What an item event is: a purchase, the family's answer to a stock question, a question asked, or one that went unanswered. */
export const EVENT_KINDS = ["purchase", "answer", "ask", "unanswered"] as const;
/** How an event counts towards the estimate. */
export const EVENT_TAGS = ["counted", "early_buy", "your_answer", "one_off", "not_counted"] as const;
/** How an event's tag reads on the item page. */
export const TAG_TEXT: Record<(typeof EVENT_TAGS)[number], string> = { counted: "counted", early_buy: "early buy", your_answer: "your answer", one_off: "one-off, not counted", not_counted: "not counted" };

/** The shopping apps, by their Flock connection id. */
export const SHOP_APPS = ["zepto", "swiggy-instamart", "zomato-blinkit", "bigbasket", "amazon"] as const;
export type GroceryApp = (typeof SHOP_APPS)[number];
export const APP_NAMES: Record<GroceryApp, string> = { zepto: "Zepto", "swiggy-instamart": "Swiggy Instamart", "zomato-blinkit": "Blinkit", bigbasket: "BigBasket", amazon: "Amazon Fresh" };
const ALIASES: Record<string, GroceryApp> = {
  zepto: "zepto", "zepto-mcp": "zepto",
  swiggy: "swiggy-instamart", instamart: "swiggy-instamart", "swiggy instamart": "swiggy-instamart", "swiggy-instamart": "swiggy-instamart", "swiggy-instamart-mcp": "swiggy-instamart",
  blinkit: "zomato-blinkit", "zomato blinkit": "zomato-blinkit", "zomato-blinkit": "zomato-blinkit",
  bigbasket: "bigbasket", "big basket": "bigbasket",
  amazon: "amazon", "amazon fresh": "amazon", "amazon-fresh": "amazon",
};
/** An app however it is written ("Zepto", "swiggy instamart", "Blinkit"), as its id; null when it is none of ours. */
export const appOf = (v: unknown): GroceryApp | null => (typeof v === "string" ? ALIASES[v.trim().toLowerCase().replace(/\s+/g, " ")] ?? null : null);
/** Can the agent copy a cart into the app? Amazon has no cart tool: its cart is built when the family orders. */
export const CART_SYNC: Record<GroceryApp, boolean> = { zepto: true, "swiggy-instamart": true, "zomato-blinkit": true, bigbasket: true, amazon: false };

/** Dishes served with most meals: a week may hold them on many days without counting as a repeat. */
export const STAPLE_DISHES = ["roti", "rotis", "chapati", "chapatis", "phulka", "phulkas", "rice", "plain rice", "steamed rice", "curd", "dahi", "raita",
  "salad", "papad", "pickle", "buttermilk", "chaas", "milk", "fruit", "fruits"] as const;

/** How a dish went, as the family says it: good, okay, or didn't work. */
export const DISH_RATINGS = ["good", "okay", "didnt_work"] as const;
export type DishRating = (typeof DISH_RATINGS)[number];
/** How many of a dish's ratings are kept, newest first. */
export const RATINGS_KEPT = 5;

export const COOKING_DAYS_DEFAULT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
/** How far back an order history is read, in days. */
export const HISTORY_DAYS = 92;
/** A placed order still unpaid this long after is closed as not paid. */
export const UNPAID_AFTER_HOURS = 24;
/** An order left `ordering` this long is open again. */
export const ORDERING_STALE_MIN = 60;
/** A cart copied to its app this long ago is stale. */
export const CART_STALE_MIN = 30;
/** The app asks the agent to copy a cart this long after the last edit to it. */
export const SYNC_DEBOUNCE_SEC = 20;
/** An ask still unanswered after this long counts as lost. */
export const SYNC_ASK_COOLDOWN_MIN = 10;

/** The running-out estimate's tuning (spec section 6). */
export const ESTIMATE = {
  cycles: 5, oneOffLow: 0.5, oneOffHigh: 2,
  snoozeDays: { daily: 1, few_days: 1, monthly: 5 }, askLeadDays: { daily: 0, few_days: 1, monthly: 3 },
  maxAsks: 5, unansweredLimit: 2, missesBeforeWait: 2, waitStep: 1.25, waitMax: 2,
  // A daily item goes on the cart by itself when due; one whose cycle was learned from purchases stops once it was last bought this long ago.
  dailyStaleDays: 14,
} as const;

/** The app's owner-facing settings: declared here with their checks, passed to mountKit, and repeated without the checks in
 *  flock.app.json "settings". */
export const SETTINGS = [
  { key: "grocery_app", type: "choice" as const, options: [...SHOP_APPS], default: "zepto", scope: "owner" as const, label: "Your main grocery app",
    check: (v: unknown) => (SHOP_APPS as readonly unknown[]).includes(v) ? null : `grocery_app must be one of: ${SHOP_APPS.join(", ")}` },
  { key: "fallback_app", type: "choice" as const, options: ["none", ...SHOP_APPS], default: "none", scope: "owner" as const, label: "When something isn't on your main app",
    check: (v: unknown) => v === "none" || (SHOP_APPS as readonly unknown[]).includes(v) ? null : `fallback_app must be one of: none, ${SHOP_APPS.join(", ")}` },
  { key: "order_without_asking", type: "boolean" as const, default: false, scope: "owner" as const, label: "Order without asking" },
];

/** Meal Planner 2.0's tables. The upgrade keeps them as they are (mountKit keepTables): never changed, dropped or shown. */
export const OLD_TABLES = ["ingredients", "recipes", "recipe_ingredients", "meals", "meal_recipes", "diners", "diner_portions", "standing_consumption", "staples", "carts", "groceries", "prep_reminders", "shopping_prefs", "stock", "agent_jobs", "choice_log", "learned_prefs", "message_log"];
