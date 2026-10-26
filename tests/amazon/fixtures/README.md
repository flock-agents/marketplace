# Amazon.in page fixtures

Real Amazon.in pages, saved on 2026-10-26 and trimmed to what `skills/amazon/scripts/_product-read.ts`
reads: the product block (title, byline, rating, badges, price, twister, bullets, description,
delivery, availability, image block) and the scripts that hold Amazon's page data (`colorImages`,
`dimensionToAsinMap`, `variationValues`, `currentAsin`, `sortedDimValuesForAllDims`); search pages
keep their result cards only. Gzipped.

When a live `read-products` run reports a thin read (its `health` / `note`), save the page that
changed again under a new name next to these (keep the old one: the reader must still read both),
add its test, and add the new source as one more fallback in the reader.
