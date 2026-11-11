/**
 * The grocery website skills' shared functions, run against one shop (its `_<site>.ts`):
 * list-addresses, set-delivery-location, empty-cart and the cart-page read behind view-cart.
 * Each skill ships an identical copy (tests/grocery checks they match). Not a callable function.
 */
import {
  requireBrowserSession,
  errorJson,
  browserInteract,
  persistentCreate,
  persistentInteract,
  persistentClose,
} from "../../_shared/_grocery_helpers";
import {
  addressListScript,
  cartReadScript,
  emptyCartScript,
  noSavedAddresses,
  notTheCart,
  parseJson,
  selectAddress,
  summarizeBill,
  type CartPageRead,
  type PageStep,
  type SavedAddress,
  type ShopSite,
} from "./_shop";

const PARAMS = JSON.parse(process.env.SKILL_PARAMS || "{}");
const SETTLE = { action: "wait", delay: 3000 };

function failOn(read: any, what: string): void {
  if (!read) errorJson("PAGE_CHANGED", `Could not read ${what}. The service may have updated its layout.`);
  if (read.error) errorJson(read.code || "PAGE_CHANGED", read.message || `Could not read ${what}.`);
}

const shown = (a: SavedAddress) => ({ label: a.label, address: a.text, selected: a.selected });

/** list-addresses: opens the header's picker, reads every saved address, closes it without picking. */
export async function listAddresses(site: ShopSite): Promise<void> {
  requireBrowserSession();
  const result = await browserInteract(site.config, site.homeUrl, [SETTLE], undefined, addressListScript(site, true));
  const read = parseJson(result?.content);
  const missing = noSavedAddresses(site, read);
  if (missing) errorJson(missing.code, missing.message);
  console.log(JSON.stringify({ platform: site.config.name, addresses: read.saved.map(shown), currentLocation: read.location || null }));
}

/**
 * set-delivery-location: selects the saved address that matches `address` (its flat or house number
 * and building), then checks the header shows it. Fails without clicking when none or more than one matches.
 */
export async function setDeliveryLocation(site: ShopSite): Promise<void> {
  requireBrowserSession();
  const wanted = String(PARAMS.address || "").trim();
  if (!wanted) errorJson("MISSING_PARAM", "address is required: the delivery address agreed with the family (its flat or house number and building)");

  const opened = await persistentCreate(site.config, site.homeUrl, [SETTLE]);
  const sessionId: string = opened?.persistentSessionId || "";
  if (!sessionId) errorJson("SESSION_ERROR", "Failed to create persistent session");
  const step: PageStep = async (script, waitMs) => {
    const actions = waitMs ? [{ action: "wait", delay: waitMs }] : [];
    return parseJson((await persistentInteract(site.config, sessionId, actions, false, script))?.content);
  };

  const result = await selectAddress(site, wanted, step);
  await persistentClose(site.config, sessionId).catch(() => {});
  if (!result.ok) {
    console.log(JSON.stringify({ error: true, code: result.code, message: result.message, ...(result.candidates ? { savedAddresses: result.candidates.map(shown) } : {}) }));
    process.exit(1);
  }
  console.log(JSON.stringify({
    success: true,
    platform: site.config.name,
    selected: shown(result.address),
    currentLocation: result.location || null,
    confirmed: result.confirmed,
    ...(result.stillOpen ? { note: "The address picker is still open: read the cart's delivery address before trusting prices." } : {}),
  }));
}

/** Reads the cart and proves it is the cart; a home page or suggestions fail as NOT_CART_PAGE. */
export async function readCart(site: ShopSite): Promise<CartPageRead> {
  const result = await browserInteract(site.config, site.cartUrl, site.openCart, undefined, cartReadScript(site));
  const read: CartPageRead | null = parseJson(result?.content);
  failOn(read, "the cart");
  const problem = notTheCart(site, read!);
  if (problem) errorJson("NOT_CART_PAGE", `${problem} Nothing was read from it; try view-cart once more, then report it.`);
  return read!;
}

/** view-cart: the items and the full total to pay, every fee included. */
export async function viewCart(site: ShopSite): Promise<void> {
  requireBrowserSession();
  const read = await readCart(site);
  const items = read.items.map((it) => ({
    productId: site.productId(it.href),
    name: it.name,
    quantity: it.quantity,
    price: it.price,
    subtotal: it.price != null ? it.price * it.quantity : null,
  }));
  const itemsSubtotal = items.reduce((sum, it) => sum + (it.subtotal || 0), 0);
  console.log(JSON.stringify({
    platform: site.config.name,
    verifiedCart: true,
    items,
    itemCount: items.length,
    ...summarizeBill(read.bill, itemsSubtotal),
    bill: read.bill,
    deliveryAddress: read.deliveryAddress,
  }));
}

/** empty-cart: removes every line, then proves the cart (not some other page) is empty. */
export async function emptyCart(site: ShopSite): Promise<void> {
  requireBrowserSession();
  const result = await browserInteract(site.config, site.cartUrl, site.openCart, undefined, emptyCartScript(site));
  const read = parseJson(result?.content);
  failOn(read, "the cart");
  const problem = notTheCart(site, { ...read, items: new Array(read.remaining || 0), bill: [], emptyShown: read.emptyShown || read.removed?.length > 0 });
  if (problem) errorJson("NOT_CART_PAGE", `${problem} Nothing was removed.`);
  if (read.remaining > 0) {
    errorJson("CART_NOT_EMPTIED", `${read.remaining} line(s) are still in the ${site.config.name} cart after removing ${read.removed.length - read.remaining}. View the cart and remove the rest.`);
  }
  console.log(JSON.stringify({ success: true, platform: site.config.name, removed: read.removed, itemCount: 0 }));
}
