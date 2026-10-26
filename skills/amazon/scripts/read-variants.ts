#!/usr/bin/env bun
/**
 * Amazon.in — every colour and size of one product, each read from its own page.
 *
 * Params: asin (the product, as on its card); size? (the owner's size, as for read-products: "40" or
 * ["40", "M"]; read first in every colour);
 * max? (variant pages to open, default 40, at most 48); title? (the block's title).
 *
 * Amazon's price, stock and delivery differ per variant, so each variant's page is opened (5 tabs at a
 * time) and read on its own: no variant on the card is priced from another. Works for any dimensions
 * Amazon lists — colour, size, style, pattern (_variants.ts). Past `max`, the owner's size in every
 * colour is read first, then the shown colour's other sizes; colours beyond the card's 8 are counted
 * (moreColours). It takes a minute or two: the owner asked for it on the card's button.
 *
 * Answer: { block, variants, read, failed, note? }; `block` is the card for this one product, to send
 * as it is.
 */
import { PARAMS, fail, main, open, readProducts, isAsin, dp } from "./_amazon";
import { readProductPageSource } from "./_product-read";
import { toVariantsItem, toItem, toBlock, fitResult, type PageRead } from "./_cards";
import { planReads, variantFor, sizesOf, ownSize } from "./_variants";

const asin = String(PARAMS.asin ?? "").trim().toUpperCase();
const sizes = sizesOf(PARAMS.size);
const max = Math.min(48, Math.max(1, parseInt(PARAMS.max, 10) || 40));
const title: string | undefined = PARAMS.title ? String(PARAMS.title).slice(0, 80) : undefined;

await main(async () => {
  if (!isAsin(asin)) fail("BAD_PARAM", "asin is the product's 10-character Amazon id, as on its card (the id in brackets).");

  // 1. The product's own page: its variant table.
  const session = await open(dp(asin), readProductPageSource);
  const base = session.content as PageRead | null;
  if (!base) fail("PAGE_CHANGED", "The product page answered nothing. Amazon.in's pages may have changed.");
  if (base!.captcha) fail("CAPTCHA_DETECTED", "Amazon.in is showing a CAPTCHA. Solve it in the dashboard browser session, then try again.");
  if (!base!.asin) base!.asin = asin;
  const opts = { title: title || (base!.title ?? "").slice(0, 60), size: ownSize(base!.twister, sizes) };
  const t = base!.twister;
  if (!t) {
    // No colours or sizes on Amazon: the product as it is.
    const { item, reason } = toItem(base!, null);
    if (!item) fail("PAGE_CHANGED", `The product page gave no ${reason?.replace(/^no /, "") ?? "card"}. Amazon.in's pages may have changed.`);
    return { block: toBlock([item], opts), variants: 1, read: 1, failed: [], note: "This product comes in one colour and size only." };
  }

  // 2. Every variant's own page (the one already open counts).
  const plan = planReads(t, { size: sizes, shown: variantFor(t, sizes, base!.asin) ?? undefined, cap: max });
  const failed: { asin: string; reason: string }[] = [];
  const reads = await readProducts(session, plan.reads.map((v) => v.asin).filter((a) => a !== base!.asin), failed);
  reads.set(base!.asin!, base!);

  // 3. One card.
  const { item, reason } = toVariantsItem(base!, asin, plan, reads, t);
  if (!item) fail("PAGE_CHANGED", `No variant page gave a ${reason?.replace(/^no /, "") ?? "price"}. Amazon.in's pages may have changed.`);
  const result = {
    block: toBlock([item], opts), variants: item.variants.length, read: reads.size, failed,
    ...(failed.length ? { note: `${failed.length} variant page(s) could not be read; they are left off the card.` } : {}),
  };
  return fitResult(result, [item], opts);
});
