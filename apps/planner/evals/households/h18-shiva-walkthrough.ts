// 18. The owner's own walk-through (26 Nov), run as Flock sends it (spec §7): the household facts in the contract's shape
// only (the speaker a person with relation "self", no cook's name, her times free text, no weekly entry for the speaker), and
// the walk-through's answers word for word as a fixed transcript, the questions the manifest's asks as Flock fills them. No
// persona: the lines are the chat. Covers a rule naming a kind (salad, upma), a swap on a kind (Roti → Plain paratha), a
// category word not in the catalog's aliases ("dry sabji"), a box linked to the home meal, a carried home lunch, a person's
// extras, and a breakfast box beside a home lunch.
import { avoid, dish, items, kindPart, linked, mains, MON_SAT, note, part, SCHOOL, tpl, type Household } from "../lib/truth";

const GS = "Gowri Shankar";
// Their bare words that name one dish (scripts/kinds/bare-decided.md).
const DOSA = kindPart("Dosa", { dish: "Plain dosa", words: "dosa" });
const RASAM = kindPart("Rice curry", { sub: "Rasam", dish: "Tomato rasam", words: "rasam" });
const KOOTU = kindPart("Rice curry", { sub: "Kootu", dish: "Mixed vegetable kootu", words: "kootu" });
const DRY_SABJI = kindPart("Sabzi", { words: "dry sabji" });

/** The walk-through's answers, word for word, by the question they answer. */
const A = {
  pain: "1 and 2",
  apps: "Zepto main, Instamart next",
  mainApp: "Zepto main, Instamart next",
  lunchWhere: "Ankita eats lunch at office. Agastya and I carry lunch from home. Dad eats at home.",
  cook: "she comes in the morning for breakfast & lunch. comes in the afternoon for dinner",
  cookTime: "yes she can do only 3-4 dishes in the morning",
  otherDays: "Ankita cooks sometimes for sunday breakfast and lunch. Otherwise we order. Sunday dinner is typically always ordered",
  childSame: "Agastya carries Breakfast box for school. Typically, he has what we make for the whole family. South indian typically - idli, dosa, poha, upma, etc. Sometimes we pack him Pancakes for his breakfast in case we make upma since he doesnt like it.",
  familyBreakfast: "South indian typically - idli, dosa, poha, upma, etc. On sundays we have bread omlette.",
  familyLunch: "lunch is mostly south indian - rice, dry sabji, and something like sambar/rasam/kootu/kadhi/dal/etc. I take 4 eggs for my lunch and some salad. Dad doesnt eat egg or salad. Ankita doesnt carry lunch.",
  familyDinner: "north indian - dad has 2 parathas, Ankita 2 rotis, Agastya 2 rotis, myself 3 rotis. With some north indian gravy or dry sabji. Like paneer butter masala, matar paneer, aloo gobi. Or sometimes gobi paratha, aloo paratha, etc.",
  childMeals: "He carries a lunch box which is usually paratha rolled with the sabji that we make for lunch. Or sometimes with egg or cheese inside it to make it interesting depending on the sabji. Dinner is what we make for ourselves",
  differently: "he doesnt eat eggs. nothing too spicy, but nothing else. on saturdays we make egg curry sometimes. And have bread omlette for sunday breakfast. Dad doesnt eat egg. Others are okay with it. So we have to make something else for him if we make egg curry or if mains contains eggs",
  subscriptions: "no we order milk on zepto",
};

/** The manifest's asks as Flock fills them here: no cook's name ("your cook"), one child ("Agastya"), the lunch line from the
 *  weekly facts (the controller's ruling R8 keeps the walk-through's own wording of it), `differently` in its recall form. */
const Q: Record<keyof typeof A, string> = {
  pain: "What's the hardest part of meals for you? Or something else.",
  apps: "Which apps do you order groceries on: Zepto, Blinkit, Instamart, BigBasket or Amazon? If you sign me in, I'll read your past orders to learn what your home buys and how often, so the plan and the shopping list fit you from the first week, and I can fill the cart for you. Nothing is ordered without your yes.",
  mainApp: "Which is your main app, and which do you use when something isn't there?",
  lunchWhere: "On weekdays Ankita is at the office till 4 and Agastya is at school till 3; Gowri Shankar is at home. Who carries lunch from home, and who eats out?",
  cook: "Which meals does your cook make, and when does she come?",
  cookTime: "Is your cook short of time, so only a few dishes?",
  otherDays: "On her days off, who cooks, and is any meal eaten out or ordered in?",
  childSame: "Does Agastya eat what the family eats, or something else at some meals? Does Agastya carry a box to school?",
  familyBreakfast: "What did the family have for breakfast over the past week? Tell me the dishes.",
  familyLunch: "What did the family have for lunch over the past week? Tell me the dishes.",
  familyDinner: "What did the family have for dinner over the past week? Tell me the dishes.",
  childMeals: "What does Agastya have at those meals, and what goes in the box?",
  // Dad's egg and salad were heard in the lunch answer: Flock asks the recall form, {{heard}} filled (spec §6.2; lead's ruling F8).
  differently: "You mentioned Dad doesn't eat egg or salad. Anything else, for anyone, like an allergy or a fasting day?",
  subscriptions: "Does anything come on a subscription, like Country Delight or a milkman?",
};
const IDS = Object.keys(A) as (keyof typeof A)[];

export const h18: Household = {
  id: "h18-shiva-walkthrough", title: "The owner's walk-through: boxes linked to the home meal, extras, swaps on kinds, cook short of time",
  owner: "Shiva", intro: "You are Shiva, answering the meal planner's questions on WhatsApp",
  transcript: IDS.flatMap((id) => [`Q: ${Q[id]}`, `A: ${A[id]}`]),
  household: {
    "household.speaker": "Shiva",
    "household.people": [{ name: "Shiva", relation: "self", group: "adult" }, { name: "Ankita", relation: "wife", group: "adult" },
      { name: "Agastya", relation: "son", age: 6, group: "child" }, { name: GS, relation: "father", group: "elder" }],
    "household.children": ["Agastya"], "household.elders": [GS],
    "household.help": [{ role: "cook", days: "Mon-Sat", times: "morning", meals: ["Breakfast", "Lunch"] },
      { role: "cook", days: "Mon-Sat", times: "afternoon", meals: ["Dinner"] }],
    "household.school": "TCIS",
    "household.weekly": [{ person: "Ankita", where: "office", weekdays: SCHOOL, from: "09:00", to: "16:00", lunch: null },
      { person: "Agastya", where: "school", weekdays: SCHOOL, from: "07:20", to: "15:00", lunch: null },
      { person: GS, where: "home", weekdays: SCHOOL, lunch: "home" }],
  },
  groceryApps: ["Zepto", "Instamart"],
  facts: IDS.map((id) => ({ id, text: A[id], ...(id === "childSame" ? { differs: true } : {}) })),
  truth: {
    people: [{ name: "Shiva", group: "adult" }, { name: "Ankita", group: "adult" }, { name: "Agastya", group: "child", age: 6 }, { name: GS, group: "elder" }],
    // No name, no clock time: the visits by their meals only.
    cook: { name: "Cook", days: MON_SAT, visits: [{ meals: ["Breakfast", "Lunch"] }, { meals: ["Dinner"] }] },
    familyCooks: [{ person: "Ankita", days: ["Sun"] }],
    slots: [
      ...mains({ Dinner: [{ day: "Sun", skip: "ordered_in" }] }),
      // His breakfast box is the family's breakfast (linked), in place of breakfast at home on school days.
      { name: "Agastya's breakfast box", kind: "custom", usual_people: ["Agastya"], days: SCHOOL, replaces: "Breakfast", match: /breakfast/i },
      { name: "Agastya's lunch box", kind: "custom", usual_people: ["Agastya"], days: SCHOOL, replaces: "Lunch", match: /lunch ?box|tiffin/i },
      // Shiva carries the home lunch and his 4 eggs and salad beside it: counted at Lunch.
      { name: "Shiva's lunch box", kind: "addon", addon_of: "Lunch", usual_people: ["Shiva"], days: SCHOOL, extras: true, match: /shiva/i },
    ],
    away: [{ person: "Ankita", slots: ["Lunch"], days: SCHOOL }, { person: "Agastya", slots: ["Breakfast", "Lunch"], days: SCHOOL }],
    // Named dishes only: upma, poha, dry sabji, sambar, kadhi, dal, gravy, roti, rice and salad are their words for parts.
    library: [
      ...dish("Idli", ["Breakfast"]), ...dish("Plain dosa", ["Breakfast"]), ...dish("Pancakes", ["Breakfast"], { alsoSlots: ["Agastya's breakfast box"], contains: ["egg"] }),
      ...dish("Bread omelette", ["Breakfast"], { days: ["Sun"] }),
      ...dish("Tomato rasam", ["Lunch"]), ...dish("Mixed vegetable kootu", ["Lunch"]),
      // The family's words: "4 eggs" (spec §5.1, lead's ruling F8).
      ...dish("4 eggs", ["Shiva's lunch box"]),
      ...dish("Plain paratha", ["Agastya's lunch box"]),
      ...dish("Egg paratha roll", ["Agastya's lunch box"], { frequency: "sometimes" }), ...dish("Cheese paratha roll", ["Agastya's lunch box"], { frequency: "sometimes" }),
      ...dish("Paneer butter masala", ["Dinner"]), ...dish("Matar paneer", ["Dinner"]), ...dish("Aloo gobi", ["Dinner"]),
      ...dish("Gobi paratha", ["Dinner"]), ...dish("Aloo paratha", ["Dinner"]),
      ...dish("Egg curry", ["Dinner"], { days: ["Sat"], frequency: "sometimes" }),
    ],
    rules: [
      avoid("gs_no_egg", "Gowri Shankar: no egg", ["egg"], /egg/i, { who: GS }),
      avoid("gs_no_salad", "Gowri Shankar: no salad", ["salad"], /salad/i, { who: GS, targets: [{ kind: "Salad" }] }),
      note("gs_not_spicy", "nothing too spicy for Gowri Shankar", GS, /spicy/i),
      { id: "agastya_upma", title: "Agastya: pancakes when it's upma", hard: true, what: "swap", who: "Agastya", items: ["upma"], to: "Pancakes",
        slots: ["Breakfast", "Agastya's breakfast box"], quote: /upma/i, targets: [{ kind: "Upma" }], gives: { item: "Pancakes" } },
      { id: "gs_paratha", title: "Gowri Shankar: parathas, not rotis", hard: true, what: "swap", who: GS, items: ["roti"], to: "paratha",
        slots: ["Dinner"], quote: /paratha/i, targets: [{ kind: "Roti" }], gives: { item: "Plain paratha", kind: "Paratha" } },
      { id: "cook_limit", title: "the cook: 3-4 dishes in the morning", hard: false, hardAny: true, what: "cap", per_meal: 4, slots: ["Breakfast", "Lunch"], days: MON_SAT, quote: /3-4 dishes/i },
    ],
    seed: [],
    cuisines: ["south", "north"], cuisinesAlso: ["tamil", "karnataka", "punjab", "west", "central", "continental"],
    meals: [
      { slot: "Breakfast", templates: [tpl([kindPart("Idli")]), tpl([DOSA]), tpl([kindPart("Poha")]), tpl([kindPart("Upma", { words: "upma" })]),
        { parts: [items("Bread omelette")], days: ["Sun"] }] },
      { slot: "Agastya's breakfast box", templates: [tpl([linked("Breakfast")])] },
      { slot: "Lunch", staples: ["Rice"], templates: [tpl(["Rice", DRY_SABJI, "Rice curry/Sambar"]), tpl(["Rice", DRY_SABJI, RASAM]), tpl(["Rice", DRY_SABJI, KOOTU]),
        tpl(["Rice", DRY_SABJI, "Rice curry/Kadhi"]), tpl(["Rice", DRY_SABJI, "Dal"])] },
      { slot: "Shiva's lunch box", templates: [tpl([items("4 eggs"), kindPart("Salad", { words: "salad" })])] },
      { slot: "Agastya's lunch box", templates: [tpl([kindPart("Paratha", { dish: "Plain paratha", words: "paratha" }), linked("Lunch", "Sabzi")]),
        tpl([items("Egg paratha roll")], "sometimes"), tpl([items("Cheese paratha roll")], "sometimes")] },
      { slot: "Dinner", staples: ["Roti"], templates: [tpl(["Roti", kindPart("Gravy", { words: "north indian gravy" })]), tpl(["Roti", DRY_SABJI]),
        tpl([kindPart("Paratha", { words: "gobi paratha, aloo paratha" })], "sometimes"), { parts: [part("Roti"), items("Egg curry")], share: "sometimes", days: ["Sat"] }] },
    ],
    judgeNotes: ["Gowri Shankar gets a non-egg dish when the plate has egg curry or bread omelette.", "Agastya's boxes follow the home meal; pancakes on upma days.", "Sunday dinner ordered in."],
  },
};
