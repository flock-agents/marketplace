#!/usr/bin/env bun
/**
 * Zepto — remove everything from the cart, and confirm the cart page shows it empty. Params: (none)
 */
import { emptyCart } from "./_shop_run";
import { ZEPTO } from "./_zepto";

await emptyCart(ZEPTO);
