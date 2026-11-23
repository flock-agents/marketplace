#!/usr/bin/env bun
/**
 * Blinkit — remove products from the cart, by name, or all of them.
 * Params: { productName?: string, all?: boolean } (productId is read as a name: the cart drawer carries no ids)
 *
 * Blinkit has no cart page: the cart is a drawer (_blinkit.ts). A line's stepper is
 * `AddToCart__UpdatedButtonContainer`: minus, quantity, plus. Pressing its first control until the
 * line is gone removes the product.
 */
import { requireBrowserSession, errorJson, browserInteract } from "../../_shared/_grocery_helpers";
import { BLINKIT as config, HOME_URL, OPEN_CART_ACTIONS, READ_CART_SCRIPT } from "./_blinkit";

const PARAMS = JSON.parse(process.env.SKILL_PARAMS || "{}");
const all = PARAMS.all === true || PARAMS.all === "true";
const name: string = String(PARAMS.productName || PARAMS.name || PARAMS.productId || "").trim();

requireBrowserSession();
if (!all && !name) errorJson("MISSING_PARAM", "Give productName (as view-cart shows it), or all: true to empty the cart.");

const REMOVE_SCRIPT = `(async () => {
  const want = ${JSON.stringify(name.toLowerCase())};
  const all = ${all};
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const lines = () => Array.from(document.querySelectorAll('[class*="CartProduct__Container"]'));
  const title = (el) => ((el.querySelector('[class*="ProductTitle"]') || {}).innerText || "").trim();
  const matches = (el) => all || title(el).toLowerCase().includes(want) || want.includes(title(el).toLowerCase());
  const removed = [];
  for (let guard = 0; guard < 60; guard++) {
    const line = lines().find(matches);
    if (!line) break;
    const stepper = line.querySelector('[class*="AddToCart__UpdatedButtonContainer"]');
    const minus = stepper && (stepper.querySelector('[class*="AddMinusIcon"]') || stepper.firstElementChild);
    if (!minus) return JSON.stringify({ error: true, code: "PAGE_CHANGED", message: "No minus control on the cart line " + title(line) });
    const t = title(line);
    (minus.closest('button,[role="button"]') || minus).click();
    await sleep(900);
    if (!lines().includes(line) && !removed.includes(t)) removed.push(t);
  }
  return JSON.stringify({ removed, left: lines().map(title) });
})()`;

const result = await browserInteract(config, HOME_URL, OPEN_CART_ACTIONS, undefined, REMOVE_SCRIPT);
let parsed: any;
try { parsed = JSON.parse(result.content || ""); } catch { errorJson("PAGE_CHANGED", "Could not read the cart drawer. Blinkit's page may have changed."); }
if (parsed.error) { console.log(JSON.stringify(parsed)); process.exit(1); }
if (!all && parsed.removed.length === 0) errorJson("PRODUCT_NOT_FOUND", `No cart line matches "${name}". In the cart: ${parsed.left.join(", ") || "nothing"}.`);

// The bill after the change, so the caller needn't read the cart again.
const after = await browserInteract(config, HOME_URL, OPEN_CART_ACTIONS, undefined, READ_CART_SCRIPT);
let cart: any = {};
try { cart = JSON.parse(after.content || "{}"); } catch { /* the removal stands; the bill is just unread */ }
console.log(JSON.stringify({ success: true, removed: parsed.removed, left: parsed.left, orderTotal: cart.orderTotal ?? null, bill: cart.bill ?? [] }));
