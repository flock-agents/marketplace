# Changelog

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
