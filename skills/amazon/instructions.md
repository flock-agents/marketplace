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

1. **Search products**: ask for filters first, then search, read every variant, and show product cards
   - **Filters first** (clothes, shoes, anything with sizes): ask once with a Questions block before searching — size, budget, and one question for the category (fit and sleeve for shirts). Pre-pick the owner's remembered size (or a family member's, for a gift). Never ask colour: every colour goes on the card. Never ask what the owner already said; when nothing is missing, search straight away.
   - **Search** with those filters on amazon.in and keep the best 3–5 results.
   - **Read each product page** in one persistent session (`authenticated-crawl`, **Reading a product's variants**): photos per colour (up to 4), up to 3 bullets, the details text, rating, badge, and every colour × the owner's size and one size either side — each variant's ASIN, price, MRP, delivery and stock. Close the session when done.
   - **Put the reads on the card's props**: per item `colours[].photos[].image` (up to 4 per colour), `sizes` (only those read), `variants[]` with `id` = the ASIN, `colour`, `size`, `price`, `mrp`, `delivery`, `stock`, `available` (false when the page greys it out or does not sell it), plus `bullets` (up to 3), `details`, `rating`, `badge`; block-level `pickedSize` = the owner's size. Put each photo's `src` (from readImages), exactly as Flock gave it, as the `image` of a `photos` entry — never as `src`.
   - **A read cut short** (the daily budget runs out, a page fails, the session ends): show only the products fully read, never a guessed variant. If fewer than 3 were read, say so briefly and show what was read.
   - **Show one ProductCards** block. Only read values go on the card; never invent an ASIN. The Questions block and the ProductCards are separate turns: one reply-capable block per message.
   - Groceries and Amazon Fresh: show the results with their photos (`authenticated-crawl`, **Photos of what you found**) in an ItemPicker to pick how many (an item with no colours or sizes: a Choice of cards or a RowList) — never as markdown images, and no `image` for an item whose picture you could not match
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
