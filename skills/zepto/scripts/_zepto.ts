/**
 * Zepto's pages, as the shared shop functions (_shop.ts, _shop_run.ts) read them.
 * The cart is the /cart page. The address picker and bill selectors are NOT confirmed live:
 * they are the generic ones in _shop.ts plus the header guesses below.
 */
import type { ShopSite } from "./_shop";

export const ZEPTO: ShopSite = {
  config: {
    name: "Zepto",
    baseUrl: "https://www.zeptonow.com",
    loginPattern: /zeptonow\.com\/auth|zeptonow\.com\/login/i,
  },
  homeUrl: "https://www.zeptonow.com/",
  cartUrl: "https://www.zeptonow.com/cart",
  cartPath: /^\/cart\b/i,
  openCart: [{ action: "wait", delay: 3000 }],
  cartLines: '[class*="cart-item"], [class*="CartItem"], [class*="cart_item"], [class*="cartItem"], [data-testid="cart-item"]',
  addressOpeners: ['[data-testid="user-address"]', '[data-testid*="address" i]', '[class*="LocationSelector"]', '[aria-label*="location" i]'],
  productId: (href) => (href.match(/\/pvid\/([^/?#]+)/) || href.match(/\/pn\/([^/?#]+)/) || [])[1] || "",
};
