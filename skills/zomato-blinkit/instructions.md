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

All functions execute via `POST /api/internal/skill-exec`. Invoke via:

```bash
curl -s -X POST "$FLOCK_API_URL/api/internal/skill-exec" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $FLOCK_AUTH_TOKEN" \
  -d '{
    "skillId": "zomato-blinkit",
    "functionName": "<functionName>",
    "params": { ... },
    "agentId": "'"$FLOCK_AGENT_ID"'"
  }'
```

Examples:
```bash
# Search for products
curl -s -X POST "$FLOCK_API_URL/api/internal/skill-exec" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $FLOCK_AUTH_TOKEN" \
  -d '{"skillId":"zomato-blinkit","functionName":"search-products","params":{"query":"milk","maxResults":5},"agentId":"'"$FLOCK_AGENT_ID"'"}'

# Add to cart
curl -s -X POST "$FLOCK_API_URL/api/internal/skill-exec" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $FLOCK_AUTH_TOKEN" \
  -d '{"skillId":"zomato-blinkit","functionName":"add-to-cart","params":{"productId":"12345","quantity":1},"agentId":"'"$FLOCK_AGENT_ID"'"}'

# View cart
curl -s -X POST "$FLOCK_API_URL/api/internal/skill-exec" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $FLOCK_AUTH_TOKEN" \
  -d '{"skillId":"zomato-blinkit","functionName":"view-cart","params":{},"agentId":"'"$FLOCK_AGENT_ID"'"}'
```

**Use these functions for these operations, not authenticated-crawl:** the scripts drive the browser for you, with session management and rate limiting. For anything they cannot do, or when one keeps failing for a reason other than sign-in, do it with authenticated-crawl on the same signed-in session. Ask the owner before placing an order or paying.

## Available Functions

### search-products
Search for products on Blinkit. Params: `{ query: string, maxResults?: number }`

### add-to-cart
Add a product to the cart by product ID. Params: `{ productId: string, quantity?: number }`

### view-cart
View current cart contents with prices and totals. Params: `{}`

### remove-from-cart
Remove an item from the cart. Params: `{ productId: string }`

### track-order
Track an existing order by order ID. Params: `{ orderId: string }`

### view-order-history
View recent order history. Params: `{ maxResults?: number }`

### checkout
Proceed through checkout and capture a payment link for the user. Params: `{ persistentSessionId?: string }`

- If `persistentSessionId` is provided (from a prior add-to-cart), reuses that session
- Otherwise creates a new session starting at the cart page
- **Smart Checkout** runs automatically before payment:
  1. Checks delivery fee and free delivery threshold
  2. Opens the coupons/offers section
  3. Discovers all available coupons from Blinkit's UI
  4. Tries applying the best coupon (up to 3 attempts)
  5. Reports savings and price breakdown
- Walks through checkout: proceed → payment method → capture payment URL
- Returns a payment link (URL or UPI intent) that the user can use to complete payment
- The agent returns the link in its response — the user pays via whatever channel they're on
- Response includes `smartCheckout` with coupon and delivery details

## No App Handoff — Everything In Chat

- NEVER tell the user to open the app, check the website, or review on the platform
- Everything happens in this chat — search, cart, checkout, payment
- If an item is out of stock, offer alternatives or check another connected platform
- For payment, generate and share the payment link directly — never redirect to app
- If something cannot be done via the browser session, say so explicitly — do not redirect to the app

## Address-First Flow

When placing ANY new order, the FIRST thing to do — before searching for items — is confirm the delivery address:

1. Ask the user: "Which address should I deliver to?"
2. Fetch the user's saved addresses from the platform. No function lists them: open the site's address selection with authenticated-crawl on the same signed-in session and extract every saved address via `evaluate`
3. Present the list: "I found these saved addresses: 1. Home — ... 2. Work — ..."
4. User picks one → select it on the platform the same way
5. THEN proceed with item search and cart

**Rules:**
- ONLY use saved addresses — the agent cannot add new addresses via browser automation (address forms are complex, need GPS pin, etc.)
- If the user wants an address that's not saved, tell them: "That address isn't saved on Blinkit. Please add it in the app first, then I can use it for your order."
- Address selection happens BEFORE any item search — don't build a cart without knowing where to deliver
- Remember the selected address for the session — don't ask again for subsequent orders in the same conversation
- If only one address is saved, confirm it: "I'll deliver to Home — <address>. Correct?"

## Channel Behavior

When the message came from a channel (Telegram, WhatsApp, etc.) — identified by `[via telegram]`, `[via whatsapp]`, or `SECURITY CONTEXT: You are responding to an EXTERNAL user via` in the prompt:

- Do NOT output intermediate working messages ("Creating session...", "Found the search bar...", "Adding milk to cart...")
- Only output the FINAL result: cart summary with items, quantities, prices, and payment link
- Keep your response to ONE concise message with the complete result
- Intermediate messages flood the user's chat — they only want the final outcome

## Notes

- All prices are in INR
- Delivery address is confirmed via the Address-First Flow before any items are added
- The agent can complete the full flow: search → add to cart → checkout → return payment link
- Payment is completed by the user via the returned link — the agent does not make payments
- Blinkit is accessed via blinkit.com (separate domain from Zomato food delivery)
- Blinkit promises delivery in minutes — product availability depends on the nearest dark store

## Smart Checkout

At checkout, the agent automatically:
- Checks for available coupons and applies the best one
- Reports the delivery fee and whether free delivery is available
- If the user is close to a free delivery threshold, suggests adding a low-cost item
- Presents a savings breakdown before generating the payment link:
  subtotal, delivery fee, coupon discount, and final total
- Coupon codes are discovered from Blinkit's own UI — never hardcoded
