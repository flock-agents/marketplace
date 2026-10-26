/**
 * Amazon.in — product page reads (readProductPage) into one ProductCards block.
 *
 * Pure: no browser, no network, so it is tested offline. Every value on a card is one a page read
 * gave; a field a read did not find is left off the card, and a product without its essentials (an
 * ASIN, a title, a price) is not shown at all but reported in `skipped`, never guessed. The limits are
 * the ProductCards component's own (packages/ui ProductCards.def.ts): up to 10 items, 4 photos, 8
 * colours, 10 sizes, 48 variants, 3 bullets, 1500 characters of details.
 */

export interface PageRead {
  asin?: string; title?: string; brand?: string; price?: number; mrp?: number;
  rating?: { stars: number; count?: number }; badge?: string; bullets?: string[]; details?: string;
  delivery?: string; stock?: string; photos?: string[];
  colours?: { name: string; photos: { image: string }[] }[]; sizes?: string[];
  variants?: { id: string; colour?: string; size?: string; price?: number; available: boolean }[];
  current?: { colour?: string | null; size?: string | null }; coloursAll?: number;
  found?: string[]; missing?: string[]; captcha?: boolean;
}

export interface Health { asin: string; title?: string; found: string[]; missing: string[] }

const SOLD_OUT = /currently unavailable|out of stock|unavailable/i;

/** One ProductCards item from a page read, or why it cannot be one. */
export function toItem(r: PageRead, fallbackAsin: string): { item?: any; reason?: string } {
  const asin = r.asin || fallbackAsin;
  if (!asin || !/^[A-Z0-9]{10}$/.test(asin)) return { reason: "no ASIN" };
  if (!r.title) return { reason: "no title" };
  const item: any = { id: asin, title: r.title.slice(0, 200), url: `https://www.amazon.in/dp/${asin}` };
  if (r.brand) item.brand = r.brand;
  if (r.rating && isFinite(r.rating.stars)) item.rating = r.rating;
  if (r.badge) item.badge = r.badge;
  if (r.bullets?.length) item.bullets = r.bullets.slice(0, 3);
  if (r.details) item.details = r.details.slice(0, 1500);
  const onScreen = { ...(r.price ? { price: r.price } : {}), ...(r.mrp ? { mrp: r.mrp } : {}), ...(r.delivery ? { delivery: r.delivery } : {}), ...(r.stock ? { stock: r.stock } : {}) };
  const inStock = !(r.stock && SOLD_OUT.test(r.stock));

  if (r.variants?.length) {
    const sizes = (r.sizes ?? []).slice(0, 10);
    let variants = r.variants.filter((v) => !v.size || sizes.length === 0 || sizes.includes(v.size)).slice(0, 48).map((v) => ({ ...v }));
    const colourNames = new Set(variants.map((v) => v.colour).filter(Boolean));
    // The variant on screen carries what the page shows for it; its colour's other sizes take its price
    // when their swatch showed none (one price per colour is how Amazon lists most clothes).
    const cur = variants.find((v) => v.id === asin)
      ?? variants.find((v) => (v.colour ?? null) === (r.current?.colour ?? null) && (v.size ?? null) === (r.current?.size ?? null));
    if (cur) {
      Object.assign(cur, onScreen);
      if (!inStock) cur.available = false;
      for (const v of variants) if (v !== cur && v.price === undefined && v.colour === cur.colour && cur.price) v.price = cur.price;
    }
    if (!variants.some((v) => typeof v.price === "number")) return { reason: "no price" };
    if (r.colours?.length) {
      item.colours = r.colours.filter((c) => colourNames.has(c.name)).slice(0, 8)
        .map((c) => ({ name: c.name, ...(c.photos?.length ? { photos: c.photos.slice(0, 4) } : {}) }));
    } else if (r.photos?.length) item.photos = r.photos.slice(0, 4).map((image) => ({ image }));
    if (sizes.length) item.sizes = sizes;
    item.variants = variants;
    return { item };
  }

  if (!r.price) return { reason: "no price" };
  if (r.photos?.length) item.photos = r.photos.slice(0, 4).map((image) => ({ image }));
  item.variants = [{ id: asin, ...onScreen, available: inStock }];
  return { item };
}

/** The block the agent sends as it is: a MiniApp holding one ProductCards. */
export function toBlock(items: any[], opts: { title?: string; size?: string } = {}): string {
  const sized = opts.size && items.some((it) => (it.sizes ?? []).includes(opts.size)) ? { pickedSize: opts.size } : {};
  const spec = {
    type: "MiniApp", id: "amazon-products",
    props: { title: opts.title || "From Amazon.in", subtitle: "Read just now on Amazon.in" },
    children: [{ type: "ProductCards", id: "products", props: { items: items.slice(0, 10), ...sized } }],
  };
  return "```flock-ui\n" + JSON.stringify(spec) + "\n```";
}

/** What each product's read found and missed, so a layout change shows up in the result. */
export function healthOf(asin: string, r: PageRead): Health {
  return { asin, ...(r.title ? { title: r.title.slice(0, 60) } : {}), found: r.found ?? [], missing: r.missing ?? [] };
}
