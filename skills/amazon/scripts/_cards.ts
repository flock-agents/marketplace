/**
 * Amazon.in — page reads (readProductPage) into ProductCards items.
 *
 * Pure: no browser, no network, so it is tested offline. Every value on a card is one read from that
 * variant's OWN page — Amazon's price, stock and delivery differ per colour and size (owner 2026-10-26) —
 * and a variant whose page was not read is not on the card. A product without its essentials (an ASIN, a
 * title, a price) is not shown but reported, never guessed. The limits are the ProductCards component's
 * (packages/ui ProductCards.def.ts): 10 items, 4 photos, 8 colours, 10 sizes, 48 variants, 3 bullets,
 * 1500 characters of details.
 */
import { otherOptions, type Twister, type Variant } from "./_variants";

export interface PageRead {
  asin?: string; title?: string; brand?: string; price?: number; mrp?: number;
  rating?: { stars: number; count?: number }; badge?: string; bullets?: string[]; details?: string;
  delivery?: string; stock?: string; photos?: string[]; twister?: Twister;
  found?: string[]; missing?: string[]; captcha?: boolean;
}

export interface Health { asin: string; title?: string; missing: string[] }

const SOLD_OUT = /currently unavailable|out of stock|unavailable|not available/i;
const inStock = (r: PageRead) => !!r.price && !(r.stock && SOLD_OUT.test(r.stock));

/** The product-level fields of a card (the same for every variant), from one page read. */
function productFields(r: PageRead, asin: string): any {
  const item: any = { id: asin, title: (r.title ?? "").slice(0, 200), url: `https://www.amazon.in/dp/${asin}` };
  if (r.brand) item.brand = r.brand;
  if (r.rating && isFinite(r.rating.stars)) item.rating = r.rating;
  if (r.badge) item.badge = r.badge;
  if (r.bullets?.length) item.bullets = r.bullets.slice(0, 3);
  if (r.details) item.details = r.details.slice(0, 1500);
  return item;
}

/** A variant row from that variant's own page. */
function row(v: Variant, r: PageRead): any {
  return {
    id: v.asin, ...(v.colour !== undefined ? { colour: v.colour } : {}), ...(v.size !== undefined ? { size: v.size } : {}),
    ...(r.price ? { price: r.price } : {}), ...(r.mrp && r.price && r.mrp > r.price ? { mrp: r.mrp } : {}),
    ...(r.delivery ? { delivery: r.delivery } : {}), ...(r.stock ? { stock: r.stock } : {}),
    available: inStock(r),
  };
}

/**
 * One product, shown as the one variant read for the owner's size (`read` is that variant's own page;
 * `shown` is its place in the table, absent for a product with no variants). Its other colours and
 * sizes are counted in `moreOptions`, for the card's button.
 */
export function toItem(read: PageRead, shown: Variant | null, twister?: Twister): { item?: any; reason?: string } {
  const asin = shown?.asin || read.asin || "";
  if (!/^[A-Z0-9]{10}$/.test(asin)) return { reason: "no ASIN" };
  if (!read.title) return { reason: "no title" };
  if (!read.price) return { reason: "no price" };
  const item = productFields(read, asin);
  const photos = (read.photos ?? []).slice(0, 4).map((image) => ({ image }));
  const v: Variant = shown ?? { asin };
  if (v.colour !== undefined) item.colours = [{ name: v.colour, ...(photos.length ? { photos } : {}) }];
  else if (photos.length) item.photos = photos;
  if (v.size !== undefined) item.sizes = [v.size];
  item.variants = [row(v, read)];
  if (twister && shown) {
    const more = otherOptions(twister, shown);
    if (more.colours || more.sizes) item.moreOptions = more;
  }
  return { item };
}

/**
 * One product with every variant read (read-variants): `reads` maps each variant's ASIN to its own page.
 * Colours in the order planned (at most 8), sizes in Amazon's order, only those with a variant read;
 * colours Amazon sells beyond the card become `moreColours` (the card links them to the page).
 */
export function toVariantsItem(base: PageRead, baseAsin: string, plan: { reads: Variant[]; colours: string[]; coloursAll: number }, reads: Map<string, PageRead>, twister: Twister): { item?: any; reason?: string } {
  if (!base.title) return { reason: "no title" };
  const done = plan.reads.filter((v) => reads.has(v.asin));
  const rows = done.map((v) => row(v, reads.get(v.asin)!)).filter((r) => r.price !== undefined || r.available === false);
  if (!rows.some((r) => typeof r.price === "number")) return { reason: "no price" };
  const item = productFields(base, baseAsin);
  const colours = plan.colours.filter((c) => rows.some((r) => r.colour === c));
  if (colours.length) {
    item.colours = colours.map((c) => {
      const withPhotos = done.find((v) => v.colour === c && (reads.get(v.asin)?.photos ?? []).length);
      const photos = withPhotos ? reads.get(withPhotos.asin)!.photos!.slice(0, 4).map((image) => ({ image })) : [];
      return { name: c, ...(photos.length ? { photos } : {}) };
    });
  } else if (base.photos?.length) item.photos = base.photos.slice(0, 4).map((image) => ({ image }));
  const sizeDim = twister.dims.find((d) => /size/i.test(d));
  const sizes = sizeDim ? (twister.values[sizeDim] ?? []).filter((s) => rows.some((r) => r.size === s)).slice(0, 10) : [];
  if (sizes.length) item.sizes = sizes;
  item.variants = rows.filter((r) => (r.colour === undefined || colours.includes(r.colour)) && (r.size === undefined || sizes.includes(r.size))).slice(0, 48);
  const more = plan.coloursAll - colours.length;
  if (more > 0) item.moreColours = more;
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

/** What a read missed, so a layout change shows up in the result. */
export function healthOf(asin: string, r: PageRead): Health {
  return { asin, ...(r.title ? { title: r.title.slice(0, 60) } : {}), missing: (r.missing ?? []).filter((m) => m !== "badge" && m !== "details") };
}

/**
 * A result small enough to reach the agent whole. A command's output past ~30,000 characters is saved
 * to a file the agent may read cut short (live 2026-10-26: a 48 KB answer arrived truncated, the agent
 * rebuilt the cards from the fragment, one variant each). Trims the extras — details, then photos past
 * two, then the third bullet, then the health list — never a variant or a price.
 */
export function fitResult(result: { block: string | null; [k: string]: unknown }, items: any[], opts: { title?: string; size?: string }, limit = 20000): typeof result {
  const size = () => JSON.stringify(result).length;
  const steps: Array<() => void> = [
    () => { for (const it of items) delete it.details; },
    () => { for (const it of items) { if (it.photos) it.photos = it.photos.slice(0, 2); for (const c of it.colours ?? []) if (c.photos) c.photos = c.photos.slice(0, 2); } },
    () => { for (const it of items) if (it.bullets) it.bullets = it.bullets.slice(0, 2); },
    () => { result.health = undefined; },
    () => { for (const it of items) { for (const c of it.colours ?? []) if (c.photos) c.photos = c.photos.slice(0, 1); if (it.photos) it.photos = it.photos.slice(0, 1); } },
  ];
  for (const step of steps) {
    if (size() <= limit) break;
    step();
    if (result.block !== null) result.block = toBlock(items, opts);
  }
  return result;
}
