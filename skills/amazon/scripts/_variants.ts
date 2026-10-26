/**
 * Amazon.in — the variant table of a product (readProductPage's `twister`): which variant to show, and
 * which to read. Pure, so it is tested offline.
 *
 * Every colour and size Amazon sells is its own product, with its own ASIN, price and stock (owner
 * 2026-10-26: "availability and prices change with each variant"), so nothing here prices a variant:
 * it only says which variant pages to open. A size is one dimension (size_name); every other dimension
 * (colour, style, pattern…) together makes the card's "colour", joined with " · " when there are several.
 */

export interface Twister {
  dims: string[];
  values: Record<string, string[]>;
  /** "<index in dims[0]>_<index in dims[1]>…" → the ASIN of that pair (pairs not sold are absent). */
  map: Record<string, string>;
  selected?: Record<string, number>;
  /** The states Amazon gives the values of each row, for the variant on screen (AVAILABLE, SELECTED…). */
  states?: Record<string, Record<string, string>>;
}

export interface Variant { asin: string; colour?: string; size?: string }

const isSize = (d: string) => /size/i.test(d);

/** Every variant Amazon sells, in its table order. */
export function variantsOf(t: Twister): Variant[] {
  const out: Variant[] = [];
  const seen = new Set<string>();
  for (const [key, asin] of Object.entries(t.map ?? {})) {
    if (!/^[A-Z0-9]{10}$/.test(asin) || seen.has(asin)) continue;
    const idx = key.split("_").map((n) => parseInt(n, 10));
    if (idx.length !== t.dims.length || idx.some((n) => !Number.isInteger(n))) continue;
    const v: Variant = { asin };
    const colour: string[] = [];
    t.dims.forEach((d, i) => {
      const value = t.values[d]?.[idx[i]];
      if (value === undefined) return;
      if (isSize(d)) v.size = value; else colour.push(value);
    });
    if (colour.length) v.colour = colour.join(" · ");
    seen.add(asin);
    out.push(v);
  }
  // Table order: by colour as Amazon lists it, then size.
  const order = (d: string, value?: string) => (value === undefined ? -1 : (t.values[d] ?? []).indexOf(value));
  const sizeDim = t.dims.find(isSize);
  const colourDims = t.dims.filter((d) => !isSize(d));
  const colourRank = (v: Variant) => colourDims.reduce((r, d) => r * 1000 + Math.max(0, (t.values[d] ?? []).findIndex((x) => (v.colour ?? "").split(" · ").includes(x))), 0);
  return out.sort((a, b) => colourRank(a) - colourRank(b) || (sizeDim ? order(sizeDim, a.size) - order(sizeDim, b.size) : 0));
}

/** The values on screen: the colour and size of the variant the page shows. */
export function onScreen(t: Twister): { colour?: string; size?: string } {
  const sel = t.selected ?? {};
  const colour: string[] = [];
  let size: string | undefined;
  for (const d of t.dims) {
    const value = typeof sel[d] === "number" ? t.values[d]?.[sel[d]] : undefined;
    if (value === undefined) continue;
    if (isSize(d)) size = value; else colour.push(value);
  }
  return { ...(colour.length ? { colour: colour.join(" · ") } : {}), ...(size !== undefined ? { size } : {}) };
}

const ALIASES: Record<string, string> = {
  xs: "xs", extrasmall: "xs", xsmall: "xs", s: "s", small: "s", m: "m", medium: "m", l: "l", large: "l",
  xl: "xl", xlarge: "xl", extralarge: "xl", xxl: "xxl", "2xl": "xxl", xxlarge: "xxl", "2xlarge": "xxl",
  xxxl: "xxxl", "3xl": "xxxl", xxxlarge: "xxxl", "3xlarge": "xxxl", "4xl": "4xl", xxxxl: "4xl", "5xl": "5xl",
};
/** One size written two ways: "M" and "Medium", "2XL" and "XX-Large", "40" and "40 cm". */
export function sameSize(a: string, b: string): boolean {
  const key = (s: string) => s.toLowerCase().replace(/[\s\-_]/g, "");
  const ka = key(a), kb = key(b);
  if (ka === kb) return true;
  if (ALIASES[ka] && ALIASES[ka] === ALIASES[kb]) return true;
  // Units around a number ("40 cm", "UK 9", "32 Inch") say nothing more than the number.
  const bare = (k: string) => k.replace(/(cm|inches|inch|uk|us|eu|india|ind)/g, "");
  return /\d/.test(ka) && bare(ka) !== "" && bare(ka) === bare(kb);
}

/** Does the product come in sizes at all? */
export const hasSizes = (t: Twister) => t.dims.some(isSize);

/**
 * The variant to show for the owner's size: the colour on screen in that size, else the first colour
 * that sells that size; with no size asked (or a product with no sizes), the variant on screen. Null
 * when the product is not sold in that size.
 */
export function variantFor(t: Twister, size: string | string[] | undefined, loadedAsin?: string): Variant | null {
  // The owner's size as each sizing system writes it ("40" and "M" for a shirt): the first that this
  // product sells wins.
  if (Array.isArray(size)) {
    for (const one of size) { const v = variantFor(t, one, loadedAsin); if (v) return v; }
    return size.length ? null : variantFor(t, undefined, loadedAsin);
  }
  const all = variantsOf(t);
  if (all.length === 0) return null;
  const here = onScreen(t);
  const loaded = all.find((v) => v.asin === loadedAsin);
  if (!size || !hasSizes(t)) return loaded ?? all.find((v) => v.colour === here.colour && v.size === here.size) ?? all[0];
  const fits = all.filter((v) => v.size !== undefined && sameSize(v.size, size));
  if (fits.length === 0) return null;
  const colour = loaded?.colour ?? here.colour;
  // Amazon marks the sizes of the colour on screen: one it marks unavailable there is shown in a colour
  // that has it, when one does.
  const sizeDim = t.dims.find(isSize)!;
  const state = (v: Variant) => (v.colour === here.colour && v.size !== undefined ? t.states?.[sizeDim]?.[v.size] : undefined);
  const mine = fits.find((v) => v.colour === colour);
  if (mine && state(mine) !== "UNAVAILABLE") return mine;
  return fits.find((v) => v !== mine) ?? mine ?? fits[0];
}

/** The colours and sizes Amazon sells beyond the one variant on the card (for its "See more" button). */
export function otherOptions(t: Twister, shown: Variant): { colours?: number; sizes?: number } {
  const all = variantsOf(t);
  const colours = new Set(all.map((v) => v.colour).filter((c) => c !== undefined && c !== shown.colour));
  const sizes = new Set(all.map((v) => v.size).filter((s) => s !== undefined && s !== shown.size));
  return { ...(colours.size ? { colours: colours.size } : {}), ...(sizes.size ? { sizes: sizes.size } : {}) };
}

/**
 * The variant pages read-variants opens, at most `cap`: every variant Amazon sells when they fit;
 * beyond that, the owner's size in every colour first, then the shown colour's other sizes, then the
 * rest in table order — so what is left out is the least likely pick. `colours` (at most 8, the card's
 * limit) are the colours kept, in the order shown.
 */
export function planReads(t: Twister, opts: { size?: string | string[]; shown?: Variant; cap?: number } = {}): { reads: Variant[]; colours: string[]; coloursAll: number } {
  const cap = Math.max(1, Math.min(opts.cap ?? 40, 48));
  const sizes = opts.size === undefined ? [] : Array.isArray(opts.size) ? opts.size : [opts.size];
  const all = variantsOf(t);
  const coloursAll = [...new Set(all.map((v) => v.colour).filter((c): c is string => c !== undefined))];
  // The shown colour first, then Amazon's order; at most 8 colours on one card.
  const first = opts.shown?.colour;
  const colours = (first && coloursAll.includes(first) ? [first, ...coloursAll.filter((c) => c !== first)] : coloursAll).slice(0, 8);
  const inCard = all.filter((v) => v.colour === undefined || colours.includes(v.colour));
  const rank = (v: Variant) => {
    if (opts.shown && v.asin === opts.shown.asin) return 0;
    if (v.size !== undefined && sizes.some((one) => sameSize(v.size!, one))) return 1;
    if (first && v.colour === first) return 2;
    return 3;
  };
  const reads = inCard.map((v, i) => ({ v, i })).sort((a, b) => rank(a.v) - rank(b.v) || a.i - b.i).slice(0, cap).map((x) => x.v);
  const kept = colours.filter((c) => reads.some((v) => v.colour === c));
  return { reads, colours: kept, coloursAll: coloursAll.length };
}

/** The owner's size param: one size ("40"), or the same size in several systems (["40", "M"]). */
export function sizesOf(param: unknown): string[] {
  const list = Array.isArray(param) ? param : param === undefined || param === null || param === "" ? [] : [param];
  return list.map((x) => String(x).trim()).filter(Boolean).slice(0, 4);
}

/** Which of this product's own sizes is the owner's, for the card's pickedSize. */
export function ownSize(t: Twister | undefined, sizes: string[]): string | undefined {
  const dim = t?.dims.find(isSize);
  if (!t || !dim) return undefined;
  for (const one of sizes) { const hit = (t.values[dim] ?? []).find((v) => sameSize(v, one)); if (hit) return hit; }
  return undefined;
}
