# Changelog

## 1.4.2

- The instructions name Flock's own tools instead of the hidden private-browser and authenticated-crawl skills and the show-payment-qr script: the `browser` tool on the signed-in session for what the functions cannot do (`open` with `session`, then `act` and `read` with its `persistentSessionId`), `show_qr` and `hand_to_owner` with the checkout's `persistentSessionId`, and the `api` tool for the saved payment preference. The rules are unchanged.

## 1.4.1

- `remove-from-cart` `{ productName?, all? }` removes lines from the cart drawer by name, or every line, and returns what it removed, what is left and the new bill. `view-cart` lines carry no product id, so removing by id always failed.

## 1.4.0

- `list-addresses`: the delivery addresses saved on Blinkit, and the location the site shows now.
- `set-delivery-location` `{ address }`: selects the saved address that is the given one (matched by the address itself, never across pincodes; a label only when one address carries it) before searching. A missing or ambiguous address fails without clicking, with the saved addresses.
- `empty-cart`: removes every line, so a quote counts only the items asked for, and succeeds only once the cart itself shows empty; it reports what it removed.
- `view-cart` reads only the open cart drawer (Blinkit has no cart page: `blinkit.com/cart` shows the home page and suggestions) and fails `NOT_CART_PAGE` on any other page, never a guessed total. It returns the full total to pay with every fee (`fees`, `feeTotal`, `discount`, `total`, `totalSource`): the page's own grand total, else subtotal + fees − discount.
- The instructions call the functions with the `run_skill` tool (no `curl` to Flock's API) and settle the delivery address with the new functions; a missing address is added on the website after the owner's yes.
- The address picker, the bill rows and emptying the cart use generic page reads tested on stand-in pages (`tests/grocery`), not yet confirmed on the live site.
