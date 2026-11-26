// The app's fixed vocabulary and its one setting. No Drizzle or Bun import here: the pages read these too.

/** The main slots a household starts from (the setup writes them as `slots` rows). The slots table is the list a week is
 *  planned with; this one is only the default. */
export const SLOTS = ["Breakfast", "Lunch", "Dinner"] as const;

// ── The slot model (docs/slot-model-spec.md §2) ──

/** A slot: one of the main meals, a custom one (a child's tiffin, an evening snack), or an add-on to a main one for one
 *  person's different plate ("Papa's dinner"). */
export const SLOT_KINDS = ["main", "custom", "addon"] as const;
export type SlotKind = (typeof SLOT_KINDS)[number];
/** Planning order: Breakfast 10, a custom slot from breakfast (a tiffin) 20, Lunch 30, snacks 40, Dinner 50, add-ons 60 on. */
export const SLOT_ORDER = { Breakfast: 10, tiffin: 20, Lunch: 30, snack: 40, Dinner: 50, addon: 60 } as const;
/** A person's own meal in place of a main meal (a custom slot) sits this far after it in the day's order: its meal is that one. */
export const INSTEAD_STEP = 5;
/** A slot-day not cooked at home. */
export const SKIPS = ["eaten_out", "ordered_in"] as const;
export type Skip = (typeof SKIPS)[number];
/** planned: a suggestion the family was shown, never read as eaten; confirmed: the family said what was made (or a setup seed). */
export const SLOT_DAY_STATUSES = ["planned", "confirmed"] as const;
export type SlotDayStatus = (typeof SLOT_DAY_STATUSES)[number];
/** Where a library dish came from. */
export const LIBRARY_ORIGINS = ["setup_named", "family_added", "planner_suggested"] as const;
export type LibraryOrigin = (typeof LIBRARY_ORIGINS)[number];
/** What a rule is. Hard: always kept (veg, egg, no_eggs, avoid, only, swap, require, fasting, cap); a soft one has a
 *  frequency; note is words only, not checked. */
export const RULE_WHATS = ["veg", "egg", "no_eggs", "avoid", "only", "swap", "require", "fasting", "cap", "note"] as const;
export type RuleWhat = (typeof RULE_WHATS)[number];
/** How often a library dish or a soft rule comes: usually (4–5 a week), sometimes (2–3), rarely (at most 1), or "<n>/week".
 *  daily (a dish only): the family said to have it every day ("salad every day"): a staple by their word, on every slot-day of
 *  its slot, exempt from the repeat window (owner, 23 Nov). */
export const FREQUENCY_WORDS = ["usually", "sometimes", "rarely", "daily"] as const;
export type Frequency = (typeof FREQUENCY_WORDS)[number] | `${number}/week`;
/** Staples of a slot: dishes in at least this share of the slot's last STAPLE_WINDOW history rows with dishes (owner, 23 Nov). */
export const STAPLE_SHARE = 0.6;
export const STAPLE_WINDOW = 14;
/** History counts for staples only once a slot has at least this many history rows with dishes (seed + confirmed; owner,
 *  23 Nov): below it, a slot's staples are only its `daily` dishes. */
export const STAPLE_MIN_ROWS = 3;
/** At most this many "looks like" examples a slot (seed and confirmed slot-days only). */
export const LOOKS_LIKE_MAX = 6;
/** An untried dish placed this many times with no "made it" answer is dropped. */
export const UNTRIED_MAX_OFFERS = 2;
/** The tags every library dish's contains is read for at setup, besides every tag a rule names (spec §4.1). */
export const BASE_TAGS = ["egg", "meat", "fish", "onion_garlic", "nuts", "peanut", "sugar", "white_rice", "dairy"] as const;
/** The setup's day/count lint (spec §4.2): a dish's quote with one of these words (or a digit) and no frequency or days
 *  saved gets one re-read. Words only to spot a quote worth a second look; the model reads what they mean. */
export const LINT_DAY_WORDS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday", "mondays", "tuesdays", "wednesdays",
  "thursdays", "fridays", "saturdays", "sundays", "mon", "tue", "tues", "wed", "thu", "thur", "thurs", "fri", "sat", "sun", "weekend", "weekends",
  "weekday", "weekdays", "daily", "everyday", "day", "days", "night", "nights", "morning", "mornings", "evening", "evenings"] as const;
/** The frequency words a family says (J5): the saved ones, and their everyday forms. A quote with one and no frequency saved is
 *  linted like a day or count word: words only to spot it, the model reads what they mean. */
export const LINT_FREQUENCY_WORDS = [...FREQUENCY_WORDS, "mostly", "often", "generally", "normally", "typically", "regularly", "occasionally", "occasional",
  "seldom", "sometime", "everyday"] as const;
export const LINT_COUNT_WORDS = ["once", "twice", "thrice", "one", "two", "three", "four", "five", "six", "seven"] as const;
/** Staples are counted from confirmed slot-days only (the setup seed is stored confirmed, so it counts); a planned slot-day
 *  never feeds a staple (owner, 23 Nov: the plan's own output must not feed back into it). Flip to let planned ones count. */
export const STAPLES_FROM_PLANNED = false;

// ── The weekly plan (make_plan, spec §5; decided defaults, tunable) ──

/** The days (inclusive range [min, max]) a week a dish or a soft rule comes, by how often. A daily dish comes on every
 *  slot-day of its slot. A dish with nothing said has no count: the rotation spreads it (kinds model, owner 25 Nov). */
export const FREQUENCY_DAYS: Record<"usually" | "sometimes" | "rarely" | "daily", [number, number]> = { usually: [4, 5], sometimes: [2, 3], rarely: [0, 1], daily: [7, 7] };
/** How many days of a 7-day week a meal's template comes when the family said it in words ("usually", "sometimes"): a part
 *  week has its share of these. "<n>/week" is exactly n. */
export const TEMPLATE_DAYS: Record<"usually" | "sometimes" | "rarely" | "daily", number> = { usually: 5, sometimes: 2, rarely: 1, daily: 7 };
/** At most this many dishes a contains read asks about in one call. */
export const CONTAINS_BATCH = 40;
/** A tag that is a kind of another: a chicken dish has meat, a peanut dish has nuts. */
export const TAG_PARENT: Record<string, string> = { chicken: "meat", red_meat: "meat", mutton: "red_meat", beef: "red_meat", pork: "red_meat", prawn: "fish", peanut: "nuts" };
/** The main slots' span of the day, by their planning order: a weekly pattern with times (at the office 9 to 6) is away for a
 *  main slot only when it covers the whole span. A family eats breakfast before leaving (school at 7:30 still eats it) and
 *  dinner after coming home (back at 9 still eats it); weekday lunch goes by the family's word for it first. */
export const MAIN_SLOT_HOURS: Record<number, [string, string]> = { 10: ["06:00", "10:00"], 30: ["12:00", "14:30"], 50: ["19:00", "22:30"] };
/** The Family Calendar's app id, read for the week's stays and trips (get_events). */
export const CALENDAR_APP = "family-calendar";

/** The new-dishes-a-week choices: none, 1–2, 3–4, surprise me. */
export const NEW_DISHES_CHOICES = [0, 2, 4, 7] as const;

/** A person's age group: portions and the planning rules follow it. */
export const GROUPS = ["child", "adult", "elder"] as const;
/** A house rule: vegetarian (no meat, no eggs), eggs but no meat, no eggs, no meat, fasting, no onion and garlic, or the family's
 *  own (its note says it). A rule with no days holds every day ("mostly vegetarian"). The kinds the app checks a plan against
 *  (server/rules.ts): avoid (no dish with its items), only (who eats only its items), swap (who has `to` in place of its
 *  items), require (who eats one of its items at each of its slots) and cap (its items in at most per_week meals, or at most per_meal dishes a meal). */
export const RULE_KINDS = ["veg", "egg", "no_eggs", "no_meat", "fasting", "no_onion_garlic", "other", "avoid", "only", "swap", "require", "cap"] as const;
/** How each rule reads on the Family page: what the rule allows or forbids, never the opposite. */
export const RULE_LABELS: Record<(typeof RULE_KINDS)[number], string> = { veg: "Vegetarian", egg: "Eggs but no meat", no_eggs: "No eggs", no_meat: "No meat",
  fasting: "Fasting", no_onion_garlic: "No onion or garlic", other: "Other",
  avoid: "Never these", only: "Only these", swap: "Swap for", require: "Always one of these", cap: "At most a few times a week" };
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


/** How often the family has a dish, or keeps a soft rule, in their words (owner, 23 Nov): usually (most days, most nights,
 *  daily), sometimes (sometimes, "when he's tired", now and then), rarely (once in a while, occasionally). */
export const OFTEN = ["usually", "sometimes", "rarely"] as const;
export type Often = (typeof OFTEN)[number];
/** The days a week a dish of the family's comes back at most, by how often they have it (owner, 23 Nov); a dish with nothing
 *  said comes back on MAIN_DAYS_MAX days (meals.ts). */
export const DISH_DAYS_MAX: Record<Often, number> = { usually: 5, sometimes: 2, rarely: 1 };
/** The meals a week a soft rule is kept at, by how often ("millets are good for him": 2 to 3 meals, not every meal). */
export const RULE_TIMES: Record<Often, [number, number]> = { usually: [4, 5], sometimes: [2, 3], rarely: [0, 1] };

/** How a dish went, as the family says it: good, okay, or didn't work. */
export const DISH_RATINGS = ["good", "okay", "didnt_work"] as const;
export type DishRating = (typeof DISH_RATINGS)[number];
/** How many of a dish's ratings are kept, newest first. */
export const RATINGS_KEPT = 5;

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
  { key: "new_dishes_per_week", type: "integer" as const, default: 2, scope: "owner" as const, label: "New dishes a week",
    check: (v: unknown) => (NEW_DISHES_CHOICES as readonly unknown[]).includes(v) ? null : `new_dishes_per_week must be one of: ${NEW_DISHES_CHOICES.join(", ")}` },
];

/** Meal Planner 2.0's tables. The upgrade keeps them as they are (mountKit keepTables): never changed, dropped or shown. So no
 *  table of the app's may take one of these names (the slot model's ingredients table is `dish_ingredients`). */
export const OLD_TABLES = ["ingredients", "recipes", "recipe_ingredients", "meals", "meal_recipes", "diners", "diner_portions", "standing_consumption", "staples", "carts", "groceries", "prep_reminders", "shopping_prefs", "stock", "agent_jobs", "choice_log", "learned_prefs", "message_log"];
/** Who delivers a subscribed item when the family named nobody (the Pantry item's "Comes on subscription" with "from" left
 *  empty): set_subscription needs a source, and the pill then says just "Subscription". */
export const SUBSCRIPTION_UNNAMED = "outside the apps";
