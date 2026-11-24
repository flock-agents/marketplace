#!/usr/bin/env bun
/**
 * Blinkit — remove everything from the cart drawer, and confirm the cart shows empty. Params: (none)
 */
import { emptyCart } from "./_shop_run";
import { BLINKIT_SITE } from "./_blinkit";

await emptyCart(BLINKIT_SITE);
