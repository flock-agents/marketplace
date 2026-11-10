# Changelog

## 1.4.1

- With Zepto's own connector (`zepto-mcp`), the cart and the bill come only from the connector: Zepto keeps a cart per device, so the website never sees that cart. The total to pay is the "Order Total" `get_payment_methods` returns; an order is never created to read a price (Zepto has no cancel). With no fees shown, the items total and a plain note that Zepto shows none.
- The instructions name Flock's own tools instead of the hidden private-browser and authenticated-crawl skills and the show-payment-qr script: the `browser` tool on the signed-in session for what the functions cannot do (`open` with `session`, then `act` and `read` with its `persistentSessionId`), `show_qr` and `hand_to_owner` with the checkout's `persistentSessionId`, and the `api` tool for the saved payment preference. The rules are unchanged.
- `set-delivery-location` finds the saved addresses by their text where the picker has no address classes (a picker of utility classes, as Blinkit's pages now are), picks the address by its own text, never its position, and presses its entry with a full pointer sequence; tested on stand-in pickers (`tests/grocery`), not yet on the live site. The instructions use `list-addresses` and `set-delivery-location` with `run_skill` before any browser use.

## 1.4.0

- `list-addresses`: the delivery addresses saved on Zepto, and the location the site shows now.
- `set-delivery-location` `{ address }`: selects the saved address that is the given one (matched by the address itself, never across pincodes; a label only when one address carries it) before searching. A missing or ambiguous address fails without clicking, with the saved addresses.
- `empty-cart`: removes every line, so a quote counts only the items asked for, and succeeds only once the cart itself shows empty; it reports what it removed.
- `view-cart` reads only the `/cart` page and fails `NOT_CART_PAGE` on any other page, never a guessed total. It returns the full total to pay with every fee (`fees`, `feeTotal`, `discount`, `total`, `totalSource`): the page's own grand total, else subtotal + fees − discount.
- The instructions call the functions with the `run_skill` tool (no `curl` to Flock's API) and settle the delivery address with the new functions; a missing address is added on the website after the owner's yes.
- The address picker, the bill rows and emptying the cart use generic page reads tested on stand-in pages (`tests/grocery`), not yet confirmed on the live site.
