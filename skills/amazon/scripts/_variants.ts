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
/** One size written two ways: "M" and "Medium", "2XL" and "XX-Large", "40" and "40 cm". Never across
 *  sizing systems (no "40" ↔ "M", no UK ↔ US): a wrong match is worse than none. */
export function sameSize(a: string, b: string): boolean {
  const key = (s: string) => s.toLowerCase().replace(/[\s\-_]/g, "");
  const ka = key(a), kb = key(b);
  if (ka === kb) return true;
  if (ALIASES[ka] && ALIASES[ka] === ALIASES[kb]) return true;
  // A length unit says nothing more than the number ("40 cm" is 40). A sizing system does: UK 10, US 10
  // and EU 10 are different sizes, so they are never stripped and never matched to each other.
  const bare = (k: string) => k.replace(/(cm|inches|inch)$/g, "");
  return /^\d+(\.\d+)?$/.test(bare(ka)) && bare(ka) === bare(kb);
}

/** Does the product come in sizes at all? */
export const hasSizes = (t: Twister) => t.dims.some(isSize);

/**
 * The variant a card shows: the one the page opens on (Amazon's default), or — when the owner named a
 * size and this product sells that very size — that size in the colour on screen, else in the first
 * colour that has it in stock. Size is a variant like colour (owner 2026-10-26): no size is asked, a
 * named one is a preference, and a product that does not sell it still shows, in its default variant.
 * `matched` says whether the owner's size was found.
 */
export function variantFor(t: Twister, size: string | string[] | undefined, loadedAsin?: string): Variant | null {
  return pickVariant(t, size, loadedAsin).variant;
}

export function pickVariant(t: Twister, size: string | string[] | undefined, loadedAsin?: string): { variant: Variant | null; matched: boolean } {
  const all = variantsOf(t);
  if (all.length === 0) return { variant: null, matched: false };
  const here = onScreen(t);
  const loaded = all.find((v) => v.asin === loadedAsin);
  const fallback = loaded ?? all.find((v) => v.colour === here.colour && v.size === here.size) ?? all[0];
  const wanted = (Array.isArray(size) ? size : size ? [size] : []).filter(Boolean);
  if (wanted.length === 0 || !hasSizes(t)) return { variant: fallback, matched: false };
  const sizeDim = t.dims.find(isSize)!;
  const colour = loaded?.colour ?? here.colour;
  // Amazon marks the sizes of the colour on screen: one it marks unavailable there is shown in a colour
  // that has it, when one does.
  const state = (v: Variant) => (v.colour === here.colour && v.size !== undefined ? t.states?.[sizeDim]?.[v.size] : undefined);
  for (const one of wanted) {
    const fits = all.filter((v) => v.size !== undefined && sameSize(v.size, one));
    if (fits.length === 0) continue;
    const mine = fits.find((v) => v.colour === colour);
    if (mine && state(mine) !== "UNAVAILABLE") return { variant: mine, matched: true };
    return { variant: fits.find((v) => v !== mine) ?? mine ?? fits[0], matched: true };
  }
  return { variant: fallback, matched: false };
}

/** The colours and sizes Amazon sells beyond the one variant on the card (for its "See more" button). */
export function otherOptions(t: Twister, shown: Variant): { colours?: number; sizes?: number } {
  const all = variantsOf(t);
  const colours = new Set(all.map((v) => v.colour).filter((c) => c !== undefined && c !== shown.colour));
  const sizes = new Set(all.map((v) => v.size).filter((s) => s !== undefined && s !== shown.size));
  return { ...(colours.size ? { colours: colours.size } : {}), ...(sizes.size ? { sizes: sizes.size } : {}) };
}

/**
 * The variant pages read-variants opens, at most `cap`: whole colours only — the shown colour first,
 * then Amazon's order, each with every size it is sold in — so a size the card strikes out is one
 * Amazon does not sell or marks sold out, never one left unread. Colours that do not fit (and any past
 * the card's 8) are counted in `coloursAll` for the card's "+N more colours" link. A first colour with
 * more variants than `cap` is read up to the cap, the owner's size first.
 */
export function planReads(t: Twister, opts: { size?: string | string[]; shown?: Variant; cap?: number } = {}): { reads: Variant[]; colours: string[]; coloursAll: number } {
  const cap = Math.max(1, Math.min(opts.cap ?? 48, 48));
  const sizes = opts.size === undefined ? [] : Array.isArray(opts.size) ? opts.size : [opts.size];
  const all = variantsOf(t);
  const coloursAll = [...new Set(all.map((v) => v.colour).filter((c): c is string => c !== undefined))];
  if (coloursAll.length === 0) return { reads: all.slice(0, cap), colours: [], coloursAll: 0 };
  const first = opts.shown?.colour;
  const order = first && coloursAll.includes(first) ? [first, ...coloursAll.filter((c) => c !== first)] : coloursAll;
  const mine = (v: Variant) => (opts.shown && v.asin === opts.shown.asin ? 0 : v.size !== undefined && sizes.some((one) => sameSize(v.size!, one)) ? 1 : 2);
  const reads: Variant[] = [];
  const colours: string[] = [];
  for (const c of order) {
    if (colours.length === 8) break;
    const of = all.filter((v) => v.colour === c);
    if (reads.length + of.length > cap) {
      if (colours.length === 0) { reads.push(...of.sort((a, b) => mine(a) - mine(b)).slice(0, cap)); colours.push(c); }
      break;
    }
    reads.push(...of);
    colours.push(c);
  }
  return { reads, colours, coloursAll: coloursAll.length };
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
