---
name: Zomato Blinkit
description: Search products, manage cart, and track orders on Blinkit (by Zomato)
icon: 🛵
category: integration
requiresInstance: true
auth:
  type: browser_session
  session_name: blinkit
  setup_instructions: "Log in to your Blinkit account via the dashboard. The agent will ask which saved address to deliver to when you place an order."
tier: installable
---

# Zomato Blinkit

Search for groceries, manage your cart, and track orders on Blinkit using the connected browser session.

## Setup

The user must:
1. Open a browser session for Blinkit via the dashboard
2. Log in to their Blinkit account
3. Ensure at least one delivery address is saved in their Blinkit account

## Usage

Call these functions with your `run_skill` tool: skill `zomato-blinkit`, the function's name, and its params (for example `search-products` with `{"query": "milk", "maxResults": 5}`). Never call Flock's API, a script or a port yourself.

**Use these functions for these operations, not authenticated-crawl:** the scripts drive the browser for you, with session management and rate limiting. For anything they cannot do, or when one keeps failing for a reason other than sign-in, do it with authenticated-crawl on the same signed-in session. Ask the owner before placing an order or paying.

## Available Functions

### list-addresses
The delivery addresses saved on Blinkit, and the location the site shows now. Params: `{}`
Returns `{ addresses: [{ label, address, selected }], currentLocation }`.

### set-delivery-location
Select the saved address that is the given one, before searching or filling the cart: prices, stock and fees depend on it. Params: `{ address: string }` — the address agreed with the family (its text; a label such as "Home" only when one saved address carries it).
Matches by the address itself; a different pincode never matches. Returns `{ success, selected, currentLocation, confirmed }`; `confirmed: false` means the header did not visibly change, so check the cart's delivery address. Fails without clicking: `ADDRESS_NOT_SAVED` (with `savedAddresses`) or `AMBIGUOUS_ADDRESS` (pass more of the address).

### empty-cart
Remove everything from the cart, so a quote counts only the items asked for. Params: `{}`
Returns `{ success, removed: [names], itemCount: 0 }` only after the cart itself shows empty; fails `NOT_CART_PAGE` or `CART_NOT_EMPTIED` otherwise. Tell the family what was removed when the cart held items they had put there.

### search-products
Search for products on Blinkit. Params: `{ query: string, maxResults?: number }`
Each product carries an `imageUrl`: show the results as a flock-ui block with that address, exactly as given, as each item's `image` (an ItemPicker to pick how many, or a Choice of cards), never as markdown images.

### add-to-cart
Add a product to the cart by product ID. Params: `{ productId: string, quantity?: number }`

### view-cart
The cart's items and the full total to pay, every fee included. Params: `{}`
Returns `{ verifiedCart: true, items, itemCount, subtotal, fees: [{ label, amount }], feeTotal, discount, total, totalSource, bill }`. `total` is what the person pays: the page's own grand total or to-pay line (`totalSource: "page"`), else subtotal + fees − discount (`"computed"`). It reads only the cart drawer and fails `NOT_CART_PAGE` when the page is anything else (a home page, suggestions): try once more, then report it, never a guessed total. Blinkit has no cart page: `blinkit.com/cart` shows the home page and its suggestions, so never read it as the cart; this function opens the cart drawer and reads only that.

### remove-from-cart
Remove an item from the cart. Params: `{ productId: string }`

### track-order
Track an existing order by order ID. Params: `{ orderId: string }`

### view-order-history
View recent order history. Params: `{ maxResults?: number }`

### checkout
Three phases. Params: `{ phase?: "review" | "pay" | "status", persistentSessionId?: string }`

- `review` (default): reads the cart and the full total, goes to the payment-method page and stops there; the session stays open. Nothing is paid.
- Then read the owner's saved payment preference first (private-browser skill, **Paying at checkout**, step 2), then ask the person once: the items, the total including every fee, and "Blinkit". Paying always needs that one confirmation, even in the owner's own chat.
- `pay` (optional; needs `persistentSessionId` from review — choosing UPI on the page yourself does the same): only after the yes. Selects UPI with payment capture on and returns `{ success, platform, captured, persistentSessionId }` — never a payment link. Then pay the preferred way (private-browser skill, **Paying at checkout**, steps 2–3): with the preference you read before the yes, in this same persistent session choose UPI (or a gateway that names UPI), read the page again, and press Pay / Confirm / Place order once only when UPI is plainly the selected method, nothing else that pays is still ticked and the total is the one the person said yes to; otherwise ask with the page's options. When the page or the gateway offers a UPI ID option ("UPI ID", "Pay via UPI ID", "Enter UPI ID", "Add UPI ID") and there is a UPI ID to send the request to (the owner's saved one; in a group, only after the person chose the owner's UPI app), unless the saved preference is `upi_qr`, type it there and press that option's own verify / request button. That sends a payment request to the payer's UPI app and charges nothing by itself: tell them to approve it in their UPI app within the time shown. Otherwise — no UPI ID option, no UPI ID saved, or the person picks a QR — choose QR / "Show QR" and, right after your press, run `bash "$FLOCK_SKILLS_DIR/payments/scripts/show-payment-qr.sh" --session <persistentSessionId> --wait 15` (payments skill), before any hand-off: Flock never clicks, it reads the QR your press opened and posts the QR card itself, and you never paste a UPI link. One path per attempt: after a UPI ID request that expired or failed, offer a fresh request or the QR card, and for the QR card ask for a fresh payment screen: open the payment page anew and walk it to the QR again, or hand the page over. On `payment_blocked`, tell the person plainly "<site> blocks automated payment" with the total and the `payUrl`, and offer to hand them the page with `"payment": true` so they press Pay themselves; do not press Pay again or retry in a loop, and after that hand-off ends run `show-payment-qr` once more (private-browser skill, **Paying at checkout**, step 7). On `no_payment_found` after your press, hand the page over with `"payment": true` (private-browser skill, **Paying at checkout**).
- `status`: reads the already-open payment page, `{ state: "paid" | "pending" | "failed", orderId? }`. Re-read it every 15 seconds for up to 10 minutes after the request is sent or the card is shown, then post the order confirmation.
- Never end a checkout by reporting a bug: hand the page over instead.

## No App Handoff — Everything In Chat

- NEVER tell the user to open the app, check the website, or review on the platform
- Everything happens in this chat — search, cart, checkout, payment
- If an item is out of stock, offer alternatives or check another connected platform
- For payment, send the request to the payer's UPI app by UPI ID, or show the QR card (checkout above) — never paste a payment link, never redirect to app
- If something cannot be done via the browser session, say so explicitly — do not redirect to the app

## Address-First Flow

When placing ANY new order or quoting a cart, the FIRST thing to do — before searching for items — is settle the delivery address:

1. Use the address agreed with the family (the agent's own notes say which), or ask: "Which address should I deliver to?"
2. `list-addresses`, then `set-delivery-location` with that address.
3. Then search and fill the cart.

**Rules:**
- The same address for every service in a comparison: match the address itself (building, street, area, pincode), not its label. "Home" on Blinkit may be another place, and an office is not a home.
- When the address isn't saved on Blinkit, don't quote another one. Adding it needs the owner's yes (one yes may cover several services); then add it on the website in the browser on the same signed-in session, and hand the page over if the form needs a map pin you cannot place.
- Address selection happens BEFORE any item search — don't build a cart without knowing where to deliver
- Remember the selected address for the session — don't ask again for subsequent orders in the same conversation
- If only one address is saved, confirm it: "I'll deliver to Home — <address>. Correct?"

## Channel Behavior

When the message came from a channel (Telegram, WhatsApp, etc.) — identified by `[via telegram]`, `[via whatsapp]`, or `SECURITY CONTEXT: You are responding to an EXTERNAL user via` in the prompt:

- Do NOT output intermediate working messages ("Creating session...", "Found the search bar...", "Adding milk to cart...")
- Only output the FINAL result: cart summary with items, quantities, prices, and the total, then (after a yes) the payment request or the payment card
- Keep your response to ONE concise message with the complete result
- Intermediate messages flood the user's chat — they only want the final outcome

## Notes

- All prices are in INR
- Delivery address is confirmed via the Address-First Flow before any items are added
- The agent can complete the full flow: search → add to cart → checkout → payment request to the payer's UPI app, or the payment QR card
- The person pays by approving the request in their UPI app, or by scanning the QR card, with their own UPI PIN — the agent never presses a Pay that charges by itself
- Blinkit is accessed via blinkit.com (separate domain from Zomato food delivery)
- Blinkit promises delivery in minutes — product availability depends on the nearest dark store

## Fees and savings

Before the review step, while the cart is still being built:
- Report the delivery fee and whether free delivery is available
- If the person is close to a free delivery threshold, suggest adding a low-cost item
- Coupons are applied only before the review: the person's coupon wins, or a coupon Blinkit shows on the cart page itself (never hardcoded, never guessed)

At the review, present the breakdown: subtotal, delivery fee, discount, and final total.

Once the review is done, run nothing else on the cart until the person's yes and the pay step. `view-cart`, coupon reads and address reads between the review and the pay make the payment page unpayable: the cart is reloaded and the page the pay step needs is gone. Go straight from the person's yes to the payment walk (private-browser skill, **Paying at checkout**, step 3; the `pay` phase is optional).
