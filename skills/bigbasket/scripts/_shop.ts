/**
 * What the grocery website skills (BigBasket, Blinkit, Zepto) share: the saved-address picker, the
 * cart page check, emptying the cart, and the bill with every fee. Each skill ships an identical
 * copy (tests/grocery checks they match); the site's own selectors come from its `_<site>.ts`.
 * The in-page scripts are strings Flock's browser runs on the page; the rest is plain logic.
 * Not a callable function: the manifest's allowedFunctions does not name it.
 */
import type { GroceryServiceConfig } from "../../_shared/_grocery_helpers";

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
  openCart: unknown[];
  /** One line of the cart. */
  cartLines: string;
  /** Inside a line: its remove or minus control, tried before the generic ones. */
  removeControls?: string;
  /** The header control that opens the saved-address picker, tried before a text match. */
  addressOpeners: string[];
  /** The product id in a cart line's link, or "". */
  productId(href: string): string;
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

const MATCH_AT = 0.6;
const MATCH_MARGIN = 0.15;
const PINCODE = /\b\d{6}\b/;

const normalize = (s: string): string => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const tokens = (s: string): string[] => normalize(s).split(" ").filter((w) => w.length >= 3 || /\d/.test(w));

/** How well a saved address matches the wanted one, 0–1. A different pincode is never a match. */
function addressScore(saved: SavedAddress, wanted: string): number {
  const have = normalize(`${saved.label} ${saved.text}`);
  const want = normalize(wanted);
  const wantPin = want.match(PINCODE)?.[0];
  const havePin = have.match(PINCODE)?.[0];
  if (wantPin && havePin && wantPin !== havePin) return 0;
  if (want && have.includes(want)) return 1;
  const words = tokens(wanted);
  if (!words.length) return 0;
  const haveWords = new Set(have.split(" "));
  return words.filter((w) => haveWords.has(w)).length / words.length;
}

/**
 * The saved address that is the wanted one: by the address itself (or a label only one address
 * carries). Two close candidates are ambiguous, never a guess.
 */
export function matchAddress(saved: SavedAddress[], wanted: string): AddressMatch {
  const scored = saved.map((address) => ({ address, score: addressScore(address, wanted) })).sort((a, b) => b.score - a.score);
  const best = scored[0];
  if (!best || best.score < MATCH_AT) return { ok: false, code: "ADDRESS_NOT_SAVED", candidates: saved };
  const close = scored.filter((s) => best.score - s.score < MATCH_MARGIN);
  if (close.length > 1) return { ok: false, code: "AMBIGUOUS_ADDRESS", candidates: close.map((s) => s.address) };
  return { ok: true, address: best.address };
}

/** Does the header's location now show the chosen address (a shared word of four letters or more)? */
export function locationShows(location: string, address: SavedAddress): boolean {
  const shown = new Set(tokens(location));
  return tokens(`${address.label} ${address.text}`).some((w) => w.length >= 4 && shown.has(w));
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
  const visible = (el) => !!el && el.getClientRects().length > 0;
  const text = (el) => ((el && (el.innerText || el.textContent)) || "").replace(/\s+/g, " ").trim();
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (test, ms) => { const end = Date.now() + ms; while (Date.now() < end) { const v = test(); if (v) return v; await sleep(250); } return test(); };
  const press = (el) => {
    el.scrollIntoView({ block: "center" });
    const r = el.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    (hit && el.contains(hit) ? hit : el).click();
  };
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

/**
 * Empties the cart on the page it is run on: the page's own "Empty basket" / "Clear cart" when it
 * has one, else each line's remove (or minus, until the line goes). Confirms a "Remove?" prompt.
 * → { pageUrl, cartShown, headerText, removed: [names], remaining } or { error, code, message }.
 */
export function emptyCartScript(site: ShopSite): string {
  return String.raw`(async () => {
  ${PAGE_KIT}
  ${lineReader(site)}
  const SHOWN = ${JSON.stringify(site.cartShown || "")};
  const HEADER = ${JSON.stringify(site.cartHeader || "")};
  const CONTROLS = [${JSON.stringify(site.removeControls || "")}, ${JSON.stringify(GENERIC_REMOVE)}].filter(Boolean);
  const buttons = () => Array.from(document.querySelectorAll('button, a, [role="button"]')).filter(visible);
  const confirmPrompt = async () => {
    await sleep(600);
    const yes = buttons().find((b) => /^(yes|remove|delete|empty|clear|confirm|ok|okay)( (it|all|items?|basket|cart))?$/i.test(text(b)));
    if (yes) { press(yes); await sleep(800); }
  };
  await until(() => lines().length || EMPTY.test(document.body.innerText), 10000);
  const removed = lines().map(nameOf);
  const clearAll = buttons().find((b) => /^(empty|clear) (my |your )?(basket|cart)$|^remove all( items)?$/i.test(text(b)));
  if (clearAll && lines().length) {
    press(clearAll);
    await confirmPrompt();
    await until(() => !lines().length, 6000);
  }
  const deadline = Date.now() + 70000;
  let stuck = 0;
  while (lines().length && Date.now() < deadline && stuck < 3) {
    const line = lines()[0];
    const before = text(line) + "|" + lines().length;
    let control = null;
    for (const sel of CONTROLS) { control = Array.from(line.querySelectorAll(sel)).find(visible); if (control) break; }
    if (!control) control = Array.from(line.querySelectorAll('button, [role="button"]')).find((b) => /^[-−–]$/.test(text(b)));
    if (!control) return JSON.stringify({ error: true, code: "PAGE_CHANGED", message: "A cart line has no remove or minus control: the page may have changed.", removed: [] });
    press(control);
    await confirmPrompt();
    const moved = await until(() => !lines().length || (text(lines()[0]) + "|" + lines().length) !== before, 4000);
    stuck = moved ? 0 : stuck + 1;
  }
  return JSON.stringify({
    pageUrl: location.href,
    cartShown: !!SHOWN && visible(document.querySelector(SHOWN)),
    emptyShown: EMPTY.test(document.body.innerText),
    headerText: HEADER ? text(document.querySelector(HEADER)).substring(0, 60) : "",
    removed,
    remaining: lines().length,
  });
})()`;
}

/**
 * The saved-address picker: opens it from the header when it is not already open, lists the saved
 * addresses, and (with clickIndex) picks one and confirms a "change address?" prompt.
 * → { saved: [SavedAddress], location, pageUrl } or, with clickIndex, { selected, stillOpen, location, pageUrl }.
 */
export function addressScript(site: ShopSite, clickIndex: number | null): string {
  return String.raw`(async () => {
  ${PAGE_KIT}
  const OPENERS = ${JSON.stringify(site.addressOpeners)};
  const NOT_AN_ADDRESS = /^\+?\s*add\b|add (a )?new address|current location|detect|search|enter (your )?(area|location|address)/i;
  const LOCATION_TEXT = /deliver(y|ing)? (in|to)|select (your )?location|change location|set location|delivery location/i;
  const scopes = () => Array.from(document.querySelectorAll('[role="dialog"], [aria-modal="true"], [class*="modal" i], [class*="drawer" i], [class*="popup" i], [class*="sheet" i]')).filter(visible);
  const entries = () => {
    const roots = scopes();
    let found = [];
    for (const root of (roots.length ? roots : [document.body])) found.push(...root.querySelectorAll('[class*="address" i], [data-testid*="address" i]'));
    found = Array.from(new Set(found)).filter((el) => visible(el) && !el.matches("input, textarea"))
      .filter((el) => { const t = text(el); return t.length >= 10 && t.length <= 300 && !NOT_AN_ADDRESS.test(t); });
    found = found.filter((el) => found.filter((o) => o !== el && el.contains(o)).length < 2);
    return found.filter((el) => !found.some((o) => o !== el && o.contains(el)));
  };
  const header = () => {
    for (const sel of OPENERS) { const el = document.querySelector(sel); if (visible(el)) return el; }
    return Array.from(document.querySelectorAll('header button, header a, header [role="button"], header div')).filter(visible)
      .find((el) => text(el).length < 120 && LOCATION_TEXT.test(text(el))) || null;
  };
  if (!scopes().length || !entries().length) {
    const opener = await until(header, 10000);
    if (!opener) return JSON.stringify({ error: true, code: "NO_LOCATION_CONTROL", message: "No delivery-location control in the page header: the page may have changed." });
    press(opener);
    await until(() => entries().length, 8000);
  }
  const list = entries();
  const saved = list.map((el, index) => {
    const lines = String(el.innerText || "").split("\n").map((s) => s.trim()).filter(Boolean);
    const marked = /selected|active|checked|current/i.test(String(el.className)) || el.getAttribute("aria-selected") === "true" || el.getAttribute("aria-checked") === "true" || !!el.querySelector('input:checked, [aria-checked="true"], [aria-selected="true"]');
    return { index, label: (lines[0] || "").substring(0, 40), text: text(el).substring(0, 300), selected: marked };
  });
  const pick = ${clickIndex == null ? "null" : String(Math.trunc(clickIndex))};
  if (pick === null) return JSON.stringify({ saved, location: text(header()).substring(0, 120), pageUrl: location.href });
  const target = list[pick];
  if (!target) return JSON.stringify({ error: true, code: "PAGE_CHANGED", message: "The saved addresses changed while one was being picked." });
  press(target);
  await sleep(2500);
  const prompt = Array.from(document.querySelectorAll('button, [role="button"]')).filter(visible).find((b) => /^(confirm|continue|yes|ok|okay|change address)$/i.test(text(b)));
  if (prompt) { press(prompt); await sleep(2000); }
  return JSON.stringify({ selected: saved[pick], stillOpen: entries().length > 0, location: text(header()).substring(0, 120), pageUrl: location.href });
})()`;
}
