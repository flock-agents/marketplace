#!/usr/bin/env bun
/**
 * Amazon.in — search, and show each result as one variant, read from that variant's own page.
 *
 * Params: query (what to search) or asins (product ids to read, up to 10); size? (a size the owner
 * named, written as they wrote it — a preference only); max? (products to show, default 5, at most 10);
 * title? (the block's title).
 *
 * Size is a variant like colour (owner 2026-10-26): Amazon's price, stock and delivery differ per
 * colour and size, so a card shows the variant the page opens on, read from its own page. When the
 * owner named a size this product sells under that very name ("M" = "Medium", never "40" = "M"), that
 * variant is shown instead (its own page, in a second round); a product without it still shows, in its
 * default variant, and is listed in `notInSize`. The card counts its other colours and sizes
 * (moreOptions) for its "See more" button: read-variants reads them.
 *
 * Answer: { block, shown, skipped, health, notInSize?, note? }. `block` is the ```flock-ui fence to send
 * as it is. No product read at all is PAGE_CHANGED: Amazon's pages changed beyond the reader's fallbacks.
 */
import { PARAMS, agentId, fail, main, open, readProducts, isAsin, dp, type Session } from "./_amazon";
import { saveCards } from "./_store";
import { readSearchPageSource } from "./_product-read";
import { toItem, toBlock, healthOf, fitResult, type Health, type PageRead } from "./_cards";
import { pickVariant, sizesOf, type Variant } from "./_variants";

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
  const notInSize: string[] = [];
  for (const a of asins) {
    const r = first.get(a);
    if (!r) continue;
    if (!r.twister) { shown.set(a, null); continue; }
    const { variant: v, matched } = pickVariant(r.twister, sizes, r.asin);
    if (!v) { shown.set(a, null); continue; }
    if (sizes.length && !matched) notInSize.push(a);
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
    if (!own) { skipped.push({ asin: a, reason: "its variant's page could not be read" }); continue; }
    // A variant page leaves product-level text out sometimes: the first page fills it in.
    const read: PageRead = { ...base, ...Object.fromEntries(Object.entries(own).filter(([, x]) => x !== undefined && x !== "")) };
    health.push(healthOf(a, own));
    if (items.length >= max) continue;
    const { item, reason } = toItem(read, v, base.twister);
    if (item) items.push(item); else skipped.push({ asin: a, reason: reason ?? "unreadable" });
  }
  if (items.length === 0) {
    if (skipped.some((s) => s.reason === "CAPTCHA")) fail("CAPTCHA_DETECTED", "Amazon.in is showing a CAPTCHA. Solve it in the dashboard browser session, then try again.");
    fail("PAGE_CHANGED", `No product page gave a title and a price (${skipped.map((s) => `${s.asin}: ${s.reason}`).join("; ") || "nothing read"}). Amazon.in's pages may have changed: read them with the skill's manual steps instead.`);
  }
  const thin = health.filter((h) => h.missing.includes("price") || h.missing.includes("photos"));
  // Each card is one variant, in the owner's size already: no pickedSize to set.
  const opts = { title };
  const result = fitResult({
    block: toBlock(items, opts), shown: items.length, skipped, health,
    ...(notInSize.length ? { notInSize: { size: sizeText, asins: notInSize.filter((a) => items.some((it) => it.id === shown.get(a)?.asin || it.id === a)) } } : {}),
    ...(thin.length ? { note: `Some reads came back thin (${thin.map((h) => `${h.asin} missing ${h.missing.join(", ")}`).join("; ")}): Amazon.in's page may have changed.` } : {}),
  }, items, opts);
  // Kept for read-variants, which answers this whole set again with one product swapped in.
  saveCards(agentId, { title, items });
  return result;
});
