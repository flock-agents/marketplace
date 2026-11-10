/**
 * BigBasket's pages, as the shared shop functions (_shop.ts, _shop_run.ts) read them.
 * The cart is the /basket page. The address picker and bill selectors are NOT confirmed live:
 * they are the generic ones in _shop.ts plus the header guesses below.
 */
import type { ShopSite } from "./_shop";

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
  addressOpeners: ['[class*="AddressDropdown"]', '[class*="LocationSelector"]', '[class*="DeliveryLocation"]', '[data-testid*="location" i]'],
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
