---
name: Amazon Shopping
description: Search products, add to cart, place orders, and track deliveries on Amazon.in
category: integration
requiresInstance: true
auth:
  type: browser_session
  session_name: amazon.in
  setup_instructions: "Log in to your Amazon.in account via the dashboard browser session."
tier: installable
---

# Amazon Shopping

Search for products, manage your cart, place orders, and track deliveries on Amazon.in using the connected browser session.

## Setup

The user must:
1. Open a browser session for Amazon.in via the dashboard
2. Log in to their Amazon account
3. Ensure their delivery address and payment methods are saved in their Amazon account

## When to Activate

- User asks to order something from Amazon
- User asks to search for a product on Amazon
- User wants to check order status or track a delivery
- User asks to compare prices on Amazon

## How to Use

1. **Search products**: ask for filters first, then search, read every variant, and show product cards — for every product but groceries (clothes, gifts, gadgets, home items), sized or not; never a Choice for products
   - **Every product search runs every step below, whoever asked and however the ask was worded.** A hand-off that lists what to capture ("name, price, rating, photo URL") or asks for "a list" sets the least to find, never the most: still open every product page with the product read and show one ProductCards block with its colours, sizes and variants. Search results alone never make a card.
   - **Every shopping ask is a fresh search.** Never show results from memory notes or an earlier chat: prices, stock and ASINs go stale. What was picked before may only shape the filters (size, brands liked).
   - **Filters first** (clothes, shoes, anything with sizes): ask once with a Questions block before searching — size, budget, and one question for the category (fit and sleeve for shirts). Pre-pick the owner's remembered size (or a family member's, for a gift). Never ask colour: every colour goes on the card. Never ask what the owner already said; when nothing is missing, search straight away.
   - **Search** with those filters on amazon.in and keep the best 3–5 results.
   - **Read every product page at once**: one `readPages` call in one persistent session (`authenticated-crawl`, **Reading several pages at once**) with each result's `https://www.amazon.in/dp/<ASIN>`, and close the session on that call. Each page answers with every read, so read the text and the product in the same entry — never a second load: `[{"action": "readText"}, {"action": "evaluate", "script": "<the product read>"}]`. **The product read** answers from the data Amazon builds the page from, with no clicks: `photos` (the gallery of the colour on screen, 500 px, including the ones behind "+N"), and for a product sold in colours or sizes, `colours` (every colour, the one on screen first, each with its own `photos`), `sizes` and `variants` (one per colour and size Amazon sells, each with its ASIN as `id`, the colour's price, and `available`). Paste this as the `script`, exactly as written:

     ```
     (() => { const dq = String.fromCharCode(34); const q = String.fromCharCode(39); const all = [...document.scripts].map((s) => s.textContent || '').join(' '); const grab = (key) => { const at = all.indexOf(dq + key + dq); if (at < 0) return null; let i = at + key.length + 2; while (i < all.length && all[i] !== '{' && all[i] !== '[') { if (all[i] !== ':' && all[i] !== ' ') return null; i++; } let depth = 0, str = false, esc = false; for (let j = i; j < all.length; j++) { const c = all[j]; if (str) { if (esc) esc = false; else if (c.charCodeAt(0) === 92) esc = true; else if (c === dq) str = false; continue; } if (c === dq) str = true; else if (c === '{' || c === '[') depth++; else if (c === '}' || c === ']') { depth--; if (depth === 0) { try { return JSON.parse(all.slice(i, j + 1)); } catch (e) { return null; } } } } return null; }; const price = (t) => { const k = (t || '').indexOf('₹'); if (k < 0) return undefined; let s = ''; for (const ch of t.slice(k + 1)) { if ('0123456789.,'.includes(ch)) s += ch; else if (s) break; } const n = parseFloat(s.split(',').join('')); return isNaN(n) ? undefined : n; }; const id = (u) => ((u || '').split('/I/')[1] || '').split('.')[0]; const land = document.querySelector('#landingImage, #imgBlkFront'); const main = land ? land.src || Object.keys(JSON.parse(land.getAttribute('data-a-dynamic-image') || '{}'))[0] || '' : ''; let gallery = []; for (const s of document.scripts) { const t = s.textContent || ''; const at = t.indexOf(q + 'colorImages' + q); if (at < 0) continue; const a = t.indexOf('parseJSON(' + q, at); if (a < 0) continue; const b = t.indexOf(q + ')', a + 11); try { gallery = JSON.parse(t.slice(a + 11, b).split(String.fromCharCode(92, 39)).join(q)); } catch (e) {} } const current = !main || gallery.some((p) => id(p.hiRes) === id(main) || id(p.large) === id(main) || id(p.main && Object.keys(p.main)[0]) === id(main)); const photos = (current ? gallery.map((p) => p.large || p.hiRes).filter(Boolean) : [main]).slice(0, 8); const dims = grab('dimensions') || []; const vv = grab('variationValues') || {}; const map = grab('dimensionToAsinMap') || {}; const cd = dims.find((d) => d.indexOf('color') >= 0 || d.indexOf('style') >= 0 || d.indexOf('pattern') >= 0); const sd = dims.find((d) => d.indexOf('size') >= 0); if (!dims.length || (!cd && !sd) || dims.some((d) => d !== cd && d !== sd)) return JSON.stringify({ photos: photos, all: photos.length }); const sel = (grab('selectedVariationValues') || {}); const colours = cd ? vv[cd] || [] : [null]; const sizes = sd ? vv[sd] || [] : [null]; const curC = cd ? colours[sel[cd]] : null; const sorted = grab('sortedDimValuesForAllDims') || {}; const off = {}; for (const v of (sd && sorted[sd]) || []) if (v.dimensionValueState !== 'AVAILABLE' && v.dimensionValueState !== 'SELECTED') off[v.dimensionValueDisplayText] = true; const swatchPrice = {}; for (const li of document.querySelectorAll('li.inline-twister-swatch, li[data-asin]')) { const name = li.getAttribute('title') || (li.querySelector('img') || {}).alt || ''; const p = price(li.textContent); if (name && p) swatchPrice[name.trim()] = p; } const ci = grab('colorImages') || {}; let order = colours.map((c, i) => i); if (curC) order = [colours.indexOf(curC)].concat(order.filter((i) => colours[i] !== curC)); const perColour = Math.max(1, sizes.length); order = order.slice(0, Math.min(8, Math.max(1, Math.floor(48 / perColour)))); const outColours = [], variants = []; for (const ci2 of order) { const c = colours[ci2]; if (cd) { const ps = c === curC && photos.length ? photos : (ci[c] || []).map((p) => p.large || p.hiRes).filter(Boolean); outColours.push({ name: c, photos: ps.slice(0, 4).map((u) => ({ image: u })) }); } sizes.forEach((s, si) => { const key = dims.map((d) => (d === cd ? ci2 : si)).join('_'); const asin = map[key]; if (!asin) return; variants.push({ id: asin, colour: c || undefined, size: s || undefined, price: (c && swatchPrice[c]) || undefined, available: !(c === curC && s && off[s]) }); }); } return JSON.stringify({ photos: photos.slice(0, 4), colours: cd ? outColours : undefined, sizes: sd ? sizes : undefined, variants: variants, coloursShown: outColours.length, coloursAll: cd ? colours.length : 0, current: { colour: curC, size: sd ? sizes[sel[sd]] : undefined } }); })()
     ```

     If Flock refuses the script (while you prepare a card, page scripts do not run), read the same entries with `{"action": "readImages"}` instead, use the product's own large photo from it, and show the product with the one variant on screen. On the page text, take what Amazon shows in its usual places and leave out what is not there, never reloading to hunt for it: the title; the price and the M.R.P. beside it; the rating and its review count; a badge such as Amazon's Choice or #1 Best Seller; the "About this item" bullets; the delivery line; and the stock line (In stock, Only N left).
   - **Colours and sizes come from the product read, never from clicking swatches.** Even when the ask names no colour or size, every product sold in them goes on the card with the read's `colours`, `sizes` and `variants`, so the owner picks there.
   - **Put the reads on the card's props**: per item `url` = `https://www.amazon.in/dp/<ASIN>` (its title links to the page); `colours`, `sizes` and `variants` exactly as the product read gave them (never drop, rename or invent one); on the variant that matches the read's `current` colour and size, add `price`, `mrp`, `delivery` and `stock` from the page text. A product with no `variants` in the read: up to 4 `photos[].image` on the item from its `photos`, and one `variants` row with its ASIN, price, MRP, delivery and stock. Plus `bullets` (up to 3), `details`, `rating`, `badge`; block-level `pickedSize` = the owner's size when it is one of the `sizes`. Every photo address goes in exactly as Flock gave it, as the `image` of a `photos` entry — never as `src`.
   - **A read cut short** (the daily budget runs out, a page fails, the session ends): show only the products fully read, never a guessed variant. If fewer than 3 were read, say so briefly and show what was read.
   - **Show one ProductCards** block. Only read values go on the card; never invent an ASIN. The Questions block and the ProductCards are separate turns: one reply-capable block per message.
   - Groceries and Amazon Fresh only: show the results with their photos (`authenticated-crawl`, **Photos of what you found**) in an ItemPicker to pick how many — never as markdown images, and no `image` for an item whose picture you could not match
2. **Add to cart**: Add the selected item to the user's cart
   - **Checkout from product cards**: a message starting `[Checkout from …'s product cards]` has one line per cart item, ending with its ASIN in brackets. Through the connected sign-in, open `https://www.amazon.in/dp/<ASIN>?psc=1` for each line and click Add to Cart — that exact ASIN, never a search for it. Then go to Place order.
3. **Place order**: Walk through checkout — always confirm the total and delivery address with the user before placing the order
4. **Track orders**: Check the Orders page for delivery status updates

## Rules

- ALWAYS confirm with the user before placing an order — show item, price, and delivery estimate
- Never store or display payment details
- If a product is out of stock, suggest alternatives
- Compare prices when the user asks — check multiple sellers for the same item
- For groceries, check Amazon Fresh availability first

## No App Handoff — Everything In Chat

- NEVER tell the user to open the Amazon app or website
- Everything happens in this chat — search, cart, checkout, order tracking
- For payment, walk through checkout in the browser session — never redirect to app
- If something cannot be done via the browser session, say so explicitly

## Channel Behavior

When the message came from a channel (Telegram, WhatsApp, etc.):
- Do NOT output intermediate working messages
- Only output the FINAL result: product details, cart summary, or order status
- Keep your response to ONE concise message with the complete result

## Notes

- All prices are in INR (Amazon.in)
- Amazon has a complex checkout flow — always verify address and payment before confirming
- The agent does not make payments directly — it walks through checkout and confirms with the user
- Product availability and pricing can change between search and checkout
