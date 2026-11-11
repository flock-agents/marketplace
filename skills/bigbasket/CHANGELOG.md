# Changelog

## 1.4.2

- After adding, `view-cart` is compared line by line with what was meant (an add's `success` is not proof), and every mismatch is reported before asking for the yes. Moved here from the Meal Planner app's guide.
- Every `search-products` call failed with "evaluate: SyntaxError: Unexpected token 'const'": its page script was a plain template string, so its regexes lost their backslashes. It is `String.raw` now, and the rating in a card's heading ("4.2", "5122 Ratings") is no longer read as the pack size. Checked on the live search page; `tests/grocery/page-scripts.test.ts` keeps every page script's backslashes.
- A search with no product cards (BigBasket sells nothing that matches) returns no products and a `note`, instead of failing on a 10-second wait for cards: the page script waits for the cards itself.
- The instructions name Flock's own tools instead of the hidden private-browser and authenticated-crawl skills and the show-payment-qr script: the `browser` tool on the signed-in session for what the functions cannot do (`open` with `session`, then `act` and `read` with its `persistentSessionId`), `show_qr` and `hand_to_owner` with the checkout's `persistentSessionId`, and the `api` tool for the saved payment preference. The rules are unchanged.
- `add-to-cart` takes `query` (the search the product came from) and adds from those search results: the card's Add (found by its text), then its "+" for each more unit, without opening the product page; it returns `quantityAdded`. Without `query`, the product page as before.
- `set-delivery-location` finds the saved addresses by their text where the picker has no address classes (a picker of utility classes, as Blinkit's pages now are), picks the address by its own text, never its position, and presses its entry with a full pointer sequence; tested on stand-in pickers (`tests/grocery`), not yet on the live site. The instructions use `list-addresses` and `set-delivery-location` with `run_skill` before any browser use.
- `list-addresses` and `set-delivery-location` returned `NO_SAVED_ADDRESSES` on the live site, where addresses are saved: the address menu sits in the page header, which the generic reader skipped. They now use the markup captured live: the header's "Delivery in …" menu button opens the menu, each `li[role="menuitem"]` is a saved address (label, then the address). `list-addresses` opens the menu, reads every entry and closes it; `NO_SAVED_ADDRESSES` only when the opened menu has none (`PICKER_NOT_OPENED` when it does not open). `set-delivery-location` presses the matching entry, presses a "change address?" confirm if one shows (not captured live), then reads the header. Tested on stand-in pages of the captured shapes (`tests/grocery`).
- Address matching (shared by the grocery skills) goes by the address's own distinctive parts: its flat or house number together with its building or complex name. A different or missing pincode no longer rejects a match (one home is stored with different pincodes, or none, by different shops), another flat number never matches, and a label alone ("Home") never matches. Two equally good matches are still `AMBIGUOUS_ADDRESS`, none `ADDRESS_NOT_SAVED`. `confirmed` is true only when the header shows the address: its flat number or building, or a part of it the header did not show before; a header showing another flat number is not it.

## 1.4.1

- `search-products` reads today's product cards (`SKUDeck___StyledDiv`: brand, name and pack from the heading, the id from `/pd/<id>/`, selling price and MRP); the old selectors timed out on every search. Checked live 2026-11-10.
- `add-to-cart` finds the product page's button by its text ("Add to basket"), checked live 2026-11-10.

## 1.4.0

- `list-addresses`: the delivery addresses saved on BigBasket, and the location the site shows now.
- `set-delivery-location` `{ address }`: selects the saved address that is the given one (matched by the address itself, never across pincodes; a label only when one address carries it) before searching. A missing or ambiguous address fails without clicking, with the saved addresses.
- `empty-cart`: removes every line, so a quote counts only the items asked for, and succeeds only once the cart itself shows empty; it reports what it removed.
- `view-cart` reads only the `/basket` page and fails `NOT_CART_PAGE` on any other page, never a guessed total. It returns the full total to pay with every fee (`fees`, `feeTotal`, `discount`, `total`, `totalSource`): the page's own grand total, else subtotal + fees − discount.
- The instructions call the functions with the `run_skill` tool (no `curl` to Flock's API) and settle the delivery address with the new functions; a missing address is added on the website after the owner's yes.
- The address picker, the bill rows and emptying the cart use generic page reads tested on stand-in pages (`tests/grocery`), not yet confirmed on the live site.
