/**
 * BigBasket's pages, as the shared shop functions (_shop.ts, _shop_run.ts) read them.
 * The cart is the /basket page. The bill selectors are NOT confirmed live: they are the generic
 * ones in _shop.ts.
 */
import { PRESS_KIT_JS, pressLoop, type GroceryServiceConfig, type PageAction } from "../../_shared/_grocery_helpers";
import { baseUrlFrom, sitePattern, type AddressPicker, type ShopSite } from "./_shop";

/** BigBasket's site, or the stand-in shop an isolated e2e Flock points it at. */
export const BASE_URL = baseUrlFrom(process.env.FLOCK_CONNECTOR_BASE_URL, "https://www.bigbasket.com");

/** What every BigBasket script hands Flock's browser helpers. */
export const CONFIG: GroceryServiceConfig = {
  name: "BigBasket",
  baseUrl: BASE_URL,
  loginPattern: sitePattern(BASE_URL, "signin|login"),
};

/**
 * The saved-address picker, as captured live (signed in, 2026-11-11): the header's "Delivery in 6 mins /
 * Home: <area>" control is a Headless UI menu button; the open menu (`ul.overscroll-contain[role="none"]`)
 * holds one `li[role="menuitem"]` per saved address: `AddressCard___StyledDiv` > the label span, an
 * `<hr>`, then a div with the name span and the address span (the last one). A "change address?"
 * confirm after picking was not captured; one is pressed if it shows.
 */
const ADDRESS_PICKER: AddressPicker = {
  opener: 'button[aria-haspopup="menu"]',
  openerText: "deliver(y|ing)? in",
  entry: '[role="menuitem"]',
  label: '[class*="AddressCard"] > span',
  address: '[class*="AddressCard"] > div > span:last-child',
  item: '[role="menuitem"]',
};

export const BIGBASKET: ShopSite = {
  config: CONFIG,
  homeUrl: `${BASE_URL}/`,
  cartUrl: `${BASE_URL}/basket/`,
  cartPath: /^\/basket\b/i,
  openCart: [{ action: "wait", delay: 3000 }],
  cartLines: '[class*="cart-item"], [class*="CartItem"], [class*="BasketItem"], [data-testid="cart-item"], [class*="itemlist"] > div, [class*="ItemList"] > div',
  addressPicker: ADDRESS_PICKER,
  productId: (href) => (href.match(/\/pd\/(\d+)/) || href.match(/\/(\d{5,})/) || [])[1] || "",
};

/** A search result card: one `SKUDeck___StyledDiv-…` per product (checked live 2026-11-10). */
export const SEARCH_CARD = '[class*="SKUDeck___StyledDiv"], [qa="product"], [class*="ProductCard"], .SKUDeck';

/**
 * search-products' page script. It waits up to `waitMs` for product cards; a search with none (BigBasket sells
 * nothing that matches, say) answers `{ products: [], noCards: true }` instead of timing out. Before the read, the
 * page is scrolled twice as a person looks down the results (searchActions), for lazily drawn cards. Markup checked live 2026-11-10: a card's h3 holds brand, name and pack on
 * separate lines, with the rating ("4.2", "5122 Ratings") between them; the link is /pd/<id>/<slug>/; prices are
 * the ₹ amounts (selling first, then MRP); an in-stock card has an "Add" button.
 */
export function searchActions(waitMs = 10000): PageAction[] {
  const waitForCards = String.raw`(async () => {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  for (const end = Date.now() + ${waitMs}; document.querySelectorAll('${SEARCH_CARD}').length === 0 && Date.now() < end; ) await sleep(250);
})()`;
  const lookDown = [{ action: "scroll", deltaY: 600 }, { action: "wait", delay: 1000 }];
  return [{ action: "evaluate", script: waitForCards }, ...lookDown, ...lookDown];
}

/** The search results read: the cards the page holds (see searchActions). */
export function searchScript(maxResults: number): string {
  return String.raw`(async () => {
  const maxResults = ${maxResults};
  const cardsNow = () => Array.from(document.querySelectorAll('${SEARCH_CARD}'));
  if (cardsNow().length === 0) return JSON.stringify({ products: [], totalResults: 0, noCards: true });
  const rupees = (t) => (t.match(/₹\s*[\d,]+(?:\.\d+)?/g) || []).map((s) => parseFloat(s.replace(/[₹,\s]/g, "")));
  const cards = cardsNow();
  const products = [];
  for (const el of cards) {
    if (products.length >= maxResults) break;
    const href = (el.querySelector('a[href*="/pd/"]') || {}).getAttribute?.("href") || "";
    const id = (href.match(/\/pd\/(\d+)/) || [])[1];
    const head = ((el.querySelector("h3") || {}).innerText || "").split("\n").map((s) => s.trim()).filter((s) => s && !/^\d+(\.\d+)?$/.test(s) && !/ratings?$/i.test(s));
    if (!id || head.length === 0) continue;
    const text = el.innerText || "";
    const [price, mrp] = rupees(text);
    const brand = head.length > 2 ? head[0] : "";
    const name = head.length > 2 ? head[1] : head[0];
    const pack = head.length > 2 ? head[2] : (head[1] || "");
    const add = Array.from(el.querySelectorAll("button")).some((b) => /^add$/i.test(b.innerText.trim()));
    const img = el.querySelector("img");
    products.push({
      id, name: (brand ? brand + " " : "") + name, brand, quantity: pack,
      price: price ?? null, mrp: mrp ?? null,
      discount: (text.match(/\d+% OFF/i) || [null])[0],
      inStock: add || !/out of stock|notify me|sold out/i.test(text),
      imageUrl: img?.src || null,
      deliveryEstimate: (text.match(/\d+\s*MINS?/i) || [null])[0],
    });
  }
  return JSON.stringify({ products, totalResults: cards.length });
})()`;
}

/** The mark add-to-cart's presses on the search results go to, and its page state. */
const SEARCH_ADD = "bb-search-add";

/**
 * add-to-cart's page actions on the search results: finds the card whose link is the product's
 * (/pd/<id>/) and marks its "Add" button (found by its text) for Flock's real click, then the
 * stepper's "+" for each more unit. It never opens the product page. A card with no Add button is
 * out of stock or changed. The last action's answer:
 * → { success, productId, name, quantityAdded, quantityAsked } or { error, code, message }.
 */
export function addFromSearchActions(productId: string, quantity: number, waitMs = 10000): PageAction[] {
  const start = String.raw`(async () => {
  ${PRESS_KIT_JS}
  const ID = ${JSON.stringify(productId)};
  const MARK = ${JSON.stringify(SEARCH_ADD)};
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const visible = (el) => !!el && el.getClientRects().length > 0;
  const text = (el) => ((el && (el.innerText || el.textContent)) || "").replace(/\s+/g, " ").trim();
  const cardOf = () => Array.from(document.querySelectorAll('${SEARCH_CARD}')).find((el) => Array.from(el.querySelectorAll('a[href*="/pd/"]')).some((a) => (a.getAttribute("href") || "").match(/\/pd\/(\d+)/)?.[1] === ID));
  const s = flockState(MARK, true);
  flockClear(MARK);
  let card = null;
  for (const end = Date.now() + ${waitMs}; !(card = cardOf()) && Date.now() < end; ) await sleep(250);
  if (!card) { s.done = true; s.answer = { error: true, code: "NOT_IN_RESULTS", message: "That product is not in these search results. Search again with its name, then add it with the same query." }; return; }
  s.name = text(card.querySelector("h3")).substring(0, 200);
  const buttons = () => Array.from(card.querySelectorAll('button, [role="button"]')).filter(visible);
  const add = buttons().find((b) => /^add( to basket)?$/i.test(text(b)));
  if (!add) {
    const out = /out of stock|notify me|sold out|currently unavailable/i.test(text(card));
    s.done = true;
    s.answer = { error: true, code: out ? "OUT_OF_STOCK" : "PAGE_CHANGED", message: out ? s.name + " is out of stock." : "The product card has no Add button: the page may have changed." };
    return;
  }
  const plus = () => buttons().find((b) => text(b) === "+" || /increase|increment|add one|plus/i.test(b.getAttribute("aria-label") || ""))
    || (() => { const icons = buttons().filter((b) => !text(b)); return icons.length >= 2 ? icons[icons.length - 1] : null; })();
  s.step = async () => {
    flockMark(MARK, null);
    await flockSettle(s);
    const more = plus();
    if (!more) { s.done = true; return; }
    flockMark(MARK, more);
    s.added++;
    s.settleMs = 900;
  };
  flockMark(MARK, add);
  s.added = 1;
  s.settleMs = 1500;
})()`;
  const finish = String.raw`(async () => {
  ${PRESS_KIT_JS}
  const s = flockState(${JSON.stringify(SEARCH_ADD)});
  flockClear(${JSON.stringify(SEARCH_ADD)});
  await flockSettle(s);
  return JSON.stringify(s.answer || { success: true, productId: ${JSON.stringify(productId)}, name: s.name, quantityAdded: s.added, quantityAsked: ${quantity} });
})()`;
  return pressLoop({ key: SEARCH_ADD, mark: SEARCH_ADD, start, finish, presses: quantity });
}
