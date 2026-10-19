/**
 * Blinkit's page, as its scripts read it. Shared by view-cart and checkout (not a callable
 * function: the manifest's allowedFunctions does not name it).
 *
 * Markup confirmed live on 35720 on 2026-10-16 (signed-in session, cart drawer open):
 * Blinkit has NO /cart page (it redirects home); the cart is a drawer opened from the header
 * button `[class*="CartButton__Button"]` ("3 items ₹120", or "My Cart" when empty). A
 * Playwright click on that button hung live; a script `el.click()` opened it.
 * Drawer: `CartWrapper__CartContainer`; a line: `CartProduct__Container` >
 * `DefaultProductCard__ProductTitle`, `DefaultProductCard__Price`,
 * `AddToCart__UpdatedButtonContainer` (quantity, between two icon-font glyphs).
 * Bill rows: `BillCard__BillItemContainer`; to pay: `CheckoutStrip__NetPriceText`; the strip
 * `CheckoutStrip__Container` reads "₹162 TOTAL Proceed To Pay". Blinkit uses
 * styled-components: the `Name__Part` prefix before `-sc-` is stable, the hash is not.
 */
import type { GroceryServiceConfig } from "../../_shared/_grocery_helpers";

export const BLINKIT: GroceryServiceConfig = {
  name: "Blinkit",
  baseUrl: "https://blinkit.com",
  loginPattern: /blinkit\.com\/login|blinkit\.com\/auth/i,
};

export const HOME_URL = "https://blinkit.com/";

/** The header cart button, present on every page once the app has rendered. */
export const CART_BUTTON = '[class*="CartButton"]';

/** Opens the cart drawer unless it is already open. */
export const OPEN_CART_SCRIPT = `(() => {
  const shown = (el) => !!el && el.getClientRects().length > 0;
  if (shown(document.querySelector('[class*="CartWrapper__CartContainer"]')) || shown(document.querySelector('[class*="CartProduct__Container"]'))) return "already_open";
  const btn = document.querySelector('[class*="CartButton__Button"]') || document.querySelector('[class*="CartButton__Container"]') || document.querySelector('[class*="CartButton"]');
  if (!btn) return "no_cart_button";
  btn.click();
  return "clicked";
})()`;

/** The page actions that open the drawer and give it time to render. */
export const OPEN_CART_ACTIONS = [
  { action: "waitForSelector", selector: CART_BUTTON, delay: 15000 },
  { action: "evaluate", script: OPEN_CART_SCRIPT },
  { action: "wait", delay: 2500 },
];

/**
 * Reads the open drawer: { drawerOpen, headerText, itemCount, orderTotal, items, bill,
 * deliveryEstimate }. Quantities are read from the stepper's own text nodes: its +/− are
 * icon-font glyphs ("U", "5") that would otherwise run into the number.
 */
export const READ_CART_SCRIPT = `(() => {
  const q = (sel, root) => (root || document).querySelector(sel);
  const text = (el) => ((el && (el.innerText || el.textContent)) || "").trim();
  const rupees = (s) => { const m = String(s || "").match(/₹\\s*([\\d,]+(?:\\.\\d+)?)/); return m ? parseFloat(m[1].replace(/,/g, "")) : null; };
  const drawer = q('[class*="CartWrapper__CartContainer"]') || q('.cart-modal-rn');
  const header = q('[class*="CartButton__Button"]') || q('[class*="CartButton"]');
  const lines = Array.from(document.querySelectorAll('[class*="CartProduct__Container"]')).slice(0, 50);
  const items = lines.map((el) => {
    const stepper = q('[class*="AddToCart__UpdatedButtonContainer"]', el);
    let qtyText = "";
    if (stepper) {
      for (const node of Array.from(stepper.childNodes)) if (node.nodeType === 3) qtyText += node.textContent;
      if (!qtyText.trim()) {
        const clone = stepper.cloneNode(true);
        clone.querySelectorAll('[class*="AddMinusIcon"]').forEach((n) => n.remove());
        qtyText = clone.textContent || "";
      }
    }
    return {
      name: text(q('[class*="ProductTitle"]', el)).substring(0, 200),
      variant: text(q('[class*="ProductVariant"]', el)).substring(0, 50),
      quantity: parseInt(qtyText.replace(/[^\\d]/g, ""), 10) || 1,
      price: rupees(text(q('[class*="DefaultProductCard__Price"]', el)) || text(el)),
    };
  }).filter((it) => it.name);
  const bill = Array.from(document.querySelectorAll('[class*="BillCard__BillItemContainer"]')).slice(0, 15).map((row) => {
    const t = text(row).replace(/\\s+/g, " ");
    const amounts = t.match(/₹\\s*[\\d,]+(?:\\.\\d+)?/g) || [];
    return { label: t.split("₹")[0].trim().substring(0, 60), amount: amounts.length ? rupees(amounts[amounts.length - 1]) : null };
  }).filter((r) => r.label);
  const grand = bill.find((r) => /grand total|to pay/i.test(r.label));
  const net = text(q('[class*="CheckoutStrip__NetPriceText"]'));
  const eta = (document.body.innerText.match(/Delivery in [^\\n]{1,20}/i) || [""])[0];
  return JSON.stringify({
    drawerOpen: (!!drawer && drawer.getClientRects().length > 0) || lines.length > 0,
    headerText: text(header).replace(/\\s+/g, " ").substring(0, 60),
    itemCount: items.length,
    orderTotal: net || (grand && grand.amount != null ? "₹" + grand.amount : ""),
    items,
    bill,
    deliveryEstimate: eta.substring(0, 40) || null,
  });
})()`;

/** The header says the cart has items ("3 items ₹120"), whatever the drawer shows. */
export function headerShowsItems(headerText: unknown): boolean {
  return /\d+\s*items?/i.test(String(headerText || ""));
}

/** Amount in rupees from "₹1,234" (or a number), or null. */
export function rupeeAmount(value: unknown): number | null {
  if (typeof value === "number") return value;
  const m = String(value ?? "").match(/([\d,]+(?:\.\d+)?)/);
  return m ? parseFloat(m[1].replace(/,/g, "")) : null;
}
