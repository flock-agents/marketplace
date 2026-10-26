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

1. **Search products**: the owner's size first, then `read-products`, and show its product cards — for every product but groceries (clothes, gifts, gadgets, home items), sized or not; never a Choice for products
   - **Every shopping ask is a fresh search.** Never show results from memory notes or an earlier chat: prices, stock and ASINs go stale. What was picked before may only shape the filters (size, brands liked).
   - **Size first.** For anything sold in sizes (clothes, shoes, rings), ask the owner's size before searching — once, with a Questions block, with budget and one question for the category (fit and sleeve for shirts) — and never search without it: Amazon's price and stock differ for every size and colour, so a card is read for that size. Pre-pick the owner's remembered size (or a family member's, for a gift); never ask what the owner already said. Working in the background, ask it with your waiting-on-user question. Never ask colour: the card shows how many more colours there are. One-size products (gadgets, toys, home items) need no question.
   - **Read with `read-products`, every time, however the ask was worded** — a hand-off that lists what to capture ("name, price, rating, photo URL") or asks for "a list" changes nothing. It searches Amazon.in and shows each result in the owner's size, read from that variant's own page (title, price, M.R.P., rating, badge, bullets, delivery, stock, photos):

     ```bash
     bash "$FLOCK_SKILLS_DIR/_shared/skill-exec.sh" amazon read-products '{"query": "men cotton casual shirt", "size": ["40", "M"], "max": 5, "title": "Cotton shirts"}'
     ```

     `query` is the search with the owner's filters in it (`"asins": ["B0C2YCBW9Y", …]` instead reads products you already have); `size` the owner's size, as each sizing system of the category writes it — brands size the same shirt 40 or M, shoes UK 9 or EU 43 — so pass every form you know (`["40", "M"]`: shirts 38 S, 40 M, 42 L, 44 XL, 46 XXL; trousers' waist 32 is also M); leave it out only for one-size products; `max` the products to show (5; at most 10); `title` the block's title. A product not sold in that size is left off (`skipped`).
   - **Send its `block` exactly as it is**, in your reply: never retype parts of it, trim, merge or rebuild it, and never add a card of your own beside it. End the reply with one question (which to add to the cart). `skipped` and `note` say what was left out and why: say so in a few words. When the output is long and saved to a file, read that file with `cat` (Bash), never the Read tool — Read cuts long lines, and a cut block is a broken card.
   - **"See all colours and sizes: <product> [<ASIN>]"** — the owner pressed the card's button for that product: run `read-variants` for the ASIN in brackets, with the owner's size, and send its `block` the same way (it is that one product's card, every colour and size read from its own page). Say first, in a few words, that it takes a minute or two.

     ```bash
     bash "$FLOCK_SKILLS_DIR/_shared/skill-exec.sh" amazon read-variants '{"asin": "B07DMZDRV4", "size": ["40", "M"]}'
     ```
   - **When it fails**: `CAPTCHA_DETECTED` or `SESSION_OUTDATED` — say so, the owner clears it in the Amazon.in browser session; `RATE_LIMITED` — try again in a few minutes; `PAGE_CHANGED`, `SCRIPT_ERROR` or no answer — Amazon.in's pages have changed: read by hand once (one `readPages` call in one persistent session, `authenticated-crawl` **Reading several pages at once**, each result's `https://www.amazon.in/dp/<ASIN>` with `[{"action": "readText"}, {"action": "readImages"}]`), show only what you read — one variant per product, its own large photo — and tell the owner the full cards are back once the skill is updated.
   - Only read values go on a card; never invent an ASIN, a colour or a size.
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
