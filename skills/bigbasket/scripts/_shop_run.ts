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
  addressScript,
  cartReadScript,
  emptyCartScript,
  locationShows,
  matchAddress,
  notTheCart,
  parseJson,
  summarizeBill,
  type CartPageRead,
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

/** The saved delivery addresses and the one the header shows now. */
export async function listAddresses(site: ShopSite): Promise<void> {
  requireBrowserSession();
  const result = await browserInteract(site.config, site.homeUrl, [SETTLE], undefined, addressScript(site, null));
  const read = parseJson(result?.content);
  failOn(read, "the saved addresses");
  const saved: SavedAddress[] = read.saved || [];
  if (!saved.length) errorJson("NO_SAVED_ADDRESSES", `No saved delivery address was found on ${site.config.name}. Add one there first (with the owner's yes).`);
  console.log(JSON.stringify({ platform: site.config.name, addresses: saved.map(shown), currentLocation: read.location || null }));
}

/**
 * Selects the saved address that matches `address` (its text, or a label only one address has).
 * Fails without clicking when it is not saved or more than one could be meant.
 */
export async function setDeliveryLocation(site: ShopSite): Promise<void> {
  requireBrowserSession();
  const wanted = String(PARAMS.address || "").trim();
  if (!wanted) errorJson("MISSING_PARAM", "address is required: the delivery address agreed with the family (its text, or its saved label)");

  const opened = await persistentCreate(site.config, site.homeUrl, [SETTLE]);
  const sessionId: string = opened?.persistentSessionId || "";
  if (!sessionId) errorJson("SESSION_ERROR", "Failed to create persistent session");
  const finish = async (out: unknown, exitCode = 0): Promise<never> => {
    await persistentClose(site.config, sessionId).catch(() => {});
    console.log(JSON.stringify(out));
    process.exit(exitCode);
  };

  const listed = parseJson((await persistentInteract(site.config, sessionId, [], false, addressScript(site, null)))?.content);
  if (!listed || listed.error) {
    await finish({ error: true, code: listed?.code || "PAGE_CHANGED", message: listed?.message || "Could not read the saved addresses." }, 1);
  }
  const saved: SavedAddress[] = listed.saved || [];
  const match = matchAddress(saved, wanted);
  if (!match.ok) {
    const message = match.code === "AMBIGUOUS_ADDRESS"
      ? `More than one saved ${site.config.name} address could be "${wanted}". Pass more of the address.`
      : `"${wanted}" is not among ${site.config.name}'s saved addresses. Adding it needs the owner's yes.`;
    await finish({ error: true, code: match.code, message, savedAddresses: match.candidates.map(shown) }, 1);
  }
  const address = (match as { ok: true; address: SavedAddress }).address;
  const picked = parseJson((await persistentInteract(site.config, sessionId, [], false, addressScript(site, address)))?.content);
  if (!picked || picked.error) {
    await finish({ error: true, code: picked?.code || "PAGE_CHANGED", message: picked?.message || "Could not select the address." }, 1);
  }
  const location = String(picked.location || "");
  await finish({
    success: true,
    platform: site.config.name,
    selected: shown(address),
    currentLocation: location || null,
    confirmed: locationShows(location, address),
    ...(picked.stillOpen ? { note: "The address picker is still open: read the cart's delivery address before trusting prices." } : {}),
  });
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
