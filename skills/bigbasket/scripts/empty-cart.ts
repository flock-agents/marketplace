#!/usr/bin/env bun
/**
 * BigBasket — remove everything from the cart, and confirm the cart page shows it empty. Params: (none)
 */
import { emptyCart } from "./_shop_run";
import { BIGBASKET } from "./_bigbasket";

await emptyCart(BIGBASKET);
