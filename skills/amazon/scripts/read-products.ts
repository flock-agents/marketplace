#!/usr/bin/env bun
/**
 * Amazon.in — search, and show each result in the owner's size, read from that variant's own page.
 *
 * Params: query (what to search) or asins (product ids to read, up to 10); size (the owner's size —
 * ask it first for anything sold in sizes — as one size, "40", or as it is written in each sizing
 * system, ["40", "M"]: the first a product sells is used); max? (products to show, default 5, at most 10); title? (the
 * block's title).
 *
 * Amazon's price, stock and delivery differ per colour and size, so a product's card is the variant for
 * the owner's size (the colour on screen in that size, else the first colour that has it), read from
 * its own page: the search result's page first, then — when that is another size — the right variant's
 * page in a second round. A product not sold in that size is left off (`skipped`). The card's other
 * colours and sizes are counted on it (moreOptions) for its "See more" button: read-variants reads them.
 *
 * Answer: { block, shown, skipped, health, note? }. `block` is the ```flock-ui fence to send as it is.
 * No product read at all is PAGE_CHANGED: Amazon's pages changed beyond the reader's fallbacks.
 */
import { PARAMS, fail, main, open, readProducts, isAsin, dp, type Session } from "./_amazon";
import { readSearchPageSource } from "./_product-read";
import { toItem, toBlock, healthOf, fitResult, type Health, type PageRead } from "./_cards";
import { variantFor, sizesOf, type Variant } from "./_variants";

const query: string = String(PARAMS.query ?? "").trim();
const asinsIn: string[] = Array.isArray(PARAMS.asins) ? PARAMS.asins.map((a: unknown) => String(a).trim().toUpperCase()) : [];
const max = Math.min(10, Math.max(1, parseInt(PARAMS.max, 10) || 5));
const sizes = sizesOf(PARAMS.size);
const sizeText = sizes.join(" / ");
const title: string | undefined = PARAMS.title ? String(PARAMS.title).slice(0, 80) : undefined;

await main(async () => {
  if (!query && asinsIn.length === 0) fail("MISSING_PARAM", "Give a query (what to search) or asins (the products to read).");
  if (asinsIn.some((a) => !isAsin(a))) fail("BAD_PARAM", "Each of asins is a 10-character Amazon product id, such as B0C2YCBW9Y.");

  // 1. The search (or the first product, when asins are given) opens the session.
  let session: Session;
  let asins = asinsIn.slice(0, 10);
  if (query) {
    session = await open(`https://www.amazon.in/s?k=${encodeURIComponent(query)}`, readSearchPageSource);
    const s = session.content;
    if (s?.captcha) fail("CAPTCHA_DETECTED", "Amazon.in is showing a CAPTCHA. Solve it in the dashboard browser session, then try again.");
    const results: { asin: string }[] = Array.isArray(s?.results) ? s.results : [];
    if (results.length === 0) return { block: null, shown: 0, skipped: [], health: [], note: `Amazon.in found nothing for "${query}", or its results page has changed.` };
    // A spare or two beyond `max`: a product not in the size, or a page that fails, leaves room for the next.
    asins = results.slice(0, Math.min(10, max + 3)).map((r) => r.asin);
  } else {
    session = await open(dp(asins[0]), "JSON.stringify({ok:true})");
  }

  // 2. Every result's page.
  const failed: { asin: string; reason: string }[] = [];
  const first = await readProducts(session, asins, failed);

  // 3. The variant for the owner's size; its own page when it is not the one read.
  const shown = new Map<string, Variant | null>();
  const skipped = [...failed];
  const second: string[] = [];
  for (const a of asins) {
    const r = first.get(a);
    if (!r) continue;
    if (!r.twister) { shown.set(a, null); continue; }
    const v = variantFor(r.twister, sizes, r.asin);
    if (!v) { skipped.push({ asin: a, reason: `not sold in size ${sizeText}` }); continue; }
    shown.set(a, v);
    if (v.asin !== r.asin) second.push(v.asin);
  }
  const variantReads = second.length ? await readProducts(session, second, failed) : new Map<string, PageRead>();

  // 4. The cards.
  const items: any[] = [];
  const health: Health[] = [];
  for (const a of asins) {
    if (!shown.has(a)) continue;
    const base = first.get(a)!;
    const v = shown.get(a) ?? null;
    const own = v && v.asin !== base.asin ? variantReads.get(v.asin) : base;
    if (!own) { skipped.push({ asin: a, reason: `its size ${sizeText} page could not be read` }); continue; }
    // A variant page leaves product-level text out sometimes: the first page fills it in.
    const read: PageRead = { ...base, ...Object.fromEntries(Object.entries(own).filter(([, x]) => x !== undefined && x !== "")) };
    health.push(healthOf(a, own));
    if (items.length >= max) continue;
    const { item, reason } = toItem(read, v, base.twister);
    if (item) items.push(item); else skipped.push({ asin: a, reason: reason ?? "unreadable" });
  }
  if (items.length === 0) {
    if (skipped.some((s) => s.reason === "CAPTCHA")) fail("CAPTCHA_DETECTED", "Amazon.in is showing a CAPTCHA. Solve it in the dashboard browser session, then try again.");
    if (sizes.length && skipped.length && skipped.every((s) => s.reason.startsWith("not sold in size"))) {
      return { block: null, shown: 0, skipped, health, note: `None of the results is sold in size ${sizeText}.` };
    }
    fail("PAGE_CHANGED", `No product page gave a title and a price (${skipped.map((s) => `${s.asin}: ${s.reason}`).join("; ") || "nothing read"}). Amazon.in's pages may have changed: read them with the skill's manual steps instead.`);
  }
  const thin = health.filter((h) => h.missing.includes("price") || h.missing.includes("photos"));
  // Each card is one variant, in the owner's size already: no pickedSize to set.
  const opts = { title };
  return fitResult({
    block: toBlock(items, opts), shown: items.length, skipped, health,
    ...(thin.length ? { note: `Some reads came back thin (${thin.map((h) => `${h.asin} missing ${h.missing.join(", ")}`).join("; ")}): Amazon.in's page may have changed.` } : {}),
  }, items, opts);
});
