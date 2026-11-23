#!/usr/bin/env bun
/**
 * Blinkit — remove products from the cart, by name, or all of them.
 * Params: { productName?: string, all?: boolean } (productId is read as a name: the cart drawer carries no ids)
 *
 * Blinkit has no cart page: the cart is a drawer (_blinkit.ts). A line's stepper is
 * `AddToCart__UpdatedButtonContainer`: minus, quantity, plus. Pressing its first control until the
 * line is gone removes the product.
 */
import { requireBrowserSession, errorJson, browserInteract, persistentCreate, persistentClose, runPressLoop, PRESS_KIT_JS } from "../../_shared/_grocery_helpers";
import { BLINKIT as config, HOME_URL, OPEN_CART_ACTIONS, READ_CART_SCRIPT } from "./_blinkit";

const PARAMS = JSON.parse(process.env.SKILL_PARAMS || "{}");
const all = PARAMS.all === true || PARAMS.all === "true";
const name: string = String(PARAMS.productName || PARAMS.name || PARAMS.productId || "").trim();

requireBrowserSession();
if (!all && !name) errorJson("MISSING_PARAM", "Give productName (as view-cart shows it), or all: true to empty the cart.");

/** The mark Flock's real clicks on a line's minus go to, and its page state. */
const MINUS_MARK = "blinkit-minus";
/** At most this many presses of a minus, as the drawer's lines go. */
const MAX_PRESSES = 60;

// Each step notes whether the line it pressed last went, then marks the next matching line's minus
// for Flock's real click.
const START_SCRIPT = `(() => {
  ${PRESS_KIT_JS}
  const want = ${JSON.stringify(name.toLowerCase())};
  const all = ${all};
  const lines = () => Array.from(document.querySelectorAll('[class*="CartProduct__Container"]'));
  const title = (el) => ((el.querySelector('[class*="ProductTitle"]') || {}).innerText || "").trim();
  const matches = (el) => all || title(el).toLowerCase().includes(want) || want.includes(title(el).toLowerCase());
  const s = flockState("${MINUS_MARK}", true);
  flockClear("${MINUS_MARK}");
  s.removed = [];
  s.settle = async () => {
    flockMark("${MINUS_MARK}", null);
    await flockSettle(s);
    const pressed = s.pressed;
    s.pressed = null;
    if (pressed && !lines().includes(pressed.line) && !s.removed.includes(pressed.title)) s.removed.push(pressed.title);
    s.left = lines().map(title);
  };
  s.step = async () => {
    await s.settle();
    const line = lines().find(matches);
    if (!line) { s.done = true; return; }
    const stepper = line.querySelector('[class*="AddToCart__UpdatedButtonContainer"]');
    const minus = stepper && (stepper.querySelector('[class*="AddMinusIcon"]') || stepper.firstElementChild);
    if (!minus) { s.done = true; s.answer = { error: true, code: "PAGE_CHANGED", message: "No minus control on the cart line " + title(line) }; return; }
    s.pressed = { line, title: title(line) };
    flockMark("${MINUS_MARK}", minus.closest('button,[role="button"]') || minus);
    s.settleMs = 900;
  };
  return s.step();
})()`;

const FINISH_SCRIPT = `(async () => {
  ${PRESS_KIT_JS}
  const s = flockState("${MINUS_MARK}");
  await s.settle();
  flockClear("${MINUS_MARK}");
  return JSON.stringify(s.answer || { removed: s.removed, left: s.left });
})()`;

const opened = await persistentCreate(config, HOME_URL, OPEN_CART_ACTIONS);
const sessionId: string = opened?.persistentSessionId || "";
if (!sessionId) errorJson("SESSION_ERROR", "Failed to create persistent session");
const content = await runPressLoop(config, sessionId, { key: MINUS_MARK, mark: MINUS_MARK, start: START_SCRIPT, finish: FINISH_SCRIPT, presses: MAX_PRESSES });
await persistentClose(config, sessionId);
let parsed: any;
try { parsed = JSON.parse(content || ""); } catch { errorJson("PAGE_CHANGED", "Could not read the cart drawer. Blinkit's page may have changed."); }
if (parsed.error) { console.log(JSON.stringify(parsed)); process.exit(1); }
if (!all && parsed.removed.length === 0) errorJson("PRODUCT_NOT_FOUND", `No cart line matches "${name}". In the cart: ${parsed.left.join(", ") || "nothing"}.`);

// The bill after the change, so the caller needn't read the cart again.
const after = await browserInteract(config, HOME_URL, OPEN_CART_ACTIONS, undefined, READ_CART_SCRIPT);
let cart: any = {};
try { cart = JSON.parse(after.content || "{}"); } catch { /* the removal stands; the bill is just unread */ }
console.log(JSON.stringify({ success: true, removed: parsed.removed, left: parsed.left, orderTotal: cart.orderTotal ?? null, bill: cart.bill ?? [] }));
