/**
 * What the grocery website skills (BigBasket, Blinkit) share: the saved-address picker, the
 * cart page check, emptying the cart, and the bill with every fee. Each skill ships an identical
 * copy (tests/grocery checks they match); the site's own selectors come from its `_<site>.ts`.
 * The in-page scripts are strings Flock's browser runs on the page; the rest is plain logic. A page
 * script never presses anything itself: it marks the element (flockMark) and Flock clicks the mark
 * with real input, since sites tell a script's click from a person's.
 * Not a callable function: the manifest's allowedFunctions does not name it.
 */
import { PRESS_KIT_JS, type GroceryServiceConfig, type PageAction, type PressLoop } from "../../_shared/_grocery_helpers";
import { clickTarget } from "../../_shared/_realInput";

/**
 * The shop's base URL: `override` (FLOCK_CONNECTOR_BASE_URL, which Flock sets only in an isolated e2e
 * Flock, pointing at a stand-in shop) when it is a bare http(s) origin, else `fallback` (the real
 * site). A trailing slash is dropped; a path, query, fragment or user part makes it fall back.
 */
export function baseUrlFrom(override: string | undefined, fallback: string): string {
  if (!override) return fallback;
  try {
    const url = new URL(override.trim());
    const bare = url.pathname === "/" && !url.search && !url.hash && !url.username && !url.password;
    return /^https?:$/.test(url.protocol) && bare ? url.origin : fallback;
  } catch {
    return fallback;
  }
}

/**
 * A pattern for pages of the shop at `baseUrl`: its host (port kept, a leading "www." dropped so
 * any subdomain matches, as the hand-written patterns did), "/", then one of `paths` (a regex
 * source, e.g. "signin|login"). Case-insensitive.
 */
export function sitePattern(baseUrl: string, paths: string): RegExp {
  const host = new URL(baseUrl).host.replace(/^www\./i, "");
  return new RegExp(`${host.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\/(?:${paths})`, "i");
}

/** One shop's pages, as these scripts read them. */
export interface ShopSite {
  config: GroceryServiceConfig;
  homeUrl: string;
  /** Where the cart is read: the cart page, or (Blinkit) any page whose header opens the cart drawer. */
  cartUrl: string;
  /** The cart page's path, when the shop has one. A read that ends elsewhere is not the cart. */
  cartPath?: RegExp;
  /** Shown only while the cart is on screen (Blinkit's drawer), when the shop has no cart page. */
  cartShown?: string;
  /** The header's cart button ("3 items ₹120"), when the shop has one. */
  cartHeader?: string;
  /** Page actions that bring the cart up after loading cartUrl (Blinkit opens its drawer). */
  openCart: PageAction[];
  /** One line of the cart. */
  cartLines: string;
  /** Inside a line: its remove or minus control, tried before the generic ones. */
  removeControls?: string;
  /** The saved-address picker, where its markup is known. Without it the generic reader finds it. */
  addressPicker?: AddressPicker;
  /** Generic reader only: the header control that opens the picker, tried before a text match. */
  addressOpeners?: string[];
  /** The product id in a cart line's link, or "". */
  productId(href: string): string;
}

/** A saved-address picker as the site draws it. Selectors match the class-name part, never a styled-components hash. */
export interface AddressPicker {
  /** The header control that opens the picker; its text is the location the site delivers to now. */
  opener: string;
  /** A regex source the opener's text must match, when the selector alone is not enough. */
  openerText?: string;
  /** One saved address in the open picker; the outermost match is the entry. */
  entry: string;
  /** Inside an entry: its label ("Home"). An element matching `entry` without one is not a saved address. */
  label: string;
  /** Inside an entry: the address itself. The press is aimed at it (never at an edit icon). */
  address: string;
  /** The entry's outer container (its outermost match around the address), one of the elements pressed to pick it. */
  item?: string;
}

export interface SavedAddress { index: number; label: string; text: string; selected: boolean }
export type AddressMatch =
  | { ok: true; address: SavedAddress }
  | { ok: false; code: "ADDRESS_NOT_SAVED" | "AMBIGUOUS_ADDRESS"; candidates: SavedAddress[] };

export interface BillRow { label: string; amount: number | null }
export interface CartTotals {
  subtotal: number;
  fees: BillRow[];
  feeTotal: number;
  discount: number;
  /** What the person pays, every fee included. */
  total: number;
  /** "page": the page's own grand total / to-pay line; "computed": subtotal + fees − discount. */
  totalSource: "page" | "computed";
}

/** A read of a cart page (cartReadScript). */
export interface CartPageRead {
  pageUrl: string;
  cartShown: boolean;
  emptyShown: boolean;
  headerText: string;
  items: Array<{ name: string; quantity: number; price: number | null; href: string }>;
  bill: BillRow[];
  deliveryAddress: string | null;
}

/** Words that say what kind of place a part is, not which place ("Road", "Block", "Floor"). */
const KIND_WORDS = new Set([
  "road", "street", "main", "cross", "lane", "block", "floor", "flat", "apartment", "apartments", "apt", "apts",
  "tower", "towers", "wing", "layout", "stage", "phase", "sector", "near", "opp", "opposite", "behind", "house",
  "plot", "door", "level", "the", "and",
]);
/** "Delivery in 17 minutes": the header's delivery time, not part of the location. Its unit may run into the next word ("6 minsHome:"). */
const DELIVERY_TIME = /deliver(y|ing)?\s+in\s+\d+\s*(minutes?|mins?|hours?|hrs?|days?)?/gi;

/** A flat or house number: has a digit; not a pincode or phone number (six digits or more), not "3rd". */
const isUnit = (t: string): boolean => /\d/.test(t) && t.replace(/\D/g, "").length < 6 && !/^\d+(st|nd|rd|th)$/.test(t);
const isName = (t: string): boolean => /^[a-z]{3,}$/.test(t) && !KIND_WORDS.has(t);
/** The same word, or one cut short ("Srinivas" for "Srinivasa"). */
const sameWord = (a: string, b: string): boolean => a === b || (Math.min(a.length, b.length) >= 5 && (a.startsWith(b) || b.startsWith(a)));
/** The same flat: equal, or the same number where one side leaves out the block letter ("307", "A307"). */
const sameUnit = (a: string, b: string): boolean => a === b || (/^\d+$/.test(a) !== /^\d+$/.test(b) && a.replace(/\D/g, "") === b.replace(/\D/g, ""));
const hasWord = (words: string[], w: string): boolean => words.some((x) => sameWord(x, w));
const unitsShared = (a: AddressParts, b: AddressParts): boolean => a.units.some((u) => b.units.some((v) => sameUnit(u, v)));
const unitsConflict = (a: AddressParts, b: AddressParts): boolean => a.units.length > 0 && b.units.length > 0 && !unitsShared(a, b);
/** Every word of the building's name is among `words`. */
const names = (building: string[], words: string[]): boolean => building.length > 0 && building.every((w) => hasWord(words, w));

interface AddressParts {
  /** Flat or house numbers ("a307", "12"). */
  units: string[];
  /** The building, complex or street name: the first named part from the flat number on ("srinivasa classic"). */
  building: string[];
  /** Every name word in the address. */
  words: string[];
}

/** An address's own distinctive parts. A pincode and the label are not among them. */
export function addressParts(address: string): AddressParts {
  const segments = String(address || "").toLowerCase().split(/[,\n]/).map((segment) => {
    const words = segment.replace(/[^a-z0-9]+/g, " ").replace(/\b([a-z]) (\d+)\b/g, "$1$2").trim().split(" ").filter(Boolean);
    return { units: words.filter(isUnit), names: words.filter(isName) };
  });
  const firstUnit = segments.findIndex((s) => s.units.length > 0);
  const fromUnit = firstUnit < 0 ? segments : segments.slice(firstUnit);
  return {
    units: segments.flatMap((s) => s.units),
    building: fromUnit.find((s) => s.names.length > 0)?.names ?? [],
    words: segments.flatMap((s) => s.names),
  };
}

/** The saved address's text without its label, when the picker's text starts with it. */
function addressText(saved: SavedAddress): string {
  const label = saved.label.trim();
  return label && saved.text.toLowerCase().startsWith(label.toLowerCase()) ? saved.text.slice(label.length) : saved.text;
}

/**
 * How surely a saved address is the wanted one: 2 when the flat number and the building name both
 * agree, 1 when one side has no flat number and the wanted address names the saved one's building,
 * 0 otherwise. Two different flat numbers never match. The pincode and the label do not count.
 */
function addressScore(saved: SavedAddress, wanted: string): 0 | 1 | 2 {
  const have = addressParts(addressText(saved));
  const want = addressParts(wanted);
  if (unitsConflict(have, want)) return 0;
  if (unitsShared(have, want)) return names(have.building, want.words) || names(want.building, have.words) ? 2 : 0;
  return names(have.building, want.words) ? 1 : 0;
}

/**
 * The saved address that is the wanted one, by its flat or house number and its building name.
 * A different or missing pincode does not reject it; a label alone never matches ("Home" is reused).
 * Two equally good candidates are ambiguous, never a guess.
 */
export function matchAddress(saved: SavedAddress[], wanted: string): AddressMatch {
  const scored = saved.map((address) => ({ address, score: addressScore(address, wanted) }));
  const best = Math.max(0, ...scored.map((s) => s.score));
  if (best === 0) return { ok: false, code: "ADDRESS_NOT_SAVED", candidates: saved };
  const top = scored.filter((s) => s.score === best).map((s) => s.address);
  if (top.length > 1) return { ok: false, code: "AMBIGUOUS_ADDRESS", candidates: top };
  return { ok: true, address: top[0] };
}

/**
 * The header names this address: its flat number or building, or its label followed by its area
 * (BigBasket's "Home: Bellandur, Bangalore"). A header showing another flat number does not.
 */
export function headerShows(location: string, address: SavedAddress): boolean {
  const header = location.replace(DELIVERY_TIME, " ").trim();
  const shown = addressParts(header);
  const it = addressParts(addressText(address));
  if (unitsConflict(shown, it)) return false;
  if (unitsShared(shown, it) || names(it.building, shown.words)) return true;
  const label = address.label.trim().toLowerCase();
  if (!label || !header.toLowerCase().startsWith(label)) return false;
  return names(addressParts(header.slice(label.length)).building, it.words);
}

/**
 * Does the header now show the chosen address? `headerShows`, else a name word of it the header did
 * not show `before` (a city both share proves nothing).
 */
export function locationShows(location: string, address: SavedAddress, before = ""): boolean {
  if (headerShows(location, address)) return true;
  const shown = addressParts(location.replace(DELIVERY_TIME, " "));
  const it = addressParts(addressText(address));
  if (unitsConflict(shown, it)) return false;
  const was = addressParts(before.replace(DELIVERY_TIME, " "));
  return it.words.some((w) => w.length >= 4 && hasWord(shown.words, w) && !hasWord(was.words, w));
}

const PAYABLE = /grand total|to pay|payable|order total|bill total|net (amount|total)/i;
const SUBTOTAL = /items? total|sub ?total|basket (value|total)|cart (value|total)/i;
const DISCOUNT = /discount|coupon/i;
const FEE = /deliver|handling|platform|small cart|packag|surge|convenience|fee|charge/i;

/** The bill, every fee counted: the page's own total to pay when it shows one. */
export function summarizeBill(rows: BillRow[], itemsSubtotal: number): CartTotals {
  const valued = rows.filter((r) => r.amount != null) as Array<{ label: string; amount: number }>;
  const payable = [...valued].reverse().find((r) => PAYABLE.test(r.label));
  const subtotalRow = valued.find((r) => SUBTOTAL.test(r.label) && !PAYABLE.test(r.label));
  const fees = valued.filter((r) => FEE.test(r.label) && !PAYABLE.test(r.label) && !SUBTOTAL.test(r.label) && !DISCOUNT.test(r.label));
  const discount = valued.filter((r) => DISCOUNT.test(r.label)).reduce((sum, r) => sum + Math.abs(r.amount), 0);
  const feeTotal = fees.reduce((sum, r) => sum + r.amount, 0);
  const subtotal = subtotalRow?.amount ?? itemsSubtotal;
  if (payable) return { subtotal, fees, feeTotal, discount, total: payable.amount, totalSource: "page" };
  return { subtotal, fees, feeTotal, discount, total: Math.max(0, subtotal + feeTotal - discount), totalSource: "computed" };
}

/** The header's cart button says the cart has items ("3 items ₹120"). */
export function headerShowsItems(headerText: unknown): boolean {
  return /\d+\s*items?/i.test(String(headerText || ""));
}

/** Why this read is not the cart, or null when it is. Never read a home page or suggestions as the cart. */
export function notTheCart(site: ShopSite, read: Pick<CartPageRead, "pageUrl" | "cartShown" | "emptyShown" | "headerText" | "items" | "bill">): string | null {
  let path = "";
  try { path = new URL(read.pageUrl).pathname; } catch { /* no URL: judged by what is on screen */ }
  if (site.cartPath && !site.cartPath.test(path)) return `The browser ended on ${read.pageUrl || "an unknown page"}, not ${site.config.name}'s cart page.`;
  if (site.cartShown && !read.cartShown) {
    const emptyByHeader = !!site.cartHeader && !!read.headerText && !headerShowsItems(read.headerText) && read.items.length === 0;
    if (!emptyByHeader) return `${site.config.name}'s cart did not open on the page, so what is there is not the cart.`;
  }
  if (!site.cartShown && !read.items.length && !read.emptyShown && !read.bill.length) {
    return `The page shows no cart lines, no bill and no empty-cart message: it is not a readable ${site.config.name} cart.`;
  }
  return null;
}

/** Parse a page script's JSON answer, or null. */
export function parseJson(content: unknown): any {
  try { return JSON.parse(String(content ?? "")); } catch { return null; }
}

// ---------------------------------------------------------------------------------------------
// In-page scripts. String.raw keeps every backslash as written: these run in the page as is.

const PAGE_KIT = String.raw`
  ${PRESS_KIT_JS}
  const visible = (el) => !!el && el.getClientRects().length > 0;
  const text = (el) => ((el && (el.innerText || el.textContent)) || "").replace(/\s+/g, " ").trim();
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (test, ms) => { const end = Date.now() + ms; while (Date.now() < end) { const v = test(); if (v) return v; await sleep(250); } return test(); };
  const rupees = (s) => { const all = String(s || "").match(/₹\s*-?[\d,]+(?:\.\d+)?/g) || []; const last = all[all.length - 1]; return last ? Math.abs(parseFloat(last.replace(/[₹\s,]/g, ""))) : null; };
  const EMPTY = /(basket|cart) is empty|no items in (your )?(basket|cart)|nothing in (your )?(basket|cart)|don.t have any items in your (basket|cart)/i;
`;

/** readBill(): the bill's rows (label, amount), the innermost element holding both; "FREE" is 0. */
const READ_BILL = String.raw`
  const BILL_LABEL = /items? total|sub ?total|basket (value|total)|cart (value|total)|deliver|handling|platform|small cart|packag|surge|convenience|fee|charge|discount|coupon|grand total|to pay|payable|order total|bill total|net (amount|total)/i;
  const readBill = () => {
    const isRow = (el) => { const t = text(el); return t.length > 0 && t.length <= 90 && BILL_LABEL.test(t) && (/₹\s*-?[\d,]/.test(t) || /\bfree\b/i.test(t)); };
    const rows = Array.from(document.querySelectorAll("div, li, tr, p, span, section")).filter((el) => visible(el) && isRow(el));
    const innermost = rows.filter((el) => !rows.some((o) => o !== el && el.contains(o)));
    const seen = new Set();
    return innermost.map((el) => {
      const t = text(el);
      const label = t.split("₹")[0].replace(/[-–:\s]+$/, "").trim().substring(0, 60);
      const free = /\bfree\b/i.test(t.replace(label, ""));
      return { label, amount: free ? 0 : rupees(t) };
    }).filter((r) => { const key = r.label + "|" + r.amount; if (!r.label || seen.has(key)) return false; seen.add(key); return true; }).slice(0, 20);
  };
`;

const lineReader = (site: ShopSite) => String.raw`
  const LINES = ${JSON.stringify(site.cartLines)};
  const lines = () => Array.from(document.querySelectorAll(LINES)).filter((el) => visible(el) && text(el));
  const nameOf = (el) => text(el && el.querySelector('[class*="name" i], [class*="title" i], h3, h4')) || text(el).substring(0, 80);
`;

/**
 * Reads the cart on the page it is run on: { pageUrl, cartShown, emptyShown, headerText, items,
 * bill, deliveryAddress }. Waits up to 10s for cart lines or the empty-cart message.
 */
export function cartReadScript(site: ShopSite): string {
  return String.raw`(async () => {
  ${PAGE_KIT}
  ${READ_BILL}
  ${lineReader(site)}
  const SHOWN = ${JSON.stringify(site.cartShown || "")};
  const HEADER = ${JSON.stringify(site.cartHeader || "")};
  await until(() => lines().length || EMPTY.test(document.body.innerText), 10000);
  const items = lines().slice(0, 60).map((el) => {
    const qtyEl = el.querySelector('input[type="number"], [class*="quantity" i], [class*="qty" i], [class*="count" i]');
    const qty = parseInt(String((qtyEl && (qtyEl.value || qtyEl.textContent)) || "1").replace(/[^\d]/g, ""), 10) || 1;
    const priceEl = el.querySelector('[class*="price" i], [class*="amount" i]');
    return { name: nameOf(el).substring(0, 200), quantity: qty, price: rupees(text(priceEl) || text(el)), href: (el.querySelector("a") || {}).href || "" };
  });
  const addressEl = document.querySelector('[class*="DeliveryAddress" i], [class*="delivery-address" i], [class*="address" i]');
  return JSON.stringify({
    pageUrl: location.href,
    cartShown: !!SHOWN && visible(document.querySelector(SHOWN)),
    emptyShown: EMPTY.test(document.body.innerText),
    headerText: HEADER ? text(document.querySelector(HEADER)).substring(0, 60) : "",
    items,
    bill: readBill(),
    deliveryAddress: text(addressEl).substring(0, 200) || null,
  });
})()`;
}

const GENERIC_REMOVE = '[class*="remove" i], [class*="delete" i], [aria-label*="remove" i], [aria-label*="delete" i], [class*="minus" i], [class*="decrement" i], [class*="decrease" i], [aria-label*="decrease" i]';

/** The mark Flock's real clicks while emptying the cart go to, and its page state. */
const EMPTY_MARK = "cart-empty";
/** At most this many presses while emptying (each line takes one, two with a "Remove?" prompt); the 70s deadline ends it sooner. */
const MAX_EMPTY_PRESSES = 200;

/**
 * Empties the cart on the page it is run on: the page's own "Empty basket" / "Clear cart" when it
 * has one, else each line's remove (or minus, until the line goes). Confirms a "Remove?" prompt.
 * Each press is Flock's real click on the control a step marked (runPressLoop).
 * `finish` → { pageUrl, cartShown, headerText, removed: [names], remaining } or { error, code, message }.
 */
export function emptyCartLoop(site: ShopSite): PressLoop {
  const start = String.raw`(async () => {
  ${PAGE_KIT}
  ${lineReader(site)}
  const MARK = ${JSON.stringify(EMPTY_MARK)};
  const CONTROLS = [${JSON.stringify(site.removeControls || "")}, ${JSON.stringify(GENERIC_REMOVE)}].filter(Boolean);
  const buttons = () => Array.from(document.querySelectorAll('button, a, [role="button"]')).filter(visible);
  const s = flockState(MARK, true);
  flockClear(MARK);
  /** Marks el for Flock's click; after it, a "Remove?" prompt's yes is pressed when one shows, then then() runs. */
  const press = (el, then) => { flockMark(MARK, el); s.next = confirmPrompt(then); return true; };
  const confirmPrompt = (then) => async () => {
    await sleep(600);
    const yes = buttons().find((b) => /^(yes|remove|delete|empty|clear|confirm|ok|okay)( (it|all|items?|basket|cart))?$/i.test(text(b)));
    if (!yes) { s.next = then; return false; }
    s.next = async () => { await sleep(800); s.next = then; return false; };
    return flockMark(MARK, yes);
  };
  const eachLine = () => { s.deadline = Date.now() + 70000; s.stuck = 0; s.next = nextLine; return false; };
  const nextLine = () => {
    if (!(lines().length && Date.now() < s.deadline && s.stuck < 3)) { s.done = true; return false; }
    const line = lines()[0];
    const before = text(line) + "|" + lines().length;
    let control = null;
    for (const sel of CONTROLS) { control = Array.from(line.querySelectorAll(sel)).find(visible); if (control) break; }
    if (!control) control = Array.from(line.querySelectorAll('button, [role="button"]')).find((b) => /^[-−–]$/.test(text(b)));
    if (!control) { s.done = true; s.answer = { error: true, code: "PAGE_CHANGED", message: "A cart line has no remove or minus control: the page may have changed.", removed: [] }; return false; }
    return press(control, async () => {
      const moved = await until(() => !lines().length || (text(lines()[0]) + "|" + lines().length) !== before, 4000);
      s.stuck = moved ? 0 : s.stuck + 1;
      s.next = nextLine;
      return false;
    });
  };
  s.step = async () => {
    flockMark(MARK, null);
    while (!s.done) if (await s.next()) return;
  };
  await until(() => lines().length || EMPTY.test(document.body.innerText), 10000);
  s.removed = lines().map(nameOf);
  const clearAll = buttons().find((b) => /^(empty|clear) (my |your )?(basket|cart)$|^remove all( items)?$/i.test(text(b)));
  s.next = clearAll && lines().length
    ? () => press(clearAll, async () => { await until(() => !lines().length, 6000); return eachLine(); })
    : eachLine;
  await s.step();
})()`;
  const finish = String.raw`(() => {
  ${PAGE_KIT}
  ${lineReader(site)}
  const SHOWN = ${JSON.stringify(site.cartShown || "")};
  const HEADER = ${JSON.stringify(site.cartHeader || "")};
  const s = flockState(${JSON.stringify(EMPTY_MARK)});
  flockClear(${JSON.stringify(EMPTY_MARK)});
  if (s.answer) return JSON.stringify(s.answer);
  return JSON.stringify({
    pageUrl: location.href,
    cartShown: !!SHOWN && visible(document.querySelector(SHOWN)),
    emptyShown: EMPTY.test(document.body.innerText),
    headerText: HEADER ? text(document.querySelector(HEADER)).substring(0, 60) : "",
    removed: s.removed || [],
    remaining: lines().length,
  });
})()`;
  return { key: EMPTY_MARK, mark: EMPTY_MARK, start, finish, presses: MAX_EMPTY_PRESSES };
}

/**
 * The saved-address picker's page kit: finds the header control, the saved entries and what to
 * press; Flock does the pressing (the scripts below mark it). With `site.addressPicker` it uses the
 * site's own markup. Without it (a site not yet checked live) a generic reader finds entries by
 * class ("address") or, inside an overlay, by their text (an address line: a pincode, or two commas).
 */
const addressKit = (site: ShopSite) => String.raw`
  const PICKER = ${JSON.stringify(site.addressPicker || null)};
  const OPENERS = ${JSON.stringify(site.addressOpeners || [])};
  const NOT_AN_ADDRESS = /^\+?\s*add\b|add (a )?new address|current location|detect|search|enter (your )?(area|location|address)/i;
  const LOCATION_TEXT = /deliver(y|ing)? (in|to)|select (your )?location|change location|set location|delivery location/i;
  const ADDRESS_LINE = (t) => /\b\d{6}\b/.test(t) || (t.match(/,/g) || []).length >= 2;
  const CONFIRM = /^(confirm|continue|proceed|yes|ok|okay|change address)$/i;
  const outermost = (found) => found.filter((el) => !found.some((o) => o !== el && o.contains(el)));
  const overlays = () => Array.from(document.querySelectorAll("body > div, body > div > div")).filter((el) => visible(el) && getComputedStyle(el).position === "fixed" && el.getBoundingClientRect().height > 150);
  const scopes = () => [...new Set([...document.querySelectorAll('[role="dialog"], [aria-modal="true"], [role="menu"], [class*="modal" i], [class*="drawer" i], [class*="popup" i], [class*="sheet" i]'), ...overlays()])].filter(visible);
  const genericOpener = () => {
    for (const sel of OPENERS) { const el = document.querySelector(sel); if (visible(el)) return el; }
    return Array.from(document.querySelectorAll('header button, header a, header [role="button"], header div')).filter(visible)
      .find((el) => text(el).length < 120 && LOCATION_TEXT.test(text(el))) || null;
  };
  const genericEntries = () => {
    const usable = (el) => { const t = text(el); return visible(el) && !el.matches("input, textarea") && !el.closest("header") && t.length >= 10 && t.length <= 300 && !t.includes("₹") && !NOT_AN_ADDRESS.test(t); };
    const innermostFew = (found) => outermost(found.filter((el) => found.filter((o) => o !== el && el.contains(o)).length < 2));
    const roots = scopes();
    const byClass = (roots.length ? roots : [document.body]).flatMap((root) => Array.from(root.querySelectorAll('[class*="address" i], [data-testid*="address" i]'))).filter(usable);
    if (byClass.length) return innermostFew([...new Set(byClass)]);
    if (!roots.length) return [];
    const byText = roots.flatMap((root) => Array.from(root.querySelectorAll("div, li, label, button, a, [role='button']"))).filter((el) => usable(el) && ADDRESS_LINE(text(el)));
    return innermostFew([...new Set(byText)]);
  };
  const opener = () => {
    if (!PICKER) return genericOpener();
    const wanted = PICKER.openerText ? new RegExp(PICKER.openerText, "i") : null;
    return Array.from(document.querySelectorAll(PICKER.opener)).find((el) => visible(el) && (!wanted || wanted.test(text(el)))) || null;
  };
  const entries = () => PICKER
    ? outermost(Array.from(document.querySelectorAll(PICKER.entry)).filter((el) => visible(el) && el.querySelector(PICKER.label)))
    : genericEntries();
  const labelOf = (el) => PICKER ? text(el.querySelector(PICKER.label)) : (String(el.innerText || "").split("\n").map((s) => s.trim()).find(Boolean) || "");
  const addressOf = (el) => {
    if (!PICKER) return text(el);
    const own = text(el.querySelector(PICKER.address));
    return own || text(el).replace(labelOf(el), "").trim();
  };
  const markedSelected = (el) => /selected|active|checked|current/i.test(String(el.className)) || el.getAttribute("aria-selected") === "true" || el.getAttribute("aria-checked") === "true" || !!el.querySelector('input:checked, [aria-checked="true"], [aria-selected="true"]');
  const readSaved = () => entries().map((el, index) => ({ index, label: labelOf(el).substring(0, 40), text: addressOf(el).substring(0, 300), selected: markedSelected(el) }));
  const locationText = () => text(opener()).substring(0, 160);
  const expanded = () => { const el = opener(); return !!el && el.getAttribute("aria-expanded") === "true"; };
  const isOpen = () => entries().length > 0 || expanded() || scopes().length > 0;
  const EDIT = '[class*="EditIcon" i], [class*="edit-icon" i], [aria-label^="edit" i]';
  const INTERACTIVE = 'button, a, label, [role="button"], [role="option"], [role="menuitem"], [role="radio"], [tabindex]';
  const reactHandler = (el) => {
    const key = Object.keys(el).find((k) => k.startsWith("__reactProps$"));
    const props = key ? el[key] : null;
    return !!props && !!(props.onClick || props.onMouseDown || props.onMouseUp || props.onPointerDown || props.onPointerUp);
  };
  const setsPointer = (el) => getComputedStyle(el).cursor === "pointer" && !(el.parentElement && getComputedStyle(el.parentElement).cursor === "pointer");
  const addressElOf = (entry) => (PICKER && entry.querySelector(PICKER.address)) || entry;
  /**
   * What to press to pick an entry, best first: the nearest element with a React click handler, the
   * entry's outer container (PICKER.item), the element that is a control or sets the pointer cursor,
   * the outermost element holding this entry alone, then the address text. Never an edit icon.
   */
  const pressTargets = (entry) => {
    const others = entries().filter((o) => o !== entry);
    const chain = [];
    for (let el = addressElOf(entry); el && el !== document.body && !others.some((o) => el.contains(o)); el = el.parentElement) chain.push(el);
    const item = PICKER && PICKER.item ? chain.filter((el) => el.matches(PICKER.item)).pop() : null;
    const found = [chain.find(reactHandler), item, chain.find((el) => el.matches(INTERACTIVE) || setsPointer(el)), chain[chain.length - 1], addressElOf(entry)];
    return [...new Set(found.filter(Boolean))].filter((el) => !el.closest(EDIT));
  };
  const describe = (el) => (el.tagName.toLowerCase() + (el.getAttribute("role") ? "[role=" + el.getAttribute("role") + "]" : "") + "." + String(el.className || "").split(/\s+/)[0]).substring(0, 80);
  /** After Flock pressed the header control (afterOpen): waits for the picker's entries. */
  const settleOpen = async (afterOpen) => {
    flockClear(${JSON.stringify(OPEN_MARK)});
    if (afterOpen) await until(() => entries().length, 11000);
  };
  const confirmButton = () => scopes().flatMap((root) => Array.from(root.querySelectorAll('button, [role="button"]'))).filter(visible).find((b) => CONFIRM.test(text(b))) || null;
`;

/** The marks Flock's real clicks in the address picker go to. */
const OPEN_MARK = "addr-open";
const PICK_MARK = "addr-pick";
const CONFIRM_MARK = "addr-confirm";
const CLOSE_MARK = "addr-close";

/**
 * Marks the header control that opens the saved-address picker, unless the picker already shows
 * its entries. → { shown: true } or { shown: false, control } (control false: no header control).
 */
export function addressOpenerScript(site: ShopSite): string {
  return String.raw`(async () => {
  ${PAGE_KIT}
  ${addressKit(site)}
  flockClear(${JSON.stringify(OPEN_MARK)});
  if (entries().length && (PICKER || scopes().length)) return JSON.stringify({ shown: true });
  const el = await until(opener, 10000);
  return JSON.stringify({ shown: false, control: flockMark(${JSON.stringify(OPEN_MARK)}, el) });
})()`;
}

/**
 * Reads each saved address in the open picker (label and address), after waiting for its entries
 * when Flock just pressed its header control (`afterOpen`). `opened` says whether the picker
 * opened, so no entries in an opened picker is "none saved", not a picker that never showed.
 * → { saved: [SavedAddress], opened, location, pageUrl }.
 */
export function addressListScript(site: ShopSite, afterOpen: boolean): string {
  return String.raw`(async () => {
  ${PAGE_KIT}
  ${addressKit(site)}
  await settleOpen(${afterOpen});
  const saved = readSaved();
  const opened = saved.length > 0 || isOpen();
  return JSON.stringify({ saved, opened, location: locationText(), pageUrl: location.href });
})()`;
}

/**
 * Marks the given saved address's entry for Flock's press, found again by its own label and text
 * (never its position). `attempt` picks the press target (pressTargets, best first), so a retry
 * presses the next one out. A target holding the entry's edit icon is not pressed itself: its
 * address is (inside it, so the target still gets the press), as a real click lands where it aims.
 * → { selected, pressed, last } or { error, code, message, saved }.
 */
export function addressPickScript(site: ShopSite, pick: SavedAddress, attempt: number, afterOpen: boolean): string {
  const wanted = JSON.stringify({ label: pick.label, text: pick.text });
  return String.raw`(async () => {
  ${PAGE_KIT}
  ${addressKit(site)}
  const PICK = ${wanted};
  const ATTEMPT = ${attempt};
  await settleOpen(${afterOpen});
  flockClear(${JSON.stringify(PICK_MARK)});
  const list = entries();
  const saved = readSaved();
  const same = (a) => a.text === PICK.text && a.label === PICK.label;
  const at = saved.findIndex(same) >= 0 ? saved.findIndex(same) : saved.findIndex((a) => a.text === PICK.text || (a.text && (a.text.includes(PICK.text) || PICK.text.includes(a.text))));
  if (at < 0) return JSON.stringify({ error: true, code: "PAGE_CHANGED", message: "The saved address to pick is no longer in the picker.", saved });
  const targets = pressTargets(list[at]);
  if (!targets.length) return JSON.stringify({ error: true, code: "PAGE_CHANGED", message: "The saved address's entry has nothing to press but its edit icon.", saved });
  const target = targets[Math.min(ATTEMPT, targets.length - 1)];
  const aim = addressElOf(list[at]);
  flockMark(${JSON.stringify(PICK_MARK)}, target.querySelector(EDIT) ? aim : target);
  return JSON.stringify({ selected: saved[at], pressed: describe(target), last: ATTEMPT >= targets.length - 1 });
})()`;
}

/**
 * After Flock's press on the entry (or on a confirm): marks a "change address?" confirm for the
 * next press when one shows, else waits for the header to change from `before` and reads it.
 * → { prompted: true } or { prompted: false, stillOpen, location, pageUrl }.
 */
export function addressSettleScript(site: ShopSite, before: string): string {
  return String.raw`(async () => {
  ${PAGE_KIT}
  ${addressKit(site)}
  const BEFORE = ${JSON.stringify(before)};
  flockClear("addr-");
  await until(() => confirmButton() || (opener() && locationText() !== BEFORE), 6000);
  if (flockMark(${JSON.stringify(CONFIRM_MARK)}, confirmButton())) return JSON.stringify({ prompted: true });
  return JSON.stringify({ prompted: false, stillOpen: entries().length > 0, location: locationText(), pageUrl: location.href });
})()`;
}

/**
 * After Flock's Escape: whether the picker closed; when it did not, marks the control that closes
 * it (the opener again for a menu, else the picker's close button). → { closed, location }.
 */
export function addressEscapedScript(site: ShopSite): string {
  return String.raw`(async () => {
  ${PAGE_KIT}
  ${addressKit(site)}
  flockClear(${JSON.stringify(CLOSE_MARK)});
  if (await until(() => !entries().length, 1500)) return JSON.stringify({ closed: true, location: locationText() });
  const close = expanded() ? opener() : scopes().flatMap((root) => Array.from(root.querySelectorAll('[aria-label*="close" i], [class*="close" i]'))).find(visible);
  flockMark(${JSON.stringify(CLOSE_MARK)}, close);
  return JSON.stringify({ closed: false, location: locationText() });
})()`;
}

/** After Flock's press on the close control: whether the picker closed. → { closed, location }. */
export function addressClosedScript(site: ShopSite): string {
  return String.raw`(async () => {
  ${PAGE_KIT}
  ${addressKit(site)}
  flockClear(${JSON.stringify(CLOSE_MARK)});
  const closed = !!(await until(() => !entries().length, 1500));
  return JSON.stringify({ closed, location: locationText() });
})()`;
}

/** Runs page actions on the open page; the JSON answer of the last one (an evaluate), or null. */
export type PageStep = (actions: PageAction[]) => Promise<any>;

const evaluate = (script: string): PageAction => ({ action: "evaluate", script });

/**
 * Runs `script(afterOpen)` with the saved-address picker open: when it is closed, Flock first
 * presses its header control (and the script waits for the entries). The script's answer, a
 * NO_LOCATION_CONTROL error with no header control, or null when the page could not be read.
 */
async function inOpenPicker(site: ShopSite, step: PageStep, script: (afterOpen: boolean) => string): Promise<any> {
  const opener = await step([evaluate(addressOpenerScript(site))]);
  if (!opener) return null;
  if (opener.shown) return step([evaluate(script(false))]);
  if (!opener.control) return { error: true, code: "NO_LOCATION_CONTROL", message: "No delivery-location control in the page header: the page may have changed." };
  return step([clickTarget(OPEN_MARK, true), evaluate(script(true))]);
}

/**
 * Closes the picker without picking, when `open`: Flock's Escape, else its press on the opener again
 * (a menu) or the picker's close button. → { closed, location } (location null: not read), or null.
 */
async function closePicker(site: ShopSite, step: PageStep, open: boolean): Promise<{ closed: boolean; location: string | null } | null> {
  if (!open) return { closed: true, location: null };
  const escaped = await step([{ action: "press", key: "Escape" }, evaluate(addressEscapedScript(site))]);
  if (!escaped || escaped.closed) return escaped;
  return step([clickTarget(CLOSE_MARK, true), evaluate(addressClosedScript(site))]);
}

/**
 * list-addresses on an open page: opens the header's picker, reads every saved address, closes it
 * again without picking. → addressListScript's answer, its location read after closing, or an
 * error answer, or null.
 */
export async function listSavedAddresses(site: ShopSite, step: PageStep): Promise<any> {
  const read = await inOpenPicker(site, step, (afterOpen) => addressListScript(site, afterOpen));
  if (!read || read.error) return read;
  const closed = await closePicker(site, step, read.saved.length > 0);
  return { ...read, location: closed?.location || read.location };
}

export interface AddressProblem { ok: false; code: string; message: string; candidates?: SavedAddress[]; location?: string }
export interface AddressSet { ok: true; address: SavedAddress; location: string; alreadySet: boolean; stillOpen: boolean }
export type AddressPick = AddressSet | AddressProblem;

/** Why a picker read has no saved addresses to offer, or null when it has some. */
export function noSavedAddresses(site: ShopSite, read: any): AddressProblem | null {
  if (!read) return { ok: false, code: "PAGE_CHANGED", message: `Could not read ${site.config.name}'s saved addresses. The service may have updated its layout.` };
  if (read.error) return { ok: false, code: read.code || "PAGE_CHANGED", message: read.message || "Could not read the saved addresses." };
  if (read.saved?.length) return null;
  if (!read.opened) return { ok: false, code: "PICKER_NOT_OPENED", message: `${site.config.name}'s delivery-location control did not open its saved-address picker: the page may have changed.` };
  return { ok: false, code: "NO_SAVED_ADDRESSES", message: `${site.config.name}'s address picker has no saved delivery address. Add one there first (with the owner's yes).` };
}

const SETTLE_MS = 1500;
/** Presses tried per pick, each on the next press target out (pressTargets). */
const MAX_PRESSES = 4;

/**
 * Presses the address once (target `attempt`) with Flock's real click, confirms a prompt, and reads
 * the header; a problem when the page did not settle.
 */
async function pressAndSettle(site: ShopSite, address: SavedAddress, before: string, attempt: number, step: PageStep) {
  const picked = await inOpenPicker(site, step, (afterOpen) => addressPickScript(site, address, attempt, afterOpen));
  if (!picked || picked.error) return { problem: { ok: false, code: picked?.code || "PAGE_CHANGED", message: picked?.message || "Could not select the address." } as AddressProblem };
  const settle = [clickTarget(PICK_MARK, true), clickTarget(CONFIRM_MARK, true), { action: "wait", delay: SETTLE_MS }, evaluate(addressSettleScript(site, before))];
  let settled: any = null;
  for (let tries = 0; tries < 3 && (!settled || settled.prompted); tries++) settled = await step(settle);
  if (settled?.prompted) await step([clickTarget(CONFIRM_MARK, true)]);
  if (!settled || settled.prompted) return { problem: { ok: false, code: "PAGE_CHANGED", message: "The page did not settle after picking the address: check the header's location." } as AddressProblem };
  return { last: !!picked.last, location: String(settled.location || ""), stillOpen: !!settled.stillOpen };
}

/**
 * set-delivery-location on an open page: lists the saved addresses and finds the one that matches
 * `wanted` (nothing is clicked when none or more than one does). When the header already shows it,
 * that is the delivery address. Otherwise it presses the entry, confirms a "change address?" prompt
 * and checks the header shows it, pressing the next target out until it does. The picker is closed
 * after. A header that never shows it is ADDRESS_NOT_SWITCHED, never a success.
 */
export async function selectAddress(site: ShopSite, wanted: string, step: PageStep): Promise<AddressPick> {
  const listed = await inOpenPicker(site, step, (afterOpen) => addressListScript(site, afterOpen));
  const missing = noSavedAddresses(site, listed);
  if (missing) return missing;
  const saved: SavedAddress[] = listed.saved;
  const match = matchAddress(saved, wanted);
  if (!match.ok) {
    const message = match.code === "AMBIGUOUS_ADDRESS"
      ? `More than one saved ${site.config.name} address could be "${wanted}". Pass more of the address (its flat number and building).`
      : `"${wanted}" is not among ${site.config.name}'s saved addresses. Adding it needs the owner's yes.`;
    return { ok: false, code: match.code, message, candidates: match.candidates };
  }
  const address = match.address;
  const before = String(listed.location || "");
  const close = async (location: string, alreadySet: boolean): Promise<AddressSet> => {
    const closed = await closePicker(site, step, true);
    return { ok: true, address, location: closed?.location || location, alreadySet, stillOpen: closed?.closed === false };
  };
  const shownBefore = (a: SavedAddress) => headerShows(before, a);
  if (shownBefore(address) && !saved.some((a) => a !== address && shownBefore(a))) return close(before, true);

  let location = before;
  let stillOpen = true;
  for (let attempt = 0; attempt < MAX_PRESSES; attempt++) {
    const pressed = await pressAndSettle(site, address, before, attempt, step);
    if ("problem" in pressed) return pressed.problem!;
    location = pressed.location;
    stillOpen = pressed.stillOpen;
    if (locationShows(location, address, address.selected ? "" : before)) return pressed.stillOpen ? close(location, false) : { ok: true, address, location, alreadySet: false, stillOpen: false };
    if (pressed.last) break;
  }
  await closePicker(site, step, stillOpen);
  return {
    ok: false,
    code: "ADDRESS_NOT_SWITCHED",
    message: `${site.config.name}'s header still does not show "${address.text}" after picking it, so prices would be for another address. Do not price this service.`,
    location,
  };
}
