/**
 * BigBasket's pages, as the shared shop functions (_shop.ts, _shop_run.ts) read them.
 * The cart is the /basket page. The bill selectors are NOT confirmed live: they are the generic
 * ones in _shop.ts.
 */
import type { AddressPicker, ShopSite } from "./_shop";

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
  config: {
    name: "BigBasket",
    baseUrl: "https://www.bigbasket.com",
    loginPattern: /bigbasket\.com\/signin|bigbasket\.com\/login/i,
  },
  homeUrl: "https://www.bigbasket.com/",
  cartUrl: "https://www.bigbasket.com/basket/",
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
 * nothing that matches, say) answers `{ products: [], noCards: true }` instead of timing out. Then it scrolls twice
 * for lazily drawn cards and reads them. Markup checked live 2026-11-10: a card's h3 holds brand, name and pack on
 * separate lines, with the rating ("4.2", "5122 Ratings") between them; the link is /pd/<id>/<slug>/; prices are
 * the ₹ amounts (selling first, then MRP); an in-stock card has an "Add" button.
 */
export function searchScript(maxResults: number, waitMs = 10000): string {
  return String.raw`(async () => {
  const maxResults = ${maxResults};
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const cardsNow = () => Array.from(document.querySelectorAll('${SEARCH_CARD}'));
  for (const end = Date.now() + ${waitMs}; cardsNow().length === 0 && Date.now() < end; ) await sleep(250);
  if (cardsNow().length === 0) return JSON.stringify({ products: [], totalResults: 0, noCards: true });
  for (let i = 0; i < 2; i++) { window.scrollBy(0, 600); await sleep(1000); }
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

/**
 * add-to-cart's page script on the search results: finds the card whose link is the product's
 * (/pd/<id>/), presses its "Add" button (found by its text), then the stepper's "+" for each more
 * unit. It never opens the product page. A card with no Add button is out of stock or changed.
 * → { success, productId, name, quantityAdded, quantityAsked } or { error, code, message }.
 */
export function addFromSearchScript(productId: string, quantity: number, waitMs = 10000): string {
  return String.raw`(async () => {
  const ID = ${JSON.stringify(productId)};
  const QUANTITY = ${quantity};
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const visible = (el) => !!el && el.getClientRects().length > 0;
  const text = (el) => ((el && (el.innerText || el.textContent)) || "").replace(/\s+/g, " ").trim();
  const cardOf = () => Array.from(document.querySelectorAll('${SEARCH_CARD}')).find((el) => Array.from(el.querySelectorAll('a[href*="/pd/"]')).some((a) => (a.getAttribute("href") || "").match(/\/pd\/(\d+)/)?.[1] === ID));
  let card = null;
  for (const end = Date.now() + ${waitMs}; !(card = cardOf()) && Date.now() < end; ) await sleep(250);
  if (!card) return JSON.stringify({ error: true, code: "NOT_IN_RESULTS", message: "That product is not in these search results. Search again with its name, then add it with the same query." });
  card.scrollIntoView({ block: "center" });
  const name = text(card.querySelector("h3")).substring(0, 200);
  const buttons = () => Array.from(card.querySelectorAll('button, [role="button"]')).filter(visible);
  const add = buttons().find((b) => /^add( to basket)?$/i.test(text(b)));
  if (!add) {
    const out = /out of stock|notify me|sold out|currently unavailable/i.test(text(card));
    return JSON.stringify({ error: true, code: out ? "OUT_OF_STOCK" : "PAGE_CHANGED", message: out ? name + " is out of stock." : "The product card has no Add button: the page may have changed." });
  }
  add.click();
  await sleep(1500);
  let added = 1;
  const plus = () => buttons().find((b) => text(b) === "+" || /increase|increment|add one|plus/i.test(b.getAttribute("aria-label") || ""))
    || (() => { const icons = buttons().filter((b) => !text(b)); return icons.length >= 2 ? icons[icons.length - 1] : null; })();
  while (added < QUANTITY) {
    const more = plus();
    if (!more) break;
    more.click();
    await sleep(900);
    added++;
  }
  return JSON.stringify({ success: true, productId: ID, name, quantityAdded: added, quantityAsked: QUANTITY });
})()`;
}
