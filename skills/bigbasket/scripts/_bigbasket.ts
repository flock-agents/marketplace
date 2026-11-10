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
